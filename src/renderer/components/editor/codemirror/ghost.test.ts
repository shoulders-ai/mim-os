// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ghostExtension } from './ghost.js'

function createGhostView(doc, options = {}) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    extensions: [ghostExtension(options)],
  })
  return new EditorView({ state, parent })
}

function dispatchKey(view, key, opts = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  })
  view.contentDOM.dispatchEvent(event)
  return event
}

describe('ghost suggestions', () => {
  describe('accept keys', () => {
    it('calls onAccept when accepting a full ghost suggestion', async () => {
      const onAccept = vi.fn()
      const view = createGhostView('hello ', {
        getSuggestions: vi.fn(async () => ['suggestion text']),
        onAccept,
      })
      view.dispatch({ selection: { anchor: 6 } })

      dispatchKey(view, '+')
      view.dispatch({ changes: { from: 6, insert: '+' }, selection: { anchor: 7 } })
      dispatchKey(view, '+')
      await new Promise(r => setTimeout(r, 50))
      dispatchKey(view, 'Tab')

      expect(onAccept).toHaveBeenCalledWith({ mode: 'full' })
      expect(view.state.doc.toString()).toContain('suggestion text')
      view.destroy()
    })

    it('calls onAccept when accepting the next word', async () => {
      const onAccept = vi.fn()
      const view = createGhostView('hello ', {
        getSuggestions: vi.fn(async () => ['suggestion text']),
        onAccept,
      })
      view.dispatch({ selection: { anchor: 6 } })

      dispatchKey(view, '+')
      view.dispatch({ changes: { from: 6, insert: '+' }, selection: { anchor: 7 } })
      dispatchKey(view, '+')
      await new Promise(r => setTimeout(r, 50))
      dispatchKey(view, 'ArrowRight', { altKey: true })

      expect(onAccept).toHaveBeenCalledWith({ mode: 'word' })
      expect(view.state.doc.toString()).toContain('suggestion ')
      view.destroy()
    })

    it('Enter dismisses ghost and does not accept the suggestion', () => {
      // Verify Enter is NOT in the accept key list by checking the
      // ghost.js source behavior: when Enter is pressed with an active ghost,
      // the ghost should be cleared without inserting the suggestion text.
      // We test this by setting up a ghost state and pressing Enter.
      const getSuggestions = vi.fn(async () => ['suggestion text'])
      const view = createGhostView('hello ', { getSuggestions })
      view.dispatch({ selection: { anchor: 6 } })

      // Trigger ghost via ++ (at start of line / after space)
      dispatchKey(view, '+')
      // After first +, the char is NOT inserted by the keydown handler.
      // Simulate the character being typed (input event)
      view.dispatch({ changes: { from: 6, insert: '+' }, selection: { anchor: 7 } })

      // Second + triggers
      dispatchKey(view, '+')
      // Ghost is now active (pending)

      // Press Enter -- should dismiss, not accept
      const enterEvent = dispatchKey(view, 'Enter')

      // The ghost should be cleared. The document should NOT contain
      // the suggestion text.
      expect(view.state.doc.toString()).not.toContain('suggestion text')

      view.destroy()
    })
  })

  describe('silence on failure', () => {
    it('does not insert canned text when no getSuggestions is wired', () => {
      // Without getSuggestions, triggering ++ should not show any text
      const view = createGhostView('hello ', {})
      view.dispatch({ selection: { anchor: 6 } })

      dispatchKey(view, '+')
      view.dispatch({ changes: { from: 6, insert: '+' }, selection: { anchor: 7 } })
      dispatchKey(view, '+')

      // Document should be "hello " (the ++ chars should be removed by the trigger)
      // and no suggestion text should appear
      expect(view.state.doc.toString()).not.toContain('practical test')
      expect(view.state.doc.toString()).not.toContain('calm under pressure')
      expect(view.state.doc.toString()).not.toContain('constraint')

      view.destroy()
    })

    it('clears ghost when AI returns empty results', async () => {
      const getSuggestions = vi.fn(async () => [])
      const onStateChange = vi.fn()
      const view = createGhostView('hello ', { getSuggestions, onStateChange })
      view.dispatch({ selection: { anchor: 6 } })

      dispatchKey(view, '+')
      view.dispatch({ changes: { from: 6, insert: '+' }, selection: { anchor: 7 } })
      dispatchKey(view, '+')

      // Wait for the async getSuggestions to resolve
      await new Promise(r => setTimeout(r, 50))

      // Document should not contain any canned fallback text
      expect(view.state.doc.toString()).not.toContain('practical test')
      expect(view.state.doc.toString()).not.toContain('calm under pressure')

      view.destroy()
    })

    it('clears ghost when AI throws an error', async () => {
      const getSuggestions = vi.fn(async () => { throw new Error('network fail') })
      const view = createGhostView('hello ', { getSuggestions })
      view.dispatch({ selection: { anchor: 6 } })

      dispatchKey(view, '+')
      view.dispatch({ changes: { from: 6, insert: '+' }, selection: { anchor: 7 } })
      dispatchKey(view, '+')

      await new Promise(r => setTimeout(r, 50))

      expect(view.state.doc.toString()).not.toContain('practical test')
      expect(view.state.doc.toString()).not.toContain('calm under pressure')

      view.destroy()
    })
  })

  describe('++ trigger safety', () => {
    it('does NOT fire ++ trigger when preceded by a word character', () => {
      const getSuggestions = vi.fn(async () => ['suggestion'])
      const view = createGhostView('count', { getSuggestions })
      // Cursor right after "count"
      view.dispatch({ selection: { anchor: 5 } })

      // Type first + (keydown fires first, then character is inserted)
      dispatchKey(view, '+')
      // Simulate the first + being inserted into the doc
      view.dispatch({ changes: { from: 5, insert: '+' }, selection: { anchor: 6 } })

      // Type second + (keydown fires, handler checks ++)
      dispatchKey(view, '+')

      // The trigger should NOT fire because 't' precedes the ++
      expect(getSuggestions).not.toHaveBeenCalled()

      view.destroy()
    })

    it('fires ++ trigger when preceded by whitespace', () => {
      const getSuggestions = vi.fn(async () => ['suggestion'])
      const view = createGhostView('hello ', { getSuggestions })
      view.dispatch({ selection: { anchor: 6 } })

      // Type first +
      dispatchKey(view, '+')
      view.dispatch({ changes: { from: 6, insert: '+' }, selection: { anchor: 7 } })

      // Type second + triggers
      dispatchKey(view, '+')

      expect(getSuggestions).toHaveBeenCalled()

      view.destroy()
    })

    it('fires ++ trigger at the start of the document', () => {
      const getSuggestions = vi.fn(async () => ['suggestion'])
      const view = createGhostView('', { getSuggestions })

      // Type first +
      dispatchKey(view, '+')
      view.dispatch({ changes: { from: 0, insert: '+' }, selection: { anchor: 1 } })

      // Type second +
      dispatchKey(view, '+')

      expect(getSuggestions).toHaveBeenCalled()

      view.destroy()
    })
  })
})
