import { describe, expect, it } from 'vitest'
import {
  buildAssistantTurnView,
  formatTurnElapsed,
  getAssistantTurnElapsedMs,
  withLastAssistantTurnElapsed,
} from './assistantTurn.js'

describe('assistant turn display', () => {
  const parts = [
    { type: 'text', text: 'Reading the document.' },
    { type: 'tool-fs_read', state: 'output-available', input: { path: 'README.md' }, output: { ok: true } },
    { type: 'text', text: 'Checking the draft.' },
    { type: 'tool-fs_edit', state: 'output-available', input: { path: 'dummy.md' }, output: { ok: true } },
    { type: 'text', text: 'Writing the answer.' },
    { type: 'text', text: 'Here is the answer.' },
    { type: 'source-url', url: 'https://example.com', title: 'Example' },
  ]

  it('keeps the active turn exactly as streamed', () => {
    const view = buildAssistantTurnView(parts, {
      canCollapse: false,
      detailsExpanded: false,
      elapsedMs: 72_000,
    })

    expect(view.entries.map(entry => entry.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(view.hasDetails).toBe(false)
  })

  it('collapses finished detail parts behind the final answer', () => {
    const view = buildAssistantTurnView(parts, {
      canCollapse: true,
      detailsExpanded: false,
      elapsedMs: 72_000,
    })

    expect(view.entries.map(entry => entry.index)).toEqual([5, 6])
    expect(view.hasDetails).toBe(true)
    expect(view.summary).toBe('edited dummy.md · 2 actions · 1m 12s')
  })

  it('expands finished turns back to the full streamed order', () => {
    const view = buildAssistantTurnView(parts, {
      canCollapse: true,
      detailsExpanded: true,
      elapsedMs: 12_000,
    })

    expect(view.entries.map(entry => entry.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(view.hasDetails).toBe(true)
    expect(view.summary).toBe('edited dummy.md · 2 actions · 12s')
  })

  it('names checked files when no file changed', () => {
    const view = buildAssistantTurnView([
      { type: 'text', text: 'Reading the document.' },
      { type: 'tool-fs_read', state: 'output-available', input: { path: 'docs/brief.md' }, output: { ok: true } },
      { type: 'text', text: 'Here is the answer.' },
    ], {
      canCollapse: true,
      detailsExpanded: false,
      elapsedMs: 5000,
    })

    expect(view.summary).toBe('checked brief.md · 1 action · 5s')
  })

  it('does not show details when there is no earlier visible work', () => {
    const view = buildAssistantTurnView([{ type: 'text', text: 'Final only.' }], {
      canCollapse: true,
      detailsExpanded: false,
      elapsedMs: 10_000,
    })

    expect(view.entries.map(entry => entry.index)).toEqual([0])
    expect(view.hasDetails).toBe(false)
  })

  it('omits very short elapsed times', () => {
    expect(formatTurnElapsed(2999)).toBe('')
    expect(formatTurnElapsed(3000)).toBe('3s')
    expect(formatTurnElapsed(61_000)).toBe('1m 1s')
    expect(formatTurnElapsed(120_000)).toBe('2m')
  })
})

describe('assistant turn elapsed metadata', () => {
  it('adds elapsed time to the last assistant message without dropping existing metadata', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', metadata: { source: 'model', mim: { existing: true } }, parts: [{ type: 'text', text: 'old' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'again' }] },
      { id: 'a2', role: 'assistant', metadata: { source: 'model' }, parts: [{ type: 'text', text: 'new' }] },
    ]

    const next = withLastAssistantTurnElapsed(messages, 12_345)

    expect(next).not.toBe(messages)
    expect(next[1]).toBe(messages[1])
    expect(next[3]).toMatchObject({
      id: 'a2',
      metadata: {
        source: 'model',
        mim: { turnElapsedMs: 12_345 },
      },
    })
    expect(getAssistantTurnElapsedMs(next[3])).toBe(12_345)
  })

  it('returns the original messages when there is no assistant message or elapsed time', () => {
    const messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]

    expect(withLastAssistantTurnElapsed(messages, null)).toBe(messages)
    expect(withLastAssistantTurnElapsed(messages, 10_000)).toBe(messages)
  })
})
