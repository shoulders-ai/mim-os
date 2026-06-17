export function escapePromptXml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function documentIdFromPath(path) {
  if (!path) return null
  return String(path).replace(/^\/+/, '').replace(/[^a-zA-Z0-9._/-]+/g, '-')
}
