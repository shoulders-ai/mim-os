import { Annotation, EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import { parseComments } from '@main/comments/model.js'

export const commentMutation = Annotation.define()
export const setActiveComment = StateEffect.define()

export function buildCommentDecorations(docText, activeId = null, enabled = true) {
  const threads = enabled ? parseComments(docText) : []
  const decorations = []
  const hidden = []

  for (const thread of threads) {
    if (thread.tagFrom < thread.anchorFrom) {
      const deco = Decoration.replace({ inclusive: false }).range(thread.tagFrom, thread.anchorFrom)
      decorations.push(deco)
      hidden.push(deco)
    }

    if (thread.anchorFrom < thread.anchorTo) {
      decorations.push(Decoration.mark({
        class: thread.id === activeId
          ? 'cm-comment-range cm-comment-range-active'
          : 'cm-comment-range',
        attributes: {
          'data-comment-id': thread.id,
          title: 'Review comment',
        },
      }).range(thread.anchorFrom, thread.anchorTo))
    }

    if (thread.anchorTo < thread.tagTo) {
      const deco = Decoration.replace({ inclusive: false }).range(thread.anchorTo, thread.tagTo)
      decorations.push(deco)
      hidden.push(deco)
    }
  }

  return {
    enabled,
    activeId,
    threads,
    decorations: Decoration.set(decorations, true),
    hiddenRanges: Decoration.set(hidden, true),
  }
}

const commentField = StateField.define({
  create(state) {
    return buildCommentDecorations(state.doc.toString(), null)
  },
  update(value, tr) {
    let activeId = value.activeId
    let activeChanged = false

    for (const effect of tr.effects) {
      if (effect.is(setActiveComment)) {
        activeId = effect.value || null
        activeChanged = true
      }
    }

    if (tr.docChanged || activeChanged) {
      return buildCommentDecorations(tr.newDoc.toString(), activeId)
    }
    return value
  },
  provide(field) {
    return [
      EditorView.decorations.from(field, value => value.decorations),
      EditorView.atomicRanges.of(view => view.state.field(field).hiddenRanges),
    ]
  },
})

export function getCommentState(state) {
  return state.field(commentField, false) || buildCommentDecorations(state.doc.toString(), null)
}

const commentHideField = StateField.define({
  create(state) {
    return buildCommentDecorations(state.doc.toString(), null)
  },
  update(value, tr) {
    if (tr.docChanged) return buildCommentDecorations(tr.newDoc.toString(), null)
    return value
  },
  provide(field) {
    return EditorView.decorations.from(field, value => value.decorations)
  },
})

export function commentsHideExtension() {
  return commentHideField
}

export function commentsExtension(options = {}) {
  return [
    commentField,
    commentProtection(),
    commentKeymap(),
    commentClickHandler(options),
    commentUpdateListener(options),
    commentTheme,
  ]
}

function commentProtection() {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(commentMutation)) return tr
    const state = getCommentState(tr.startState)
    if (state.threads.length === 0) return tr

    const hidden = hiddenRanges(state.threads)
    const changes = []
    let normalized = false
    let blocked = false

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const result = normalizeCommentChange(state.threads, hidden, fromA, toA, inserted.toString())
      if (!result) {
        blocked = true
        return
      }
      normalized = normalized || result.normalized
      changes.push(...result.changes)
    })

    if (blocked) return { changes: [] }
    if (!normalized) return tr

    const merged = mergeChanges(changes)
    return merged ? { changes: merged } : { changes: [] }
  })
}

function normalizeCommentChange(threads, hidden, from, to, insert) {
  if (!changeTouchesRanges(hidden, from, to)) {
    return { normalized: false, changes: [{ from, to, insert }] }
  }

  if (from === to) return null

  const touchedThreads = threads.filter(thread =>
    changeTouchesRanges(threadHiddenRanges(thread), from, to)
  )
  const anchorTouched = touchedThreads.some(thread =>
    rangesIntersect(from, to, thread.anchorFrom, thread.anchorTo)
  )

  if (anchorTouched) {
    let expandedFrom = from
    let expandedTo = to
    for (const thread of touchedThreads) {
      if (!rangesIntersect(from, to, thread.anchorFrom, thread.anchorTo)) continue
      expandedFrom = Math.min(expandedFrom, thread.tagFrom)
      expandedTo = Math.max(expandedTo, thread.tagTo)
    }
    return {
      normalized: expandedFrom !== from || expandedTo !== to,
      changes: [{ from: expandedFrom, to: expandedTo, insert }],
    }
  }

  const visibleParts = subtractRanges(from, to, hidden)
  if (visibleParts.length === 0) return insert ? null : { normalized: true, changes: [] }

  return {
    normalized: true,
    changes: visibleParts.map((part, index) => ({
      from: part.from,
      to: part.to,
      insert: index === 0 ? insert : '',
    })),
  }
}

function changeTouchesRanges(ranges, from, to) {
  for (const range of ranges) {
    if (from === to) {
      if (from > range.from && from < range.to) return true
      continue
    }
    if (rangesIntersect(from, to, range.from, range.to)) return true
  }
  return false
}

function rangesIntersect(fromA, toA, fromB, toB) {
  return fromA < toB && toA > fromB
}

function subtractRanges(from, to, ranges) {
  const parts = []
  let cursor = from
  for (const range of ranges) {
    if (range.to <= cursor || range.from >= to) continue
    if (cursor < range.from) parts.push({ from: cursor, to: Math.min(range.from, to) })
    cursor = Math.max(cursor, range.to)
    if (cursor >= to) break
  }
  if (cursor < to) parts.push({ from: cursor, to })
  return parts.filter(part => part.from < part.to)
}

function mergeChanges(changes) {
  if (changes.length <= 1) return changes
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to)
  const merged = []
  for (const change of sorted) {
    const last = merged[merged.length - 1]
    if (!last || change.from >= last.to) {
      merged.push({ ...change })
      continue
    }
    if (last.insert || change.insert) return null
    last.to = Math.max(last.to, change.to)
  }
  return merged
}

function commentKeymap() {
  return Prec.highest(keymap.of([
    { key: 'Backspace', run: commentBackspace },
    { key: 'Delete', run: commentDelete },
  ]))
}

export function commentBackspace(view) {
  const selection = view.state.selection.main
  if (!selection.empty) return false
  const pos = selection.head
  const state = getCommentState(view.state)

  for (const range of hiddenRanges(state.threads)) {
    if (pos !== range.to) continue
    if (range.from <= 0) return true
    view.dispatch({
      changes: { from: range.from - 1, to: range.from, insert: '' },
    })
    return true
  }
  return false
}

export function commentDelete(view) {
  const selection = view.state.selection.main
  if (!selection.empty) return false
  const pos = selection.head
  const state = getCommentState(view.state)

  for (const range of hiddenRanges(state.threads)) {
    if (pos !== range.from) continue
    if (range.to >= view.state.doc.length) return true
    view.dispatch({
      changes: { from: range.to, to: range.to + 1, insert: '' },
    })
    return true
  }
  return false
}

function commentClickHandler(options) {
  return EditorView.domEventHandlers({
    click(event, view) {
      const target = event.target
      const el = target instanceof Element ? target.closest('.cm-comment-range') : null
      if (!el) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      const state = getCommentState(view.state)
      const thread = state.threads.find(item =>
        (typeof pos === 'number' && pos >= item.anchorFrom && pos <= item.anchorTo) ||
        el.getAttribute('data-comment-id') === item.id
      )
      if (!thread) return false
      view.dispatch({ effects: setActiveComment.of(thread.id) })
      options.onActiveComment?.(thread.id)
      return false
    },
  })
}

function commentUpdateListener(options) {
  return EditorView.updateListener.of((update) => {
    if (!options.onThreadsChange) return
    if (!update.docChanged) return
    options.onThreadsChange(getCommentState(update.state).threads)
  })
}

function hiddenRanges(threads) {
  const ranges = []
  for (const thread of threads) {
    ranges.push(...threadHiddenRanges(thread))
  }
  return ranges
}

function threadHiddenRanges(thread) {
  const ranges = []
  if (thread.tagFrom < thread.anchorFrom) ranges.push({ from: thread.tagFrom, to: thread.anchorFrom })
  if (thread.anchorTo < thread.tagTo) ranges.push({ from: thread.anchorTo, to: thread.tagTo })
  return ranges
}

const commentTheme = EditorView.theme({
  '.cm-comment-range': {
    backgroundColor: 'var(--color-accent-tint)',
    borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
    borderRadius: '1px',
  },
  '.cm-comment-range-active': {
    backgroundColor: 'var(--color-accent-soft)',
    borderBottomColor: 'var(--color-accent)',
  },
})
