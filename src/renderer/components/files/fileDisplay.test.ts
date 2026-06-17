import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  baseName,
  compareRows,
  dirOf,
  entryToRow,
  fileToRow,
  formatSize,
  formatTime,
  highlight,
  highlightQueryText,
  isFileContentMatch,
  isFsEntry,
  locationLabel,
  parentDir,
  rowTitle,
  sortEntries,
  timestampOf,
} from './fileDisplay.js'
import type { FileRow, FileRowBase, FsEntry, RowCompareOptions } from './fileTypes.js'

function row(overrides: Partial<FileRowBase> & { name: string }): FileRowBase {
  return {
    path: overrides.name,
    dir: '',
    type: 'file',
    kind: 'File',
    positions: [],
    level: 0,
    ...overrides,
  }
}

function opts(overrides: Partial<RowCompareOptions> = {}): RowCompareOptions {
  return { sortKey: 'name', sortDirection: 'asc', showLocationColumn: false, ...overrides }
}

describe('fileToRow', () => {
  it('builds a file row with derived dir, kind, and defaults', () => {
    const r = fileToRow({ path: 'docs/notes.md', name: 'notes.md', size: 12, modifiedAt: '2026-01-01T00:00:00Z' })
    expect(r).toMatchObject({
      path: 'docs/notes.md',
      name: 'notes.md',
      dir: 'docs',
      type: 'file',
      kind: 'Markdown',
      size: 12,
      level: 0,
    })
    expect(r.positions).toEqual([])
  })

  it('prefers an explicit dir over the derived one', () => {
    expect(fileToRow({ path: 'docs/notes.md', name: 'notes.md', dir: 'elsewhere' }).dir).toBe('elsewhere')
  })

  it('handles root-level and extensionless files', () => {
    const r = fileToRow({ path: 'Makefile', name: 'Makefile' })
    expect(r.dir).toBe('')
    expect(r.kind).toBe('File')
  })
})

describe('entryToRow', () => {
  it('labels directories as Folder and carries the level through', () => {
    const r = entryToRow({ path: 'a/b', name: 'b', type: 'directory' }, 2)
    expect(r.kind).toBe('Folder')
    expect(r.type).toBe('directory')
    expect(r.level).toBe(2)
  })

  it('classifies file entries by extension', () => {
    expect(entryToRow({ path: 'a/x.ts', name: 'x.ts', type: 'file' }, 0).kind).toBe('TypeScript')
  })
})

describe('compareRows', () => {
  const folder = row({ name: 'zeta', type: 'directory', kind: 'Folder' })
  const file = row({ name: 'alpha' })

  it('puts folders above files in browse mode regardless of name order', () => {
    expect(compareRows(folder, file, opts())).toBeLessThan(0)
    expect(compareRows(file, folder, opts())).toBeGreaterThan(0)
  })

  it('keeps folders above files even when sorting descending', () => {
    expect(compareRows(folder, file, opts({ sortDirection: 'desc' }))).toBeLessThan(0)
  })

  it('does not group folders first when the location column is shown', () => {
    // Search-like views sort purely by the active key.
    expect(compareRows(folder, file, opts({ showLocationColumn: true }))).toBeGreaterThan(0)
  })

  it('sorts by name with direction applied', () => {
    const a = row({ name: 'a.txt' })
    const b = row({ name: 'b.txt' })
    expect(compareRows(a, b, opts())).toBeLessThan(0)
    expect(compareRows(a, b, opts({ sortDirection: 'desc' }))).toBeGreaterThan(0)
  })

  it('sorts kindOrLocation by kind, falling back to name', () => {
    const md = row({ name: 'b.md', kind: 'Markdown' })
    const ts = row({ name: 'a.ts', kind: 'TypeScript' })
    expect(compareRows(md, ts, opts({ sortKey: 'kindOrLocation' }))).toBeLessThan(0)
    const md2 = row({ name: 'a.md', kind: 'Markdown' })
    expect(compareRows(md2, md, opts({ sortKey: 'kindOrLocation' }))).toBeLessThan(0)
  })

  it('sorts kindOrLocation by dir when the location column is shown', () => {
    const inA = row({ name: 'z.md', dir: 'a' })
    const inB = row({ name: 'a.md', dir: 'b' })
    expect(compareRows(inA, inB, opts({ sortKey: 'kindOrLocation', showLocationColumn: true }))).toBeLessThan(0)
  })

  it('sorts by size with directories and unknown sizes first ascending', () => {
    const dir = row({ name: 'd', type: 'directory', kind: 'Folder' })
    const unknown = row({ name: 'u' })
    const small = row({ name: 's', size: 0 })
    const big = row({ name: 'b', size: 10 })
    const options = opts({ sortKey: 'size', showLocationColumn: true })
    expect(compareRows(small, big, options)).toBeLessThan(0)
    expect(compareRows(unknown, small, options)).toBeLessThan(0)
    // Directory and unknown-size file tie at -1; tiebreak puts the directory first.
    expect(compareRows(dir, unknown, options)).toBeLessThan(0)
  })

  it('sorts by timestamps, treating missing or invalid dates as epoch', () => {
    const old = row({ name: 'old', modifiedAt: '2020-01-01T00:00:00Z' })
    const recent = row({ name: 'new', modifiedAt: '2026-01-01T00:00:00Z' })
    const missing = row({ name: 'missing' })
    const options = opts({ sortKey: 'modifiedAt' })
    expect(compareRows(old, recent, options)).toBeLessThan(0)
    expect(compareRows(missing, old, options)).toBeLessThan(0)
    expect(compareRows(recent, old, opts({ sortKey: 'modifiedAt', sortDirection: 'desc' }))).toBeLessThan(0)
  })

  it('sorts by createdAt independently of modifiedAt', () => {
    const a = row({ name: 'a', createdAt: '2026-01-02T00:00:00Z', modifiedAt: '2020-01-01T00:00:00Z' })
    const b = row({ name: 'b', createdAt: '2026-01-01T00:00:00Z', modifiedAt: '2026-06-01T00:00:00Z' })
    expect(compareRows(a, b, opts({ sortKey: 'createdAt' }))).toBeGreaterThan(0)
  })

  it('breaks full ties by name', () => {
    const a = row({ name: 'a', size: 5 })
    const b = row({ name: 'b', size: 5 })
    expect(compareRows(a, b, opts({ sortKey: 'size' }))).toBeLessThan(0)
  })
})

describe('sortEntries', () => {
  it('returns a new sorted array with folders above files, without mutating the input', () => {
    const entries: FsEntry[] = [
      { path: 'b.txt', name: 'b.txt', type: 'file' },
      { path: 'zdir', name: 'zdir', type: 'directory' },
      { path: 'a.txt', name: 'a.txt', type: 'file' },
    ]
    const copy = entries.slice()
    const sorted = sortEntries(entries, opts())
    expect(sorted.map(e => e.name)).toEqual(['zdir', 'a.txt', 'b.txt'])
    expect(entries).toEqual(copy)
    expect(sorted).not.toBe(entries)
  })
})

describe('highlight', () => {
  it('returns one unhighlighted part when there are no positions', () => {
    expect(highlight('abc', [])).toEqual([{ text: 'abc', hl: false }])
  })

  it('splits text into alternating highlighted and plain runs', () => {
    expect(highlight('abcd', [1, 2])).toEqual([
      { text: 'a', hl: false },
      { text: 'bc', hl: true },
      { text: 'd', hl: false },
    ])
  })

  it('highlights from position zero and at the end', () => {
    expect(highlight('ab', [0])).toEqual([
      { text: 'a', hl: true },
      { text: 'b', hl: false },
    ])
    expect(highlight('ab', [1])).toEqual([
      { text: 'a', hl: false },
      { text: 'b', hl: true },
    ])
  })

  it('ignores positions beyond the text length', () => {
    expect(highlight('ab', [99])).toEqual([{ text: 'ab', hl: false }])
  })

  it('treats positions as UTF-16 indices for unicode names', () => {
    // 'é' is one code unit; positions line up with string indexing.
    expect(highlight('éxé', [0])).toEqual([
      { text: 'é', hl: true },
      { text: 'xé', hl: false },
    ])
  })
})

describe('highlightQueryText', () => {
  it('returns the whole text unhighlighted for an empty or whitespace query', () => {
    expect(highlightQueryText('abc', '')).toEqual([{ text: 'abc', hl: false }])
    expect(highlightQueryText('abc', '   ')).toEqual([{ text: 'abc', hl: false }])
  })

  it('highlights a case-insensitive match', () => {
    expect(highlightQueryText('Read Me.md', 'read')).toEqual([
      { text: 'Read', hl: true },
      { text: ' Me.md', hl: false },
    ])
  })

  it('drops empty edge parts when the match spans the whole text', () => {
    expect(highlightQueryText('abc', 'ABC')).toEqual([{ text: 'abc', hl: true }])
  })

  it('falls back to the first multi-character token when the full query misses', () => {
    expect(highlightQueryText('weekly-report.md', 'report q3')).toEqual([
      { text: 'weekly-', hl: false },
      { text: 'report', hl: true },
      { text: '.md', hl: false },
    ])
    // Only the first multi-char token is tried; a later matching token is ignored.
    expect(highlightQueryText('weekly-report.md', 'q3 report')).toEqual([
      { text: 'weekly-report.md', hl: false },
    ])
  })

  it('returns no highlight when nothing matches', () => {
    expect(highlightQueryText('abc', 'zz qq')).toEqual([{ text: 'abc', hl: false }])
    expect(highlightQueryText('abc', 'z')).toEqual([{ text: 'abc', hl: false }])
  })
})

describe('formatTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a dash for missing or invalid values', () => {
    expect(formatTime()).toBe('-')
    expect(formatTime('')).toBe('-')
    expect(formatTime('not a date')).toBe('-')
  })

  it('labels same-day timestamps as Today with a time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 11, 12, 0, 0))
    expect(formatTime(new Date(2026, 5, 11, 0, 0, 1).toISOString())).toMatch(/^Today /)
    expect(formatTime(new Date(2026, 5, 11, 23, 59, 59).toISOString())).toMatch(/^Today /)
  })

  it('labels the previous local day as Yesterday, including the midnight boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 11, 0, 30, 0))
    expect(formatTime(new Date(2026, 5, 10, 23, 59, 59).toISOString())).toBe('Yesterday')
    expect(formatTime(new Date(2026, 5, 10, 0, 0, 0).toISOString())).toBe('Yesterday')
  })

  it('omits the year for older dates in the current year and shows it otherwise', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 11, 12, 0, 0))
    const sameYear = formatTime(new Date(2026, 0, 15, 12, 0, 0).toISOString())
    expect(sameYear).not.toMatch(/Today|Yesterday/)
    expect(sameYear).not.toContain('2026')
    const otherYear = formatTime(new Date(2024, 0, 15, 12, 0, 0).toISOString())
    expect(otherYear).toContain('2024')
  })
})

describe('formatSize', () => {
  it('returns a dash for directories and unknown sizes', () => {
    expect(formatSize(undefined, 'file')).toBe('-')
    expect(formatSize(2048, 'directory')).toBe('-')
    expect(formatSize()).toBe('-')
  })

  it('formats bytes below 1 KB, including zero', () => {
    expect(formatSize(0, 'file')).toBe('0 B')
    expect(formatSize(1023, 'file')).toBe('1023 B')
  })

  it('formats kilobytes and megabytes at the 1024 boundaries', () => {
    expect(formatSize(1024, 'file')).toBe('1 KB')
    expect(formatSize(1536, 'file')).toBe('2 KB')
    expect(formatSize(1024 * 1024, 'file')).toBe('1.0 MB')
    expect(formatSize(2.5 * 1024 * 1024, 'file')).toBe('2.5 MB')
  })

  it('treats a missing type as a file', () => {
    expect(formatSize(500)).toBe('500 B')
  })
})

describe('rowTitle and locationLabel', () => {
  const base: FileRow = {
    path: 'docs/a.md',
    name: 'a.md',
    dir: 'docs',
    type: 'file',
    kind: 'Markdown',
    positions: [],
    level: 0,
    gi: 0,
  }

  it('builds the title from path plus optional search and author lines', () => {
    expect(rowTitle(base)).toBe('docs/a.md')
    expect(rowTitle({ ...base, searchLine: 4, searchSnippet: 'hello', lastChangedBy: 'paul' }))
      .toBe('docs/a.md\nLine 4: hello\nChanged by paul')
    // A search line without a snippet is not rendered.
    expect(rowTitle({ ...base, searchLine: 4 })).toBe('docs/a.md')
  })

  it('shows kind, location, or location:line depending on the column mode', () => {
    expect(locationLabel(base, false)).toBe('Markdown')
    expect(locationLabel(base, true)).toBe('docs')
    expect(locationLabel({ ...base, searchLine: 7 }, true)).toBe('docs:7')
    expect(locationLabel({ ...base, dir: '' }, true)).toBe('workspace')
  })
})

describe('path helpers', () => {
  it('dirOf returns the parent or empty string at the root', () => {
    expect(dirOf('a/b/c.txt')).toBe('a/b')
    expect(dirOf('c.txt')).toBe('')
    expect(dirOf('/abs.txt')).toBe('')
  })

  it('parentDir falls back to dot for root-level paths', () => {
    expect(parentDir('a/b.txt')).toBe('a')
    expect(parentDir('b.txt')).toBe('.')
  })

  it('baseName handles separators, trailing slashes, and unicode', () => {
    expect(baseName('a/b/c.txt')).toBe('c.txt')
    expect(baseName('a/b/')).toBe('b')
    expect(baseName('a\\b\\c.txt')).toBe('c.txt')
    expect(baseName('über/straße.md')).toBe('straße.md')
    expect(baseName('plain')).toBe('plain')
    expect(baseName('/')).toBe('/')
  })

  it('timestampOf parses ISO dates and returns 0 otherwise', () => {
    expect(timestampOf('2026-01-01T00:00:00.000Z')).toBe(Date.parse('2026-01-01T00:00:00.000Z'))
    expect(timestampOf()).toBe(0)
    expect(timestampOf('garbage')).toBe(0)
  })
})

describe('runtime guards for fileTypes shapes', () => {
  it('isFsEntry accepts only objects matching the FsEntry contract', () => {
    expect(isFsEntry({ path: 'a', name: 'a', type: 'file' })).toBe(true)
    expect(isFsEntry({ path: 'a', name: 'a', type: 'directory', size: 1 })).toBe(true)
    expect(isFsEntry({ path: 'a', name: 'a', type: 'symlink' })).toBe(false)
    expect(isFsEntry({ path: 'a', type: 'file' })).toBe(false)
    expect(isFsEntry(null)).toBe(false)
    expect(isFsEntry(undefined)).toBe(false)
    expect(isFsEntry([])).toBe(false)
    expect(isFsEntry('a')).toBe(false)
  })

  it('isFileContentMatch requires path, numeric line, and snippet', () => {
    expect(isFileContentMatch({ path: 'a', line: 1, snippet: 'x' })).toBe(true)
    expect(isFileContentMatch({ path: 'a', line: '1', snippet: 'x' })).toBe(false)
    expect(isFileContentMatch({ path: 'a', line: 1 })).toBe(false)
    expect(isFileContentMatch(null)).toBe(false)
    expect(isFileContentMatch([])).toBe(false)
  })
})
