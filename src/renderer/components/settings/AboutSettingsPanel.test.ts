// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AboutSettingsPanel from './AboutSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('AboutSettingsPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    call = vi.fn(async (tool: string) => {
      if (tool === 'app.info') return { version: '0.42.0', electron: '33', chrome: '130', node: '22', platform: 'darwin' }
      if (tool === 'account.status') return { connected: false }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn(), getWorkspace: vi.fn(async () => '/Users/test/mim-workspace') },
    })
    app = null
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  function mount() {
    app = createApp(AboutSettingsPanel)
    app.mount(root)
  }

  it('shows app version and workspace path', async () => {
    mount()
    await flushUi()

    expect(root.textContent).toContain('Mim')
    expect(root.textContent).toContain('v0.42.0')
    expect(root.textContent).toContain('/Users/test/mim-workspace')
    expect(root.textContent).toContain('~/.mim')
  })

  it('shows disconnected account state with token input', async () => {
    mount()
    await flushUi()

    expect(root.textContent).toContain('Organisation registry')
    expect(root.textContent).toContain('Not connected')
    expect(root.querySelector('input[aria-label="Account token"]')).toBeTruthy()
  })

  it('shows connected account state with client name', async () => {
    call = vi.fn(async (tool: string) => {
      if (tool === 'app.info') return { version: '0.42.0', electron: '33', chrome: '130', node: '22', platform: 'darwin' }
      if (tool === 'account.status') return { connected: true }
      if (tool === 'account.validate') return { valid: true, client: { id: 'c1', name: 'Acme Inc' }, entitlements: ['board', 'slides'] }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn(), getWorkspace: vi.fn(async () => '') },
    })

    mount()
    await flushUi()

    expect(root.textContent).toContain('Connected as Acme Inc')
    expect(root.textContent).toContain('board')
    expect(root.textContent).toContain('slides')
  })

  it('disconnects and returns to token input', async () => {
    call = vi.fn(async (tool: string) => {
      if (tool === 'app.info') return { version: '0.42.0', electron: '33', chrome: '130', node: '22', platform: 'darwin' }
      if (tool === 'account.status') return { connected: true }
      if (tool === 'account.validate') return { valid: true, client: { id: 'c1', name: 'Acme Inc' }, entitlements: [] }
      if (tool === 'account.clearToken') return {}
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn(), getWorkspace: vi.fn(async () => '') },
    })

    mount()
    await flushUi()

    expect(root.textContent).toContain('Connected as Acme Inc')
    const disconnect = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Disconnect')!
    disconnect.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('account.clearToken')
    expect(root.textContent).toContain('Not connected')
  })
})
