import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, relative, resolve } from 'path'
import { loadUserConfig } from '@main/userConfig.js'
import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import {
  addComment,
  appendCommentReply,
  lineNumberAt,
  parseComments,
  resolveComment,
  type CommentThread,
} from '@main/comments/model.js'

export interface CommentToolOptions {
  isDirtyOpenPath?: (path: string) => boolean
  now?: () => Date
  userName?: () => string | undefined
  generateId?: (existingIds: Set<string>) => string
}

export function registerCommentTools(tools: ToolRegistry, options: CommentToolOptions = {}): void {
  tools.register({
    name: 'comments.list',
    description: 'List inline review comment threads in a markdown file.',
    inputSchema: objectSchema({ path: { type: 'string' } }, ['path']),
    execute: async (params) => {
      const target = resolveWorkspaceFile(tools, requireString(params, 'path'))
      const content = readFileSync(target.abs, 'utf-8')
      return {
        path: target.rel,
        threads: parseComments(content).map(thread => summarizeThread(thread, content)),
      }
    },
  })

  tools.register({
    name: 'comments.add',
    description: 'Add an inline review comment anchored to exact visible text in a markdown file.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      anchor_text: { type: 'string' },
      text: { type: 'string' },
      by: { type: 'string' },
      expected_hash: { type: 'string' },
    }, ['path', 'anchor_text', 'text']),
    execute: async (params, ctx) => {
      const target = resolveWorkspaceFile(tools, requireString(params, 'path'))
      assertCleanOpenBuffer(target.rel, options)
      const content = readFileSync(target.abs, 'utf-8')
      assertExpectedHash(target.rel, content, optionalString(params, 'expected_hash'))
      const updated = addComment(content, {
        anchorText: requireNonEmptyString(params, 'anchor_text'),
        text: requireString(params, 'text'),
        by: authorFor(params, ctx, options),
        now: options.now?.(),
        generateId: options.generateId,
      })
      const version = writeTextFile(target.abs, updated.text)
      return {
        path: target.rel,
        id: updated.thread.id,
        thread: summarizeThread(updated.thread, updated.text),
        hash: version.hash,
        version,
      }
    },
  })

  tools.register({
    name: 'comments.reply',
    description: 'Append a reply note to an existing inline review comment thread.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      id: { type: 'string' },
      text: { type: 'string' },
      by: { type: 'string' },
      expected_hash: { type: 'string' },
    }, ['path', 'id', 'text']),
    execute: async (params, ctx) => {
      const target = resolveWorkspaceFile(tools, requireString(params, 'path'))
      assertCleanOpenBuffer(target.rel, options)
      const content = readFileSync(target.abs, 'utf-8')
      assertExpectedHash(target.rel, content, optionalString(params, 'expected_hash'))
      const updated = appendCommentReply(content, {
        id: requireNonEmptyString(params, 'id'),
        text: requireString(params, 'text'),
        by: authorFor(params, ctx, options),
        now: options.now?.(),
      })
      const version = writeTextFile(target.abs, updated.text)
      return {
        path: target.rel,
        id: updated.thread.id,
        thread: summarizeThread(updated.thread, updated.text),
        hash: version.hash,
        version,
      }
    },
  })

  tools.register({
    name: 'comments.resolve',
    description: 'Resolve an inline review comment by removing the wrapper and notes while keeping the anchored text.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      id: { type: 'string' },
      expected_hash: { type: 'string' },
    }, ['path', 'id']),
    execute: async (params) => {
      const target = resolveWorkspaceFile(tools, requireString(params, 'path'))
      assertCleanOpenBuffer(target.rel, options)
      const content = readFileSync(target.abs, 'utf-8')
      assertExpectedHash(target.rel, content, optionalString(params, 'expected_hash'))
      const updated = resolveComment(content, requireNonEmptyString(params, 'id'))
      const version = writeTextFile(target.abs, updated.text)
      return {
        path: target.rel,
        id: params.id,
        anchor: updated.anchor,
        hash: version.hash,
        version,
      }
    },
  })
}

function summarizeThread(thread: CommentThread, content: string): Record<string, unknown> {
  return {
    id: thread.id,
    anchor: thread.anchor,
    notes: thread.notes,
    line: lineNumberAt(content, thread.anchorFrom),
    tagFrom: thread.tagFrom,
    tagTo: thread.tagTo,
    anchorFrom: thread.anchorFrom,
    anchorTo: thread.anchorTo,
  }
}

function resolveWorkspaceFile(tools: ToolRegistry, requested: string): { abs: string; rel: string } {
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  const root = resolve(workspace)
  const abs = isAbsolute(requested) ? resolve(requested) : resolve(root, requested)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path traversal outside workspace is not allowed')
  return { abs, rel: toSlashPath(rel) }
}

function assertCleanOpenBuffer(path: string, options: CommentToolOptions): void {
  if (options.isDirtyOpenPath?.(path)) {
    throw new Error('File has unsaved changes in the editor')
  }
}

function assertExpectedHash(path: string, content: string, expectedHash?: string): void {
  if (expectedHash !== undefined && hashContent(content) !== expectedHash) {
    throw new Error(`Cannot write ${path}; file changed on disk.`)
  }
}

function writeTextFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf-8')
  return buildTextFileVersion(path, content)
}

function buildTextFileVersion(path: string, content: string) {
  const stat = existsSync(path) ? statSync(path) : null
  return {
    hash: hashContent(content),
    size: Buffer.byteLength(content, 'utf-8'),
    mtimeMs: stat?.mtimeMs,
    modifiedAt: stat?.mtime ? stat.mtime.toISOString() : undefined,
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

function authorFor(params: Record<string, unknown>, ctx: ToolContext, options: CommentToolOptions): string {
  const explicit = optionalString(params, 'by')
  if (explicit) return explicit
  if (ctx.actor === 'ai') return 'ai'
  return options.userName?.() || loadUserConfig().user?.name || 'user'
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function requireNonEmptyString(params: Record<string, unknown>, key: string): string {
  const value = requireString(params, key)
  if (!value.length) throw new Error(`${key} must not be empty`)
  return value
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  if (value == null) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}
