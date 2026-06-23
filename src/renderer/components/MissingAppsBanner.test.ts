// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import MissingAppsBanner from './MissingAppsBanner.vue'
import { useAppsStore } from '../stores/coreApps.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('MissingAppsBanner', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let call: ReturnType<typeof vi.fn>
  let appsState: Array<Record<string, unknown>>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)

    appsState = []
    call = vi.fn(async (tool: string) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'package.install') return { installed: 'pkg', version: '1.0.0', dir: '/install' }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })
    app = null
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.restoreAllMocks()
  })

  async function mountWithApps() {
    const pinia = createPinia()
    setActivePinia(pinia)
    app = createApp(MissingAppsBanner)
    app.use(pinia)
    app.mount(root)
    await useAppsStore().refresh()
    await flushUi()
  }

  function missingApp(id: string, source: string, path?: string) {
    return {
      id,
      enabled: true,
      layer: 'workspace',
      installed: false,
      installedVersions: [],
      source,
      version: '1.2.0',
      ...(path ? { path } : {}),
      shadowed: false,
      needsTrust: false,
      needsInstall: true,
      folderPresent: false,
    }
  }

  it('is hidden when no committed apps are missing', async () => {
    appsState = [
      { id: 'board', enabled: true, layer: 'workspace', installed: true, installedVersions: ['0.1.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: true },
    ]
    await mountWithApps()

    expect(root.querySelector('[data-testid="missing-apps-banner"]')).toBeNull()
  })

  it('names the missing apps in one banner', async () => {
    appsState = [
      missingApp('github-monitor', 'https://github.com/shoulders-ai/mim-apps', 'packages/github-monitor'),
      missingApp('slides', 'https://github.com/shoulders-ai/mim-apps', 'packages/slides'),
    ]
    await mountWithApps()

    const banner = root.querySelector('[data-testid="missing-apps-banner"]')
    expect(banner).toBeTruthy()
    expect(banner!.textContent).toContain('This workspace uses github-monitor, slides')
  })

  it('installs every missing app by id and version on Add all', async () => {
    appsState = [
      missingApp('github-monitor', 'https://github.com/shoulders-ai/mim-apps', 'packages/github-monitor'),
      missingApp('slides', 'https://github.com/shoulders-ai/mim-apps', 'packages/slides'),
    ]
    await mountWithApps()

    root.querySelector<HTMLButtonElement>('[data-testid="missing-apps-add-all"]')!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('package.install', { id: 'github-monitor', version: '1.2.0' })
    expect(call).toHaveBeenCalledWith('package.install', { id: 'slides', version: '1.2.0' })
  })

  it('skips apps without a declared source', async () => {
    appsState = [
      { id: 'bool-pkg', enabled: true, layer: 'workspace', installed: false, installedVersions: [], shadowed: false, needsTrust: false, needsInstall: true, folderPresent: false },
    ]
    await mountWithApps()

    expect(root.querySelector('[data-testid="missing-apps-banner"]')).toBeNull()
  })

  it('is dismissible', async () => {
    appsState = [
      missingApp('slides', 'https://github.com/shoulders-ai/mim-apps', 'packages/slides'),
    ]
    await mountWithApps()

    const dismissBtn = [...root.querySelectorAll('button')].find(b => b.title === 'Dismiss')!
    dismissBtn.click()
    await flushUi()

    expect(root.querySelector('[data-testid="missing-apps-banner"]')).toBeNull()
  })

  it('shows the install error in the banner', async () => {
    appsState = [
      missingApp('slides', 'https://github.com/shoulders-ai/mim-apps', 'packages/slides'),
    ]
    call.mockImplementation(async (tool: string) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'package.install') throw new Error('Registry sync failed')
      return {}
    })
    await mountWithApps()

    root.querySelector<HTMLButtonElement>('[data-testid="missing-apps-add-all"]')!.click()
    await flushUi()

    expect(root.textContent).toContain('Registry sync failed')
  })
})
