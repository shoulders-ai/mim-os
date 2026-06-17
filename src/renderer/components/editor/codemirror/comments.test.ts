/* @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { deleteCharForward } from '@codemirror/commands'
import {
  buildCommentDecorations,
  commentBackspace,
  commentDelete,
  commentMutation,
  commentsExtension,
  commentsHideExtension,
  getCommentState,
  setActiveComment,
} from './comments.js'

const DOC = 'We propose <comment id="c001">a staged rollout<note by="user" at="2026-06-13T09:30">Too slow</note></comment> now.'

function decorationSummary(doc: string, activeId: string | null = null) {
  const built = buildCommentDecorations(doc, activeId)
  const result: Array<{ from: number; to: number; className?: string; replace: boolean }> = []
  const iter = built.decorations.iter()
  while (iter.value) {
    result.push({
      from: iter.from,
      to: iter.to,
      className: iter.value.spec?.class,
      replace: iter.value.spec?.inclusive === false || !iter.value.spec?.class,
    })
    iter.next()
  }
  return result
}

function makeView(doc = DOC, extensions: unknown[] = []) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        commentsExtension(),
        ...extensions,
      ],
    }),
    parent,
  })
  return { view, parent }
}

describe('comment CodeMirror extension', () => {
  it('builds replace decorations for markup and mark decorations for anchors', () => {
    const summary = decorationSummary(DOC)
    const anchorFrom = DOC.indexOf('a staged rollout')
    const anchorTo = anchorFrom + 'a staged rollout'.length

    expect(summary).toEqual([
      { from: DOC.indexOf('<comment'), to: anchorFrom, className: undefined, replace: true },
      { from: anchorFrom, to: anchorTo, className: 'cm-comment-range', replace: false },
      { from: anchorTo, to: DOC.indexOf('</comment>') + '</comment>'.length, className: undefined, replace: true },
    ])
  })

  it('marks the active anchor distinctly', () => {
    const summary = decorationSummary(DOC, 'c001')
    expect(summary.some(item => item.className === 'cm-comment-range cm-comment-range-active')).toBe(true)
  })

  it('exposes parsed threads from editor state', () => {
    const { view, parent } = makeView()
    const state = getCommentState(view.state)

    expect(state.threads.map(thread => thread.id)).toEqual(['c001'])
    view.destroy()
    parent.remove()
  })

  it('updates active comment through an effect', () => {
    const { view, parent } = makeView()
    view.dispatch({ effects: setActiveComment.of('c001') })

    const state = getCommentState(view.state)
    expect(state.activeId).toBe('c001')
    expect(state.decorations.size).toBeGreaterThan(0)

    view.destroy()
    parent.remove()
  })

  it('notifies when parsed threads change', () => {
    const onThreadsChange = vi.fn()
    const parent = document.createElement('div')
    const view = new EditorView({
      state: EditorState.create({
        doc: 'plain',
        extensions: [commentsExtension({ onThreadsChange })],
      }),
      parent,
    })

    view.dispatch({
      changes: { from: 0, to: 5, insert: DOC },
      annotations: commentMutation.of(true),
    })

    expect(onThreadsChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'c001', anchor: 'a staged rollout' }),
    ]))

    view.destroy()
  })

  it('blocks edits that touch hidden markup', () => {
    const { view, parent } = makeView()

    view.dispatch({ changes: { from: DOC.indexOf('<comment'), to: DOC.indexOf('<comment') + 1, insert: '' } })
    expect(view.state.doc.toString()).toBe(DOC)

    view.destroy()
    parent.remove()
  })

  it('deletes selected visible text adjacent to hidden markup without dropping the comment', () => {
    const { view, parent } = makeView()
    const from = DOC.indexOf('propose')
    const anchorFrom = DOC.indexOf('a staged rollout')

    view.dispatch({ selection: { anchor: from, head: anchorFrom } })
    expect(deleteCharForward(view)).toBe(true)

    expect(view.state.doc.toString()).toBe('We <comment id="c001">a staged rollout<note by="user" at="2026-06-13T09:30">Too slow</note></comment> now.')

    view.destroy()
    parent.remove()
  })

  it('deletes a selected range that spans hidden comment markup', () => {
    const { view, parent } = makeView()
    const from = DOC.indexOf('propose')
    const to = DOC.indexOf(' now.')

    view.dispatch({ selection: { anchor: from, head: to } })
    expect(deleteCharForward(view)).toBe(true)

    expect(view.state.doc.toString()).toBe('We  now.')

    view.destroy()
    parent.remove()
  })

  it('allows programmatic comment mutations through the bypass annotation', () => {
    const { view, parent } = makeView()

    view.dispatch({
      changes: { from: DOC.indexOf('<comment'), to: DOC.indexOf('<comment') + 1, insert: '' },
      annotations: commentMutation.of(true),
    })
    expect(view.state.doc.toString()).not.toBe(DOC)

    view.destroy()
    parent.remove()
  })

  it('allows normal edits to anchor text', () => {
    const { view, parent } = makeView()
    const anchorFrom = DOC.indexOf('a staged rollout')

    view.dispatch({ changes: { from: anchorFrom, to: anchorFrom + 1, insert: 'A' } })
    expect(view.state.doc.toString()).toContain('A staged rollout')

    view.destroy()
    parent.remove()
  })

  it('redirects Backspace at a hidden boundary to the previous visible character', () => {
    const { view, parent } = makeView()
    const anchorFrom = DOC.indexOf('a staged rollout')
    view.dispatch({ selection: { anchor: anchorFrom } })

    expect(commentBackspace(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('We propose<comment id="c001">a staged rollout<note by="user" at="2026-06-13T09:30">Too slow</note></comment> now.')

    view.destroy()
    parent.remove()
  })

  it('redirects Delete at a hidden boundary to the next visible character', () => {
    const { view, parent } = makeView()
    const tagFrom = DOC.indexOf('<comment')
    view.dispatch({ selection: { anchor: tagFrom } })

    expect(commentDelete(view)).toBe(true)
    expect(view.state.doc.toString()).toContain('<comment id="c001"> staged rollout')

    view.destroy()
    parent.remove()
  })
})

describe('commentsHideExtension', () => {
  it('produces replace decorations that match the full extension while keeping doc raw', () => {
    const full = buildCommentDecorations(DOC, null)
    const hide = buildCommentDecorations(DOC, null)

    const fullReplace: Array<{ from: number; to: number }> = []
    const fullIter = full.decorations.iter()
    while (fullIter.value) {
      if (!fullIter.value.spec?.class) fullReplace.push({ from: fullIter.from, to: fullIter.to })
      fullIter.next()
    }

    const hideAll: Array<{ from: number; to: number }> = []
    const hideIter = hide.decorations.iter()
    while (hideIter.value) {
      if (!hideIter.value.spec?.class) hideAll.push({ from: hideIter.from, to: hideIter.to })
      hideIter.next()
    }

    expect(hideAll).toEqual(fullReplace)
    expect(hideAll.length).toBeGreaterThan(0)
  })

  it('keeps the raw document intact when mounted in an editor', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [commentsHideExtension()],
      }),
      parent,
    })

    expect(view.state.doc.toString()).toBe(DOC)
    expect(view.state.doc.toString()).toContain('<comment id="c001">')
    expect(view.state.doc.toString()).toContain('<note by="user"')

    view.destroy()
    parent.remove()
  })

  it('does not block edits (no change filter, no protection)', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [commentsHideExtension()],
      }),
      parent,
    })

    const tagFrom = DOC.indexOf('<comment')
    view.dispatch({ changes: { from: tagFrom, to: tagFrom + 1, insert: '' } })
    expect(view.state.doc.toString()).not.toBe(DOC)

    view.destroy()
    parent.remove()
  })
})
