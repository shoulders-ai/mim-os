import { describe, expect, it } from 'vitest'
import { countTextMatches, findTextMatches } from '@main/search/textMatch.js'

describe('text matching', () => {
  it('finds exact matches in original coordinates', () => {
    expect(findTextMatches('alpha beta gamma', 'beta')).toEqual([
      { index: 6, length: 4 },
    ])
  })

  it('returns all matches from the first successful matching mode', () => {
    expect(findTextMatches('cat and cat and cat', 'cat')).toEqual([
      { index: 0, length: 3 },
      { index: 8, length: 3 },
      { index: 16, length: 3 },
    ])
  })

  it('matches curly quotes against straight quotes', () => {
    const text = 'She said “hello” and left.'
    const [match] = findTextMatches(text, '"hello"')
    expect(text.slice(match.index, match.index + match.length)).toBe('“hello”')
  })

  it('matches em dashes against double hyphens', () => {
    const text = 'The risk—benefit result changed.'
    const [match] = findTextMatches(text, 'risk--benefit')
    expect(text.slice(match.index, match.index + match.length)).toBe('risk—benefit')
  })

  it('matches ellipsis characters against three dots', () => {
    const text = 'Wait… then continue.'
    const [match] = findTextMatches(text, 'Wait...')
    expect(text.slice(match.index, match.index + match.length)).toBe('Wait…')
  })

  it('maps whitespace-normalized matches back to the original span', () => {
    const text = 'alpha   beta\tgamma'
    const [match] = findTextMatches(text, 'alpha beta gamma')
    expect(text.slice(match.index, match.index + match.length)).toBe('alpha   beta\tgamma')
  })

  it('maps CRLF-normalized matches back to the full original span', () => {
    const text = 'line one\r\nline two\r\nline three'
    const [match] = findTextMatches(text, 'line one\nline two')
    expect(text.slice(match.index, match.index + match.length)).toBe('line one\r\nline two')
  })

  it('combines whitespace and typographic matching', () => {
    const text = 'She  said “hello”\r\ntoday.'
    const [match] = findTextMatches(text, 'She said "hello"\ntoday.')
    expect(text.slice(match.index, match.index + match.length)).toBe('She  said “hello”\r\ntoday.')
  })

  it('is case-sensitive', () => {
    expect(findTextMatches('Alpha beta', 'alpha')).toEqual([])
  })

  it('returns zero for empty inputs', () => {
    expect(findTextMatches('', 'alpha')).toEqual([])
    expect(findTextMatches('alpha', '')).toEqual([])
    expect(countTextMatches('alpha', '')).toBe(0)
  })
})
