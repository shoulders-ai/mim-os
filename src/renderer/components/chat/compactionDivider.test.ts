import { describe, expect, it } from 'vitest'
import { compactionDividerForMessages, latestCompactionRecord } from './compactionDivider.js'

describe('compactionDividerForMessages', () => {
  const messages = [
    { id: 'u1' },
    { id: 'a1' },
    { id: 'u2' },
    { id: 'a2' },
  ]

  it('places the divider at firstKeptMessageId', () => {
    const placement = compactionDividerForMessages(messages, [{
      id: 'cmp_1',
      firstKeptMessageId: 'u2',
      firstKeptMessageIndex: 1,
      summary: 'Earlier work was summarized.',
    }])

    expect(placement?.messageIndex).toBe(2)
    expect(placement?.record.id).toBe('cmp_1')
  })

  it('falls back to firstKeptMessageIndex when the id is missing', () => {
    const placement = compactionDividerForMessages(messages, [{
      id: 'cmp_1',
      firstKeptMessageId: 'missing',
      firstKeptMessageIndex: 3,
      summary: 'Earlier work was summarized.',
    }])

    expect(placement?.messageIndex).toBe(3)
  })

  it('uses the latest usable compaction record', () => {
    const latest = latestCompactionRecord([
      {
        id: 'cmp_old',
        firstKeptMessageIndex: 1,
        summary: 'Old summary.',
      },
      {
        id: 'cmp_bad',
        firstKeptMessageIndex: 2,
        summary: '',
      },
      {
        id: 'cmp_new',
        firstKeptMessageIndex: 2,
        summary: 'New summary.',
      },
    ])

    expect(latest?.id).toBe('cmp_new')
  })

  it('returns null without messages or usable compaction records', () => {
    expect(compactionDividerForMessages([], [{
      id: 'cmp_1',
      firstKeptMessageIndex: 0,
      summary: 'Earlier work was summarized.',
    }])).toBeNull()

    expect(compactionDividerForMessages(messages)).toBeNull()
    expect(compactionDividerForMessages(messages, [])).toBeNull()
    expect(compactionDividerForMessages(messages, [{
      id: 'cmp_blank',
      firstKeptMessageIndex: 1,
      summary: '   ',
    }])).toBeNull()
  })

  it('returns null when no valid cut point is available', () => {
    expect(compactionDividerForMessages(messages, [{
      id: 'cmp_1',
      firstKeptMessageId: 'missing',
      firstKeptMessageIndex: 99,
      summary: 'Earlier work was summarized.',
    }])).toBeNull()
  })
})
