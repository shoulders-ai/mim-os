import { basename } from 'path'
import { readFileSync, statSync } from 'fs'

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
  mediaType: string
  size: number
  type: 'image' | 'text' | 'file'
  content?: string
  dataUrl?: string
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

export function readAttachmentPath(path: string): KernelAttachment {
  const stat = statSync(path)
  if (!stat.isFile()) throw new Error(`Not a file: ${path}`)
  if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error(`File too large: ${basename(path)}`)

  const filename = basename(path)
  const mediaType = mediaTypeFromPath(path) || 'application/octet-stream'

  if (isImageMediaType(mediaType)) {
    return {
      filename,
      mediaType,
      size: stat.size,
      type: 'image',
      dataUrl: `data:${mediaType};base64,${readFileSync(path).toString('base64')}`,
    }
  }

  if (isTextMediaType(mediaType)) {
    return {
      filename,
      mediaType,
      size: stat.size,
      type: 'text',
      content: readFileSync(path, 'utf-8'),
    }
  }

  return {
    filename,
    mediaType,
    size: stat.size,
    type: 'file',
    dataUrl: `data:${mediaType};base64,${readFileSync(path).toString('base64')}`,
  }
}

export function readAttachmentPaths(paths: string[]): KernelAttachment[] {
  return paths.map(path => readAttachmentPath(path))
}
