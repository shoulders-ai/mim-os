import { describe, expect, it } from 'vitest'
import { buildSessionIndexRows, extractMessageText } from '@main/search/searchText.js'

describe('session search text extraction', () => {
  it('uses message content when present', () => {
    expect(extractMessageText({
      role: 'user',
      content: 'Can you help me with Rust programming?',
      parts: [{ type: 'text', text: 'ignored' }],
    })).toBe('Can you help me with Rust programming?')
  })

  it('uses AI SDK text parts when content is absent', () => {
    expect(extractMessageText({
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Let me explain how WebAssembly works.' },
      ],
    })).toBe('Let me explain how WebAssembly works.')
  })

  it('uses legacy part content fields when present', () => {
    expect(extractMessageText({
      role: 'assistant',
      parts: [
        { type: 'text', content: 'First part' },
        { type: 'text', text: 'Second part' },
      ],
    })).toBe('First part\nSecond part')
  })

  it('indexes data-context filenames but not hidden attachment content', () => {
    expect(extractMessageText({
      role: 'user',
      parts: [
        { type: 'text', text: 'Please review this' },
        {
          type: 'data-context',
          data: {
            filename: 'private-notes.md',
            mediaType: 'text/markdown',
            content: 'do not index this hidden phrase',
          },
        },
      ],
    })).toBe('Please review this\nprivate-notes.md')
  })

  it('skips messages with blank extracted text', () => {
    expect(buildSessionIndexRows('s1', 'Blank Session', [
      { role: 'user', content: '   ' },
      { role: 'assistant', parts: [{ type: 'tool-call' }] },
    ])).toEqual([])
  })

  it('adds a label-only row for sessions without messages', () => {
    expect(buildSessionIndexRows('s_label', 'Quantum Notes', [])).toEqual([
      {
        sessionId: 's_label',
        messageIdx: -1,
        role: 'session',
        content: '',
        label: 'Quantum Notes',
      },
    ])
  })

  it('builds rows with source message indexes preserved', () => {
    expect(buildSessionIndexRows('s1', 'Searchable', [
      { role: 'user', content: '' },
      { role: 'assistant', parts: [{ type: 'text', text: 'durable indexed phrase' }] },
    ])).toEqual([
      {
        sessionId: 's1',
        messageIdx: 1,
        role: 'assistant',
        content: 'durable indexed phrase',
        label: 'Searchable',
      },
    ])
  })
})
