// @ts-check
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { escapeForRString } from '../../../services/renderDocument.js'

/**
 * Given an EditorState, compute what text to send to the terminal and where
 * to place the cursor afterward.
 *
 * @param {EditorState} state
 * @returns {{ text: string; nextPos: number } | null}
 */
export function computeSendSelection(state) {
  const sel = state.selection.main

  // Non-empty selection: return the selected text
  if (!sel.empty) {
    return {
      text: state.doc.sliceString(sel.from, sel.to),
      nextPos: sel.to,
    }
  }

  // Empty selection (cursor): work with the current line
  const line = state.doc.lineAt(sel.head)
  const lineText = line.text

  // Blank line: return null
  if (lineText.trim() === '') {
    return null
  }

  // Find next line with non-whitespace content
  let nextPos = state.doc.length
  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const nextLine = state.doc.line(i)
    if (nextLine.text.trim() !== '') {
      nextPos = nextLine.from
      break
    }
  }

  return { text: lineText, nextPos }
}

/**
 * Determine the language from a file path extension.
 *
 * @param {string} path
 * @returns {string | null}
 */
export function languageFromPath(path) {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return null

  const ext = path.slice(dot + 1).toLowerCase()
  if (ext === 'r') return 'r'
  if (ext === 'py') return 'python'
  return null
}

/**
 * Parse the language hint from a fenced code info string.
 * Handles knitr/Quarto format: `{r, echo=FALSE}` -> 'r', `{python}` -> 'python'
 * Also handles plain: `r` -> 'r'
 *
 * @param {string} info
 * @returns {string | null}
 */
function parseChunkLanguage(info) {
  if (!info) return null
  let token = info.trim()
  if (token.startsWith('```')) token = token.slice(3).trim()
  if (token.startsWith('{') && token.endsWith('}')) token = token.slice(1, -1).trim()
  else if (token.startsWith('{')) token = token.slice(1).trim()
  token = token.split(/[\s,]/, 1)[0] || ''
  if (!token) return null
  return token.toLowerCase()
}

/**
 * Find the FencedCode node containing the cursor position by walking the
 * syntax tree. Returns the node or null if cursor is not inside a fenced block.
 *
 * @param {EditorState} state
 * @returns {{ node: any; infoLine: string; bodyFrom: number; bodyTo: number; language: string | null } | null}
 */
function findContainingChunk(state) {
  const tree = syntaxTree(state)
  const pos = state.selection.main.head
  let fencedCode = null

  tree.iterate({
    enter(node) {
      if (node.name === 'FencedCode' && node.from <= pos && node.to >= pos) {
        fencedCode = node.node
        return false
      }
    },
  })

  if (!fencedCode) return null

  // Parse the chunk structure: first line is the opening fence (```{r, ...})
  // last line might be closing fence (```)
  const from = fencedCode.from
  const to = fencedCode.to

  // Get the first line (info/fence line)
  const firstLine = state.doc.lineAt(from)
  const infoLine = firstLine.text

  // Check if info string starts with a recognized chunk language
  const language = parseChunkLanguage(infoLine)
  if (!language) return null
  // Only support r and python chunks
  if (language !== 'r' && language !== 'python') return null

  // Body starts after the info line
  const bodyFrom = firstLine.to + 1

  // Check for closing fence
  const lastLine = state.doc.lineAt(to)
  const hasClosingFence = lastLine.text.trim().startsWith('```')
  if (!hasClosingFence) return null // Unterminated chunk: do nothing

  // Body ends before the closing fence line
  const bodyTo = lastLine.from > bodyFrom ? lastLine.from - 1 : bodyFrom

  // Empty chunk body
  if (bodyFrom > bodyTo) return null

  return { node: fencedCode, infoLine, bodyFrom, bodyTo, language }
}

/**
 * Compute what to send from a markdown chunk context.
 *
 * @param {EditorState} state
 * @param {'line' | 'chunk'} mode - 'line' for Mod-Enter (current line/selection), 'chunk' for Mod-Shift-Enter (whole chunk)
 * @returns {{ text: string; language: string; nextPos: number } | null}
 */
export function computeChunkSend(state, mode) {
  const chunk = findContainingChunk(state)
  if (!chunk) return null

  const pos = state.selection.main.head

  // Cursor must be within chunk body or on the fence lines
  // (on fence line itself we allow it to trigger - sends chunk body for whole-chunk mode,
  //  or does nothing for line mode if on fence)

  if (mode === 'chunk') {
    // Send the entire chunk body
    const text = state.doc.sliceString(chunk.bodyFrom, chunk.bodyTo)
    if (!text.trim()) return null
    // Position after the closing fence
    const closingLine = state.doc.lineAt(chunk.bodyTo + 1)
    const nextPos = closingLine.number < state.doc.lines
      ? state.doc.line(closingLine.number + 1).from
      : state.doc.length
    return { text, language: chunk.language, nextPos }
  }

  // Line mode: send current line / selection if inside chunk body
  if (pos < chunk.bodyFrom || pos > chunk.bodyTo) return null

  const sel = state.selection.main
  if (!sel.empty) {
    return {
      text: state.doc.sliceString(sel.from, sel.to),
      language: chunk.language,
      nextPos: sel.to,
    }
  }

  const line = state.doc.lineAt(pos)
  if (line.text.trim() === '') return null

  // Find next non-blank line within or after chunk
  let nextPos = chunk.bodyTo
  for (let i = line.number + 1; i <= state.doc.lines; i++) {
    const nextLine = state.doc.line(i)
    if (nextLine.from > chunk.bodyTo) {
      nextPos = chunk.bodyTo
      break
    }
    if (nextLine.text.trim() !== '') {
      nextPos = nextLine.from
      break
    }
  }

  return { text: line.text, language: chunk.language, nextPos }
}

/**
 * Compute the source/run-file command for a given language.
 * For R: `source('<escaped path>', echo = TRUE)`
 * For other languages: null (caller sends the whole buffer instead).
 *
 * @param {string} path - workspace-relative file path
 * @param {string | null} language
 * @returns {string | null}
 */
export function computeSourceCommand(path, language) {
  if (language === 'r') {
    return `source('${escapeForRString(path)}', echo = TRUE)`
  }
  return null
}
