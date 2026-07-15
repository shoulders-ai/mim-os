export type ContextPreparationKind = 'compact' | 'large-first-turn'
export type ContextPreparationPhase = 'checking' | 'summarizing'

export interface ContextPreparationPlan {
  kind: ContextPreparationKind
  tokenCount: number
  contextWindow: number
  threshold: number
}

export interface ContextPreparationCopy {
  title: string
  detail: string
}

const CONTEXT_COMPACTION_RESERVE_TOKENS = 16_384

export function contextCompactionThreshold(contextWindow: unknown): number {
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) return 0
  const windowTokens = Math.floor(contextWindow)
  const reserve = Math.min(CONTEXT_COMPACTION_RESERVE_TOKENS, Math.floor(windowTokens * 0.2))
  return Math.max(0, windowTokens - reserve)
}

export function planContextPreparation({
  contextTokens,
  estimatedRequestTokens,
  contextWindow,
  priorMessageCount,
}: {
  contextTokens: number
  estimatedRequestTokens: number
  contextWindow: number
  priorMessageCount: number
}): ContextPreparationPlan | null {
  const threshold = contextCompactionThreshold(contextWindow)
  if (!threshold) return null

  const tokenCount = Math.max(0, Math.floor(Math.max(contextTokens || 0, estimatedRequestTokens || 0)))
  if (tokenCount <= threshold) return null

  return {
    kind: priorMessageCount > 0 ? 'compact' : 'large-first-turn',
    tokenCount,
    contextWindow: Math.floor(contextWindow),
    threshold,
  }
}

export function contextPreparationCopy(
  plan: Pick<ContextPreparationPlan, 'kind'>,
  phase: ContextPreparationPhase,
): ContextPreparationCopy {
  if (plan.kind === 'large-first-turn') {
    return {
      title: 'Sending large message',
      detail: 'There is no earlier chat history to summarize yet.',
    }
  }

  if (phase === 'summarizing') {
    return {
      title: 'Summarizing earlier messages before replying',
      detail: 'Full transcript stays visible.',
    }
  }

  return {
    title: 'Checking context before replying',
    detail: 'Mim will summarize older messages if this turn needs it.',
  }
}
