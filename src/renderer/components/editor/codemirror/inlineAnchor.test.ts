/* @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { inlineAnchorExtension, setInlineAnchor } from './inlineAnchor.js'

function makeState(doc: string) {
  return EditorState.create({ doc, extensions: [inlineAnchorExtension()] })
}

/** Read the anchor decoration ranges out of the editor state. */
function anchorRanges(state: EditorState) {
  const ranges: Array<{ from: number; to: number }> = []
  const set = state.facet(EditorView.decorations).flatMap((source) =>
    typeof source === 'function' ? [] : [source]
  )
  for (const deco of set) {
    const cursor = deco.iter()
    while (cursor.value) {
      ranges.push({ from: cursor.from, to: cursor.to })
      cursor.next()
    }
  }
  return ranges
}

describe('inlineAnchor', () => {
  it('has no decoration before an anchor is set', () => {
    expect(anchorRanges(makeState('hello world'))).toEqual([])
  })

  it('marks the anchored range when set', () => {
    let state = makeState('hello world')
    state = state.update({ effects: setInlineAnchor.of({ from: 0, to: 5 }) }).state
    expect(anchorRanges(state)).toEqual([{ from: 0, to: 5 }])
  })

  it('ignores an empty (cursor) range', () => {
    let state = makeState('hello world')
    state = state.update({ effects: setInlineAnchor.of({ from: 3, to: 3 }) }).state
    expect(anchorRanges(state)).toEqual([])
  })

  it('clears the decoration when set to null', () => {
    let state = makeState('hello world')
    state = state.update({ effects: setInlineAnchor.of({ from: 0, to: 5 }) }).state
    state = state.update({ effects: setInlineAnchor.of(null) }).state
    expect(anchorRanges(state)).toEqual([])
  })

  it('maps the range through edits before the anchor', () => {
    let state = makeState('hello world')
    state = state.update({ effects: setInlineAnchor.of({ from: 6, to: 11 }) }).state
    // Insert two chars at the start; the anchored "world" shifts right by 2.
    state = state.update({ changes: { from: 0, insert: '>>' } }).state
    expect(anchorRanges(state)).toEqual([{ from: 8, to: 13 }])
  })

  it('drops the anchor when the anchored text is fully deleted', () => {
    let state = makeState('hello world')
    state = state.update({ effects: setInlineAnchor.of({ from: 6, to: 11 }) }).state
    state = state.update({ changes: { from: 6, to: 11, insert: '' } }).state
    expect(anchorRanges(state)).toEqual([])
  })
})
