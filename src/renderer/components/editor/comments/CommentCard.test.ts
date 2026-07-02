// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import type { CommentThread } from '@main/comments/model.js'
import CommentCard from './CommentCard.vue'

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 'k3f9',
    anchor: 'a staged rollout',
    notes: [{ by: 'paul', at: '2026-06-13T09:14', text: 'Too slow.' }],
    tagFrom: 10,
    tagTo: 120,
    anchorFrom: 24,
    anchorTo: 40,
    ...overrides,
  }
}

function setInputValue(el: HTMLTextAreaElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('CommentCard', () => {
  let mounted: { app: ReturnType<typeof createApp>; root: HTMLElement } | null = null

  function mount(props: Record<string, unknown> = {}) {
    const app = createApp(CommentCard, props)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    mounted = { app, root }
    return root
  }

  afterEach(async () => {
    // Cancel any pending draft-blur autocancel timers before teardown.
    await new Promise(resolve => setTimeout(resolve, 0))
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    vi.restoreAllMocks()
  })

  it('renders the collapsed row with author and preview text, resolve hidden until hover', () => {
    const root = mount({ thread: thread() })
    expect(root.textContent).toContain('paul')
    expect(root.textContent).toContain('Too slow.')
    const resolveButton = root.querySelector('button[title="Resolve"]')
    expect(resolveButton).toBeTruthy()
    expect(resolveButton?.className).toContain('opacity-0')
  })

  it('clicking the collapsed row activates the thread', () => {
    const onActivate = vi.fn()
    const root = mount({ thread: thread(), onActivate })
    root.querySelector('[data-comment-id]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onActivate).toHaveBeenCalledWith('k3f9')
  })

  it('shows the agent sparkles icon only for machine-authored notes', () => {
    const human = mount({ thread: thread({ notes: [{ by: 'paul', at: '2026-06-13T09:14', text: 'x' }] }) })
    expect(human.querySelector('.tabler-icon-sparkles')).toBeNull()
    mounted?.app.unmount()
    mounted?.root.remove()

    const agent = mount({ thread: thread({ notes: [{ by: 'claude-code', at: '2026-06-13T09:14', text: 'x' }] }) })
    expect(agent.querySelector('.tabler-icon-sparkles')).not.toBeNull()
  })

  it('shows a delete button for reply notes but not for the first note', () => {
    const onDeleteNote = vi.fn()
    const root = mount({
      thread: thread({
        notes: [
          { by: 'paul', at: '2026-06-13T09:14', text: 'first' },
          { by: 'ai', at: '2026-06-13T09:20', text: 'reply' },
        ],
      }),
      active: true,
      onDeleteNote,
    })

    const deleteButtons = root.querySelectorAll('button[title="Delete reply"]')
    expect(deleteButtons).toHaveLength(1)
    deleteButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onDeleteNote).toHaveBeenCalledWith('k3f9', 1)
  })

  it('exposes an edit affordance on the first note via the header pencil', async () => {
    const onEditNote = vi.fn()
    const root = mount({ thread: thread(), active: true, onEditNote })

    const editButtons = root.querySelectorAll('button[title="Edit"]')
    expect(editButtons.length).toBeGreaterThan(0)
    editButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()

    const textarea = root.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).toBeTruthy()
    expect(textarea.value).toBe('Too slow.')

    setInputValue(textarea, 'Too slow, revised.')
    const saveButton = Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Save')
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onEditNote).toHaveBeenCalledWith('k3f9', 0, 'Too slow, revised.')
  })

  it('shows an absolute-time tooltip alongside the relative time', () => {
    const root = mount({ thread: thread() })
    const timeEl = Array.from(root.querySelectorAll('span')).find(el => el.getAttribute('title')?.includes('2026-06-13'))
    expect(timeEl?.getAttribute('title')).toBe('2026-06-13 09:14')
  })

  it('draft mode reports text changes to the parent instead of holding local state', () => {
    const onUpdateDraftText = vi.fn()
    const root = mount({ draft: true, draftText: '', onUpdateDraftText })

    const textarea = root.querySelector('textarea') as HTMLTextAreaElement
    setInputValue(textarea, 'new comment')

    expect(onUpdateDraftText).toHaveBeenCalledWith('new comment')
  })

  it('draft mode reflects the parent-controlled draftText prop', () => {
    const root = mount({ draft: true, draftText: 'from parent' })
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('from parent')
  })

  it('saves a non-empty draft and cancels an empty one', () => {
    const onSaveDraft = vi.fn()
    const onCancelDraft = vi.fn()
    const root = mount({ draft: true, draftText: '  hello  ', onSaveDraft, onCancelDraft })

    const saveButton = Array.from(root.querySelectorAll('button')).find(b => b.textContent?.startsWith('Save'))
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onSaveDraft).toHaveBeenCalledWith('hello')

    const cancelButton = Array.from(root.querySelectorAll('button')).find(b => b.textContent === 'Cancel')
    cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onCancelDraft).toHaveBeenCalledTimes(1)
  })
})
