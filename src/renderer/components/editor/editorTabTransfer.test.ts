import { describe, it, expect } from 'vitest'
import {
  serializeTabForTransfer,
  validateTransferredTab,
  clampSelection,
  type TransferredTab,
} from './editorTabTransfer.js'
import type { TabState } from './editorTypes.js'

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    kind: 'text',
    path: '/workspace/report.md',
    name: 'report.md',
    content: 'hello world',
    originalContent: 'hello world',
    dirty: false,
    ...overrides,
  }
}

describe('serializeTabForTransfer', () => {
  it('serializes a clean file-backed text tab without content', () => {
    const tab = makeTab({ dirty: false, path: '/workspace/notes.md', name: 'notes.md' })
    const result = serializeTabForTransfer(tab, {})
    expect(result).toEqual({
      path: '/workspace/notes.md',
      kind: 'text',
      name: 'notes.md',
      dirty: false,
    })
    expect(result.content).toBeUndefined()
    expect(result.selection).toBeUndefined()
    expect(result.scrollTop).toBeUndefined()
    expect(result.viewMode).toBeUndefined()
  })

  it('serializes a dirty text tab with content', () => {
    const tab = makeTab({ dirty: true, content: 'modified text' })
    const result = serializeTabForTransfer(tab, {})
    expect(result.dirty).toBe(true)
    expect(result.content).toBe('modified text')
  })

  it('serializes an untitled tab with content', () => {
    const tab = makeTab({ path: '', name: 'Untitled', dirty: true, content: 'draft' })
    const result = serializeTabForTransfer(tab, {})
    expect(result.path).toBeNull()
    expect(result.dirty).toBe(true)
    expect(result.content).toBe('draft')
  })

  it('includes selection when provided', () => {
    const tab = makeTab()
    const result = serializeTabForTransfer(tab, { selection: { anchor: 5, head: 10 } })
    expect(result.selection).toEqual({ anchor: 5, head: 10 })
  })

  it('includes scrollTop when provided', () => {
    const tab = makeTab()
    const result = serializeTabForTransfer(tab, { scrollTop: 142 })
    expect(result.scrollTop).toBe(142)
  })

  it('includes viewMode when provided', () => {
    const tab = makeTab()
    const result = serializeTabForTransfer(tab, { viewMode: 'split' })
    expect(result.viewMode).toBe('split')
  })

  it('includes all view state fields together', () => {
    const tab = makeTab({ dirty: true, content: 'abc' })
    const result = serializeTabForTransfer(tab, {
      selection: { anchor: 0, head: 3 },
      scrollTop: 200,
      viewMode: 'preview',
    })
    expect(result).toEqual({
      path: '/workspace/report.md',
      kind: 'text',
      name: 'report.md',
      dirty: true,
      content: 'abc',
      originalContent: 'hello world',
      selection: { anchor: 0, head: 3 },
      scrollTop: 200,
      viewMode: 'preview',
    })
  })

  it('carries the disk baseline (originalContent + version) for dirty file-backed tabs', () => {
    const tab = makeTab({
      dirty: true,
      content: 'modified',
      originalContent: 'on disk',
      version: { hash: 'abc123', size: 7, mtimeMs: 1000, modifiedAt: '2026-01-01' },
    })
    const result = serializeTabForTransfer(tab, {})
    expect(result.originalContent).toBe('on disk')
    expect(result.version).toEqual({ hash: 'abc123', size: 7, mtimeMs: 1000, modifiedAt: '2026-01-01' })
    // Copied, not aliased — mutating the transfer must not touch the tab.
    expect(result.version).not.toBe(tab.version)
  })

  it('does not carry baseline for clean or untitled tabs', () => {
    const clean = serializeTabForTransfer(makeTab({ dirty: false, version: { hash: 'x' } }), {})
    expect(clean.originalContent).toBeUndefined()
    expect(clean.version).toBeUndefined()
    const untitled = serializeTabForTransfer(
      makeTab({ path: '', dirty: true, content: 'draft', version: { hash: 'x' } }),
      {},
    )
    expect(untitled.originalContent).toBeUndefined()
    expect(untitled.version).toBeUndefined()
  })

  it('serializes pdf tab (non-text, always path-only when clean)', () => {
    const tab = makeTab({ kind: 'pdf', path: '/workspace/doc.pdf', dirty: false })
    const result = serializeTabForTransfer(tab, {})
    expect(result.kind).toBe('pdf')
    expect(result.content).toBeUndefined()
  })

  it('serializes table tab with dirty content', () => {
    const tab = makeTab({ kind: 'table', dirty: true, content: 'a,b\n1,2' })
    const result = serializeTabForTransfer(tab, {})
    expect(result.kind).toBe('table')
    expect(result.dirty).toBe(true)
    expect(result.content).toBe('a,b\n1,2')
  })

  it('serializes image tab', () => {
    const tab = makeTab({ kind: 'image', path: '/workspace/photo.png', dirty: false })
    const result = serializeTabForTransfer(tab, {})
    expect(result.kind).toBe('image')
    expect(result.path).toBe('/workspace/photo.png')
    expect(result.content).toBeUndefined()
  })
})

describe('validateTransferredTab', () => {
  it('validates a minimal clean tab', () => {
    const input: TransferredTab = {
      path: '/workspace/file.md',
      kind: 'text',
      name: 'file.md',
      dirty: false,
    }
    expect(validateTransferredTab(input)).toEqual(input)
  })

  it('validates a dirty tab with content', () => {
    const input: TransferredTab = {
      path: '/workspace/file.md',
      kind: 'text',
      name: 'file.md',
      dirty: true,
      content: 'hello',
      selection: { anchor: 0, head: 5 },
      scrollTop: 100,
      viewMode: 'source',
    }
    expect(validateTransferredTab(input)).toEqual(input)
  })

  it('validates an untitled tab (path null)', () => {
    const input: TransferredTab = {
      path: null,
      kind: 'text',
      name: 'Untitled',
      dirty: true,
      content: 'draft',
    }
    expect(validateTransferredTab(input)).toEqual(input)
  })

  it('returns null for non-object input', () => {
    expect(validateTransferredTab(null)).toBeNull()
    expect(validateTransferredTab(undefined)).toBeNull()
    expect(validateTransferredTab(42)).toBeNull()
    expect(validateTransferredTab('string')).toBeNull()
  })

  it('returns null for missing required fields', () => {
    expect(validateTransferredTab({ kind: 'text', name: 'x', dirty: false })).toBeNull()
    expect(validateTransferredTab({ path: '/x', name: 'x', dirty: false })).toBeNull()
    expect(validateTransferredTab({ path: '/x', kind: 'text', dirty: false })).toBeNull()
    expect(validateTransferredTab({ path: '/x', kind: 'text', name: 'x' })).toBeNull()
  })

  it('returns null for invalid kind', () => {
    expect(validateTransferredTab({ path: '/x', kind: 'video', name: 'x', dirty: false })).toBeNull()
  })

  it('returns null when dirty is true but content is missing', () => {
    expect(validateTransferredTab({ path: null, kind: 'text', name: 'x', dirty: true })).toBeNull()
  })

  it('strips unknown extra properties', () => {
    const input = {
      path: '/workspace/file.md',
      kind: 'text',
      name: 'file.md',
      dirty: false,
      unknownProp: 'should be removed',
    }
    const result = validateTransferredTab(input)
    expect(result).not.toBeNull()
    expect((result as Record<string, unknown>).unknownProp).toBeUndefined()
  })

  it('validates selection shape', () => {
    const input = {
      path: '/workspace/file.md',
      kind: 'text',
      name: 'file.md',
      dirty: false,
      selection: { anchor: 'not a number', head: 5 },
    }
    const result = validateTransferredTab(input)
    // Invalid selection should be stripped, not reject the whole tab
    expect(result).not.toBeNull()
    expect(result!.selection).toBeUndefined()
  })

  it('validates scrollTop is a number', () => {
    const input = {
      path: '/workspace/file.md',
      kind: 'text',
      name: 'file.md',
      dirty: false,
      scrollTop: 'invalid',
    }
    const result = validateTransferredTab(input)
    expect(result).not.toBeNull()
    expect(result!.scrollTop).toBeUndefined()
  })

  it('passes through originalContent and a well-formed version', () => {
    const result = validateTransferredTab({
      path: '/workspace/file.md',
      kind: 'text',
      name: 'file.md',
      dirty: true,
      content: 'modified',
      originalContent: 'on disk',
      version: { hash: 'abc123', size: 7 },
    })
    expect(result!.originalContent).toBe('on disk')
    expect(result!.version).toEqual({ hash: 'abc123', size: 7 })
  })

  it('strips a version without a string hash', () => {
    const result = validateTransferredTab({
      path: '/workspace/file.md',
      kind: 'text',
      name: 'file.md',
      dirty: true,
      content: 'modified',
      version: { size: 7 },
    })
    expect(result).not.toBeNull()
    expect(result!.version).toBeUndefined()
  })
})

describe('clampSelection', () => {
  it('returns selection unchanged when within bounds', () => {
    expect(clampSelection({ anchor: 0, head: 5 }, 10)).toEqual({ anchor: 0, head: 5 })
  })

  it('clamps anchor and head to docLength', () => {
    expect(clampSelection({ anchor: 20, head: 30 }, 10)).toEqual({ anchor: 10, head: 10 })
  })

  it('clamps only the out-of-bounds value', () => {
    expect(clampSelection({ anchor: 3, head: 100 }, 50)).toEqual({ anchor: 3, head: 50 })
  })

  it('handles zero-length document', () => {
    expect(clampSelection({ anchor: 5, head: 5 }, 0)).toEqual({ anchor: 0, head: 0 })
  })

  it('returns undefined for undefined input', () => {
    expect(clampSelection(undefined, 100)).toBeUndefined()
  })
})

describe('round-trip: serialize then validate', () => {
  it('round-trips a dirty text tab', () => {
    const tab = makeTab({ dirty: true, content: 'modified' })
    const serialized = serializeTabForTransfer(tab, {
      selection: { anchor: 2, head: 8 },
      scrollTop: 50,
      viewMode: 'source',
    })
    const validated = validateTransferredTab(serialized)
    expect(validated).toEqual(serialized)
  })

  it('round-trips a clean tab', () => {
    const tab = makeTab({ dirty: false })
    const serialized = serializeTabForTransfer(tab, {})
    const validated = validateTransferredTab(serialized)
    expect(validated).toEqual(serialized)
  })

  it('round-trips an untitled tab', () => {
    const tab = makeTab({ path: '', name: 'Untitled', dirty: true, content: 'buffer' })
    const serialized = serializeTabForTransfer(tab, { selection: { anchor: 0, head: 6 } })
    const validated = validateTransferredTab(serialized)
    expect(validated).toEqual(serialized)
  })
})
