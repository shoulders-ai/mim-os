import { EditorState, Compartment, Prec } from '@codemirror/state'
import { EditorView, keymap, highlightActiveLine, drawSelection, dropCursor, rectangularSelection, crosshairCursor, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, bracketMatching, indentOnInput, foldKeymap, syntaxHighlighting } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { stripComments } from '@main/comments/model.js'
import { detectActiveFormats } from './formatting.js'
import { markdownLanguageExtension } from './language.js'

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--color-ink)',
    backgroundColor: 'var(--color-chrome)',
    fontSize: 'var(--editor-size)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--editor-font, var(--font-mono))',
    lineHeight: 'var(--editor-line-height)',
    letterSpacing: '0',
    backgroundColor: 'var(--editor-paper)',
  },
  '.cm-content': {
    caretColor: 'var(--color-accent)',
    maxWidth: 'var(--editor-max-width, none)',
    boxSizing: 'border-box',
    minHeight: '100%',
    margin: '0',
    padding: '24px clamp(8px, 3vw, 24px) clamp(72px, 20vh, 100px)',
    color: 'var(--color-ink)',
    textAlign: 'left',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  // Line numbers sit on the paper itself: no slab background, no border, mono
  // tabular digits a step smaller than the text, pinned to the exact pixel
  // line height so they baseline-align with the content at any font size.
  '.cm-gutters': {
    backgroundColor: 'var(--editor-paper)',
    color: 'var(--color-ink-4)',
    border: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72em',
    lineHeight: 'var(--editor-line-height)',
    fontVariantNumeric: 'tabular-nums',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 10px 0 16px',
    minWidth: '42px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--color-ink-2)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection) !important',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--color-accent)',
    borderLeftWidth: '2px',
  },
  '.cm-tooltip': {
    border: '1px solid var(--line-strong)',
    background: 'var(--panel)',
    color: 'var(--color-ink)',
    borderRadius: '3px',
    boxShadow: 'var(--shadow-low)',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete': {
    padding: '2px',
  },
  '.cm-tooltip-autocomplete ul': {
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
  },
  '.cm-tooltip-autocomplete ul li': {
    borderRadius: '2px',
    padding: '6px 8px',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: 'var(--color-accent)',
    color: 'var(--color-accent-ink)',
  },
  // ── Find/replace panel ──
  '.cm-panel.cm-search': {
    background: 'var(--panel)',
    borderBottom: '1px solid var(--line-strong)',
    padding: '4px 8px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    color: 'var(--color-ink)',
    gap: '4px',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search select': {
    background: 'var(--editor-paper)',
    border: '1px solid var(--line-strong)',
    borderRadius: '3px',
    color: 'var(--color-ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    padding: '2px 6px',
    outline: 'none',
  },
  '.cm-panel.cm-search input:focus': {
    borderColor: 'var(--color-accent)',
  },
  '.cm-panel.cm-search button': {
    background: 'var(--panel)',
    border: '1px solid var(--line-strong)',
    borderRadius: '3px',
    color: 'var(--color-ink)',
    fontFamily: 'var(--font-sans)',
    fontSize: '11px',
    padding: '2px 8px',
  },
  '.cm-panel.cm-search button:hover': {
    background: 'var(--editor-paper)',
  },
  '.cm-panel.cm-search button[name="close"]': {
    background: 'transparent',
    border: 'none',
    color: 'var(--muted)',
    fontSize: '14px',
    padding: '0 4px',
  },
  '.cm-panel.cm-search button[name="close"]:hover': {
    color: 'var(--color-ink)',
    background: 'transparent',
  },
  '.cm-panel.cm-search label': {
    color: 'var(--muted)',
    fontSize: '11px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'var(--color-accent-soft)',
    outline: '1px solid var(--color-accent)',
  },
}, { dark: false })

export const editorHighlightStyle = HighlightStyle.define([
  // ── Markdown prose ──
  { tag: t.heading1, fontWeight: '650', fontSize: '1.55em', color: 'var(--ink-strong)' },
  { tag: t.heading2, fontWeight: '650', fontSize: '1.25em', color: 'var(--ink-strong)' },
  { tag: t.heading3, fontWeight: '650', color: 'var(--ink-strong)' },
  { tag: [t.strong], fontWeight: '700', color: 'var(--ink-strong)' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.monospace], fontFamily: 'var(--font-mono)', backgroundColor: 'var(--inline-code-bg)', color: 'var(--code)' },
  { tag: [t.link], color: 'var(--color-accent)', textDecoration: 'underline', textUnderlineOffset: '3px' },
  { tag: [t.quote], color: 'var(--quote)', fontStyle: 'italic' },
  // ── Code tokens ──
  { tag: [t.keyword, t.atom, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syntax-keyword)' },
  { tag: [t.string, t.character, t.docString], color: 'var(--syntax-string)' },
  { tag: [t.number, t.integer, t.float], color: 'var(--syntax-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--muted)' },
  { tag: [t.typeName, t.namespace, t.className], color: 'var(--syntax-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syntax-function)' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--syntax-property)' },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator, t.updateOperator, t.definitionOperator], color: 'var(--syntax-operator)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--color-ink)' },
  { tag: [t.bool, t.null, t.self, t.unit], color: 'var(--syntax-keyword)' },
  { tag: [t.regexp, t.escape, t.special(t.string)], color: 'var(--syntax-string)' },
  { tag: [t.meta, t.annotation, t.processingInstruction, t.documentMeta], color: 'var(--syntax-meta)' },
  { tag: [t.punctuation, t.bracket, t.separator, t.angleBracket, t.squareBracket, t.paren, t.brace], color: 'var(--color-ink-3)' },
  { tag: [t.tagName, t.attributeName, t.attributeValue], color: 'var(--syntax-type)' },
  { tag: [t.macroName, t.special(t.variableName)], color: 'var(--syntax-function)' },
  { tag: [t.labelName, t.constant(t.variableName)], color: 'var(--syntax-keyword)' },
  { tag: [t.url], color: 'var(--color-accent)' },
  { tag: [t.inserted], color: 'var(--color-add)' },
  { tag: [t.deleted], color: 'var(--color-rem)' },
  { tag: [t.invalid], color: 'var(--color-rem)', textDecoration: 'underline' },
])

export const wrapCompartment = new Compartment()
export const spellcheckCompartment = new Compartment()
export const lineNumbersCompartment = new Compartment()
// Markdown by default (untitled drafts); reconfigured per file path through
// languageExtensionForPath when a tab with a concrete file becomes active.
export const languageCompartment = new Compartment()

export { lineNumbers }

const spellcheckExtension = EditorView.contentAttributes.of({ spellcheck: 'true' })

// One settings → compartment-effects mapping, shared by the live settings
// watchers and tab switches. Cached per-tab EditorStates keep the compartment
// config they were created with, so the panel must dispatch these effects
// after every setState — otherwise a toggled setting silently reverts on the
// next tab switch.
export function editorSettingsEffects({ wordWrap, spellCheck, lineNumbers: showLineNumbers }) {
  return [
    wrapCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
    spellcheckCompartment.reconfigure(spellCheck ? spellcheckExtension : []),
    lineNumbersCompartment.reconfigure(showLineNumbers ? lineNumbers() : []),
  ]
}

// Build a self-contained EditorState. Each tab needs its OWN state created
// here (never by dispatching another tab's content into a live view) so undo
// history can never leak across documents.
export function createEditorState({ doc, extensions = [], onChange, onCursor, onStats, onActiveFormats, onInlineAI, initialSettings, readOnly = false }) {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange?.(update)
    }
    if (update.docChanged || update.selectionSet) {
      const selStats = computeSelectionStats(update.state)
      onStats?.(selStats || computeStats(update.state))
    }
    if (update.selectionSet || update.docChanged) {
      const selection = update.state.selection.main
      const line = update.state.doc.lineAt(selection.head)
      onCursor?.({
        line: line.number,
        column: selection.head - line.from + 1,
        offset: selection.head,
        hasSelection: selection.from !== selection.to,
      })
      onActiveFormats?.(detectActiveFormats(update.state))
    }
  })

  const showWordWrap = initialSettings?.wordWrap ?? true
  const showSpellcheck = initialSettings?.spellCheck ?? false
  const showLineNumbers = initialSettings?.lineNumbers ?? false

  const inlineAIKeymap = onInlineAI ? Prec.highest(keymap.of([{
    key: 'Mod-k',
    run(view) {
      const sel = view.state.selection.main
      onInlineAI({
        from: sel.from,
        to: sel.to,
        text: sel.from === sel.to ? '' : view.state.sliceDoc(sel.from, sel.to),
        coords: view.coordsAtPos(sel.to),
      })
      return true
    },
  }])) : []

  return EditorState.create({
    doc,
    extensions: [
      inlineAIKeymap,
      wrapCompartment.of(showWordWrap ? EditorView.lineWrapping : []),
      spellcheckCompartment.of(showSpellcheck ? spellcheckExtension : []),
      lineNumbersCompartment.of(showLineNumbers ? lineNumbers() : []),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      languageCompartment.of(markdownLanguageExtension()),
      editorTheme,
      syntaxHighlighting(editorHighlightStyle),
      keymap.of([
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
      ]),
      updateListener,
      ...extensions,
    ],
  })
}

export function createEditor({ parent, ...stateOptions }) {
  return new EditorView({ state: createEditorState(stateOptions), parent })
}

export function computeStats(state) {
  const text = stripComments(state.doc.toString()).text
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const characters = text.length
  const readingMinutes = Math.max(1, Math.round(words / 230))
  return { words, characters, readingMinutes }
}

// Compute stats for the selected text. With multiple selections (rectangular
// selection mode), sums across all ranges. Returns null when selection is empty.
export function computeSelectionStats(state) {
  const ranges = state.selection.ranges
  let totalChars = 0
  let allText = ''
  for (const range of ranges) {
    if (range.from === range.to) continue
    const text = stripComments(state.sliceDoc(range.from, range.to)).text
    allText += (allText ? ' ' : '') + text
    totalChars += text.length
  }
  if (totalChars === 0) return null
  const words = allText.trim() ? allText.trim().split(/\s+/).length : 0
  return { words, characters: totalChars, selected: true }
}
