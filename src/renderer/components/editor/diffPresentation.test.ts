import { describe, expect, it } from 'vitest'
import { nextChunkIndexFromPos, shouldCollapseUnchangedDiffSections } from './diffPresentation.js'

describe('diff review presentation', () => {
  it('shows the full document for inline AI reviews', () => {
    expect(shouldCollapseUnchangedDiffSections({ type: 'inline-ai' })).toBe(false)
  })

  it('keeps approval previews focused around the pending tool change', () => {
    expect(shouldCollapseUnchangedDiffSections({ type: 'approval' })).toBe(true)
  })

  it('does not collapse unchanged sections by default', () => {
    expect(shouldCollapseUnchangedDiffSections(null)).toBe(false)
    expect(shouldCollapseUnchangedDiffSections({ type: 'conflict' })).toBe(false)
  })
})

describe('nextChunkIndexFromPos', () => {
  const chunks = [
    { fromB: 0, toB: 5 },
    { fromB: 10, toB: 15 },
    { fromB: 20, toB: 25 },
  ]

  it('picks the chunk containing the position', () => {
    expect(nextChunkIndexFromPos(chunks, 12)).toBe(1)
  })

  it('picks the next chunk below a position between chunks', () => {
    expect(nextChunkIndexFromPos(chunks, 7)).toBe(1)
  })

  it('falls back to the last chunk when nothing remains below', () => {
    expect(nextChunkIndexFromPos(chunks, 30)).toBe(2)
  })

  it('returns -1 when there are no chunks', () => {
    expect(nextChunkIndexFromPos([], 0)).toBe(-1)
  })
})
