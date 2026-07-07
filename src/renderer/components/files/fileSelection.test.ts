import { describe, expect, it } from 'vitest'
import {
  emptySelection,
  pruneSelection,
  reduceRowClick,
  type FileSelection,
} from './fileSelection.js'

const VISIBLE = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']

function selection(paths: string[], anchorPath: string | null = null): FileSelection {
  return { paths, anchorPath }
}

describe('reduceRowClick', () => {
  it('collapses to the clicked row and activates on a plain click', () => {
    const result = reduceRowClick(selection(['a.md', 'c.md'], 'a.md'), VISIBLE, 'b.md', {
      toggle: false,
      range: false,
    })

    expect(result.selection).toEqual({ paths: ['b.md'], anchorPath: 'b.md' })
    expect(result.activate).toBe(true)
  })

  it('toggles membership without activating on cmd/ctrl+click', () => {
    const added = reduceRowClick(selection(['a.md'], 'a.md'), VISIBLE, 'c.md', {
      toggle: true,
      range: false,
    })
    expect(added.selection).toEqual({ paths: ['a.md', 'c.md'], anchorPath: 'c.md' })
    expect(added.activate).toBe(false)

    const removed = reduceRowClick(added.selection, VISIBLE, 'a.md', {
      toggle: true,
      range: false,
    })
    expect(removed.selection).toEqual({ paths: ['c.md'], anchorPath: 'a.md' })
    expect(removed.activate).toBe(false)
  })

  it('selects the anchor-to-row range on shift+click, replacing the selection', () => {
    const result = reduceRowClick(selection(['b.md', 'e.md'], 'b.md'), VISIBLE, 'd.md', {
      toggle: false,
      range: true,
    })

    expect(result.selection).toEqual({ paths: ['b.md', 'c.md', 'd.md'], anchorPath: 'b.md' })
    expect(result.activate).toBe(false)
  })

  it('selects ranges upward from the anchor too', () => {
    const result = reduceRowClick(selection(['d.md'], 'd.md'), VISIBLE, 'a.md', {
      toggle: false,
      range: true,
    })

    expect(result.selection.paths).toEqual(['a.md', 'b.md', 'c.md', 'd.md'])
  })

  it('adds the range to the existing selection on cmd/ctrl+shift+click', () => {
    const result = reduceRowClick(selection(['e.md'], 'a.md'), VISIBLE, 'b.md', {
      toggle: true,
      range: true,
    })

    expect(result.selection.paths).toEqual(['a.md', 'b.md', 'e.md'])
    expect(result.selection.anchorPath).toBe('a.md')
    expect(result.activate).toBe(false)
  })

  it('treats the clicked row as anchor when no anchor is visible', () => {
    const noAnchor = reduceRowClick(emptySelection(), VISIBLE, 'c.md', { toggle: false, range: true })
    expect(noAnchor.selection).toEqual({ paths: ['c.md'], anchorPath: 'c.md' })

    const staleAnchor = reduceRowClick(selection([], 'gone.md'), VISIBLE, 'c.md', {
      toggle: false,
      range: true,
    })
    expect(staleAnchor.selection).toEqual({ paths: ['c.md'], anchorPath: 'c.md' })
  })

  it('keeps selection paths in visual order regardless of click order', () => {
    let state = emptySelection()
    for (const path of ['d.md', 'a.md', 'c.md']) {
      state = reduceRowClick(state, VISIBLE, path, { toggle: true, range: false }).selection
    }
    expect(state.paths).toEqual(['a.md', 'c.md', 'd.md'])
  })
})

describe('pruneSelection', () => {
  it('drops paths that are no longer visible and clears a stale anchor', () => {
    const pruned = pruneSelection(selection(['a.md', 'x.md', 'c.md'], 'x.md'), VISIBLE)
    expect(pruned).toEqual({ paths: ['a.md', 'c.md'], anchorPath: null })
  })

  it('returns the same object when nothing changed', () => {
    const state = selection(['a.md', 'c.md'], 'a.md')
    expect(pruneSelection(state, VISIBLE)).toBe(state)
  })
})
