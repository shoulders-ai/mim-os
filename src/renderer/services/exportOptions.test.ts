import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPORT_OPTIONS,
  defaultOutputName,
  detectCitations,
  loadExportOptions,
  pickBibCandidate,
  saveExportOptions,
} from './exportOptions.js'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: () => null,
    get length() { return data.size },
  } as Storage
}

describe('export options persistence', () => {
  it('round-trips options', () => {
    const storage = memoryStorage()
    saveExportOptions(storage, {
      ...DEFAULT_EXPORT_OPTIONS,
      format: 'docx',
      marginCm: 1.5,
      numberedHeadings: true,
      pageNumberPosition: 'right',
      pageNumbersSkipFirst: true,
    })
    const loaded = loadExportOptions(storage)
    expect(loaded.format).toBe('docx')
    expect(loaded.marginCm).toBe(1.5)
    expect(loaded.numberedHeadings).toBe(true)
    expect(loaded.pageNumberPosition).toBe('right')
    expect(loaded.pageNumbersSkipFirst).toBe(true)
  })

  it('keeps defaults for fields absent from stored data', () => {
    const loaded = loadExportOptions(memoryStorage({ 'mim:export-options': '{"format":"docx"}' }))
    expect(loaded.format).toBe('docx')
    expect(loaded.justify).toBe(true)
    expect(loaded.marginCm).toBe(2.5)
    expect(loaded.pageNumberPosition).toBe('none')
  })

  it('falls back to defaults on corrupt or missing data', () => {
    expect(loadExportOptions(memoryStorage())).toEqual(DEFAULT_EXPORT_OPTIONS)
    expect(loadExportOptions(memoryStorage({ 'mim:export-options': 'not json' }))).toEqual(DEFAULT_EXPORT_OPTIONS)
    expect(loadExportOptions(memoryStorage({ 'mim:export-options': '{"format":"weird"}' }))).toEqual(DEFAULT_EXPORT_OPTIONS)
  })
})

describe('defaultOutputName', () => {
  it('replaces the markdown extension next to the source', () => {
    expect(defaultOutputName('docs/paper.md', 'paper.md', 'pdf')).toBe('docs/paper.pdf')
    expect(defaultOutputName('notes.markdown', 'notes.markdown', 'docx')).toBe('notes.docx')
  })

  it('uses the tab name for untitled documents', () => {
    expect(defaultOutputName('', 'Untitled', 'pdf')).toBe('Untitled.pdf')
    expect(defaultOutputName('', '', 'docx')).toBe('Document.docx')
  })
})

describe('detectCitations', () => {
  it('detects pandoc citations in prose', () => {
    expect(detectCitations('As shown [@smith2020].')).toBe(true)
  })

  it('ignores citations inside code', () => {
    expect(detectCitations('```\n[@nope]\n```')).toBe(false)
    expect(detectCitations('use `[@key]` syntax')).toBe(false)
  })

  it('returns false without citations', () => {
    expect(detectCitations('plain text [link](x)')).toBe(false)
  })
})

describe('pickBibCandidate', () => {
  it('prefers a .bib next to the document', () => {
    expect(pickBibCandidate([
      { name: 'refs.bib', path: 'docs/refs.bib' },
      { name: 'other.bib', path: 'other.bib' },
    ])).toBe('docs/refs.bib')
  })

  it('returns null when nothing matches', () => {
    expect(pickBibCandidate([{ name: 'a.md', path: 'a.md' }])).toBe(null)
  })
})
