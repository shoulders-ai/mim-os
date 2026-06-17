import { describe, expect, it } from 'vitest'
import { shouldCollapseUnchangedDiffSections } from './diffPresentation.js'

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
