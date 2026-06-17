import { describe, it, expect } from 'vitest'
import { lastUserMessageText, buildSeedMessage } from './summary.js'

describe('lastUserMessageText', () => {
  it('returns content from a string-content user message', () => {
    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]
    expect(lastUserMessageText(messages)).toBe('hello')
  })

  it('returns text from the last user message with parts', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'first' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
      { role: 'user', parts: [{ type: 'text', text: 'second question' }] },
    ]
    expect(lastUserMessageText(messages)).toBe('second question')
  })

  it('returns empty string when no user messages', () => {
    expect(lastUserMessageText([])).toBe('')
    expect(lastUserMessageText([{ role: 'assistant', content: 'hi' }])).toBe('')
  })
})

describe('buildSeedMessage', () => {
  it('builds a summary-based seed', () => {
    const result = buildSeedMessage('We discussed project setup.', 'fallback')
    expect(result).toContain('summary')
    expect(result).toContain('We discussed project setup.')
  })

  it('falls back to last message text when summary is empty', () => {
    const result = buildSeedMessage('', 'my last question')
    expect(result).toContain('last message')
    expect(result).toContain('my last question')
  })

  it('returns null when both are empty', () => {
    expect(buildSeedMessage('', '')).toBeNull()
  })
})
