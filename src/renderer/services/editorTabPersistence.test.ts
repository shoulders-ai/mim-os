import { describe, expect, it } from 'vitest'
import { serializeTabState, deserializeTabState, type LiveTab } from './editorTabPersistence.js'

describe('editorTabPersistence', () => {
  describe('serializeTabState', () => {
    it('serializes file-backed tabs without buffer content', () => {
      const tabs: LiveTab[] = [
        { path: 'docs/readme.md', name: 'readme.md', kind: 'text', content: '# Hello' },
        { path: 'src/main.ts', name: 'main.ts', kind: 'text', content: 'console.log("hi")' },
      ]
      const result = serializeTabState(tabs, 1)
      expect(result).toEqual({
        version: 1,
        tabs: [
          { path: 'docs/readme.md', name: 'readme.md', kind: 'text' },
          { path: 'src/main.ts', name: 'main.ts', kind: 'text' },
        ],
        activeIndex: 1,
      })
    })

    it('serializes untitled tabs with buffer content', () => {
      const tabs: LiveTab[] = [
        { path: '', name: 'Untitled', kind: 'text', content: 'draft text' },
      ]
      const result = serializeTabState(tabs, 0)
      expect(result.tabs[0]).toEqual({ path: '', name: 'Untitled', kind: 'text', content: 'draft text' })
    })

    it('does not persist empty untitled tab content', () => {
      const tabs: LiveTab[] = [
        { path: '', name: 'Untitled', kind: 'text', content: '' },
      ]
      const result = serializeTabState(tabs, 0)
      expect(result.tabs[0]).toEqual({ path: '', name: 'Untitled', kind: 'text' })
    })

    it('serializes pdf, card, table, and image tabs with kind but without buffer content', () => {
      const tabs: LiveTab[] = [
        { path: 'reports/brief.pdf', name: 'brief.pdf', kind: 'pdf', content: '%PDF...' },
        { path: 'inputs/source.docx', name: 'source.docx', kind: 'card', content: 'binary-ish' },
        { path: 'data/input.csv', name: 'input.csv', kind: 'table', content: 'A,B\n1,2' },
        { path: 'outputs/plot.png', name: 'plot.png', kind: 'image', content: '' },
      ]

      const result = serializeTabState(tabs, 0)

      expect(result.tabs).toEqual([
        { path: 'reports/brief.pdf', name: 'brief.pdf', kind: 'pdf' },
        { path: 'inputs/source.docx', name: 'source.docx', kind: 'card' },
        { path: 'data/input.csv', name: 'input.csv', kind: 'table' },
        { path: 'outputs/plot.png', name: 'plot.png', kind: 'image' },
      ])
    })

    it('round-trips image tabs and still rejects unknown kinds', () => {
      const serialized = serializeTabState(
        [{ path: 'outputs/plot.png', name: 'plot.png', kind: 'image', content: '' }],
        0,
      )
      const restored = deserializeTabState(JSON.parse(JSON.stringify(serialized)))
      expect(restored!.tabs).toEqual([{ path: 'outputs/plot.png', name: 'plot.png', kind: 'image' }])

      const rejected = deserializeTabState({
        version: 1,
        tabs: [{ path: 'a.bin', name: 'a.bin', kind: 'hologram' }],
        activeIndex: 0,
      })
      expect(rejected).toBeNull()
    })

    it('filters read-only tabs and remaps the active index', () => {
      const tabs: LiveTab[] = [
        { path: 'docs/a.md', name: 'a.md', kind: 'text', content: 'A' },
        { path: '', name: 'Slides README.md', kind: 'text', content: '# Slides', readOnly: true },
        { path: 'docs/b.md', name: 'b.md', kind: 'text', content: 'B' },
      ]

      expect(serializeTabState(tabs, 1)).toEqual({
        version: 1,
        tabs: [
          { path: 'docs/a.md', name: 'a.md', kind: 'text' },
          { path: 'docs/b.md', name: 'b.md', kind: 'text' },
        ],
        activeIndex: 0,
      })
      expect(serializeTabState(tabs, 2).activeIndex).toBe(1)
    })

    it('clamps activeIndex to valid range', () => {
      const tabs: LiveTab[] = [
        { path: 'a.md', name: 'a.md', kind: 'text', content: '' },
      ]
      expect(serializeTabState(tabs, 5).activeIndex).toBe(0)
      expect(serializeTabState(tabs, -1).activeIndex).toBe(0)
    })
  })

  describe('deserializeTabState', () => {
    it('round-trips through serialize/deserialize', () => {
      const tabs: LiveTab[] = [
        { path: 'docs/readme.md', name: 'readme.md', kind: 'text', content: '# Hello' },
        { path: '', name: 'Untitled', kind: 'text', content: 'draft' },
        { path: 'docs/report.pdf', name: 'report.pdf', kind: 'pdf', content: '' },
      ]
      const serialized = serializeTabState(tabs, 1)
      const deserialized = deserializeTabState(serialized)
      expect(deserialized).not.toBeNull()
      expect(deserialized!.tabs).toHaveLength(3)
      expect(deserialized!.tabs[0]).toEqual({ path: 'docs/readme.md', name: 'readme.md', kind: 'text' })
      expect(deserialized!.tabs[1]).toEqual({ path: '', name: 'Untitled', kind: 'text', content: 'draft' })
      expect(deserialized!.tabs[2]).toEqual({ path: 'docs/report.pdf', name: 'report.pdf', kind: 'pdf' })
      expect(deserialized!.activeIndex).toBe(1)
    })

    it('defaults missing tab kind to text for existing persisted files', () => {
      const raw = { version: 1, tabs: [{ path: 'a.md', name: 'a.md' }], activeIndex: 0 }

      expect(deserializeTabState(raw)?.tabs[0]).toEqual({ path: 'a.md', name: 'a.md', kind: 'text' })
    })

    it('preserves pdf, card, and table kind on deserialize', () => {
      const raw = {
        version: 1,
        tabs: [
          { path: 'a.pdf', name: 'a.pdf', kind: 'pdf', content: 'ignored' },
          { path: 'a.docx', name: 'a.docx', kind: 'card', content: 'ignored' },
          { path: 'a.csv', name: 'a.csv', kind: 'table', content: 'ignored' },
        ],
        activeIndex: 0,
      }

      expect(deserializeTabState(raw)?.tabs).toEqual([
        { path: 'a.pdf', name: 'a.pdf', kind: 'pdf' },
        { path: 'a.docx', name: 'a.docx', kind: 'card' },
        { path: 'a.csv', name: 'a.csv', kind: 'table' },
      ])
    })

    it('returns null for invalid input', () => {
      expect(deserializeTabState(null)).toBeNull()
      expect(deserializeTabState('string')).toBeNull()
      expect(deserializeTabState(42)).toBeNull()
      expect(deserializeTabState([])).toBeNull()
      expect(deserializeTabState({ version: 2 })).toBeNull()
      expect(deserializeTabState({ version: 1, tabs: [] })).toBeNull()
    })

    it('clamps out-of-range activeIndex', () => {
      const raw = { version: 1, tabs: [{ path: 'a.md', name: 'a.md' }], activeIndex: 99 }
      const result = deserializeTabState(raw)
      expect(result!.activeIndex).toBe(0)
    })

    it('skips malformed tab entries', () => {
      const raw = {
        version: 1,
        tabs: [
          { path: 'a.md', name: 'a.md' },
          null,
          'not-an-object',
          { path: 'b.md' }, // missing name
          { path: 'c.md', name: 'c.md' },
        ],
        activeIndex: 0,
      }
      const result = deserializeTabState(raw)
      expect(result!.tabs).toHaveLength(2)
      expect(result!.tabs[0].path).toBe('a.md')
      expect(result!.tabs[1].path).toBe('c.md')
    })

    it('skips unsupported tab kinds', () => {
      const raw = {
        version: 1,
        tabs: [
          { path: 'a.md', name: 'a.md', kind: 'text' },
          { path: 'b.bin', name: 'b.bin', kind: 'binary' },
        ],
        activeIndex: 0,
      }

      expect(deserializeTabState(raw)?.tabs).toEqual([
        { path: 'a.md', name: 'a.md', kind: 'text' },
      ])
    })
  })
})
