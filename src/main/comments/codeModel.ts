import {
  generateCommentId,
  normalizeMinuteTimestamp,
  sanitizeAuthorHandle,
  type CommentThread,
  type Note,
} from '@main/comments/model.js'

/**
 * Line-marker review comments for code and plain-text files.
 *
 * A marker is a whole line in the file's own comment syntax:
 *
 *     # @mim(k3f9) paul 2026-06-13T09:14: This bound looks wrong
 *     # @mim(k3f9) ai 2026-06-13T09:20: Fixed by clamping below
 *     def clamp(x):
 *
 * Consecutive marker lines with the same id form one thread (first line is
 * the comment, later lines are replies). The thread anchors to the next
 * non-marker line. Threads reuse the markdown CommentThread shape so the
 * review rail, tools, and chat handoff work unchanged: [tagFrom, tagTo) is
 * the marker block including its trailing newline, and [anchorFrom, anchorTo)
 * is the anchored line (which sits after the block, not inside it).
 */

export interface CodeCommentPrefix {
  open: string
  close: string
}

export interface AddCodeCommentInput {
  anchorText: string
  text: string
  by?: string
  at?: string
  now?: Date
  generateId?: (existingIds: Set<string>) => string
  prefix: CodeCommentPrefix
}

export interface AddCodeCommentAtOffsetInput {
  offset: number
  text: string
  by?: string
  at?: string
  now?: Date
  generateId?: (existingIds: Set<string>) => string
  prefix: CodeCommentPrefix
}

export interface CodeReplyInput {
  id: string
  text: string
  by?: string
  at?: string
  now?: Date
}

const MARKER_PATTERN = /^(\s*)((?:#+|\/\/+|--|;+|%+|<!--|\/\*|\*)\s*)?@mim\(([0-9a-z]{4,6})\)\s+(\S+)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):\s?(.*)$/

interface LineInfo {
  text: string
  from: number
  to: number
  nextFrom: number
}

interface MarkerMatch {
  indent: string
  open: string
  close: string
  id: string
  by: string
  at: string
  text: string
}

export function parseCodeComments(raw: string): CommentThread[] {
  const lines = splitLines(raw)
  const threads: CommentThread[] = []
  let index = 0

  while (index < lines.length) {
    if (!matchMarkerLine(lines[index].text)) {
      index++
      continue
    }

    const block: Array<{ line: LineInfo; marker: MarkerMatch }> = []
    let end = index
    while (end < lines.length) {
      const marker = matchMarkerLine(lines[end].text)
      if (!marker) break
      block.push({ line: lines[end], marker })
      end++
    }

    const anchorLine = end < lines.length ? lines[end] : null
    const anchorFrom = anchorLine ? anchorLine.from : raw.length
    const anchorTo = anchorLine ? anchorLine.to : raw.length
    const anchor = anchorLine ? anchorLine.text : ''

    let cursor = 0
    while (cursor < block.length) {
      const id = block[cursor].marker.id
      const runStart = cursor
      while (cursor < block.length && block[cursor].marker.id === id) cursor++
      threads.push({
        id,
        anchor,
        notes: block.slice(runStart, cursor).map(item => noteFromMarker(item.marker)),
        tagFrom: block[runStart].line.from,
        tagTo: block[cursor - 1].line.nextFrom,
        anchorFrom,
        anchorTo,
      })
    }
    index = end
  }

  return threads
}

export function findCodeCommentById(raw: string, id: string): CommentThread | null {
  return parseCodeComments(raw).find(thread => thread.id === id) ?? null
}

export function addCodeComment(raw: string, input: AddCodeCommentInput): { text: string; thread: CommentThread } {
  if (!input.anchorText || !input.anchorText.length) throw new Error('anchor_text must not be empty')

  const lines = splitLines(raw)
  const matches = anchorOccurrences(raw, lines, input.anchorText)
  if (matches.length === 0) throw new Error('anchor_text was not found in the document')
  if (matches.length > 1) {
    throw new Error(`anchor_text matches ${matches.length} locations in the visible document. Provide a longer unique passage.`)
  }

  return insertMarkerAboveLine(raw, lineAt(lines, matches[0]), input)
}

export function addCodeCommentAtOffset(raw: string, input: AddCodeCommentAtOffsetInput): { text: string; thread: CommentThread } {
  const offset = Math.max(0, Math.min(input.offset, raw.length))
  const lines = splitLines(raw)
  const line = lineAt(lines, offset)
  if (matchMarkerLine(line.text)) throw new Error('Cannot anchor a comment to a comment marker line')
  return insertMarkerAboveLine(raw, line, { ...input, anchorText: line.text })
}

export function appendCodeCommentReply(raw: string, input: CodeReplyInput): { text: string; thread: CommentThread } {
  const thread = findCodeCommentById(raw, input.id)
  if (!thread) throw new Error(`Comment not found: ${input.id}`)

  const firstLineText = raw.slice(thread.tagFrom, thread.tagTo).split('\n')[0]
  const style = matchMarkerLine(firstLineText)
  if (!style) throw new Error(`Comment not found: ${input.id}`)

  const replyLine = serializeMarkerLine({
    indent: style.indent,
    prefix: { open: style.open, close: style.close },
    id: thread.id,
    by: sanitizeAuthorHandle(input.by),
    at: normalizeMinuteTimestamp(input.at, input.now),
    text: input.text ?? '',
  })

  const insertAt = thread.tagTo
  const needsLeadingNewline = insertAt === raw.length && raw.length > 0 && !raw.endsWith('\n')
  const text = needsLeadingNewline
    ? raw.slice(0, insertAt) + '\n' + replyLine
    : raw.slice(0, insertAt) + replyLine + '\n' + raw.slice(insertAt)

  const nextThread = findCodeCommentById(text, input.id)
  if (!nextThread) throw new Error(`Failed to reply to comment ${input.id}`)
  return { text, thread: nextThread }
}

export function editCodeCommentNote(raw: string, id: string, noteIndex: number, text: string): { text: string; thread: CommentThread } {
  const line = noteLine(raw, id, noteIndex)
  const marker = matchMarkerLine(line.text)
  if (!marker) throw new Error('Note not found')
  const replacement = serializeMarkerLine({
    indent: marker.indent,
    prefix: { open: marker.open, close: marker.close },
    id,
    by: marker.by,
    at: marker.at,
    text,
  })
  const nextRaw = raw.slice(0, line.from) + replacement + raw.slice(line.to)
  const thread = findCodeCommentById(nextRaw, id)
  if (!thread) throw new Error(`Failed to edit comment ${id}`)
  return { text: nextRaw, thread }
}

export function deleteCodeCommentNote(raw: string, id: string, noteIndex: number): { text: string; thread: CommentThread } {
  if (noteIndex < 1) throw new Error('Note not found')
  const line = noteLine(raw, id, noteIndex)
  const nextRaw = raw.slice(0, line.from) + raw.slice(line.nextFrom)
  const thread = findCodeCommentById(nextRaw, id)
  if (!thread) throw new Error(`Failed to delete note on comment ${id}`)
  return { text: nextRaw, thread }
}

export function resolveCodeComment(raw: string, id: string): { text: string; anchor: string } {
  const thread = findCodeCommentById(raw, id)
  if (!thread) throw new Error(`Comment not found: ${id}`)
  return {
    text: trimDanglingNewline(raw.slice(0, thread.tagFrom) + raw.slice(thread.tagTo), thread.tagFrom),
    anchor: thread.anchor,
  }
}

export function resolveAllCodeComments(raw: string): { text: string; count: number } {
  const threads = parseCodeComments(raw)
  if (!threads.length) return { text: raw, count: 0 }
  let result = raw
  for (const thread of [...threads].reverse()) {
    result = resolveCodeComment(result, thread.id).text
  }
  return { text: result, count: threads.length }
}

const HASH_EXTENSIONS = new Set(['py', 'rb', 'sh', 'bash', 'zsh', 'fish', 'yaml', 'yml', 'toml', 'r', 'jl', 'pl', 'pm', 'ex', 'exs', 'nim', 'tcl', 'ps1', 'cmake', 'mk', 'conf'])
const SLASH_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'java', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'cs', 'go', 'rs', 'swift', 'kt', 'kts', 'scala', 'php', 'dart', 'proto', 'zig', 'groovy'])
const HTML_EXTENSIONS = new Set(['html', 'htm', 'xml', 'svg', 'vue'])
const BLOCK_EXTENSIONS = new Set(['css', 'scss', 'less'])
const DASH_EXTENSIONS = new Set(['sql', 'lua', 'hs', 'elm'])
const BARE_EXTENSIONS = new Set(['txt', 'log', 'text'])
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx'])
const HASH_BASENAMES = new Set(['makefile', 'dockerfile', 'justfile', 'gitignore', 'gitattributes', 'editorconfig', 'env'])

/** Comment syntax for a path, or null when line comments would corrupt the
 *  format (JSON, CSV, unknown extensions) or the markdown model owns it. */
export function commentPrefixForPath(path: string): CodeCommentPrefix | null {
  const basename = (path.split('/').pop() || '').toLowerCase()
  const dot = basename.lastIndexOf('.')
  const ext = dot >= 0 ? basename.slice(dot + 1) : ''
  const stem = dot > 0 ? basename : basename.replace(/^\./, '')

  if (MARKDOWN_EXTENSIONS.has(ext)) return null
  if (HASH_EXTENSIONS.has(ext)) return { open: '# ', close: '' }
  if (SLASH_EXTENSIONS.has(ext)) return { open: '// ', close: '' }
  if (HTML_EXTENSIONS.has(ext)) return { open: '<!-- ', close: ' -->' }
  if (BLOCK_EXTENSIONS.has(ext)) return { open: '/* ', close: ' */' }
  if (DASH_EXTENSIONS.has(ext)) return { open: '-- ', close: '' }
  if (ext === 'tex') return { open: '% ', close: '' }
  if (BARE_EXTENSIONS.has(ext)) return { open: '', close: '' }
  if (!ext && HASH_BASENAMES.has(stem)) return { open: '# ', close: '' }
  return null
}

export function supportsCodeCommentPath(path: string): boolean {
  return commentPrefixForPath(path) !== null
}

function insertMarkerAboveLine(
  raw: string,
  line: LineInfo,
  input: { text: string; by?: string; at?: string; now?: Date; generateId?: (existingIds: Set<string>) => string; prefix: CodeCommentPrefix },
): { text: string; thread: CommentThread } {
  const indent = /^\s*/.exec(line.text)?.[0] ?? ''
  const existingIds = new Set(parseCodeComments(raw).map(thread => thread.id))
  const id = newUniqueId(existingIds, input.generateId)
  const markerLine = serializeMarkerLine({
    indent,
    prefix: input.prefix,
    id,
    by: sanitizeAuthorHandle(input.by),
    at: normalizeMinuteTimestamp(input.at, input.now),
    text: input.text ?? '',
  })
  const text = raw.slice(0, line.from) + markerLine + '\n' + raw.slice(line.from)
  const thread = findCodeCommentById(text, id)
  if (!thread) throw new Error(`Failed to add comment ${id}`)
  return { text, thread }
}

function serializeMarkerLine(input: { indent: string; prefix: CodeCommentPrefix; id: string; by: string; at: string; text: string }): string {
  const text = sanitizeMarkerText(input.text)
  return `${input.indent}${input.prefix.open}@mim(${input.id}) ${input.by} ${input.at}:${text ? ` ${text}` : ''}${input.prefix.close}`
}

function sanitizeMarkerText(text: string): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/-->/g, '-- >')
    .replace(/\*\//g, '* /')
    .trim()
}

function matchMarkerLine(text: string): MarkerMatch | null {
  const match = MARKER_PATTERN.exec(text)
  if (!match) return null
  const open = match[2] ?? ''
  let body = match[6] ?? ''
  let close = ''
  const closer = /\s*(-->|\*\/)\s*$/.exec(body)
  if (closer) {
    close = ` ${closer[1]}`
    body = body.slice(0, closer.index)
  }
  return {
    indent: match[1] ?? '',
    open,
    close,
    id: match[3],
    by: match[4],
    at: match[5],
    text: body.trim(),
  }
}

function noteFromMarker(marker: MarkerMatch): Note {
  return { by: marker.by, at: marker.at, text: marker.text }
}

function noteLine(raw: string, id: string, noteIndex: number): LineInfo {
  const thread = findCodeCommentById(raw, id)
  if (!thread) throw new Error(`Comment not found: ${id}`)
  if (noteIndex < 0 || noteIndex >= thread.notes.length) throw new Error('Note not found')
  const lines = splitLines(raw).filter(line => line.from >= thread.tagFrom && line.from < thread.tagTo)
  const line = lines[noteIndex]
  if (!line) throw new Error('Note not found')
  return line
}

// Removing a trailing marker block can leave the previous line's newline as a
// dangling final newline where there was none; keep the original ending shape.
function trimDanglingNewline(text: string, cutAt: number): string {
  if (cutAt >= text.length && text.endsWith('\n') && cutAt > 0) return text.slice(0, -1)
  return text
}

function splitLines(raw: string): LineInfo[] {
  const lines: LineInfo[] = []
  let from = 0
  while (from <= raw.length) {
    const newline = raw.indexOf('\n', from)
    const to = newline < 0 ? raw.length : newline
    lines.push({ text: raw.slice(from, to), from, to, nextFrom: newline < 0 ? raw.length : newline + 1 })
    if (newline < 0) break
    from = newline + 1
  }
  return lines
}

function lineAt(lines: LineInfo[], offset: number): LineInfo {
  for (const line of lines) {
    if (offset >= line.from && offset < line.nextFrom) return line
  }
  return lines[lines.length - 1]
}

function anchorOccurrences(raw: string, lines: LineInfo[], anchorText: string): number[] {
  const markerRanges = lines
    .filter(line => matchMarkerLine(line.text))
    .map(line => ({ from: line.from, to: line.nextFrom }))
  const positions: number[] = []
  let cursor = 0
  while (cursor <= raw.length) {
    const found = raw.indexOf(anchorText, cursor)
    if (found < 0) break
    if (!markerRanges.some(range => found >= range.from && found < range.to)) positions.push(found)
    cursor = found + 1
  }
  return positions
}

function newUniqueId(existingIds: Set<string>, generateId?: (existingIds: Set<string>) => string): string {
  if (!generateId) return generateCommentId(existingIds)
  for (let attempt = 0; attempt < 200; attempt++) {
    const candidate = generateId(existingIds)
    if (typeof candidate === 'string' && /^[0-9a-z]{4,6}$/.test(candidate) && !existingIds.has(candidate)) {
      return candidate
    }
  }
  return generateCommentId(existingIds)
}
