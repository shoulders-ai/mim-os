import { Annotation, StateEffect, StateField, Prec } from '@codemirror/state'
import { EditorView, Decoration, WidgetType } from '@codemirror/view'

const setGhost = StateEffect.define()
const clearGhost = StateEffect.define()
const cycleGhost = StateEffect.define()
const ghostAccept = Annotation.define()

class GhostWidget extends WidgetType {
  constructor(text, index, total) {
    super()
    this.text = text
    this.index = index
    this.total = total
  }

  eq(other) {
    return this.text === other.text && this.index === other.index && this.total === other.total
  }

  toDOM() {
    const el = document.createElement('span')
    el.className = 'ghost-text'
    el.textContent = this.text
    return el
  }
}

class GhostHintWidget extends WidgetType {
  constructor(index, total) {
    super()
    this.index = index
    this.total = total
  }

  eq(other) {
    return this.index === other.index && this.total === other.total
  }

  toDOM() {
    const el = document.createElement('div')
    el.className = 'ghost-hint-line'
    if (this.total > 1) {
      const count = document.createElement('span')
      count.className = 'ghost-hint-count'
      count.textContent = `${this.index + 1}/${this.total}`
      el.appendChild(count)
    }
    appendHintItem(el, ['Tab'], 'accept')
    if (this.total > 1) appendHintItem(el, ['↑', '↓'], 'cycle')
    appendHintItem(el, ['Esc'], 'cancel')
    return el
  }

  ignoreEvent() {
    return true
  }
}

class GhostLoadingWidget extends WidgetType {
  eq() {
    return true
  }

  toDOM() {
    const el = document.createElement('span')
    el.className = 'ghost-loading'
    el.setAttribute('aria-label', 'AI composing')
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement('span')
      dot.className = 'ghost-loading-dot'
      dot.textContent = '.'
      el.appendChild(dot)
    }
    return el
  }
}

class GhostErrorWidget extends WidgetType {
  constructor(message) {
    super()
    this.message = message
  }

  eq(other) {
    return this.message === other.message
  }

  toDOM() {
    const el = document.createElement('div')
    el.className = 'ghost-hint-line ghost-error-line'
    const text = document.createElement('span')
    text.textContent = this.message
    el.appendChild(text)
    appendHintItem(el, ['Esc'], 'dismiss')
    return el
  }

  ignoreEvent() {
    return true
  }
}

function appendHintItem(parent, keys, label) {
  const item = document.createElement('span')
  item.className = 'ghost-hint-item'
  for (const key of keys) {
    const keycap = document.createElement('kbd')
    keycap.textContent = key
    item.appendChild(keycap)
  }
  const text = document.createElement('span')
  text.textContent = label
  item.appendChild(text)
  parent.appendChild(item)
}

const ghostField = StateField.define({
  create() {
    return { active: false, pending: false, suggestions: [], index: 0, pos: 0, error: null }
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhost)) return { active: true, pending: Boolean(effect.value.pending), suggestions: effect.value.suggestions || [], index: 0, pos: effect.value.pos, error: effect.value.error || null }
      if (effect.is(clearGhost)) return { active: false, pending: false, suggestions: [], index: 0, pos: 0, error: null }
      if (effect.is(cycleGhost) && value.active && value.suggestions.length > 0) {
        return { ...value, index: (value.index + effect.value + value.suggestions.length) % value.suggestions.length }
      }
    }
    if (tr.docChanged && value.active && !tr.annotation(ghostAccept)) {
      return { active: false, pending: false, suggestions: [], index: 0, pos: 0, error: null }
    }
    if (tr.changes && value.active) {
      return { ...value, pos: tr.changes.mapPos(value.pos) }
    }
    return value
  },
})

const ghostDecorations = EditorView.decorations.compute([ghostField], (state) => {
  const ghost = state.field(ghostField)
  if (!ghost.active) return Decoration.none
  if (ghost.pending) {
    return Decoration.set([
      Decoration.widget({
        widget: new GhostLoadingWidget(),
        side: 1,
      }).range(ghost.pos),
    ])
  }
  if (ghost.error) {
    return Decoration.set([
      Decoration.widget({
        widget: new GhostErrorWidget(ghost.error),
        block: true,
        side: 1,
      }).range(ghost.pos),
    ])
  }
  if (ghost.suggestions.length === 0) return Decoration.none
  return Decoration.set([
    Decoration.widget({
      widget: new GhostWidget(ghost.suggestions[ghost.index], ghost.index, ghost.suggestions.length),
      side: 1,
    }).range(ghost.pos),
    Decoration.widget({
      widget: new GhostHintWidget(ghost.index, ghost.suggestions.length),
      block: true,
      side: 1,
    }).range(ghost.pos),
  ])
})

/**
 * Ghost suggestion extension for CM6.
 * The extension structure is fully functional — AI suggestion fetching
 * can be wired in via the `getSuggestions` option when ready.
 */
export function ghostExtension(options = {}) {
  let lastPlusAt = 0
  const getSuggestions = options.getSuggestions
  const onStateChange = options.onStateChange
  const onAccept = options.onAccept

  return [
    ghostField,
    ghostDecorations,
    EditorView.updateListener.of((update) => {
      if (!onStateChange) return
      const previous = update.startState.field(ghostField)
      const next = update.state.field(ghostField)
      if (
        previous.active !== next.active ||
        previous.pending !== next.pending ||
        previous.index !== next.index ||
        previous.suggestions.length !== next.suggestions.length
      ) {
        onStateChange({ ...next })
      }
    }),
    Prec.highest(EditorView.domEventHandlers({
      keydown(event, view) {
        const ghost = view.state.field(ghostField)

        if (ghost.active) {
          if (ghost.pending && event.key !== 'Escape') {
            return false
          }
          if (event.altKey && event.key === 'ArrowRight') {
            event.preventDefault()
            acceptNextWord(view, onAccept)
            return true
          }
          if (event.key === 'Enter') {
            // Enter dismisses the ghost and inserts a newline normally
            view.dispatch({ effects: clearGhost.of(null) })
            return false
          }
          if (event.key === 'Tab' || event.key === 'ArrowRight') {
            event.preventDefault()
            acceptGhost(view, onAccept)
            return true
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            view.dispatch({ effects: cycleGhost.of(-1) })
            return true
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            view.dispatch({ effects: cycleGhost.of(1) })
            return true
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            view.dispatch({ effects: clearGhost.of(null) })
            return true
          }
          view.dispatch({ effects: clearGhost.of(null) })
          return false
        }

        // Double-plus trigger (++ to invoke ghost suggestions).
        // Suppressed when preceded by a word character (e.g. `count++`) to
        // avoid false triggers in code and prose like "C++".
        if (event.key === '+' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const now = Date.now()
          if (now - lastPlusAt < 320) {
            const pos = view.state.selection.main.head
            // Check the character before the first '+' (pos-1 is the first +, pos-2 is the char before it)
            const charBefore = pos >= 2 ? view.state.sliceDoc(pos - 2, pos - 1) : ''
            if (/\w/.test(charBefore)) {
              lastPlusAt = 0
              return false
            }
            event.preventDefault()
            view.dispatch({ changes: { from: Math.max(0, pos - 1), to: pos } })
            const suggestionPos = Math.max(0, pos - 1)
            if (!getSuggestions) {
              // No AI provider wired — stay silent
              lastPlusAt = 0
              return true
            }
            view.dispatch({
              effects: setGhost.of({
                pos: suggestionPos,
                pending: true,
                suggestions: [],
              }),
            })
            const before = view.state.sliceDoc(Math.max(0, suggestionPos - 5000), suggestionPos)
            const after = view.state.sliceDoc(suggestionPos, Math.min(view.state.doc.length, suggestionPos + 1000))
            getSuggestions({ before, after, pos: suggestionPos })
              .then((result) => {
                const current = view.state.field(ghostField)
                if (!current.active || current.pos !== suggestionPos) return
                if (result && typeof result === 'object' && !Array.isArray(result) && result.error) {
                  view.dispatch({ effects: setGhost.of({ pos: suggestionPos, suggestions: [], error: result.error }) })
                  return
                }
                const items = Array.isArray(result) ? result : (result?.suggestions || [])
                const clean = cleanSuggestions(items)
                if (clean.length > 0) {
                  view.dispatch({ effects: setGhost.of({ pos: suggestionPos, suggestions: clean }) })
                } else {
                  // Empty result — stay silent
                  view.dispatch({ effects: clearGhost.of(null) })
                }
              })
              .catch(() => {
                const current = view.state.field(ghostField)
                if (!current.active || current.pos !== suggestionPos) return
                // AI failure — stay silent
                view.dispatch({ effects: clearGhost.of(null) })
              })
            lastPlusAt = 0
            return true
          }
          lastPlusAt = now
        }

        return false
      },
      mousedown(_event, view) {
        const ghost = view.state.field(ghostField)
        if (ghost.active) view.dispatch({ effects: clearGhost.of(null) })
        return false
      },
    })),
  ]
}

function acceptGhost(view, onAccept) {
  const ghost = view.state.field(ghostField)
  if (!ghost.active || ghost.pending || ghost.suggestions.length === 0) return
  const text = ghost.suggestions[ghost.index]
  view.dispatch({
    changes: { from: ghost.pos, insert: text },
    selection: { anchor: ghost.pos + text.trimEnd().length },
    effects: clearGhost.of(null),
    annotations: ghostAccept.of(true),
  })
  onAccept?.({ mode: 'full' })
}

function cleanSuggestions(suggestions) {
  if (!Array.isArray(suggestions)) return []
  const seen = new Set()
  const clean = []
  for (const item of suggestions) {
    if (typeof item !== 'string') continue
    const normalized = item.replace(/\r\n/g, '\n')
    if (!normalized.trim()) continue
    const key = normalized.trim()
    if (seen.has(key)) continue
    seen.add(key)
    clean.push(normalized)
  }
  return clean.slice(0, 5)
}

function acceptNextWord(view, onAccept) {
  const ghost = view.state.field(ghostField)
  if (!ghost.active || ghost.pending || ghost.suggestions.length === 0) return
  const text = ghost.suggestions[ghost.index]
  const match = text.match(/^(\s*\S+\s*)/)
  const insert = match ? match[1] : text
  const rest = text.slice(insert.length)
  view.dispatch({
    changes: { from: ghost.pos, insert },
    selection: { anchor: ghost.pos + insert.length },
    effects: rest ? setGhost.of({ pos: ghost.pos + insert.length, suggestions: [rest] }) : clearGhost.of(null),
    annotations: ghostAccept.of(true),
  })
  onAccept?.({ mode: 'word' })
}
