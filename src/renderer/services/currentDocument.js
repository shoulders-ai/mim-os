let currentProvider = null
const listeners = new Set()

export function registerCurrentDocumentProvider(provider) {
  currentProvider = provider
  notifyCurrentDocumentChanged()

  return () => {
    if (currentProvider === provider) {
      currentProvider = null
      notifyCurrentDocumentChanged()
    }
  }
}

export async function getCurrentDocument() {
  if (!currentProvider) return null
  const document = await currentProvider()
  return normalizeDocument(document)
}

export async function getCurrentDocumentSummary() {
  const document = await getCurrentDocument()
  if (!document) return null
  return {
    id: document.id,
    path: document.path,
    name: document.name,
    mediaType: document.mediaType,
    dirty: document.dirty,
    size: document.content.length,
  }
}

export function subscribeCurrentDocument(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyCurrentDocumentChanged() {
  for (const listener of listeners) {
    listener()
  }
}

function normalizeDocument(document) {
  if (!document || typeof document !== 'object') return null
  const content = typeof document.content === 'string' ? document.content : ''
  const path = typeof document.path === 'string' ? document.path : ''
  const name = typeof document.name === 'string' && document.name
    ? document.name
    : path.split('/').pop() || 'Untitled'

  return {
    id: typeof document.id === 'string' && document.id ? document.id : path || name,
    path,
    name,
    content,
    mediaType: typeof document.mediaType === 'string' && document.mediaType ? document.mediaType : mediaTypeFromName(path || name),
    dirty: Boolean(document.dirty),
  }
}

function mediaTypeFromName(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase()
  if (ext === 'md') return 'text/markdown'
  if (ext === 'csv') return 'text/csv'
  if (ext === 'json') return 'application/json'
  if (ext === 'yaml' || ext === 'yml') return 'text/yaml'
  if (ext === 'xml') return 'text/xml'
  return 'text/plain'
}
