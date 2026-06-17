// Chat session → downloadable JSON file. Pure payload/filename builders are
// exported separately from the DOM download trigger so they stay testable.
import type { Session } from '../stores/sessions.js'

export function buildSessionExport(session: Session) {
  return {
    _format: 'mim-session-v1',
    exportedAt: new Date().toISOString(),
    session: {
      id: session.id,
      label: session.label,
      modelId: session.modelId,
      messages: session.messages,
      usage: session.usage,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  }
}

export function sessionExportFilename(session: Session): string {
  return `${(session.label || 'session').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
}

export function downloadSessionExport(session: Session) {
  const json = JSON.stringify(buildSessionExport(session), null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = sessionExportFilename(session)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
