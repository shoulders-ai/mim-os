import { describe, expect, it } from 'vitest'
import { joinForTerminal } from './terminalSendText.js'

describe('joinForTerminal', () => {
  it('appends a single CR to a single line', () => {
    expect(joinForTerminal('hello')).toBe('hello\r')
  })

  it('converts LF to CR for multi-line text and adds trailing CR', () => {
    expect(joinForTerminal('a\nb')).toBe('a\rb\r')
  })

  it('does not double a trailing newline', () => {
    expect(joinForTerminal('a\nb\n')).toBe('a\rb\r')
  })

  it('preserves blank lines between content', () => {
    expect(joinForTerminal('a\n\nb')).toBe('a\r\rb\r')
  })

  it('sends a bare CR for empty input', () => {
    expect(joinForTerminal('')).toBe('\r')
  })

  it('handles CRLF input (Windows paste)', () => {
    expect(joinForTerminal('a\r\nb')).toBe('a\rb\r')
  })
})
