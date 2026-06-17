// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import WelcomeDialog from './WelcomeDialog.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function mountWelcome() {
  const onAction = vi.fn()
  const onClose = vi.fn()
  const app = createApp({
    setup() {
      return () => h(WelcomeDialog, { onAction, onClose })
    },
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root, onAction, onClose }
}

describe('WelcomeDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('orients across the four core surfaces with actionable rows', async () => {
    const mounted = mountWelcome()
    await flushUi()

    for (const key of ['chat', 'file', 'terminal', 'apps']) {
      const row = document.body.querySelector(`[data-testid="welcome-${key}"]`)
      expect(row).not.toBeNull()
      expect(row?.textContent).toBeTruthy()
    }
    mounted.app.unmount()
  })

  it('emits an action key when a row is chosen', async () => {
    const mounted = mountWelcome()
    await flushUi()

    document.body.querySelector<HTMLButtonElement>('[data-testid="welcome-terminal"]')?.click()
    await flushUi()

    expect(mounted.onAction).toHaveBeenCalledWith('terminal')
    mounted.app.unmount()
  })

  it('dismisses from the Get started button', async () => {
    const mounted = mountWelcome()
    await flushUi()

    document.body.querySelector<HTMLButtonElement>('[data-testid="welcome-get-started"]')?.click()
    await flushUi()

    expect(mounted.onClose).toHaveBeenCalledOnce()
    mounted.app.unmount()
  })
})
