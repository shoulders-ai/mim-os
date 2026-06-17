const MAX_FILE_SIZE = 20 * 1024 * 1024

const MEDIA_TYPE_MAP = {
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

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']
export const PDF_EXTENSIONS = ['pdf']
export const TEXT_EXTENSIONS = ['md', 'txt', 'csv', 'json', 'yaml', 'yml', 'xml']
export const ALL_FILE_EXTENSIONS = [...IMAGE_EXTENSIONS, ...PDF_EXTENSIONS, ...TEXT_EXTENSIONS]

export function mediaTypeFromFilename(name) {
  if (!name || !String(name).includes('.')) return null
  const ext = String(name).split('.').pop()?.toLowerCase()
  return MEDIA_TYPE_MAP[ext] || null
}

export function isImageType(mediaType) {
  return typeof mediaType === 'string' && mediaType.startsWith('image/')
}

export function isPdfType(mediaType) {
  return mediaType === 'application/pdf'
}

export function isTextType(mediaType) {
  return typeof mediaType === 'string' && (mediaType.startsWith('text/') || mediaType === 'application/json')
}

export function toDataUrl(mediaType, base64) {
  return `data:${mediaType};base64,${base64}`
}

export function textToDataUrl(mediaType, text) {
  return toDataUrl(mediaType || 'text/plain', textToBase64(String(text ?? '')))
}

export function toFileUIParts(attachments) {
  if (!Array.isArray(attachments)) return []

  return attachments.map((att) => {
    if (!att) return null

    if (att.dataUrl && att.mediaType && !isTextType(att.mediaType)) {
      return {
        type: 'file',
        mediaType: att.mediaType,
        filename: att.filename,
        url: att.dataUrl,
      }
    }

    return null
  }).filter(Boolean)
}

export function toContextUIParts(attachments) {
  if (!Array.isArray(attachments)) return []

  return attachments.map((att) => {
    if (!att || att.content == null) return null

    const data = {
      filename: att.filename || 'attachment.txt',
      mediaType: att.mediaType || 'text/plain',
      content: String(att.content ?? ''),
    }
    if (Number.isFinite(att.size) && att.size >= 0) data.size = att.size
    if (att.kind === 'comments') data.kind = 'comments'
    if (typeof att.path === 'string') data.path = att.path
    if (Array.isArray(att.threads)) data.threads = att.threads

    return {
      type: 'data-context',
      data,
    }
  }).filter(Boolean)
}

export function toUserMessageParts(text, attachments) {
  const fileParts = toFileUIParts(attachments)
  const contextParts = toContextUIParts(attachments)
  const textPart = String(text || '').trim()
  return [
    ...fileParts,
    ...contextParts,
    ...(textPart ? [{ type: 'text', text: textPart }] : []),
  ]
}

function textToBase64(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function validateFileSize(size) {
  return Number.isFinite(size) && size >= 0 && size <= MAX_FILE_SIZE
}

export function isAttachmentPlaceholder(part) {
  return part != null && part._attachmentPlaceholder === true
}

export function isContextUIPart(part) {
  return part != null && part.type === 'data-context' && part.data != null
}

export function contextPartFilename(part) {
  if (!isContextUIPart(part)) return 'Attachment'
  const filename = part.data.filename
  return typeof filename === 'string' && filename.trim() ? filename : 'Attachment'
}
