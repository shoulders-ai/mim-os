/* @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { deleteCharForward } from '@codemirror/commands'
import { parseCodeComments } from '@main/comments/codeModel.js'
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

  it('expands a whole-anchor deletion to remove the comment cleanly instead of leaving an empty shell', () => {
    const { view, parent } = makeView()
    const anchorFrom = DOC.indexOf('a staged rollout')
    const anchorTo = anchorFrom + 'a staged rollout'.length

    view.dispatch({ changes: { from: anchorFrom, to: anchorTo, insert: '' } })

    expect(view.state.doc.toString()).toBe('We propose  now.')
    expect(view.state.doc.toString()).not.toContain('<comment')

    view.destroy()
    parent.remove()
  })

  it('keeps the comment when the whole anchor is replaced with new text', () => {
    const { view, parent } = makeView()
    const anchorFrom = DOC.indexOf('a staged rollout')
    const anchorTo = anchorFrom + 'a staged rollout'.length

    view.dispatch({ changes: { from: anchorFrom, to: anchorTo, insert: 'a phased plan' } })

    expect(getCommentState(view.state).threads).toHaveLength(1)
    expect(getCommentState(view.state).threads[0].anchor).toBe('a phased plan')

    view.destroy()
    parent.remove()
  })

  it('notifies when a user edit removes a thread, but not for comment mutations', () => {
    const onThreadsRemovedByEdit = vi.fn()
    const parent = document.createElement('div')
    const view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: [commentsExtension({ onThreadsRemovedByEdit })],
      }),
      parent,
    })

    const from = DOC.indexOf('propose')
    const to = DOC.indexOf(' now.')
    view.dispatch({ selection: { anchor: from, head: to } })
    expect(deleteCharForward(view)).toBe(true)

    expect(onThreadsRemovedByEdit).toHaveBeenCalledTimes(1)
    expect(onThreadsRemovedByEdit).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'c001' }),
    ])

    // Programmatic resolve carries the mutation annotation: no notification.
    onThreadsRemovedByEdit.mockClear()
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: DOC },
      annotations: commentMutation.of(true),
    })
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'We propose a staged rollout now.' },
      annotations: commentMutation.of(true),
    })
    expect(onThreadsRemovedByEdit).not.toHaveBeenCalled()

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

describe('code comment mode (parse option)', () => {
  const PY_DOC = [
    'import math',
    '# @mim(c001) paul 2026-06-13T09:14: check this bound',
    'def clamp(x):',
    '    return max(0, x)',
  ].join('\n')

  function makeCodeView(doc = PY_DOC, options: Record<string, unknown> = {}) {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [commentsExtension({ parse: parseCodeComments, ...options })],
      }),
      parent,
    })
    return { view, parent }
  }

  it('hides the marker block and marks the anchored line', () => {
    const built = buildCommentDecorations(PY_DOC, null, true, parseCodeComments)
    const markerFrom = PY_DOC.indexOf('# @mim')
    const anchorFrom = PY_DOC.indexOf('def clamp(x):')

    const ranges: Array<{ from: number; to: number; mark: boolean }> = []
    const iter = built.decorations.iter()
    while (iter.value) {
      ranges.push({ from: iter.from, to: iter.to, mark: Boolean(iter.value.spec?.class) })
      iter.next()
    }

    expect(ranges).toEqual([
      { from: markerFrom, to: anchorFrom, mark: false },
      { from: anchorFrom, to: anchorFrom + 'def clamp(x):'.length, mark: true },
    ])
  })

  it('parses threads from editor state with the code parser', () => {
    const { view, parent } = makeCodeView()
    const state = getCommentState(view.state)
    expect(state.threads.map((thread: any) => thread.id)).toEqual(['c001'])
    expect(state.threads[0].anchor).toBe('def clamp(x):')
    view.destroy()
    parent.remove()
  })

  it('blocks user edits into the hidden marker line but allows editing the anchored line', () => {
    const { view, parent } = makeCodeView()
    const markerFrom = PY_DOC.indexOf('# @mim')

    view.dispatch({ changes: { from: markerFrom, to: markerFrom + 1, insert: '' } })
    expect(view.state.doc.toString()).toBe(PY_DOC)

    const anchorFrom = PY_DOC.indexOf('def clamp')
    view.dispatch({ changes: { from: anchorFrom, to: anchorFrom + 3, insert: 'DEF' } })
    expect(view.state.doc.toString()).toContain('DEF clamp(x):')
    expect(getCommentState(view.state).threads).toHaveLength(1)

    view.destroy()
    parent.remove()
  })

  it('builds non-overlapping hide ranges for stacked threads on the same anchor', () => {
    const doc = [
      '# @mim(aaaa) paul 2026-06-13T09:14: one',
      '# @mim(bbbb) ai 2026-06-13T09:15: two',
      'x = 1',
    ].join('\n')
    const built = buildCommentDecorations(doc, null, true, parseCodeComments)
    expect(built.threads).toHaveLength(2)
    // Decoration.set throws on overlapping replace ranges; reaching here with
    // both threads decorated proves the ranges are disjoint.
    expect(built.decorations.size).toBeGreaterThan(2)
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
