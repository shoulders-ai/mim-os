export interface ChatCompactionRecord {
  id: string
  firstKeptMessageId?: string
  firstKeptMessageIndex?: number
  summary: string
  trigger?: 'post_turn' | 'pre_turn' | 'overflow'
  createdAt?: string
}

export interface ChatMessageLike {
  id?: string
}

export interface ChatCompactionDividerPlacement {
  record: ChatCompactionRecord
  messageIndex: number
}

export function compactionDividerForMessages(
  messages: ChatMessageLike[],
  compactions?: ChatCompactionRecord[],
): ChatCompactionDividerPlacement | null {
  if (!Array.isArray(messages) || messages.length === 0) return null
  const record = latestCompactionRecord(compactions)
  if (!record) return null

  const index = firstKeptMessageIndex(messages, record)
  if (index < 0) return null

  return { record, messageIndex: index }
}

export function latestCompactionRecord(compactions?: ChatCompactionRecord[]): ChatCompactionRecord | null {
  if (!Array.isArray(compactions)) return null
  for (let index = compactions.length - 1; index >= 0; index -= 1) {
    const record = compactions[index]
    if (record?.id && record.summary?.trim()) return record
  }
  return null
}

function firstKeptMessageIndex(messages: ChatMessageLike[], record: ChatCompactionRecord): number {
  if (record.firstKeptMessageId) {
    const byId = messages.findIndex(message => message.id === record.firstKeptMessageId)
    if (byId >= 0) return byId
  }

  if (typeof record.firstKeptMessageIndex === 'number' && Number.isFinite(record.firstKeptMessageIndex)) {
    const index = Math.floor(record.firstKeptMessageIndex)
    if (index >= 0 && index < messages.length) return index
  }

  return -1
}
