import { describe, expect, it } from 'vitest'
import { lineDelta } from './lineDelta.js'

describe('lineDelta', () => {
  it('counts added and removed lines via line LCS', () => {
    expect(lineDelta('a\nb\nc', 'a\nX\nc\nd')).toEqual({ added: 2, removed: 1 })
  })

  it('treats identical content as zero delta', () => {
    expect(lineDelta('a\nb', 'a\nb')).toEqual({ added: 0, removed: 0 })
  })

  it('counts pure additions and pure removals', () => {
    expect(lineDelta('', 'one\ntwo')).toEqual({ added: 2, removed: 0 })
    expect(lineDelta('one\ntwo', '')).toEqual({ added: 0, removed: 2 })
  })

  it('returns null above the line cap instead of an O(n²) diff', () => {
    const big = Array.from({ length: 2001 }, (_, i) => `line ${i}`).join('\n')
    expect(lineDelta(big, 'a')).toBeNull()
    expect(lineDelta('a', big)).toBeNull()
  })
})
