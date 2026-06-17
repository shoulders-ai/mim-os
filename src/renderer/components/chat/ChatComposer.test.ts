// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import ChatComposer from './ChatComposer.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

describe('ChatComposer', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null

  afterEach(() => {
    app?.unmount()
    app = null
    root?.remove()
    vi.restoreAllMocks()
  })

  function mountComposer(onSend: ReturnType<typeof vi.fn>, props = {}) {
    root = document.createElement('div')
    document.body.appendChild(root)
    const composerRef = ref<any>(null)
    app = createApp({
      setup() {
        return () => h(ChatComposer, {
          ref: composerRef,
          modelId: '',
          models: [],
          controlId: 'normal',
          controlLabel: 'Normal',
          controlOptions: [],
          ...props,
          onSend,
        })
      },
    })
    app.mount(root)
    return composerRef
  }

  async function typeDraft(value: string) {
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea')
    if (!textarea) throw new Error('textarea not found')
    textarea.value = value
    textarea.setSelectionRange(value.length, value.length)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()
    return textarea
  }

  it('sends on plain Enter', async () => {
    const onSend = vi.fn()
    mountComposer(onSend)

    const textarea = await typeDraft('hello')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flushUi()

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }))
  })

  it('sends on Cmd/Ctrl+Enter and keeps Shift+Enter for newlines', async () => {
    const onSend = vi.fn()
    mountComposer(onSend)

    let textarea = await typeDraft('with meta')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
    await flushUi()
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'with meta' }))

    onSend.mockClear()
    textarea = await typeDraft('with ctrl')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    await flushUi()
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: 'with ctrl' }))

    onSend.mockClear()
    textarea = await typeDraft('line one')
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    expect(textarea.dispatchEvent(event)).toBe(true)
    await flushUi()
    expect(onSend).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps Shift+Enter native when the @ menu is open', async () => {
    const onSend = vi.fn()
    mountComposer(onSend, {
      skills: [{ id: 'issue-work', name: 'issue-work', desc: 'Issue workflow' }],
    })

    const textarea = await typeDraft('@')
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    expect(textarea.dispatchEvent(event)).toBe(true)
    await flushUi()

    expect(onSend).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('prepares an editable draft with attachments without sending', async () => {
    const onSend = vi.fn()
    const composerRef = mountComposer(onSend)
    await flushUi()

    composerRef.value.prepareDraft({
      text: 'Address the comments.',
      attachments: [
        {
          filename: 'Comments: plan.md (1)',
          mediaType: 'application/vnd.mim.comments+json',
          content: '{}',
          kind: 'comments',
        },
      ],
    })
    await flushUi()

    expect(root.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Address the comments.')
    expect(root.textContent).toContain('Comments: plan.md (1)')
    expect(onSend).not.toHaveBeenCalled()
  })
})
