import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

// Marks the text range the inline AI (Cmd+K) dialog is acting on, so the
// floating dialog reads as attached to a concrete anchor. Set on open with a
// {from, to} range, cleared with null on close/apply. The range is mapped
// through document edits so it stays pinned to the same text. An empty range
// (cursor, no selection) has nothing to anchor, so it draws nothing.
export const setInlineAnchor = StateEffect.define({
  map(value, changes) {
    if (!value) return null
    const from = changes.mapPos(value.from, 1)
    const to = changes.mapPos(value.to, -1)
    return from < to ? { from, to } : null
  },
})

const anchorMark = Decoration.mark({ class: 'cm-inline-anchor' })

const inlineAnchorField = StateField.define({
  create() {
    return Decoration.none
  },
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      if (effect.is(setInlineAnchor)) {
        const range = effect.value
        next = range && range.from < range.to
          ? Decoration.set([anchorMark.range(range.from, range.to)])
          : Decoration.none
      }
    }
    if (next === value && tr.docChanged) {
      next = value.map(tr.changes)
    }
    return next
  },
  provide(field) {
    return EditorView.decorations.from(field)
  },
})

const inlineAnchorTheme = EditorView.theme({
  '.cm-inline-anchor': {
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 14%, transparent)',
    borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)',
    borderRadius: '1px',
  },
})

export function inlineAnchorExtension() {
  return [inlineAnchorField, inlineAnchorTheme]
}
