// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { CommentThread } from '@main/comments/model.js'
import CommentsMargin from './CommentsMargin.vue'

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 'k3f9',
    anchor: 'a staged rollout',
    notes: [
      { by: 'paul', at: '2026-06-13T09:14', text: 'first' },
      { by: 'ai', at: '2026-06-13T09:20', text: 'reply' },
    ],
    tagFrom: 10,
    tagTo: 120,
    anchorFrom: 24,
    anchorTo: 40,
    ...overrides,
  }
}

describe('CommentsMargin', () => {
  let mounted: { app: ReturnType<typeof createApp>; root: HTMLElement } | null = null
  let pinia: ReturnType<typeof createPinia>

  function mount(props: Record<string, unknown> = {}) {
    const app = createApp(CommentsMargin, { threads: [], ...props })
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.use(pinia)
    app.mount(root)
    mounted = { app, root }
    return root
  }

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

  it('shows the empty state with no threads and no draft, and offers a request-review action', () => {
    const onRequestReview = vi.fn()
    const root = mount({ threads: [], onRequestReview })

    const empty = root.querySelector('[data-testid="comments-empty-state"]')
    expect(empty).toBeTruthy()
    expect(empty?.textContent).toContain('No comments yet')

    const button = empty?.querySelector('button')
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onRequestReview).toHaveBeenCalledTimes(1)
  })

  it('hides the empty state once a thread exists', () => {
    const root = mount({ threads: [thread()] })
    expect(root.querySelector('[data-testid="comments-empty-state"]')).toBeNull()
  })

  it('hides the empty state while a draft is in progress even with zero threads', () => {
    const root = mount({ threads: [], draft: { from: 0, to: 5, anchor: 'hello', text: '' } })
    expect(root.querySelector('[data-testid="comments-empty-state"]')).toBeNull()
  })

  it('forwards CommentCard delete-note events as deleteNote', () => {
    const onDeleteNote = vi.fn()
    const root = mount({ threads: [thread()], activeId: 'k3f9', onDeleteNote })

    const deleteButton = root.querySelector('button[title="Delete reply"]')
    expect(deleteButton).toBeTruthy()
    deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onDeleteNote).toHaveBeenCalledWith('k3f9', 1)
  })

  it('forwards draft text updates from CommentCard as updateDraftText', () => {
    const onUpdateDraftText = vi.fn()
    const root = mount({
      threads: [],
      draft: { from: 0, to: 5, anchor: 'hello', text: '' },
      onUpdateDraftText,
    })

    const textarea = root.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'typed text'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))

    expect(onUpdateDraftText).toHaveBeenCalledWith('typed text')
  })

  it('confirms resolve-all inline before emitting resolveAll', async () => {
    const onResolveAll = vi.fn()
    const root = mount({ threads: [thread()], onResolveAll })

    const resolveAllButton = Array.from(root.querySelectorAll('button')).find(b => b.textContent?.includes('Resolve all'))
    resolveAllButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(onResolveAll).not.toHaveBeenCalled()
    expect(root.textContent).toContain('Resolve all 1?')

    const confirmButton = root.querySelector('button[title="Confirm"]')
    confirmButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onResolveAll).toHaveBeenCalledTimes(1)
  })
})
