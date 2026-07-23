import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
import { createHash } from 'crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { ToolRegistry } from '@main/tools/registry.js'
import { findTextMatches } from '@main/search/textMatch.js'
import { isImageMediaType, mediaTypeFromPath, MAX_ATTACHMENT_BYTES } from '@main/attachments.js'

const DEFAULT_READ_CHARS = 50_000
const MAX_READ_CHARS = 200_000
const DEFAULT_LIST_LIMIT = 200
const MAX_LIST_LIMIT = 1_000

const SKIP_RECURSIVE_DIRS = new Set([
  '.git',
  '.mim',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  '.next',
  '.nuxt',
  '__pycache__',
  'target',
  '.venv',
  'venv',
  '.env',
])

export interface FileToolOptions {
  openNativeFile?: (path: string) => Promise<string> | string
  trashItem?: (path: string) => Promise<void>
  // Called only for user-actor trashes (a deliberate UI gesture, e.g. the
  // Files pane delete). Lets the editor close clean tabs instead of treating
  // the deletion as an external surprise. Agent/package deletes stay silent
  // here so their tabs keep the deleted-on-disk conflict banner.
  onUserTrashed?: (paths: string[]) => void
}

export function registerFileTools(tools: ToolRegistry, options: FileToolOptions = {}): void {

  tools.register({
    name: 'fs.read',
    description: 'Read a file from the workspace. Returns line and truncation metadata.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      full: { type: 'boolean' },
      max_chars: { type: 'number' },
      start_line: { type: 'number' },
      limit: { type: 'number' },
    }, ['path']),
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      const content = readFileSync(path, 'utf-8')
      return buildReadResult(tools, path, content, params)
    }
  })

  tools.register({
    name: 'fs.readImageDataUrl',
    description: 'Read a workspace image file and return a data URL for secure local preview rendering.',
    inputSchema: objectSchema({ path: { type: 'string' } }, ['path']),
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      const stat = statSync(path)
      if (!stat.isFile()) throw new Error(`Not a file: ${params.path}`)
      if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error(`Image too large: ${params.path}`)
      // SVG previews fine in <img> but stays out of the shared attachment media
      // map: model providers reject SVG as an image attachment.
      const mediaType = path.toLowerCase().endsWith('.svg')
        ? 'image/svg+xml'
        : mediaTypeFromPath(path)
      if (!mediaType || !isImageMediaType(mediaType)) {
        throw new Error(`File is not a supported image: ${params.path}`)
      }
      return {
        path: toSlashPath(relative(tools.getWorkspacePath()!, path)),
        mediaType,
        size: stat.size,
        dataUrl: `data:${mediaType};base64,${readFileSync(path).toString('base64')}`,
      }
    }
  })

  tools.register({
    name: 'fs.write',
    description: 'Overwrite content in a workspace file',
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      const content = requireString(params, 'content')
      const expectedHash = optionalString(params, 'expected_hash')
      if (expectedHash !== undefined) {
        const currentHash = existsSync(path) ? hashContent(readFileSync(path, 'utf-8')) : ''
        if (currentHash !== expectedHash) {
          throw new Error(`Cannot write ${toSlashPath(relative(tools.getWorkspacePath()!, path))}; file changed on disk.`)
        }
      }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf-8')
      const version = buildTextFileVersion(path, content)
      return {
        written: toSlashPath(relative(tools.getWorkspacePath()!, path)),
        hash: version.hash,
        version,
      }
    }
  })

  tools.register({
    name: 'fs.writeBytes',
    description: 'Overwrite a workspace file with base64-decoded binary bytes.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      base64: { type: 'string' },
    }, ['path', 'base64']),
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      const bytes = decodeBase64Bytes(requireString(params, 'base64'))
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Binary payload too large: ${bytes.length} bytes`)
      }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, bytes)
      const version = buildBinaryFileVersion(path, bytes)
      return {
        written: toSlashPath(relative(tools.getWorkspacePath()!, path)),
        hash: version.hash,
        version,
      }
    }
  })

  tools.register({
    name: 'fs.edit',
    description: 'Search-and-replace in one workspace file. Exactly one match is required.',
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      const oldText = requireNonEmptyString(params, 'old_text')
      const newText = requireString(params, 'new_text')
      const content = readFileSync(path, 'utf-8')
      const matches = findTextMatches(content, oldText)
      const relPath = toSlashPath(relative(tools.getWorkspacePath()!, path))

      if (matches.length === 0) {
        throw new Error(`Text not found in ${relPath}. File has ${content.length} characters.`)
      }
      if (matches.length > 1) {
        throw new Error(`old_text matches ${matches.length} locations in ${relPath}. Provide a longer unique passage.`)
      }

      const match = matches[0]
      const updated = content.slice(0, match.index) + newText + content.slice(match.index + match.length)
      writeFileSync(path, updated, 'utf-8')
      return { edited: relPath }
    }
  })

  tools.register({
    name: 'fs.create',
    description: 'Create a new file (fails if it already exists)',
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      if (existsSync(path)) throw new Error(`File already exists: ${params.path}`)
      const content = optionalString(params, 'content') ?? ''
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf-8')
      return { created: toSlashPath(relative(tools.getWorkspacePath()!, path)) }
    }
  })

  tools.register({
    name: 'fs.delete',
    description: 'Delete a workspace file. Directories are refused.',
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      if (statSync(path).isDirectory()) {
        throw new Error(`Cannot delete directories: ${params.path}`)
      }
      unlinkSync(path)
      return { deleted: toSlashPath(relative(tools.getWorkspacePath()!, path)) }
    }
  })

  tools.register({
    name: 'fs.trash',
    description: 'Move a workspace file or directory to the OS trash (recoverable).',
    inputSchema: objectSchema({ path: { type: 'string' } }, ['path']),
    execute: async (params, ctx) => {
      if (!options.trashItem) throw new Error('Trash is not available')
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      if (!existsSync(path)) throw new Error(`Path does not exist: ${params.path}`)
      await options.trashItem(path)
      const trashed = toSlashPath(relative(tools.getWorkspacePath()!, path))
      if (ctx.actor === 'user') options.onUserTrashed?.([trashed])
      return { trashed }
    }
  })

  tools.register({
    name: 'fs.copy',
    description: 'Copy a workspace file or directory. Without new_path, picks a collision-free "<name> copy" sibling.',
    inputSchema: objectSchema({ path: { type: 'string' }, new_path: { type: 'string' } }, ['path']),
    execute: async (params) => {
      const sourceParam = requireString(params, 'path')
      const source = resolveWorkspacePath(tools, sourceParam)
      if (!existsSync(source)) throw new Error(`Source does not exist: ${sourceParam}`)
      const newPathParam = optionalString(params, 'new_path')
      let target: string
      if (newPathParam !== undefined) {
        target = resolveWorkspacePath(tools, newPathParam)
        if (existsSync(target)) throw new Error(`Destination already exists: ${newPathParam}`)
      } else {
        target = nextCopyPath(source)
      }
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target, { recursive: true, errorOnExist: true, force: false })
      return {
        copied: {
          from: toSlashPath(relative(tools.getWorkspacePath()!, source)),
          to: toSlashPath(relative(tools.getWorkspacePath()!, target)),
        }
      }
    }
  })

  tools.register({
    name: 'fs.import',
    description: 'Copy an external file or directory into the workspace (drag-drop / explicit ingestion). Source must be an absolute path outside the workspace.',
    inputSchema: objectSchema({ source_path: { type: 'string' }, dest_dir: { type: 'string' } }, ['source_path']),
    execute: async (params) => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      const sourceParam = requireString(params, 'source_path')
      if (!isAbsolute(sourceParam)) throw new Error('source_path must be absolute')
      const source = resolve(sourceParam)
      if (!existsSync(source)) throw new Error(`Source does not exist: ${sourceParam}`)
      const root = resolve(workspace)
      const relSource = relative(root, source)
      if (!relSource.startsWith('..') && !isAbsolute(relSource)) {
        throw new Error('Source is already inside the workspace; use fs.copy instead')
      }
      const destDir = resolveWorkspacePath(tools, optionalString(params, 'dest_dir') ?? '.')
      mkdirSync(destDir, { recursive: true })
      const target = nextAvailablePath(destDir, basename(source))
      cpSync(source, target, { recursive: true, errorOnExist: true, force: false })
      return { imported: toSlashPath(relative(root, target)) }
    }
  })

  tools.register({
    name: 'fs.list',
    description: 'List workspace directory entries. Recursive mode skips heavy/generated directories.',
    execute: async (params) => {
      const dir = resolveWorkspacePath(tools, optionalString(params, 'path') ?? '.')
      const recursive = optionalBoolean(params, 'recursive') ?? false
      const pattern = optionalString(params, 'pattern')
      const limit = optionalPositiveInteger(params, 'max_entries', DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
      const includeLastChangedBy = optionalBoolean(params, 'include_last_changed_by') ?? false
      return await listEntries(tools, dir, { recursive, pattern, limit, includeLastChangedBy })
    }
  })

  tools.register({
    name: 'fs.exists',
    description: 'Check if a path exists in the workspace',
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      return { exists: existsSync(path) }
    }
  })

  tools.register({
    name: 'fs.openNative',
    description: 'Open a workspace file with the default system application.',
    inputSchema: objectSchema({ path: { type: 'string' } }, ['path']),
    execute: async (params) => {
      if (!options.openNativeFile) throw new Error('Native file opening is not available')
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      const stat = statSync(path)
      if (!stat.isFile()) throw new Error(`Not a file: ${params.path}`)
      const error = await options.openNativeFile(path)
      if (typeof error === 'string' && error.length > 0) throw new Error(error)
      return { opened: toSlashPath(relative(tools.getWorkspacePath()!, path)) }
    }
  })

  tools.register({
    name: 'fs.mkdir',
    description: 'Create a directory recursively',
    execute: async (params) => {
      const path = resolveWorkspacePath(tools, requireString(params, 'path'))
      if (existsSync(path) && statSync(path).isFile()) {
        throw new Error(`Path already exists as a file: ${params.path}`)
      }
      mkdirSync(path, { recursive: true })
      return { created: toSlashPath(relative(tools.getWorkspacePath()!, path)) }
    }
  })

  tools.register({
    name: 'fs.rename',
    description: 'Rename or move a workspace path. Destination must not exist.',
    execute: async (params) => {
      const oldPathParam = requireString(params, 'old_path')
      const newPathParam = requireString(params, 'new_path')
      const oldPath = resolveWorkspacePath(tools, oldPathParam)
      const newPath = resolveWorkspacePath(tools, newPathParam)
      if (!existsSync(oldPath)) throw new Error(`Source does not exist: ${oldPathParam}`)
      if (existsSync(newPath)) throw new Error(`Destination already exists: ${newPathParam}`)
      mkdirSync(dirname(newPath), { recursive: true })
      renameSync(oldPath, newPath)
      return {
        renamed: {
          from: toSlashPath(relative(tools.getWorkspacePath()!, oldPath)),
          to: toSlashPath(relative(tools.getWorkspacePath()!, newPath)),
        }
      }
    }
  })
}

// "report.md" -> "report copy.md" -> "report copy 2.md" (first free slot).
function nextCopyPath(source: string): string {
  const dir = dirname(source)
  const name = source.split(/[/\\]/).pop()!
  const isDir = statSync(source).isDirectory()
  const dot = isDir ? -1 : name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' copy' : ` copy ${n}`
    const candidate = join(dir, `${stem}${suffix}${ext}`)
    if (!existsSync(candidate)) return candidate
  }
}

// "notes.md" -> "notes 2.md" -> "notes 3.md" (Finder-style import collisions).
function nextAvailablePath(dir: string, name: string): string {
  const first = join(dir, name)
  if (!existsSync(first)) return first
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = join(dir, `${stem} ${n}${ext}`)
    if (!existsSync(candidate)) return candidate
  }
}

function resolveWorkspacePath(tools: ToolRegistry, relativePath: string): string {
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  const root = resolve(workspace)
  const resolved = resolve(root, relativePath)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path traversal outside workspace is not allowed')
  }
  assertNoSymlinkEscape(resolved, root)
  return resolved
}

// Prevent symlink-based escapes: if any component in the resolved path is a
// symlink whose real target lands outside the workspace, reject the operation.
// Paths under .mim/team/ are exempt because that checkout symlink is the one
// managed external root. The permission gate protects the mount itself.
function assertNoSymlinkEscape(resolved: string, root: string): void {
  const rel = relative(root, resolved)
  if (rel === join('.mim', 'team') || rel.startsWith(`${join('.mim', 'team')}${sep}`)) return

  // Walk to the deepest component that exists as a directory entry. lstat
  // (not existsSync) so a DANGLING symlink is still inspected — existsSync
  // follows links, and a write through a dangling link would create its
  // target outside the workspace.
  let check = resolved
  while (!lexists(check)) {
    const parent = dirname(check)
    if (parent === check) return
    check = parent
  }

  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(check)
  } catch (err) {
    // Vanished between the walk and lstat; the operation will surface ENOENT.
    // Anything else (EPERM, EACCES, EIO) propagates — skipping the check on
    // an unreadable path would fail open.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  if (!stat.isSymbolicLink() && !hasSymlinkAncestor(check, root)) return

  let real: string
  try {
    real = realpathSync(check)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    if (!stat.isSymbolicLink()) return
    // Dangling symlink: realpath cannot resolve it, but a write through it
    // still creates the target — resolve the link text manually instead.
    real = resolve(dirname(check), readlinkSync(check))
  }
  const remainder = relative(check, resolved)
  // Canonicalize both sides so /var vs /private/var (macOS) doesn't produce
  // a false-positive escape — including for targets that don't exist yet.
  const fullReal = canonicalizeBestEffort(
    remainder && remainder !== '.' ? join(real, remainder) : real,
  )
  let canonicalRoot: string
  try { canonicalRoot = realpathSync(root) } catch { canonicalRoot = root }
  const realRel = relative(canonicalRoot, fullReal)
  if (realRel.startsWith('..') || isAbsolute(realRel)) {
    throw new Error('Path resolves outside workspace via symlink')
  }
}

function lexists(path: string): boolean {
  try { lstatSync(path); return true } catch { return false }
}

// realpath the deepest existing ancestor and reattach the non-existing tail,
// so not-yet-created targets still compare canonically.
function canonicalizeBestEffort(path: string): string {
  let base = path
  const tail: string[] = []
  while (!lexists(base)) {
    const parent = dirname(base)
    if (parent === base) return path
    tail.unshift(basename(base))
    base = parent
  }
  try { return join(realpathSync(base), ...tail) } catch { return path }
}

function hasSymlinkAncestor(path: string, stopAt: string): boolean {
  let current = dirname(path)
  const stop = resolve(stopAt)
  while (current.length >= stop.length && current !== dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) return true
    } catch { break }
    current = dirname(current)
  }
  return false
}

function buildReadResult(
  tools: ToolRegistry,
  path: string,
  content: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const version = buildTextFileVersion(path, content)
  const full = optionalBoolean(params, 'full') ?? false
  const maxChars = full ? Infinity : optionalPositiveInteger(params, 'max_chars', DEFAULT_READ_CHARS, MAX_READ_CHARS)
  const startLine = optionalPositiveInteger(params, 'start_line', 1)
  const lineLimit = optionalPositiveInteger(params, 'limit', undefined)
  const lines = content.length === 0 ? [] : content.split(/\r\n|\n|\r/)
  const totalLines = lines.length

  let selected = content
  let outStartLine = totalLines === 0 ? 0 : 1
  let outEndLine = totalLines
  let truncated = false

  if (totalLines > 0 && (startLine !== 1 || lineLimit !== undefined)) {
    const startIndex = Math.min(startLine - 1, totalLines)
    const endIndex = lineLimit === undefined ? totalLines : Math.min(startIndex + lineLimit, totalLines)
    selected = lines.slice(startIndex, endIndex).join('\n')
    outStartLine = startIndex >= totalLines ? startLine : startIndex + 1
    outEndLine = endIndex > startIndex ? endIndex : totalLines
    truncated = outStartLine > 1 || outEndLine < totalLines
  }

  if (selected.length > maxChars) {
    selected = selected.slice(0, maxChars)
    truncated = true
  }

  return {
    content: selected,
    path: toSlashPath(relative(tools.getWorkspacePath()!, path)),
    total_lines: totalLines,
    start_line: outStartLine,
    end_line: outEndLine,
    total_chars: content.length,
    hash: version.hash,
    version,
    truncated,
  }
}

function buildTextFileVersion(path: string, content: string): { hash: string; size: number; mtimeMs: number; modifiedAt: string } {
  const stat = statSync(path)
  return {
    hash: hashContent(content),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    modifiedAt: stat.mtime.toISOString(),
  }
}

function buildBinaryFileVersion(path: string, content: Buffer): { hash: string; size: number; mtimeMs: number; modifiedAt: string } {
  const stat = statSync(path)
  return {
    hash: hashBuffer(content),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    modifiedAt: stat.mtime.toISOString(),
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function hashBuffer(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function decodeBase64Bytes(value: string): Buffer {
  const normalized = value.trim()
  if (normalized.length === 0) return Buffer.alloc(0)
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('Invalid base64 payload')
  }
  const bytes = Buffer.from(normalized, 'base64')
  if (bytes.toString('base64') !== normalized) throw new Error('Invalid base64 payload')
  return bytes
}

async function listEntries(
  tools: ToolRegistry,
  dir: string,
  options: { recursive: boolean; pattern?: string; limit: number; includeLastChangedBy: boolean },
): Promise<Record<string, unknown>> {
  const workspace = tools.getWorkspacePath()!
  const matcher = options.pattern ? globToRegex(options.pattern) : null
  const entries: Array<{
    name: string
    path: string
    type: 'directory' | 'file'
    size?: number
    modifiedAt: string
    createdAt: string
    lastChangedBy?: string
  }> = []
  let truncated = false
  let missing = false

  function addEntry(fullPath: string, type: 'directory' | 'file'): void {
    const relPath = toSlashPath(relative(workspace, fullPath))
    const name = relPath.split('/').pop() ?? relPath
    if (matcher && !matchesPattern(matcher, options.pattern!, relPath, name)) return
    if (entries.length >= options.limit) {
      truncated = true
      return
    }
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(fullPath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    entries.push({
      name,
      path: relPath || '.',
      type,
      size: type === 'file' ? stat.size : undefined,
      modifiedAt: stat.mtime.toISOString(),
      createdAt: stat.birthtime.toISOString(),
    })
  }

  function walk(current: string): void {
    if (truncated) return
    let dirents: ReturnType<typeof readdirSync>
    try {
      dirents = readdirSync(current, { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        missing = current === dir
        return
      }
      throw err
    }
    dirents = dirents.sort((a, b) => a.name.localeCompare(b.name))

    for (const dirent of dirents) {
      if (truncated) return
      const fullPath = join(current, dirent.name)

      if (dirent.isDirectory()) {
        if (options.recursive && SKIP_RECURSIVE_DIRS.has(dirent.name)) continue
        addEntry(fullPath, 'directory')
        if (options.recursive) walk(fullPath)
        continue
      }

      if (dirent.isFile()) addEntry(fullPath, 'file')
    }
  }

  walk(dir)

  if (options.includeLastChangedBy) {
    const paths = entries.map(entry => entry.path).filter(path => path !== '.')
    const authors = await readLastChangedByMapAsync(workspace, paths)
    for (const entry of entries) entry.lastChangedBy = authors.get(entry.path)
  }

  return {
    entries,
    truncated,
    limit: options.limit,
    ...(missing ? { missing: true } : {}),
  }
}

// Cache for git author lookups, keyed by directory path.
// Each cache entry stores the author map and the directory's mtime at lookup
// time. mtime alone is not enough: commits and file content edits do not bump
// the parent directory's mtime, so a TTL bounds how stale authors can get.
const AUTHOR_CACHE_TTL_MS = 30_000
const authorCache = new Map<string, { mtimeMs: number; cachedAt: number; authors: Map<string, string> }>()

async function readLastChangedByMapAsync(workspace: string, relPaths: string[]): Promise<Map<string, string>> {
  const authors = new Map<string, string>()
  if (relPaths.length === 0) return authors

  // Derive a cache key from the directory being listed (parent of the first path)
  const cacheKey = relPaths[0].includes('/') ? relPaths[0].split('/').slice(0, -1).join('/') : '.'
  const dirFullPath = cacheKey === '.' ? workspace : join(workspace, cacheKey)

  // Check cache: invalidate if directory mtime has changed
  try {
    const dirMtime = statSync(dirFullPath).mtimeMs
    const cached = authorCache.get(cacheKey)
    if (cached && cached.mtimeMs >= dirMtime && Date.now() - cached.cachedAt < AUTHOR_CACHE_TTL_MS) {
      // Return cached results for paths that are in the cache
      for (const path of relPaths) {
        const author = cached.authors.get(path)
        if (author) authors.set(path, author)
      }
      return authors
    }
  } catch {
    // stat failed, proceed without cache
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', workspace, 'log', '--max-count=200', '--name-only', '--format=__MIM_AUTHOR__%an', '--', ...relPaths],
      {
        encoding: 'utf8',
        timeout: 1500,
        maxBuffer: 2 * 1024 * 1024,
      },
    )
    let author = ''
    const pending = new Set(relPaths)
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.startsWith('__MIM_AUTHOR__')) {
        author = line.slice('__MIM_AUTHOR__'.length).trim()
        continue
      }
      if (!author) continue
      for (const path of Array.from(pending)) {
        if (line === path || line.startsWith(`${path}/`)) {
          authors.set(path, author)
          pending.delete(path)
        }
      }
      if (pending.size === 0) break
    }

    // Update cache
    try {
      const dirMtime = statSync(dirFullPath).mtimeMs
      authorCache.set(cacheKey, { mtimeMs: dirMtime, cachedAt: Date.now(), authors: new Map(authors) })
    } catch {
      // stat failed, skip caching
    }
  } catch {
    return authors
  }
  return authors
}

// Exported for testing only
export { authorCache as _authorCache }

function matchesPattern(regex: RegExp, pattern: string, relPath: string, name: string): boolean {
  regex.lastIndex = 0
  if (regex.test(relPath)) return true
  if (!pattern.includes('/')) {
    regex.lastIndex = 0
    return regex.test(name)
  }
  return false
}

function globToRegex(pattern: string): RegExp {
  let source = '^'
  let i = 0

  while (i < pattern.length) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?'
          i += 3
        } else {
          source += '.*'
          i += 2
        }
      } else {
        source += '[^/]*'
        i++
      }
      continue
    }

    if (char === '?') {
      source += '[^/]'
      i++
      continue
    }

    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    i++
  }

  return new RegExp(`${source}$`, 'i')
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function requireNonEmptyString(params: Record<string, unknown>, key: string): string {
  const value = requireString(params, key)
  if (value.length === 0) throw new Error(`${key} must not be empty`)
  return value
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  if (value == null) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key]
  if (value == null) return undefined
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  return value
}

function optionalPositiveInteger(
  params: Record<string, unknown>,
  key: string,
  defaultValue?: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = params[key]
  if (value == null) return defaultValue as number
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${key} must be a positive integer`)
  }
  return Math.min(value as number, max)
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}
