// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import MimDialog from './MimDialog.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function mountDialog(props: Record<string, unknown> = {}) {
  const close = vi.fn()
  const app = createApp({
    setup() {
      return () => h(
        MimDialog,
        {
          open: true,
          title: 'Shared dialog',
          onClose: close,
          ...props,
        },
        { default: () => h('button', { class: 'dialog-action' }, 'Action') },
      )
    },
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root, close }
}

describe('MimDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('portals an accessible dialog with title and body content', async () => {
    const mounted = mountDialog()
    await flushUi()

    expect(mounted.root.textContent).toBe('')
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(document.body.textContent).toContain('Shared dialog')
    expect(document.body.textContent).toContain('Action')
    mounted.app.unmount()
  })

  it('uses the critical layer for alert dialogs', async () => {
    const mounted = mountDialog({ role: 'alertdialog' })
    await flushUi()

    expect(document.body.querySelector('.mim-dialog')?.className).toContain('z-[var(--z-critical)]')
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull()
    mounted.app.unmount()
  })

  it('emits close when Headless UI requests closure', async () => {
    const mounted = mountDialog()
    await flushUi()

    document.body
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushUi()

    expect(mounted.close).toHaveBeenCalled()
    mounted.app.unmount()
  })

  it('accepts an initial focus ref', async () => {
    const target = ref<HTMLButtonElement | null>(null)
    const app = createApp({
      setup() {
        return () => h(
          MimDialog,
          { open: true, initialFocus: target },
          { default: () => h('button', { ref: target }, 'Focused action') },
        )
      },
    })
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flushUi()

    expect(document.activeElement?.textContent).toBe('Focused action')
    app.unmount()
  })
})
