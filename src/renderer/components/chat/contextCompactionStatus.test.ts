import { describe, expect, it } from 'vitest'
import {
  contextCompactionThreshold,
  contextPreparationCopy,
  planContextPreparation,
} from './contextCompactionStatus.js'

describe('contextCompactionStatus', () => {
  it('matches the runtime compaction reserve threshold', () => {
    expect(contextCompactionThreshold(5_000)).toBe(4_000)
    expect(contextCompactionThreshold(200_000)).toBe(183_616)
  })

  it('plans visible compaction preparation once a chat with history crosses the reserve', () => {
    expect(planContextPreparation({
      contextTokens: 30_000,
      estimatedRequestTokens: 30_500,
      contextWindow: 5_000,
      priorMessageCount: 2,
    })).toMatchObject({
      kind: 'compact',
      tokenCount: 30_500,
      contextWindow: 5_000,
      threshold: 4_000,
    })
  })

  it('keeps the UI quiet when the next turn is comfortably inside the context window', () => {
    expect(planContextPreparation({
      contextTokens: 2_000,
      estimatedRequestTokens: 2_300,
      contextWindow: 5_000,
      priorMessageCount: 2,
    })).toBeNull()
  })

  it('explains the first oversized message edge case separately', () => {
    expect(planContextPreparation({
      contextTokens: 0,
      estimatedRequestTokens: 30_000,
      contextWindow: 5_000,
      priorMessageCount: 0,
    })).toMatchObject({ kind: 'large-first-turn' })
  })

  it('uses plain status copy for checking and summarizing phases', () => {
    expect(contextPreparationCopy({ kind: 'compact' }, 'checking')).toEqual({
      title: 'Checking context before replying',
      detail: 'Mim will summarize older messages if this turn needs it.',
    })

    expect(contextPreparationCopy({ kind: 'compact' }, 'summarizing')).toEqual({
      title: 'Summarizing earlier messages before replying',
      detail: 'Full transcript stays visible.',
    })
  })
})
