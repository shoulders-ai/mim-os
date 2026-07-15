import type { ChatCompactionRecord } from './compactionDivider.js'

export function effectiveContextTokens({
  persistedTokens,
  estimatedTokens,
  latestCompaction,
  sessionUpdatedAt,
}: {
  persistedTokens?: number
  estimatedTokens?: number
  latestCompaction?: ChatCompactionRecord | null
  sessionUpdatedAt?: string
}): number {
  const persisted = positiveInteger(persistedTokens)
  const estimated = positiveInteger(estimatedTokens)
  const compacted = positiveInteger(latestCompaction?.tokensAfter)

  if (compacted && (!persisted || (compacted < persisted && compactionIsAtLeastAsFresh(latestCompaction, sessionUpdatedAt)))) {
    return compacted
  }
  return persisted || estimated || 0
}

function positiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

function compactionIsAtLeastAsFresh(compaction: ChatCompactionRecord | null | undefined, sessionUpdatedAt: string | undefined): boolean {
  const compactionMs = timestampMs(compaction?.createdAt)
  const updatedMs = timestampMs(sessionUpdatedAt)
  if (!compactionMs || !updatedMs) return true
  return compactionMs >= updatedMs
}

function timestampMs(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}
