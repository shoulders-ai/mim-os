import { describe, expect, it } from 'vitest'
import { effectiveContextTokens } from './contextUsage.js'

describe('effectiveContextTokens', () => {
  it('uses latest compaction tokensAfter when persisted usage is stale and higher', () => {
    expect(effectiveContextTokens({
      persistedTokens: 30_000,
      estimatedTokens: 30_000,
      sessionUpdatedAt: '2026-01-01T10:00:00.000Z',
      latestCompaction: {
        id: 'cmp_1',
        summary: 'Earlier work was summarized.',
        tokensBefore: 30_000,
        tokensAfter: 2_700,
        createdAt: '2026-01-01T10:01:00.000Z',
      },
    })).toBe(2_700)
  })

  it('keeps fresh provider usage after a later session update', () => {
    expect(effectiveContextTokens({
      persistedTokens: 3_200,
      estimatedTokens: 30_000,
      sessionUpdatedAt: '2026-01-01T10:02:00.000Z',
      latestCompaction: {
        id: 'cmp_1',
        summary: 'Earlier work was summarized.',
        tokensBefore: 30_000,
        tokensAfter: 2_700,
        createdAt: '2026-01-01T10:01:00.000Z',
      },
    })).toBe(3_200)
  })

  it('keeps provider usage when it is already lower than the compaction estimate', () => {
    expect(effectiveContextTokens({
      persistedTokens: 1_900,
      estimatedTokens: 30_000,
      latestCompaction: {
        id: 'cmp_1',
        summary: 'Earlier work was summarized.',
        tokensBefore: 30_000,
        tokensAfter: 2_700,
      },
    })).toBe(1_900)
  })

  it('falls back to visible transcript estimate before any provider usage or compaction', () => {
    expect(effectiveContextTokens({
      persistedTokens: 0,
      estimatedTokens: 6_500,
      latestCompaction: null,
    })).toBe(6_500)
  })
})
