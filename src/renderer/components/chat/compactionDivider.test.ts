import { describe, expect, it } from 'vitest'
import {
  compactionDividerForMessages,
  compactionRecordDetail,
  compactionTokenTransition,
  latestCompactionRecord,
} from './compactionDivider.js'

describe('compactionDividerForMessages', () => {
  const messages = [
    { id: 'u1' },
    { id: 'a1' },
    { id: 'u2' },
    { id: 'a2' },
  ]

  it('places the divider after eventMessageId', () => {
    const placement = compactionDividerForMessages(messages, [{
      id: 'cmp_1',
      eventMessageId: 'a2',
      eventMessageIndex: 3,
      firstKeptMessageId: 'u2',
      firstKeptMessageIndex: 2,
      summary: 'Earlier work was summarized.',
    }])

    expect(placement?.messageIndex).toBe(4)
    expect(placement?.record.id).toBe('cmp_1')
  })

  it('falls back to eventMessageIndex when the event id is missing', () => {
    const placement = compactionDividerForMessages(messages, [{
      id: 'cmp_1',
      eventMessageId: 'missing',
      eventMessageIndex: 1,
      firstKeptMessageId: 'u2',
      firstKeptMessageIndex: 2,
      summary: 'Earlier work was summarized.',
    }])

    expect(placement?.messageIndex).toBe(2)
  })

  it('falls back to firstKeptMessageId for legacy records', () => {
    const placement = compactionDividerForMessages(messages, [{
      id: 'cmp_1',
      firstKeptMessageId: 'u2',
      firstKeptMessageIndex: 1,
      summary: 'Earlier work was summarized.',
    }])

    expect(placement?.messageIndex).toBe(2)
  })

  it('falls back to firstKeptMessageIndex for legacy records when the id is missing', () => {
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

  it('describes when compaction happened', () => {
    expect(compactionRecordDetail({
      id: 'cmp_pre',
      summary: 'Earlier work was summarized.',
      trigger: 'pre_turn',
    })).toBe('Earlier messages were summarized before this reply.')

    expect(compactionRecordDetail({
      id: 'cmp_post',
      summary: 'Earlier work was summarized.',
      trigger: 'post_turn',
    })).toBe('Earlier messages were summarized after the last reply for future turns.')

    expect(compactionRecordDetail({
      id: 'cmp_overflow',
      summary: 'Earlier work was summarized.',
      trigger: 'overflow',
    })).toBe('The prompt exceeded the model window, so Mim summarized earlier messages and retried.')
  })

  it('formats compact token transitions', () => {
    expect(compactionTokenTransition({
      id: 'cmp_1',
      summary: 'Earlier work was summarized.',
      tokensBefore: 30_000,
      tokensAfter: 2_700,
    })).toBe('30k -> 3k')

    expect(compactionTokenTransition({
      id: 'cmp_1',
      summary: 'Earlier work was summarized.',
      tokensBefore: 0,
      tokensAfter: 2_700,
    })).toBe('')
  })
})
