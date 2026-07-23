import type { IndexedFile } from '../../services/workspaceFileIndex.js'
import { fileKindForPath } from '../../services/fileOpenPolicy.js'
import type {
  FileContentMatch,
  FileRow,
  FileRowBase,
  FsEntry,
  HighlightPart,
  RowCompareOptions,
} from './fileTypes.js'

export function fileToRow(file: IndexedFile | {
  path: string
  name: string
  dir?: string
  size?: number
  modifiedAt?: string
  createdAt?: string
  lastChangedBy?: string
  changeSummary?: string
}): FileRowBase {
  return {
    path: file.path,
    name: file.name,
    dir: file.dir ?? dirOf(file.path),
    type: 'file',
    kind: fileKindForPath(file.path),
    size: file.size,
    modifiedAt: file.modifiedAt,
    createdAt: file.createdAt,
    lastChangedBy: file.lastChangedBy,
    changeSummary: file.changeSummary,
    positions: [],
    level: 0,
  }
}

export function entryToRow(entry: FsEntry, level: number): FileRowBase {
  return {
    path: entry.path,
    name: entry.name,
    dir: dirOf(entry.path),
    type: entry.type,
    kind: entry.type === 'directory' ? 'Folder' : fileKindForPath(entry.path),
    size: entry.size,
    modifiedAt: entry.modifiedAt,
    createdAt: entry.createdAt,
    lastChangedBy: entry.lastChangedBy,
    positions: [],
    level,
  }
}

export function compareRows(a: FileRowBase, b: FileRowBase, options: RowCompareOptions): number {
  const browseTypeResult = compareBrowseTypes(a, b, options.showLocationColumn)
  if (browseTypeResult !== 0) return browseTypeResult
  const direction = options.sortDirection === 'asc' ? 1 : -1
  let result = 0
  if (options.sortKey === 'name') result = a.name.localeCompare(b.name)
  else if (options.sortKey === 'kindOrLocation') {
    const left = options.showChangedByColumn ? (a.lastChangedBy ?? '') : options.showLocationColumn ? a.dir : a.kind
    const right = options.showChangedByColumn ? (b.lastChangedBy ?? '') : options.showLocationColumn ? b.dir : b.kind
    result = left.localeCompare(right) || a.name.localeCompare(b.name)
  } else if (options.sortKey === 'size') {
    result = numericSortValue(a.size, a.type) - numericSortValue(b.size, b.type)
  } else if (options.sortKey === 'modifiedAt') {
    result = timestampOf(a.modifiedAt) - timestampOf(b.modifiedAt)
  } else if (options.sortKey === 'createdAt') {
    result = timestampOf(a.createdAt) - timestampOf(b.createdAt)
  }
  if (result === 0) result = Number(a.type === 'file') - Number(b.type === 'file') || a.name.localeCompare(b.name)
  return result * direction
}

export function sortEntries(entries: FsEntry[], options: RowCompareOptions): FsEntry[] {
  return entries.slice().sort((a, b) => compareRows(entryToRow(a, 0), entryToRow(b, 0), options))
}

export function highlight(text: string, positions: number[]): HighlightPart[] {
  if (!positions.length) return [{ text, hl: false }]
  const set = new Set(positions)
  const parts: HighlightPart[] = []
  let current = ''
  let currentHighlighted = set.has(0)

  for (let i = 0; i < text.length; i++) {
    const highlighted = set.has(i)
    if (highlighted !== currentHighlighted) {
      if (current) parts.push({ text: current, hl: currentHighlighted })
      current = ''
      currentHighlighted = highlighted
    }
    current += text[i]
  }
  if (current) parts.push({ text: current, hl: currentHighlighted })
  return parts
}

export function highlightQueryText(text: string, rawQuery: string): HighlightPart[] {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return [{ text, hl: false }]
  const lower = text.toLowerCase()
  let index = lower.indexOf(q)
  let length = q.length
  if (index < 0) {
    const token = q.split(/\s+/).find(part => part.length > 1)
    if (!token) return [{ text, hl: false }]
    index = lower.indexOf(token)
    length = token.length
  }
  if (index < 0) return [{ text, hl: false }]
  return [
    { text: text.slice(0, index), hl: false },
    { text: text.slice(index, index + length), hl: true },
    { text: text.slice(index + length), hl: false },
  ].filter(part => part.text.length > 0)
}

export function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  if (startDate === startToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (startDate === startToday - day) return 'Yesterday'
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export function formatSize(size?: number, type?: 'directory' | 'file'): string {
  if (type === 'directory' || typeof size !== 'number') return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function rowTitle(row: FileRow): string {
  const details = [row.path]
  if (row.searchLine && row.searchSnippet) details.push(`Line ${row.searchLine}: ${row.searchSnippet}`)
  if (row.lastChangedBy) details.push(`Changed by ${row.lastChangedBy}`)
  if (row.changeSummary) details.push(row.changeSummary)
  return details.join('\n')
}

export function locationLabel(row: FileRow, showLocationColumn: boolean): string {
  const location = row.dir || 'workspace'
  if (showLocationColumn && row.searchLine) return `${location}:${row.searchLine}`
  return showLocationColumn ? location : row.kind
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

export function parentDir(path: string): string {
  const dir = dirOf(path)
  return dir || '.'
}

export function baseName(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path
}

export function timestampOf(value?: string): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

export function isFsEntry(value: unknown): value is FsEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.path === 'string'
    && typeof record.name === 'string'
    && (record.type === 'directory' || record.type === 'file')
}

export function isFileContentMatch(value: unknown): value is FileContentMatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.path === 'string'
    && typeof record.line === 'number'
    && typeof record.snippet === 'string'
}

function compareBrowseTypes(a: FileRowBase, b: FileRowBase, showLocationColumn: boolean): number {
  if (showLocationColumn || a.type === b.type) return 0
  return a.type === 'directory' ? -1 : 1
}

function numericSortValue(size: number | undefined, type: 'directory' | 'file'): number {
  return type === 'directory' ? -1 : size ?? -1
}
