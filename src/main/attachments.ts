import { basename, isAbsolute, relative, resolve } from 'path'
import { readFileSync, realpathSync, statSync } from 'fs'

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const MEDIA_TYPE_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  xml: 'text/xml',
}

export interface KernelAttachment {
  filename: string
  path?: string
  mediaType: string
  size: number
  type: 'image' | 'text' | 'file'
  content?: string
  dataUrl?: string
}

export interface ReadAttachmentOptions {
  workspacePath?: string | null
}

export function mediaTypeFromPath(path: string): string | null {
  if (!path || !path.includes('.')) return null
  const ext = path.split('.').pop()?.toLowerCase()
  return ext ? MEDIA_TYPE_MAP[ext] || null : null
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith('image/')
}

export function isTextMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/') || mediaType === 'application/json'
}

export function readAttachmentPath(filePath: string, options: ReadAttachmentOptions = {}): KernelAttachment {
  const stat = statSync(filePath)
  if (!stat.isFile()) throw new Error(`Not a file: ${filePath}`)
  if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error(`File too large: ${basename(filePath)}`)

  const filename = basename(filePath)
  const mediaType = mediaTypeFromPath(filePath) || 'application/octet-stream'
  const workspacePath = workspaceRelativeAttachmentPath(filePath, options.workspacePath)
  const common = {
    filename,
    ...(workspacePath ? { path: workspacePath } : {}),
    mediaType,
    size: stat.size,
  }

  if (isImageMediaType(mediaType)) {
    return {
      ...common,
      type: 'image',
      dataUrl: `data:${mediaType};base64,${readFileSync(filePath).toString('base64')}`,
    }
  }

  if (isTextMediaType(mediaType)) {
    return {
      ...common,
      type: 'text',
      content: readFileSync(filePath, 'utf-8'),
    }
  }

  return {
    ...common,
    type: 'file',
    dataUrl: `data:${mediaType};base64,${readFileSync(filePath).toString('base64')}`,
  }
}

export function readAttachmentPaths(paths: string[], options: ReadAttachmentOptions = {}): KernelAttachment[] {
  return paths.map(path => readAttachmentPath(path, options))
}

function workspaceRelativeAttachmentPath(filePath: string, workspacePath?: string | null): string | undefined {
  if (!workspacePath) return undefined
  const root = resolve(workspacePath)
  const resolved = resolve(filePath)
  const rel = relative(root, resolved)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined

  const slashRel = toSlashPath(rel)
  if (slashRel === '.mim/team' || slashRel.startsWith('.mim/team/')) return slashRel

  try {
    const realRoot = realpathSync(root)
    const realFile = realpathSync(resolved)
    const realRel = relative(realRoot, realFile)
    if (!realRel || realRel.startsWith('..') || isAbsolute(realRel)) return undefined
    return slashRel
  } catch {
    return undefined
  }
}

function toSlashPath(path: string): string {
  return path.replace(/\\/g, '/')
}
