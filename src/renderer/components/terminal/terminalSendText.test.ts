import { describe, expect, it } from 'vitest'
import { joinForTerminal, chunkPayload, PAYLOAD_MAX_CHARS } from './terminalSendText.js'

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

  describe('bracketedPaste option', () => {
    it('single-line text is unchanged regardless of bracketedPaste flag', () => {
      expect(joinForTerminal('hello', { bracketedPaste: true })).toBe('hello\r')
    })

    it('wraps multi-line text in bracketed paste markers', () => {
      const result = joinForTerminal('a\nb', { bracketedPaste: true })
      // \x1b[200~ + CR-joined body (no trailing CR inside) + \x1b[201~ + one trailing CR
      expect(result).toBe('\x1b[200~a\rb\x1b[201~\r')
    })

    it('wraps multi-line text with three lines', () => {
      const result = joinForTerminal('a\nb\nc', { bracketedPaste: true })
      expect(result).toBe('\x1b[200~a\rb\rc\x1b[201~\r')
    })

    it('strips trailing newline before wrapping', () => {
      const result = joinForTerminal('a\nb\n', { bracketedPaste: true })
      expect(result).toBe('\x1b[200~a\rb\x1b[201~\r')
    })

    it('handles CRLF with bracketed paste', () => {
      const result = joinForTerminal('a\r\nb\r\nc', { bracketedPaste: true })
      expect(result).toBe('\x1b[200~a\rb\rc\x1b[201~\r')
    })

    it('multi-line without bracketedPaste uses existing behavior', () => {
      expect(joinForTerminal('a\nb', { bracketedPaste: false })).toBe('a\rb\r')
    })

    it('multi-line without opts uses existing behavior', () => {
      expect(joinForTerminal('a\nb')).toBe('a\rb\r')
    })

    it('blank lines inside multi-line bracketed paste are preserved', () => {
      const result = joinForTerminal('a\n\nb', { bracketedPaste: true })
      expect(result).toBe('\x1b[200~a\r\rb\x1b[201~\r')
    })
  })
})

describe('chunkPayload', () => {
  it('returns a single chunk for small payloads', () => {
    expect(chunkPayload('hello')).toEqual(['hello'])
  })

  it('returns a single chunk for payloads exactly at the size boundary', () => {
    const text = 'x'.repeat(16_384)
    expect(chunkPayload(text)).toEqual([text])
  })

  it('splits payloads larger than the chunk size', () => {
    const text = 'a'.repeat(16_384 + 10)
    const chunks = chunkPayload(text)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toBe('a'.repeat(16_384))
    expect(chunks[1]).toBe('a'.repeat(10))
  })

  it('preserves exact boundaries and order', () => {
    const text = 'abcdefgh'
    const chunks = chunkPayload(text, 3)
    expect(chunks).toEqual(['abc', 'def', 'gh'])
  })

  it('custom chunk size works', () => {
    const text = '0123456789'
    const chunks = chunkPayload(text, 4)
    expect(chunks).toEqual(['0123', '4567', '89'])
  })

  it('empty string returns single empty chunk', () => {
    expect(chunkPayload('')).toEqual([''])
  })

  // Splitting mid-escape-sequence is fine (pty is a byte stream)
  it('splits mid-escape-sequence without issue', () => {
    const text = '\x1b[200~hello\x1b[201~'
    const chunks = chunkPayload(text, 5)
    // It just splits at exact boundaries, no escape awareness needed
    expect(chunks.join('')).toBe(text)
    expect(chunks[0].length).toBe(5)
  })
})

describe('PAYLOAD_MAX_CHARS', () => {
  it('is 2,000,000', () => {
    expect(PAYLOAD_MAX_CHARS).toBe(2_000_000)
  })
})
