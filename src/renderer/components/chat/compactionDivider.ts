export interface ChatCompactionRecord {
  id: string
  firstKeptMessageId?: string
  firstKeptMessageIndex?: number
  summary: string
  tokensBefore?: number
  tokensAfter?: number
  savedRatio?: number
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

export function compactionRecordDetail(record: ChatCompactionRecord): string {
  if (record.trigger === 'pre_turn') return 'Earlier messages were summarized before this reply.'
  if (record.trigger === 'post_turn') return 'Earlier messages were summarized after the last reply for future turns.'
  if (record.trigger === 'overflow') return 'The prompt exceeded the model window, so Mim summarized earlier messages and retried.'
  return 'Earlier messages were summarized for the model.'
}

export function compactionTokenTransition(record: ChatCompactionRecord): string {
  const before = formatTokens(record.tokensBefore)
  const after = formatTokens(record.tokensAfter)
  return before && after ? `${before} -> ${after}` : ''
}

function formatTokens(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  const rounded = Math.floor(value)
  if (rounded >= 1_000_000) return `${trimDecimal(rounded / 1_000_000)}m`
  if (rounded >= 1_000) return `${Math.round(rounded / 1_000)}k`
  return String(rounded)
}

function trimDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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
