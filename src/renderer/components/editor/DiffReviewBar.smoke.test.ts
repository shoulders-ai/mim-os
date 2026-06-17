// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import DiffReviewBar from './DiffReviewBar.vue'
import { useDiffStore } from '../../stores/diff.js'

describe('DiffReviewBar', () => {
  let mounted: { app: ReturnType<typeof createApp>; root: HTMLElement } | null = null
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    vi.restoreAllMocks()
  })

  it('renders a dense editor review toolbar with view, layout, and chunk controls', () => {
    const diff = useDiffStore()
    diff.activate({
      source: 'inline-ai',
      original: 'alpha beta',
      modified: 'alpha BETA',
      path: 'notes.md',
      review: { type: 'inline-ai' },
    })
    diff.setChunkCount(2)

    const app = createApp(DiffReviewBar, { busy: false, error: '' })
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.use(pinia)
    app.mount(root)
    mounted = { app, root }

    const text = root.textContent || ''
    expect(text).toContain('AI edit')
    expect(text).toContain('notes.md')
    expect(text).toContain('Original')
    expect(text).toContain('Diff')
    expect(text).toContain('Result')
    expect(text).toContain('Unified')
    expect(text).toContain('Split')
    expect(text).toContain('1/2')
    expect(text).toContain('Accept')
    expect(text).toContain('Reject')
  })

  it('renders an approval preview as read-only: view controls but no accept/reject', () => {
    const diff = useDiffStore()
    diff.activate({
      source: 'approval',
      original: 'one\ntwo',
      modified: 'one\nTWO',
      path: 'plan.md',
      review: { type: 'approval', requestId: 'r1', kind: 'edit' },
    })

    const app = createApp(DiffReviewBar, { busy: false, error: '' })
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.use(pinia)
    app.mount(root)
    mounted = { app, root }

    const text = root.textContent || ''
    expect(text).toContain('Edit')
    expect(text).toContain('plan.md')
    expect(text).toContain('Decide in chat')
    expect(text).toContain('Close')
    // The decision lives on the chat card, not the diff bar.
    expect(text).not.toContain('Accept')
    expect(text).not.toContain('Reject')
  })

  it('renders batch reviews as review-all progress instead of single-file view controls', () => {
    const diff = useDiffStore()
    diff.activateBatch({
      fileList: [
        { path: 'notes.md', original: 'a', modified: 'b', added: 1, removed: 1 },
        { path: 'draft.md', original: 'x', modified: 'y', added: 1, removed: 1 },
      ],
    })

    const app = createApp(DiffReviewBar, { busy: false, error: '' })
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.use(pinia)
    app.mount(root)
    mounted = { app, root }

    const text = root.textContent || ''
    expect(text).toContain('Review all')
    expect(text).toContain('2 files')
    expect(text).toContain('0/2 resolved')
    expect(text).toContain('Accept All')
    expect(text).toContain('Reject All')
    expect(text).not.toContain('Original')
    expect(text).not.toContain('Unified')
  })
})
