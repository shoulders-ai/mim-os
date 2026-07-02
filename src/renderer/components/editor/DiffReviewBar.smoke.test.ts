// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import DiffReviewBar from './DiffReviewBar.vue'
import { useDiffStore } from '../../stores/diff.js'
import { useApprovalsStore, type ApprovalRequest } from '../../stores/approvals.js'

function approvalRequest(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    requestId: 'r1',
    toolName: 'fs.edit',
    actor: 'ai',
    category: 'write',
    risk: 'medium',
    mode: 'ask',
    reason: '',
    params: {},
    ...over,
  }
}

describe('DiffReviewBar', () => {
  let mounted: { app: ReturnType<typeof createApp>; root: HTMLElement } | null = null
  let pinia: ReturnType<typeof createPinia>

  function mount(props: Record<string, unknown> = {}) {
    const app = createApp(DiffReviewBar, { busy: false, error: '', ...props })
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
    ;(window as any).kernel = { respondGate: vi.fn().mockResolvedValue(undefined) }
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

    const root = mount()

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

  it('shows the +/− line delta computed at activation', () => {
    const diff = useDiffStore()
    diff.activate({
      source: 'inline-ai',
      original: 'one\ntwo\nthree',
      modified: 'one\nTWO\nthree\nfour',
      path: 'notes.md',
      review: { type: 'inline-ai' },
    })

    const text = mount().textContent || ''
    expect(text).toContain('+2')
    expect(text).toContain('−1')
  })

  it('renders an approval preview with Approve/Decline resolving the pending request', async () => {
    const diff = useDiffStore()
    const approvals = useApprovalsStore()
    approvals.enqueue(approvalRequest())
    diff.activate({
      source: 'approval',
      original: 'one\ntwo',
      modified: 'one\nTWO',
      path: 'plan.md',
      review: { type: 'approval', requestId: 'r1', kind: 'edit' },
    })

    const root = mount()
    const text = root.textContent || ''
    expect(text).toContain('Edit')
    expect(text).toContain('plan.md')
    expect(text).toContain('Approve')
    expect(text).toContain('Decline')
    expect(text).toContain('Close')
    // Chunk-level accept/reject stays off the approval preview.
    expect(text).not.toContain('Accept')
    expect(text).not.toContain('Reject review')

    const approve = Array.from(root.querySelectorAll('button')).find(b => b.textContent?.includes('Approve'))
    approve?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(approvals.get('r1')).toBeUndefined()
    expect((window as any).kernel.respondGate).toHaveBeenCalledWith('r1', { approved: true })
  })

  it('labels conflict reviews with explicit keep/take actions', () => {
    const diff = useDiffStore()
    diff.activate({
      source: 'conflict',
      original: 'disk version',
      modified: 'my version',
      path: 'notes.md',
      review: { type: 'conflict' },
    })

    const text = mount().textContent || ''
    expect(text).toContain('File changed on disk')
    expect(text).toContain('Keep my version')
    expect(text).toContain('Take disk version')
  })

  it('announces when every chunk has been resolved', () => {
    const diff = useDiffStore()
    diff.activate({ source: 'inline-ai', original: 'a', modified: 'b', review: { type: 'inline-ai' } })
    diff.setChunkCount(2)
    diff.setChunkCount(0)

    const text = mount().textContent || ''
    expect(text).toContain('All changes resolved')
  })

  it('surfaces a review notice (e.g. an edit that will fail)', () => {
    const diff = useDiffStore()
    diff.activate({
      source: 'approval',
      original: 'same',
      modified: 'same',
      path: 'a.md',
      review: { type: 'approval', requestId: 'r1', kind: 'edit', notice: 'No match found — this edit will fail as written.' },
    })

    const text = mount().textContent || ''
    expect(text).toContain('No match found — this edit will fail as written.')
  })

  it('handles review keyboard shortcuts at the window level', () => {
    const diff = useDiffStore()
    diff.activate({ source: 'inline-ai', original: 'a', modified: 'b', review: { type: 'inline-ai' } })
    const onClose = vi.fn()
    const onAccept = vi.fn()
    mount({ onClose, onAccept })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    expect(onAccept).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('suppresses review shortcuts while a modal dialog is open', () => {
    const diff = useDiffStore()
    diff.activate({ source: 'inline-ai', original: 'a', modified: 'b', review: { type: 'inline-ai' } })
    const onClose = vi.fn()
    const onAccept = vi.fn()
    mount({ onClose, onAccept })

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    expect(onAccept).not.toHaveBeenCalled()

    dialog.remove()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lets Mod+Enter accept while typing inside the diff editor, but ignores plain typing elsewhere', () => {
    const diff = useDiffStore()
    diff.activate({ source: 'inline-ai', original: 'a', modified: 'b', review: { type: 'inline-ai' } })
    const onAccept = vi.fn()
    mount({ onAccept })

    const diffScope = document.createElement('div')
    diffScope.setAttribute('data-diff-scope', '')
    const editable = document.createElement('div')
    editable.className = 'cm-content'
    editable.setAttribute('contenteditable', 'true')
    diffScope.appendChild(editable)
    document.body.appendChild(diffScope)

    editable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    expect(onAccept).toHaveBeenCalledTimes(1)

    const composer = document.createElement('textarea')
    document.body.appendChild(composer)
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }))
    expect(onAccept).toHaveBeenCalledTimes(1)

    diffScope.remove()
    composer.remove()
  })

  it('renders batch reviews as review-all progress instead of single-file view controls', () => {
    const diff = useDiffStore()
    diff.activateBatch({
      fileList: [
        { path: 'notes.md', original: 'a', modified: 'b', added: 1, removed: 1 },
        { path: 'draft.md', original: 'x', modified: 'y', added: 1, removed: 1 },
      ],
    })

    const text = mount().textContent || ''
    expect(text).toContain('Review all')
    expect(text).toContain('2 files')
    expect(text).toContain('0/2 resolved')
    expect(text).toContain('Accept All')
    expect(text).toContain('Reject All')
    expect(text).not.toContain('Original')
    expect(text).not.toContain('Unified')
  })
})
