// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import ChatComposerFooter from './ChatComposerFooter.vue'

const modes = [
  { id: 'strict', label: 'Strict', desc: 'Ask before every action' },
  { id: 'normal', label: 'Normal', desc: 'Ask before changes and outside requests' },
  { id: 'developer', label: 'Allow all', desc: 'No approval prompts' },
]

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

function mountFooter(props = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(ChatComposerFooter, {
    mode: 'normal',
    modes,
    ...props,
  })
  app.mount(root)
  return { app, root }
}

describe('ChatComposerFooter', () => {
  let mounted: ReturnType<typeof mountFooter> | null = null

  beforeEach(() => {
    mounted = null
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    vi.restoreAllMocks()
  })

  it('opens the approval menu and emits mode changes', async () => {
    const onUpdate = vi.fn()
    mounted = mountFooter({ 'onUpdate:mode': onUpdate })
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[title="Automation approval mode"]')?.click()
    await flushUi()

    expect(document.body.textContent).toContain('Strict')
    expect(document.body.textContent).toContain('No approval prompts')

    const allowAll = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Allow all')) as HTMLButtonElement
    allowAll.click()

    expect(onUpdate).toHaveBeenCalledWith('developer')
  })

  it('emits done and restore actions', async () => {
    const onDone = vi.fn()
    mounted = mountFooter({ canMarkDone: true, onDone })
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[title^="Mark done"]')?.click()
    expect(onDone).toHaveBeenCalled()

    const onRestore = vi.fn()
    mounted.app.unmount()
    mounted.root.remove()
    mounted = mountFooter({ isArchived: true, onRestore })
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('button[title="Unarchive this chat"]')?.click()
    expect(onRestore).toHaveBeenCalled()
  })
})
