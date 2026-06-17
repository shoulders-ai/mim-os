import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDiffStore } from './diff.js'

describe('diff store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('activates a single-file diff review with resolved content seeded from modified text', () => {
    const store = useDiffStore()

    store.activate({
      source: 'inline-ai',
      original: 'alpha beta',
      modified: 'alpha BETA',
      path: 'notes.md',
      review: { type: 'inline-ai', from: 6, to: 10 },
    })

    expect(store.active).toBe(true)
    expect(store.mode).toBe('single')
    expect(store.source).toBe('inline-ai')
    expect(store.filePath).toBe('notes.md')
    expect(store.originalContent).toBe('alpha beta')
    expect(store.modifiedContent).toBe('alpha BETA')
    expect(store.resolvedContent).toBe('alpha BETA')
    expect(store.effectiveContent).toBe('alpha BETA')
    expect(store.reviewMeta).toMatchObject({ type: 'inline-ai', from: 6, to: 10 })
  })

  it('tracks view mode, layout, and cyclic chunk navigation', () => {
    const store = useDiffStore()
    store.activate({ source: 'inline-ai', original: 'a', modified: 'b' })

    store.setViewMode('original')
    store.setLayout('split')
    store.setChunkCount(3)

    expect(store.viewMode).toBe('original')
    expect(store.layout).toBe('split')
    expect(store.hasChunks).toBe(true)
    expect(store.currentChunk).toBe(0)

    store.nextChunk()
    store.nextChunk()
    store.nextChunk()
    expect(store.currentChunk).toBe(0)

    store.prevChunk()
    expect(store.currentChunk).toBe(2)

    store.setChunkCount(1)
    expect(store.currentChunk).toBe(0)
  })

  it('activates batch reviews and records per-file resolution', () => {
    const store = useDiffStore()

    store.activateBatch({
      fileList: [
        { path: 'a.md', original: 'one', modified: 'two', reviewId: 'r1' },
        { path: 'b.md', original: 'old', modified: 'new', reviewId: 'r2' },
      ],
      batch: 'batch-1',
    })

    expect(store.active).toBe(true)
    expect(store.isBatch).toBe(true)
    expect(store.pendingFiles).toHaveLength(2)
    expect(store.allResolved).toBe(false)

    expect(store.focusBatchFile('a.md')).toBe(true)
    expect(store.filePath).toBe('a.md')
    expect(store.reviewIds).toEqual(['r1'])

    store.setResolvedContent('mixed')
    store.acceptFile('a.md')
    store.rejectFile('b.md')

    expect(store.files[0]).toMatchObject({ status: 'accepted', resolvedContent: 'mixed' })
    expect(store.files[1]).toMatchObject({ status: 'rejected' })
    expect(store.resolvedCount).toBe(2)
    expect(store.allResolved).toBe(true)
  })

  it('clears all review state on deactivate', () => {
    const store = useDiffStore()
    store.activate({ source: 'inline-ai', original: 'a', modified: 'b', path: 'a.md' })
    store.setChunkCount(2)

    store.deactivate()

    expect(store.active).toBe(false)
    expect(store.mode).toBe('single')
    expect(store.filePath).toBe('')
    expect(store.originalContent).toBe('')
    expect(store.modifiedContent).toBe('')
    expect(store.resolvedContent).toBeNull()
    expect(store.chunkCount).toBe(0)
  })

  it('keeps an explicitly empty resolved result instead of falling back to modified content', () => {
    const store = useDiffStore()
    store.activate({ source: 'inline-ai', original: 'remove me', modified: '' })

    store.setResolvedContent('')

    expect(store.resolvedContent).toBe('')
    expect(store.effectiveContent).toBe('')
  })
})
