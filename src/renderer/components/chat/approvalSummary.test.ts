import { describe, expect, it } from 'vitest'
import { changeSummary } from './approvalSummary.js'

describe('changeSummary', () => {
  it('describes a new file by size', () => {
    expect(changeSummary({ kind: 'create', content: 'a\nb\nc' })).toBe('Creates a new file (3 lines).')
    expect(changeSummary({ kind: 'create', content: '' })).toBe('Creates an empty file.')
    expect(changeSummary({ kind: 'create', content: 'only' })).toBe('Creates a new file (1 line).')
  })

  it('describes a delete plainly', () => {
    expect(changeSummary({ kind: 'delete' })).toBe('Deletes this file.')
  })

  it('describes an overwrite by the new size', () => {
    expect(changeSummary({ kind: 'write', content: 'a\nb' })).toBe('Overwrites the file (2 lines).')
    expect(changeSummary({ kind: 'write', content: '' })).toBe('Clears the file.')
  })

  it('describes an edit by what it adds, removes, or replaces', () => {
    expect(changeSummary({ kind: 'edit', oldText: 'a', newText: 'a\nb\nc' })).toBe('Adds 2 lines.')
    expect(changeSummary({ kind: 'edit', oldText: 'a\nb\nc', newText: 'a' })).toBe('Removes 2 lines.')
    expect(changeSummary({ kind: 'edit', oldText: 'a\nb', newText: 'x\ny' })).toBe('Rewrites 2 lines.')
    expect(changeSummary({ kind: 'edit', oldText: 'a\nb\nc', newText: 'a\nX' })).toBe('Replaces 2 lines with 1.')
  })

  it('says nothing for a no-op or a missing preview', () => {
    expect(changeSummary({ kind: 'edit', oldText: 'same', newText: 'same' })).toBe('')
    expect(changeSummary(undefined)).toBe('')
  })
})
