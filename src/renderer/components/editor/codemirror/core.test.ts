// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { history, undo } from '@codemirror/commands'
import { createEditorState, computeStats, computeSelectionStats, editorSettingsEffects } from './core.js'

/**
 * Bug 2 regression test: undo history must be per-tab (per-EditorState), not
 * shared. When we switch tabs via view.setState(), each tab keeps its own
 * undo stack. After switching from tab A to tab B, pressing Cmd+Z on B must
 * NOT undo changes from tab A.
 */
describe('per-tab undo history via setState', () => {
  it('undo on tab B does not revert tab A edits after a tab switch', () => {
    // Create two independent states (simulating two tabs)
    const stateA = EditorState.create({
      doc: 'Tab A',
      extensions: [history()],
    })
    const stateB = EditorState.create({
      doc: 'Tab B',
      extensions: [history()],
    })

    // Create the view with tab A
    const parent = document.createElement('div')
    const view = new EditorView({ state: stateA, parent })

    // Edit tab A: append " edited"
    view.dispatch({
      changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' edited' },
    })
    expect(view.state.doc.toString()).toBe('Tab A edited')

    // Save A's state before switching
    const savedA = view.state

    // Switch to tab B via setState
    view.setState(stateB)
    expect(view.state.doc.toString()).toBe('Tab B')

    // Undo on tab B — should have no effect (B has no history)
    undo(view)
    expect(view.state.doc.toString()).toBe('Tab B')

    // Switch back to tab A
    view.setState(savedA)
    expect(view.state.doc.toString()).toBe('Tab A edited')

    // Undo on tab A — should revert to original
    undo(view)
    expect(view.state.doc.toString()).toBe('Tab A')

    view.destroy()
  })

  it('a fresh tab opened after edits does not inherit the previous tab\'s undo history', () => {
    // Regression for the EditorPanel fresh-tab path: switching to a tab with
    // no saved state must install a NEW EditorState (createEditorState), not
    // dispatch the new content into the live view — a dispatch lands in the
    // previous tab's history and undo resurrects the other document.
    const parent = document.createElement('div')
    const view = new EditorView({
      state: createEditorState({ doc: 'Tab A' }),
      parent,
    })

    view.dispatch({
      changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' edited' },
    })
    expect(view.state.doc.toString()).toBe('Tab A edited')

    // Open a brand-new tab the way EditorPanel now does it
    const freshTabState = createEditorState({ doc: 'Tab B' })
    view.setState(freshTabState)
    expect(view.state.doc.toString()).toBe('Tab B')

    // Undo must be a no-op — under the old dispatch-based switch this
    // restored "Tab A edited" into tab B's buffer.
    undo(view)
    expect(view.state.doc.toString()).toBe('Tab B')

    view.destroy()
  })

  it('preserves selection and scroll across setState round-trips', () => {
    const stateA = EditorState.create({
      doc: 'Hello world',
      extensions: [history()],
    })

    const parent = document.createElement('div')
    const view = new EditorView({ state: stateA, parent })

    // Move cursor to position 5
    view.dispatch({ selection: { anchor: 5, head: 5 } })
    expect(view.state.selection.main.anchor).toBe(5)

    // Save state, switch away, switch back
    const saved = view.state
    const stateB = EditorState.create({ doc: 'Other', extensions: [history()] })
    view.setState(stateB)
    view.setState(saved)

    // Selection should be preserved
    expect(view.state.selection.main.anchor).toBe(5)
    expect(view.state.doc.toString()).toBe('Hello world')

    view.destroy()
  })
})

describe('computeStats', () => {
  it('counts words and characters of the document', () => {
    const state = EditorState.create({ doc: 'hello world' })
    const result = computeStats(state)
    expect(result).toEqual({ words: 2, characters: 11, readingMinutes: 1 })
  })

  it('returns zero words for empty doc', () => {
    const state = EditorState.create({ doc: '' })
    const result = computeStats(state)
    expect(result).toEqual({ words: 0, characters: 0, readingMinutes: 1 })
  })

  it('counts visible comment anchors but not hidden thread notes', () => {
    const state = EditorState.create({
      doc: 'A <comment id="c001">visible anchor<note by="user" at="2026-06-13T09:30">hidden note text</note></comment>.',
    })
    const result = computeStats(state)
    expect(result).toEqual({ words: 3, characters: 17, readingMinutes: 1 })
  })
})

describe('computeSelectionStats', () => {
  it('returns null when selection is empty (cursor)', () => {
    const state = EditorState.create({
      doc: 'hello world',
      selection: { anchor: 5 },
    })
    expect(computeSelectionStats(state)).toBeNull()
  })

  it('counts words and characters of a single selection', () => {
    const state = EditorState.create({
      doc: 'hello beautiful world',
      selection: { anchor: 0, head: 15 }, // "hello beautiful"
    })
    const result = computeSelectionStats(state)
    expect(result).toEqual({ words: 2, characters: 15, selected: true })
  })

  it('strips comment notes from selection stats', () => {
    const doc = 'A <comment id="c001">visible anchor<note by="user" at="2026-06-13T09:30">hidden note text</note></comment>.'
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
    })
    const result = computeSelectionStats(state)
    expect(result).toEqual({ words: 3, characters: 17, selected: true })
  })

  it('sums across multiple selection ranges', () => {
    const state = EditorState.create({
      doc: 'aaa bbb ccc ddd',
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),   // "aaa"
        EditorSelection.range(8, 11),  // "ccc"
      ], 0),
    })
    const result = computeSelectionStats(state)
    expect(result).not.toBeNull()
    expect(result!.words).toBe(2)
    expect(result!.characters).toBe(6)
    expect(result!.selected).toBe(true)
  })

  it('falls back to null when all ranges are empty', () => {
    const state = EditorState.create({
      doc: 'hello',
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([
        EditorSelection.cursor(2),
        EditorSelection.cursor(4),
      ], 0),
    })
    expect(computeSelectionStats(state)).toBeNull()
  })
})

/**
 * Settings regression tests: editor settings (line numbers, spell check, word
 * wrap) live in compartments. Each tab caches its own EditorState, so a state
 * created while a setting was off keeps it off after view.setState() — the
 * panel must re-apply current settings (editorSettingsEffects) after every
 * tab switch, and the live settings watchers use the same effects.
 */
describe('editor settings effects', () => {
  function makeView(initialSettings: Record<string, boolean>) {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      state: createEditorState({ doc: 'hello world', initialSettings }),
      parent,
    })
    return { view, parent }
  }

  function hasLineNumbers(view: EditorView) {
    return !!view.dom.querySelector('.cm-gutter.cm-lineNumbers')
  }

  it('honors initial settings at state creation', () => {
    const off = makeView({ lineNumbers: false, spellCheck: false, wordWrap: true })
    expect(hasLineNumbers(off.view)).toBe(false)
    expect(off.view.contentDOM.getAttribute('spellcheck')).not.toBe('true')
    off.view.destroy(); off.parent.remove()

    const on = makeView({ lineNumbers: true, spellCheck: true, wordWrap: true })
    expect(hasLineNumbers(on.view)).toBe(true)
    expect(on.view.contentDOM.getAttribute('spellcheck')).toBe('true')
    on.view.destroy(); on.parent.remove()
  })

  it('toggles settings on the live view (the settings-watcher path)', () => {
    const { view, parent } = makeView({ lineNumbers: false, spellCheck: false, wordWrap: true })

    view.dispatch({ effects: editorSettingsEffects({ wordWrap: true, spellCheck: true, lineNumbers: true }) })
    expect(hasLineNumbers(view)).toBe(true)
    expect(view.contentDOM.getAttribute('spellcheck')).toBe('true')

    view.dispatch({ effects: editorSettingsEffects({ wordWrap: true, spellCheck: false, lineNumbers: false }) })
    expect(hasLineNumbers(view)).toBe(false)
    expect(view.contentDOM.getAttribute('spellcheck')).not.toBe('true')

    view.destroy(); parent.remove()
  })

  it('re-applies current settings over a cached tab state created with old settings', () => {
    const { view, parent } = makeView({ lineNumbers: false, spellCheck: false, wordWrap: true })

    // Second tab cached while line numbers were still off
    const cachedTabState = createEditorState({
      doc: 'tab two',
      initialSettings: { lineNumbers: false, spellCheck: false, wordWrap: true },
    })

    // User turns line numbers on; live view follows
    view.dispatch({ effects: editorSettingsEffects({ wordWrap: true, spellCheck: false, lineNumbers: true }) })
    expect(hasLineNumbers(view)).toBe(true)

    // Switching to the cached tab silently reverts the setting…
    view.setState(cachedTabState)
    expect(hasLineNumbers(view)).toBe(false)

    // …so the panel re-applies settings after every setState
    view.dispatch({ effects: editorSettingsEffects({ wordWrap: true, spellCheck: false, lineNumbers: true }) })
    expect(hasLineNumbers(view)).toBe(true)

    view.destroy(); parent.remove()
  })
})
