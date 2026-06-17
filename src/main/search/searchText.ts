export interface SearchIndexMessage {
  role: string
  content?: string
  parts?: Array<{ type?: string; text?: string; content?: string; data?: { filename?: unknown } }>
}

export interface SessionIndexRow {
  sessionId: string
  messageIdx: number
  role: string
  content: string
  label: string
}

export function buildSessionIndexRows(
  sessionId: string,
  label: string,
  messages: SearchIndexMessage[]
): SessionIndexRow[] {
  const rows: SessionIndexRow[] = []

  if (label.trim() && messages.length === 0) {
    rows.push({
      sessionId,
      messageIdx: -1,
      role: 'session',
      content: '',
      label,
    })
  }

  messages.forEach((message, idx) => {
    const content = extractMessageText(message)
    if (!content.trim()) return
    rows.push({
      sessionId,
      messageIdx: idx,
      role: message.role,
      content,
      label,
    })
  })

  return rows
}

export function extractMessageText(message: SearchIndexMessage): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.parts)) return ''

  return message.parts
    .map((part) => {
      if (typeof part.text === 'string') return part.text
      if (part.type === 'data-context') {
        const filename = part.data?.filename
        return typeof filename === 'string' ? filename : ''
      }
      if (typeof part.content === 'string') return part.content
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
