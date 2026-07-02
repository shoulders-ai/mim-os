import { EditorState, Prec, Text } from '@codemirror/state'
import { history, historyKeymap, undo, redo, invertedEffects } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting } from '@codemirror/language'
import { Strikethrough } from '@lezer/markdown'
import { EditorView, ViewPlugin, keymap, lineNumbers } from '@codemirror/view'
import {
  MergeView,
  getChunks,
  getOriginalDoc,
  mergeViewSiblings,
  unifiedMergeView,
  updateOriginalDoc,
} from '@codemirror/merge'
import { editorHighlightStyle, editorTheme, wrapCompartment } from './core.js'
import { commentsHideExtension } from './comments.js'

const diffConfig = { scanLimit: 5000, timeout: 350 }

const diffTheme = EditorView.theme({
  '.cm-gutters': {
    background: 'var(--color-surface)',
    borderRight: '1px solid var(--color-rule-light)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--color-ink-3)',
    padding: '0 8px 0 4px',
    minWidth: '28px',
  },
  '.cm-changedLine': {
    background: 'color-mix(in srgb, var(--color-add) 7%, transparent)',
  },
  '.cm-insertedLine': {
    background: 'color-mix(in srgb, var(--color-add) 9%, transparent)',
    textDecoration: 'none',
  },
  '.cm-deletedLine, .cm-deletedChunk': {
    background: 'color-mix(in srgb, var(--color-rem) 8%, transparent)',
  },
  '.cm-changedText': {
    background: 'color-mix(in srgb, var(--color-add) 20%, transparent)',
    borderRadius: '2px',
  },
  '.cm-deletedText': {
    background: 'color-mix(in srgb, var(--color-rem) 18%, transparent)',
    textDecoration: 'line-through',
    textDecorationColor: 'color-mix(in srgb, var(--color-rem) 45%, transparent)',
  },
  '.cm-changedLineGutter': {
    background: 'var(--color-add)',
  },
  '.cm-deletedLineGutter': {
    background: 'var(--color-rem)',
  },
  '.cm-collapsedLines': {
    minHeight: '24px',
    padding: '0 12px',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--color-ink-3)',
    background: 'var(--color-chrome-mid)',
    borderTop: '1px dashed var(--color-rule-light)',
    borderBottom: '1px dashed var(--color-rule-light)',
  },
  '.cm-merge-revert': {
    width: '22px',
    background: 'var(--color-chrome)',
    borderLeft: '1px solid var(--color-rule-light)',
    borderRight: '1px solid var(--color-rule-light)',
  },
  '.cm-merge-revert button, .cm-chunkButtons button, .mim-merge-control': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    border: '1px solid transparent',
    borderRadius: '4px',
    background: 'var(--color-surface)',
    color: 'var(--color-ink-3)',
  },
  '.cm-merge-revert button svg, .cm-chunkButtons button svg, .mim-merge-control svg': {
    width: '12px',
    height: '12px',
    display: 'block',
  },
  '.cm-merge-revert button:hover, .cm-chunkButtons button:hover, .mim-merge-control:hover': {
    color: 'var(--color-ink)',
    borderColor: 'var(--color-rule)',
  },
  '.mim-merge-control-accept:hover': {
    color: 'var(--color-add)',
    borderColor: 'color-mix(in srgb, var(--color-add) 35%, var(--color-rule))',
    background: 'color-mix(in srgb, var(--color-add) 10%, var(--color-surface))',
  },
  '.mim-merge-control-reject:hover, .cm-merge-revert button:hover': {
    color: 'var(--color-rem)',
    borderColor: 'color-mix(in srgb, var(--color-rem) 35%, var(--color-rule))',
    background: 'color-mix(in srgb, var(--color-rem) 9%, var(--color-surface))',
  },
}, { dark: false })

const sharedDiffExtensions = [
  editorTheme,
  diffTheme,
  syntaxHighlighting(editorHighlightStyle),
  markdown({ base: markdownLanguage, extensions: [Strikethrough] }),
  lineNumbers(),
  wrapCompartment.of(EditorView.lineWrapping),
  history(),
  keymap.of(historyKeymap),
  commentsHideExtension(),
]

function chunkWatcherPlugin({ onAllResolved, onChunkCountChange, onResolvedContentChange }) {
  let hadChunks = false

  return ViewPlugin.define((view) => {
    const initial = getChunks(view.state)?.chunks.length ?? 0
    hadChunks = initial > 0
    onChunkCountChange?.(initial)
    onResolvedContentChange?.(view.state.doc.toString())

    return {
      update(update) {
        const count = getChunks(update.state)?.chunks.length ?? 0
        onChunkCountChange?.(count)
        if (update.docChanged) onResolvedContentChange?.(update.state.doc.toString())

        if (hadChunks && count === 0) {
          hadChunks = false
          setTimeout(() => onAllResolved?.(), 0)
        } else {
          hadChunks = count > 0
        }
      },
    }
  })
}

function splitChunkWatcherPlugin({ onAllResolved, onChunkCountChange, onResolvedContentChange }) {
  let hadChunks = false

  return ViewPlugin.define((view) => {
    const initial = mergeViewSiblings(view)?.chunks.length ?? 0
    hadChunks = initial > 0
    onChunkCountChange?.(initial)
    onResolvedContentChange?.(view.state.doc.toString())

    return {
      update(update) {
        const count = mergeViewSiblings(update.view)?.chunks.length ?? 0
        onChunkCountChange?.(count)
        if (update.docChanged) onResolvedContentChange?.(update.state.doc.toString())

        if (hadChunks && count === 0) {
          hadChunks = false
          setTimeout(() => onAllResolved?.(), 0)
        } else {
          hadChunks = count > 0
        }
      },
    }
  })
}

// Per-chunk controls are raw DOM (CodeMirror owns them), so build an inline SVG
// glyph rather than a cryptic letter: a check for accept, an X for reject.
function controlIcon(type) {
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2.4')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svgNS, 'path')
  path.setAttribute('d', type === 'accept' ? 'M5 12l4.5 4.5L19 7' : 'M6 6l12 12M18 6L6 18')
  svg.appendChild(path)
  return svg
}

export function renderUnifiedControl(type, action, onChunkResolved) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `mim-merge-control mim-merge-control-${type}`
  button.title = type === 'accept' ? 'Accept this chunk' : 'Reject this chunk'
  button.setAttribute('aria-label', button.title)
  button.appendChild(controlIcon(type))
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    // The button's screen position marks where the reviewer is looking; report
    // it after the resolve applies so the host can advance to the next chunk.
    const y = button.getBoundingClientRect().top
    action(event)
    if (onChunkResolved) setTimeout(() => onChunkResolved({ y }), 0)
  })
  return button
}

export function renderSplitRevertControl(onChunkResolved) {
  const button = document.createElement('button')
  button.type = 'button'
  // a-to-b revert discards the chunk's change, so it reads as "reject this chunk".
  button.className = 'mim-merge-control mim-merge-control-reject'
  button.title = 'Reject this chunk'
  button.setAttribute('aria-label', 'Reject this chunk')
  button.appendChild(controlIcon('reject'))
  if (onChunkResolved) {
    // The MergeView handles the revert via mousedown delegation on the gutter;
    // this listener fires first, so defer until the revert has applied.
    button.addEventListener('mousedown', () => {
      const y = button.getBoundingClientRect().top
      setTimeout(() => onChunkResolved({ y }), 0)
    })
  }
  return button
}

function forwardSplitGutterWheel(mergeView) {
  const gutter = mergeView.dom.querySelector('.cm-merge-revert')
  if (!gutter) return
  gutter.addEventListener('wheel', (event) => {
    if (event.deltaY === 0 && event.deltaX === 0) return
    event.preventDefault()
    mergeView.a.scrollDOM.scrollTop += event.deltaY
    mergeView.b.scrollDOM.scrollTop += event.deltaY
    mergeView.a.scrollDOM.scrollLeft += event.deltaX
    mergeView.b.scrollDOM.scrollLeft += event.deltaX
  }, { passive: false })
}

export function createUnifiedDiffView({
  parent,
  originalContent,
  modifiedContent,
  collapse = false,
  readOnly = false,
  onAllResolved,
  onChunkCountChange,
  onResolvedContentChange,
  onChunkResolved,
}) {
  const state = EditorState.create({
    doc: modifiedContent,
    extensions: [
      ...sharedDiffExtensions,
      Prec.highest(keymap.of(historyKeymap)),
      unifiedMergeView({
        original: Text.of(originalContent.split('\n')),
        gutter: true,
        highlightChanges: true,
        syntaxHighlightDeletions: false,
        allowInlineDiffs: true,
        // A read-only preview (approval review) shows the change but offers no
        // per-chunk accept/reject; the decision lives elsewhere.
        mergeControls: readOnly
          ? false
          : (type, action) => renderUnifiedControl(type, action, onChunkResolved),
        diffConfig,
        ...(collapse ? { collapseUnchanged: { margin: 3, minSize: 4 } } : {}),
      }),
      ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      invertedEffects.of(transaction => {
        const effects = []
        for (const effect of transaction.effects) {
          if (!effect.is(updateOriginalDoc)) continue
          const previousOriginal = getOriginalDoc(transaction.startState)
          effects.push(updateOriginalDoc.of({
            doc: previousOriginal,
            changes: effect.value.changes.invert(previousOriginal),
          }))
        }
        return effects
      }),
      chunkWatcherPlugin({ onAllResolved, onChunkCountChange, onResolvedContentChange }),
    ],
  })

  return new EditorView({ state, parent })
}

export function createSplitDiffView({
  parent,
  originalContent,
  modifiedContent,
  collapse = false,
  readOnly = false,
  onAllResolved,
  onChunkCountChange,
  onResolvedContentChange,
  onChunkResolved,
}) {
  const mergeView = new MergeView({
    a: {
      doc: originalContent,
      extensions: [
        ...sharedDiffExtensions,
        EditorView.editable.of(false),
      ],
    },
    b: {
      doc: modifiedContent,
      extensions: [
        ...sharedDiffExtensions,
        ...(readOnly ? [EditorView.editable.of(false), EditorState.readOnly.of(true)] : []),
        splitChunkWatcherPlugin({ onAllResolved, onChunkCountChange, onResolvedContentChange }),
      ],
    },
    parent,
    orientation: 'a-b',
    // A read-only preview offers no revert (accept) controls.
    ...(readOnly
      ? {}
      : { revertControls: 'a-to-b', renderRevertControl: () => renderSplitRevertControl(onChunkResolved) }),
    highlightChanges: true,
    gutter: true,
    diffConfig,
    ...(collapse ? { collapseUnchanged: { margin: 3, minSize: 4 } } : {}),
  })

  mergeView.dom.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'z') return
    event.preventDefault()
    if (event.shiftKey) {
      redo(mergeView.b) || redo(mergeView.a)
    } else {
      undo(mergeView.b) || undo(mergeView.a)
    }
  })
  mergeView.dom.tabIndex = -1
  forwardSplitGutterWheel(mergeView)

  return mergeView
}

export function createReadOnlyView({ parent, content }) {
  const state = EditorState.create({
    doc: content,
    extensions: [
      ...sharedDiffExtensions,
      EditorView.editable.of(false),
      EditorView.theme({
        '&': { cursor: 'default' },
        '.cm-cursor': { display: 'none !important' },
      }),
    ],
  })

  return new EditorView({ state, parent })
}

export function getUnifiedChunks(view) {
  return getChunks(view?.state)?.chunks ?? []
}

export function getSplitChunks(view) {
  return view?.chunks ?? []
}

export function getResolvedContent(view, type, fallback = '') {
  if (!view) return fallback
  if (type === 'unified') return view.state.doc.toString()
  if (type === 'split') return view.b.state.doc.toString()
  if (type === 'readonly') return fallback
  return fallback
}
