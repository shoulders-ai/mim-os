/**
 * CM6 markdown formatting commands.
 * Each function takes a CM6 EditorView and dispatches a transaction.
 */

import { syntaxTree } from '@codemirror/language'

// Maps marker strings to syntax tree node names for inline formats
const MARKER_NODE_MAP = {
  '**': ['StrongEmphasis'],
  '*': ['Emphasis'],
  '`': ['InlineCode'],
  '~~': ['Strikethrough'],
  '$': ['InlineMath'],
}

/**
 * Walk ancestors of the node at `pos` looking for one whose name
 * matches any of `nodeNames`. Returns the matching node or null.
 */
function findEnclosingMark(state, pos, nodeNames) {
  const tree = syntaxTree(state)
  let node = tree.resolveInner(pos, -1)
  while (node) {
    if (nodeNames.includes(node.name)) return node
    node = node.parent
  }
  // Also try resolving to the right (handles cursor at start of node)
  node = tree.resolveInner(pos, 1)
  while (node) {
    if (nodeNames.includes(node.name)) return node
    node = node.parent
  }
  return null
}

/**
 * Remove the opening and closing markers from a syntax tree node,
 * preserving cursor/selection inside the unwrapped content.
 */
function unwrapMark(view, node, markerLen) {
  const contentFrom = node.from + markerLen
  const contentTo = node.to - markerLen

  const { from, to } = view.state.selection.main
  // Clamp selection to content range, then adjust for removed opening marker
  const newFrom = Math.max(contentFrom, Math.min(from, contentTo)) - markerLen
  const newTo = Math.max(contentFrom, Math.min(to, contentTo)) - markerLen

  view.dispatch({
    changes: [
      { from: node.from, to: contentFrom, insert: '' },
      { from: contentTo, to: node.to, insert: '' },
    ],
    selection: { anchor: newFrom, head: newTo },
  })
}

function wrapSelection(view, before, after) {
  const { state } = view
  const { from, to } = state.selection.main
  const selected = state.sliceDoc(from, to)
  const markerLen = before.length
  const nodeNames = MARKER_NODE_MAP[before]

  // -- Syntax-tree-based detection --
  if (nodeNames) {
    if (from === to) {
      // No selection: check if cursor is inside a formatted node
      const enclosing = findEnclosingMark(state, from, nodeNames)
      if (enclosing) {
        unwrapMark(view, enclosing, markerLen)
        return true
      }
    } else {
      // Selection: check if both endpoints are inside the SAME formatted node
      const encFrom = findEnclosingMark(state, from, nodeNames)
      const encTo = findEnclosingMark(state, to, nodeNames)
      if (encFrom && encTo && encFrom.from === encTo.from && encFrom.to === encTo.to) {
        unwrapMark(view, encFrom, markerLen)
        return true
      }
    }
  }

  // -- No-selection: insert markers and place cursor between them --
  if (from === to) {
    view.dispatch({
      changes: { from, to, insert: before + after },
      selection: { anchor: from + before.length, head: from + before.length },
    })
    return true
  }

  // -- String-boundary check: exact selection matches markers --
  const preFrom = from - before.length
  const postTo = to + after.length
  if (
    preFrom >= 0 &&
    postTo <= state.doc.length &&
    state.sliceDoc(preFrom, from) === before &&
    state.sliceDoc(to, postTo) === after
  ) {
    // Unwrap (toggle off)
    view.dispatch({
      changes: [
        { from: preFrom, to: from, insert: '' },
        { from: to, to: postTo, insert: '' },
      ],
      selection: { anchor: preFrom, head: preFrom + selected.length },
    })
    return true
  }

  // -- Wrap --
  view.dispatch({
    changes: [
      { from, insert: before },
      { from: to, insert: after },
    ],
    selection: { anchor: from + before.length, head: from + before.length + selected.length },
  })
  return true
}

function prefixLine(view, prefix) {
  const { state } = view
  const { from, to } = state.selection.main

  const startLine = state.doc.lineAt(from)
  const endLine = state.doc.lineAt(to)

  const changes = []
  let selFrom = from
  let selTo = to

  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = state.doc.line(i)
    const text = line.text

    if (text.startsWith(prefix)) {
      // Remove prefix (toggle off)
      changes.push({ from: line.from, to: line.from + prefix.length, insert: '' })
      if (i === startLine.number) selFrom = Math.max(line.from, from - prefix.length)
      selTo -= prefix.length
    } else {
      // For headings, check if line starts with any heading prefix and replace
      const headingMatch = /^(#{1,6})\s/.exec(text)
      const prefixHeadingMatch = /^(#{1,6})\s/.exec(prefix)

      if (headingMatch && prefixHeadingMatch) {
        // Replace existing heading prefix with the new one
        const oldPrefix = headingMatch[0]
        changes.push({ from: line.from, to: line.from + oldPrefix.length, insert: prefix })
        const delta = prefix.length - oldPrefix.length
        if (i === startLine.number) selFrom = from + delta
        selTo += delta
      } else {
        // Add prefix
        changes.push({ from: line.from, to: line.from, insert: prefix })
        if (i === startLine.number) selFrom = from + prefix.length
        selTo += prefix.length
      }
    }
  }

  if (changes.length) {
    view.dispatch({
      changes,
      selection: { anchor: selFrom, head: selTo },
    })
  }
  return true
}

function insertAtCursor(view, text, cursorOffset) {
  const { from } = view.state.selection.main
  const offset = cursorOffset != null ? cursorOffset : text.length
  view.dispatch({
    changes: { from, to: from, insert: text },
    selection: { anchor: from + offset, head: from + offset },
  })
  return true
}

// -- Format detection --

export function detectActiveFormats(state) {
  const pos = state.selection.main.head
  const tree = syntaxTree(state)
  const formats = []

  // Walk ancestors for inline formats
  let node = tree.resolveInner(pos, -1)
  while (node) {
    if (node.name === 'StrongEmphasis') formats.push('bold')
    else if (node.name === 'Emphasis') formats.push('italic')
    else if (node.name === 'InlineCode') formats.push('code')
    else if (node.name === 'Strikethrough') formats.push('strikethrough')
    node = node.parent
  }

  // Check line-level formats
  const line = state.doc.lineAt(pos)
  const lineText = line.text
  if (/^#\s/.test(lineText)) formats.push('heading-1')
  else if (/^##\s/.test(lineText)) formats.push('heading-2')
  else if (/^###\s/.test(lineText)) formats.push('heading-3')
  if (/^[-*]\s/.test(lineText) || /^[-*]\s\[.\]\s/.test(lineText)) formats.push('bullet-list')
  if (/^\d+\.\s/.test(lineText)) formats.push('numbered-list')
  if (/^>\s/.test(lineText)) formats.push('blockquote')
  if (/^- \[.\] /.test(lineText)) formats.push('checkbox')

  return formats
}

// -- Public API --

export function toggleBold(view) {
  return wrapSelection(view, '**', '**')
}

export function toggleItalic(view) {
  return wrapSelection(view, '*', '*')
}

export function toggleCode(view) {
  return wrapSelection(view, '`', '`')
}

export function toggleStrikethrough(view) {
  return wrapSelection(view, '~~', '~~')
}

export function toggleHeading(view, level) {
  return prefixLine(view, '#'.repeat(level) + ' ')
}

export function toggleBulletList(view) {
  return prefixLine(view, '- ')
}

export function toggleNumberedList(view) {
  return prefixLine(view, '1. ')
}

export function toggleCheckbox(view) {
  return prefixLine(view, '- [ ] ')
}

export function toggleBlockquote(view) {
  return prefixLine(view, '> ')
}

export function insertLink(view) {
  return wrapSelection(view, '[', '](url)')
}

export function insertImage(view) {
  // Select "alt" placeholder so typing replaces it: ![<alt>](url)
  const { from } = view.state.selection.main
  const text = '![alt](url)'
  view.dispatch({
    changes: { from, to: from, insert: text },
    selection: { anchor: from + 2, head: from + 5 },
  })
  return true
}

export function insertCitation(view) {
  // Place cursor between [@ and ]
  return insertAtCursor(view, '[@]', 2)
}

export function insertHorizontalRule(view) {
  return insertAtCursor(view, '\n---\n')
}
