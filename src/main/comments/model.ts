export interface Note {
  by: string
  at: string
  text: string
}

export interface CommentThread {
  id: string
  anchor: string
  notes: Note[]
  tagFrom: number
  tagTo: number
  anchorFrom: number
  anchorTo: number
}

export interface StrippedCommentDocument {
  text: string
  /** map[strippedOffset] = raw offset for the visible char at strippedOffset. The final entry is raw.length. */
  map: number[]
  threads: CommentThread[]
}

export interface AddCommentInput {
  anchorText: string
  text: string
  by?: string
  at?: string
  now?: Date
  generateId?: (existingIds: Set<string>) => string
}

export interface ReplyInput {
  id: string
  text: string
  by?: string
  at?: string
  now?: Date
}

export interface AddCommentAtRawRangeInput {
  from: number
  to: number
  text: string
  by?: string
  at?: string
  now?: Date
  generateId?: (existingIds: Set<string>) => string
}

const COMMENT_CLOSE = '</comment>'
const NOTE_CLOSE = '</note>'
const COMMENT_OPEN = '<comment'
const NOTE_OPEN = '<note'

interface ParsedTag {
  end: number
  attrs: Record<string, string>
}

export function parseComments(raw: string): CommentThread[] {
  const threads: CommentThread[] = []
  let cursor = 0

  while (cursor < raw.length) {
    const tagFrom = findTagStart(raw, COMMENT_OPEN, cursor)
    if (tagFrom < 0) break

    const parsed = parseCommentAt(raw, tagFrom)
    if (!parsed) {
      cursor = tagFrom + COMMENT_OPEN.length
      continue
    }

    threads.push(parsed)
    cursor = parsed.tagTo
  }

  return threads
}

export function stripComments(raw: string): StrippedCommentDocument {
  const threads = parseComments(raw)
  const chars: string[] = []
  const map: number[] = []
  let cursor = 0

  for (const thread of threads) {
    appendRawRange(raw, cursor, thread.tagFrom, chars, map)
    appendRawRange(raw, thread.anchorFrom, thread.anchorTo, chars, map)
    cursor = thread.tagTo
  }
  appendRawRange(raw, cursor, raw.length, chars, map)
  map.push(raw.length)

  return { text: chars.join(''), map, threads }
}

export function strippedRangeToRawRange(
  stripped: StrippedCommentDocument,
  from: number,
  to: number,
): { from: number; to: number } {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > stripped.text.length) {
    throw new Error('Invalid stripped range')
  }
  if (from === to) {
    const raw = stripped.map[from] ?? stripped.map[stripped.map.length - 1] ?? 0
    return { from: raw, to: raw }
  }

  return {
    from: stripped.map[from],
    to: stripped.map[to - 1] + 1,
  }
}

export function addComment(raw: string, input: AddCommentInput): { text: string; thread: CommentThread } {
  const anchorText = input.anchorText
  if (!anchorText || !anchorText.length) throw new Error('anchor_text must not be empty')

  const stripped = stripComments(raw)
  const visibleMatches = allOccurrences(stripped.text, anchorText)
  let rawRange: { from: number; to: number } | null = null

  if (visibleMatches.length > 1) {
    throw new Error(`anchor_text matches ${visibleMatches.length} locations in the visible document. Provide a longer unique passage.`)
  }

  if (visibleMatches.length === 1) {
    rawRange = strippedRangeToRawRange(stripped, visibleMatches[0], visibleMatches[0] + anchorText.length)
  } else {
    const rawMatches = allOccurrences(raw, anchorText)
    if (rawMatches.length === 0) {
      throw new Error('anchor_text was not found in the document')
    }
    if (rawMatches.length > 1) {
      throw new Error(`anchor_text matches ${rawMatches.length} locations in the raw document. Provide a longer unique passage.`)
    }
    rawRange = { from: rawMatches[0], to: rawMatches[0] + anchorText.length }
  }

  assertDoesNotIntersectExistingComment(stripped.threads, rawRange.from, rawRange.to)

  const id = newUniqueId(new Set(stripped.threads.map(thread => thread.id)), input.generateId)
  const note: Note = {
    by: sanitizeAuthorHandle(input.by),
    at: normalizeMinuteTimestamp(input.at, input.now),
    text: input.text ?? '',
  }
  const anchor = raw.slice(rawRange.from, rawRange.to)
  const wrapper = serializeComment(id, anchor, [note])
  const text = raw.slice(0, rawRange.from) + wrapper + raw.slice(rawRange.to)
  const thread = findCommentById(text, id)
  if (!thread) throw new Error(`Failed to add comment ${id}`)
  return { text, thread }
}

export function addCommentAtRawRange(raw: string, input: AddCommentAtRawRangeInput): { text: string; thread: CommentThread } {
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from < 0 || input.to <= input.from || input.to > raw.length) {
    throw new Error('Invalid comment range')
  }

  const threads = parseComments(raw)
  assertDoesNotIntersectExistingComment(threads, input.from, input.to)

  const id = newUniqueId(new Set(threads.map(thread => thread.id)), input.generateId)
  const note: Note = {
    by: sanitizeAuthorHandle(input.by),
    at: normalizeMinuteTimestamp(input.at, input.now),
    text: input.text ?? '',
  }
  const anchor = raw.slice(input.from, input.to)
  const wrapper = serializeComment(id, anchor, [note])
  const text = raw.slice(0, input.from) + wrapper + raw.slice(input.to)
  const thread = findCommentById(text, id)
  if (!thread) throw new Error(`Failed to add comment ${id}`)
  return { text, thread }
}

export function appendCommentReply(raw: string, input: ReplyInput): { text: string; thread: CommentThread } {
  const thread = findCommentById(raw, input.id)
  if (!thread) throw new Error(`Comment not found: ${input.id}`)

  const note = serializeNote({
    by: sanitizeAuthorHandle(input.by),
    at: normalizeMinuteTimestamp(input.at, input.now),
    text: input.text ?? '',
  })
  const closeFrom = thread.tagTo - COMMENT_CLOSE.length
  const text = raw.slice(0, closeFrom) + note + raw.slice(closeFrom)
  const nextThread = findCommentById(text, input.id)
  if (!nextThread) throw new Error(`Failed to reply to comment ${input.id}`)
  return { text, thread: nextThread }
}

export function resolveComment(raw: string, id: string): { text: string; anchor: string } {
  const thread = findCommentById(raw, id)
  if (!thread) throw new Error(`Comment not found: ${id}`)

  return {
    text: raw.slice(0, thread.tagFrom) + thread.anchor + raw.slice(thread.tagTo),
    anchor: thread.anchor,
  }
}

export function findCommentById(raw: string, id: string): CommentThread | null {
  return parseComments(raw).find(thread => thread.id === id) ?? null
}

export function serializeComment(id: string, anchor: string, notes: Note[]): string {
  return `<comment id="${escapeAttribute(id)}">${anchor}${notes.map(serializeNote).join('')}</comment>`
}

export function serializeNote(note: Note): string {
  return `<note by="${escapeAttribute(sanitizeAuthorHandle(note.by))}" at="${escapeAttribute(note.at)}">${escapeNoteText(note.text)}</note>`
}

export function escapeNoteText(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
}

export function unescapeNoteText(text: string): string {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export function sanitizeAuthorHandle(value: unknown): string {
  const input = typeof value === 'string' ? value.trim() : ''
  const sanitized = input
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .slice(0, 32)
  return sanitized || 'user'
}

export function normalizeMinuteTimestamp(value?: string, now: Date = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value
  return now.toISOString().slice(0, 16)
}

export function generateCommentId(existingIds: Set<string>, rand: () => number = Math.random): string {
  for (let length = 4; length <= 6; length++) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const space = 36 ** length
      const id = Math.floor(rand() * space).toString(36).padStart(length, '0').slice(0, length)
      if (!existingIds.has(id)) return id
    }
  }
  throw new Error('Could not generate a unique comment id')
}

export function lineNumberAt(text: string, offset: number): number {
  const end = Math.max(0, Math.min(offset, text.length))
  let line = 1
  for (let index = 0; index < end; index++) {
    if (text.charCodeAt(index) === 10) line++
  }
  return line
}

function parseCommentAt(raw: string, tagFrom: number): CommentThread | null {
  const open = parseOpeningTag(raw, tagFrom, 'comment')
  if (!open) return null

  const id = open.attrs.id
  if (!id) return null

  const closeFrom = raw.indexOf(COMMENT_CLOSE, open.end)
  if (closeFrom < 0) return null

  const nested = findTagStart(raw, COMMENT_OPEN, open.end)
  if (nested >= 0 && nested < closeFrom) return null

  const inner = raw.slice(open.end, closeFrom)
  const firstNote = findTagStart(inner, NOTE_OPEN, 0)
  if (firstNote < 0 || firstNote === 0) return null

  const notes = parseNotes(inner, firstNote)
  if (!notes) return null

  const tagTo = closeFrom + COMMENT_CLOSE.length
  return {
    id: unescapeAttribute(id),
    anchor: raw.slice(open.end, open.end + firstNote),
    notes,
    tagFrom,
    tagTo,
    anchorFrom: open.end,
    anchorTo: open.end + firstNote,
  }
}

function parseNotes(inner: string, firstNote: number): Note[] | null {
  const notes: Note[] = []
  let cursor = firstNote

  while (cursor < inner.length) {
    while (cursor < inner.length && /\s/.test(inner[cursor])) cursor++
    if (cursor >= inner.length) break

    const open = parseOpeningTag(inner, cursor, 'note')
    if (!open) return null
    if (!open.attrs.by || !open.attrs.at) return null

    const closeFrom = inner.indexOf(NOTE_CLOSE, open.end)
    if (closeFrom < 0) return null

    notes.push({
      by: unescapeAttribute(open.attrs.by),
      at: unescapeAttribute(open.attrs.at),
      text: unescapeNoteText(inner.slice(open.end, closeFrom)),
    })
    cursor = closeFrom + NOTE_CLOSE.length
  }

  return notes.length > 0 ? notes : null
}

function parseOpeningTag(raw: string, at: number, name: 'comment' | 'note'): ParsedTag | null {
  const prefix = `<${name}`
  if (!raw.startsWith(prefix, at)) return null
  const next = raw[at + prefix.length]
  if (next !== '>' && next !== undefined && !/\s/.test(next)) return null
  const end = raw.indexOf('>', at + prefix.length)
  if (end < 0) return null
  const body = raw.slice(at + prefix.length, end)
  return { end: end + 1, attrs: parseAttributes(body) }
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrPattern = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = attrPattern.exec(source)) !== null) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

function appendRawRange(raw: string, from: number, to: number, chars: string[], map: number[]): void {
  for (let index = from; index < to; index++) {
    chars.push(raw[index])
    map.push(index)
  }
}

function findTagStart(text: string, needle: string, from: number): number {
  let cursor = from
  while (cursor < text.length) {
    const found = text.indexOf(needle, cursor)
    if (found < 0) return -1
    const next = text[found + needle.length]
    if (next === '>' || next === undefined || /\s/.test(next)) return found
    cursor = found + needle.length
  }
  return -1
}

function allOccurrences(haystack: string, needle: string): number[] {
  const positions: number[] = []
  let cursor = 0
  while (cursor <= haystack.length) {
    const found = haystack.indexOf(needle, cursor)
    if (found < 0) break
    positions.push(found)
    cursor = found + 1
  }
  return positions
}

function assertDoesNotIntersectExistingComment(threads: CommentThread[], from: number, to: number): void {
  for (const thread of threads) {
    if (from < thread.tagTo && to > thread.tagFrom) {
      throw new Error(`Anchor intersects existing comment ${thread.id}`)
    }
  }
}

function newUniqueId(existingIds: Set<string>, generateId?: (existingIds: Set<string>) => string): string {
  if (!generateId) return generateCommentId(existingIds)
  for (let attempt = 0; attempt < 200; attempt++) {
    const id = sanitizeGeneratedId(generateId(existingIds))
    if (id && !existingIds.has(id)) return id
  }
  return generateCommentId(existingIds)
}

function sanitizeGeneratedId(value: unknown): string {
  return typeof value === 'string' && /^[0-9a-z]{4,6}$/.test(value) ? value : ''
}

function escapeAttribute(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeAttribute(text: string): string {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}
