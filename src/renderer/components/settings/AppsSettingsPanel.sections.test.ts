// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AppsSettingsPanel from './AppsSettingsPanel.vue'
import { useAppsStore } from '../../stores/coreApps.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('AppsSettingsPanel sections', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let call: ReturnType<typeof vi.fn>
  let appsState: Array<Record<string, unknown>>
  let appsEnabled: Record<string, boolean>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())

    appsEnabled = { board: true, knowledge: true, 'runtime-demo': true }
    appsState = [
      { id: 'board', enabled: true, layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
      { id: 'knowledge', enabled: true, layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
      { id: 'runtime-demo', enabled: true, layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'workspace', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
    ]

    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') {
        return {
          apps: appsState.map(a => ({
            ...a,
            enabled: appsEnabled[a.id as string] ?? a.enabled,
          })),
        }
      }
      if (tool === 'app.enable') { appsEnabled[params!.id as string] = true; return { ok: true } }
      if (tool === 'app.disable') { appsEnabled[params!.id as string] = false; return { ok: true } }
      if (tool === 'app.trust') return { ok: true, id: params?.id }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') {
        return {
          packages: [
            { id: 'board', name: 'Board', enabled: appsEnabled['board'], source: 'global', views: [{ id: 'main', label: 'Board', src: './ui/index.html', role: 'work' }], permissions: { workspace: { read: true, write: true } } },
            { id: 'knowledge', name: 'Knowledge', enabled: appsEnabled['knowledge'], source: 'global', views: [{ id: 'main', label: 'Knowledge', src: './ui/index.html', role: 'work' }], permissions: { workspace: { read: true, write: true } } },
            { id: 'runtime-demo', name: 'Runtime Demo', enabled: appsEnabled['runtime-demo'], source: 'workspace', views: [{ id: 'main', label: 'Runtime', src: './ui/index.html', role: 'work' }], permissions: { workspace: { read: true }, ai: true, http: ['api.example.com'] } },
          ],
          diagnostics: [],
        }
      }
      if (tool === 'package.capabilities.list') {
        return {
          packages: [{
            packageId: 'runtime-demo',
            jobs: [{ id: 'inspectWorkspace', label: 'Inspect workspace' }],
            tools: [{ id: 'summarize', name: 'pkg_runtime__summarizeWorkspace', label: 'Summarize workspace' }],
            skills: [{ id: 'runtime-skill', label: 'Runtime skill' }],
            diagnostics: [],
          }],
        }
      }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn(), clearTimeout: vi.fn() },
    })
    app = null
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.restoreAllMocks()
  })

  function mount() {
    const pinia = createPinia()
    setActivePinia(pinia)
    app = createApp(AppsSettingsPanel)
    app.use(pinia)
    app.mount(root)
  }

  // ---- App sections ----

  it('renders personal sidebar and workspace sections', async () => {
    mount()
    await flushUi()

    expect(root.textContent).toContain('My Sidebar')
    expect(root.textContent).toContain('Workspace Apps')
    expect(root.querySelector('[data-testid="apps-row-board"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="apps-row-knowledge"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="apps-row-runtime-demo"]')).toBeTruthy()
    expect(root.textContent).not.toContain('Built in')
  })

  it('shows app skills only inside Developer details', async () => {
    mount()
    await flushUi()

    const row = root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!
    row.click()
    await flushUi()

    expect(root.textContent).not.toContain('Teaches the agent')

    root.querySelector<HTMLButtonElement>('[data-testid="app-developer-toggle-runtime-demo"]')!.click()
    await flushUi()

    expect(root.textContent).toContain('Teaches the agent')
    expect(root.textContent).toContain('Runtime skill')
  })

  it('includes needsTrust apps in the workspace section', async () => {
    appsState = [
      { id: 'vendor-pkg', enabled: false, layer: 'workspace', installed: true, installedVersions: ['1.0.0'], source: 'workspace', shadowed: false, needsTrust: true, needsInstall: false, folderPresent: false },
    ]
    call.mockImplementation(async (tool: string) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') {
        return {
          packages: [{
            id: 'vendor-pkg',
            name: 'Vendor Package',
            description: 'Workspace package',
            enabled: false,
            source: 'workspace',
            views: [],
            permissions: { workspace: { read: true }, http: ['api.example.com'] },
          }],
          diagnostics: [],
        }
      }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      return {}
    })
    mount()
    await flushUi()

    const trustRow = root.querySelector('[data-testid="apps-row-vendor-pkg"]')
    expect(trustRow).toBeTruthy()
    expect(root.textContent).not.toContain('Needs trust')
  })

  it('includes needsInstall apps in the workspace section with install action', async () => {
    appsState = [
      { id: 'github-monitor', enabled: false, layer: 'workspace', installed: false, installedVersions: [], source: 'https://mim.shoulde.rs/api/v1/registry', version: '1.2.0', shadowed: false, needsTrust: false, needsInstall: true, folderPresent: false },
    ]
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') return { packages: [], diagnostics: [] }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      if (tool === 'package.install') return { installed: 'github-monitor' }
      if (tool === 'app.enable') return { ok: true }
      if (tool === 'app.disable') return { ok: true }
      return {}
    })
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="apps-row-github-monitor"]')).toBeTruthy()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-github-monitor"]')!.click()
    await flushUi()

    const installRow = root.querySelector('[data-testid="install-from-source-github-monitor"]')
    expect(installRow).toBeTruthy()
  })

  it('shows current built-in apps even when disabled', async () => {
    appsEnabled = { board: false, knowledge: false, 'runtime-demo': false }
    appsState = [
      { id: 'board', enabled: false, layer: 'workspace', installed: true, installedVersions: ['1.0.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
    ]
    call.mockImplementation(async (tool: string) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') return { packages: [{ id: 'board', name: 'Board', enabled: false, source: 'global', views: [] }], diagnostics: [] }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      return {}
    })
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="apps-row-board"]')).toBeTruthy()
    expect(root.textContent).toContain('Shared with workspace')
  })

  // ---- Toggles ----

  it('enables an app via app.enable when toggled on', async () => {
    appsEnabled['runtime-demo'] = false
    appsState = appsState.map(app =>
      app.id === 'runtime-demo' ? { ...app, enabled: false, layer: 'workspace' } : app,
    )
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-toggle-runtime-demo"]')!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('app.enable', { id: 'runtime-demo' })
    expect(useAppsStore().isEnabled('runtime-demo')).toBe(true)
  })

  it('disables an app via app.disable when toggled off', async () => {
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-toggle-runtime-demo"]')!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('app.disable', { id: 'runtime-demo' })
  })

  it('enabling an untrusted app opens the permission dialog, then trusts and enables', async () => {
    appsState = [
      { id: 'vendor-pkg', enabled: false, layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'workspace', shadowed: false, needsTrust: true, needsInstall: false, folderPresent: false },
    ]
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') {
        return {
          packages: [{
            id: 'vendor-pkg',
            name: 'Vendor Package',
            description: 'Workspace package',
            enabled: false,
            source: 'workspace',
            views: [],
            permissions: { workspace: { read: true }, http: ['api.example.com'] },
          }],
          diagnostics: [],
        }
      }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      if (tool === 'app.trust') return { ok: true, id: params?.id }
      if (tool === 'app.enable') return { ok: true, id: params?.id }
      return {}
    })
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-toggle-vendor-pkg"]')!.click()
    await flushUi()

    expect(document.body.querySelector('[data-testid="apps-enable-permissions-vendor-pkg"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Vendor Package can:')
    expect(document.body.textContent).toContain('Read files in this workspace')
    expect(document.body.textContent).toContain('Connect to api.example.com')
    expect(call).not.toHaveBeenCalledWith('app.enable', { id: 'vendor-pkg' })

    document.body.querySelector<HTMLButtonElement>('[data-testid="apps-enable-confirm-vendor-pkg"]')!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('app.trust', { id: 'vendor-pkg' })
    expect(call).toHaveBeenCalledWith('app.enable', { id: 'vendor-pkg' })
  })

  // ---- Override badge ----

  it('shows Local override badge on shadowed apps', async () => {
    appsState = [
      { id: 'my-pkg', enabled: true, layer: 'local', installed: true, installedVersions: ['1.0.0'], source: 'workspace', shadowed: true, needsTrust: false, needsInstall: false, folderPresent: false },
    ]
    call.mockImplementation(async (tool: string) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') return { packages: [{ id: 'my-pkg', name: 'My Package', enabled: true, source: 'workspace', views: [] }], diagnostics: [] }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      return {}
    })
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="override-badge-my-pkg"]')).toBeTruthy()
    expect(root.textContent).toContain('Local override')
  })

  // ---- Install from source ----

  it('calls package.install from expanded needs-install row', async () => {
    appsState = [
      { id: 'github-monitor', enabled: false, layer: 'workspace', installed: false, installedVersions: [], source: 'https://mim.shoulde.rs/api/v1/registry', version: '1.2.0', shadowed: false, needsTrust: false, needsInstall: true, folderPresent: false },
    ]
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') return { packages: [], diagnostics: [] }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      if (tool === 'package.install') return { installed: 'github-monitor' }
      if (tool === 'app.enable') return { ok: true }
      if (tool === 'app.disable') return { ok: true }
      return {}
    })
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-github-monitor"]')!.click()
    await flushUi()

    const installBtn = root.querySelector<HTMLButtonElement>('[data-testid="install-from-source-github-monitor"] button')
    expect(installBtn).toBeTruthy()
    installBtn!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('package.install', { id: 'github-monitor', version: '1.2.0' })
  })

  it('passes monorepo path to install-from-source', async () => {
    appsState = [
      { id: 'slides', enabled: false, layer: 'workspace', installed: false, installedVersions: [], source: 'https://github.com/shoulders-ai/mim-apps', path: 'packages/slides', version: '0.4.0', shadowed: false, needsTrust: false, needsInstall: true, folderPresent: false },
    ]
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') return { packages: [], diagnostics: [] }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      if (tool === 'package.install') return { installed: 'slides' }
      if (tool === 'app.enable') return { ok: true }
      if (tool === 'app.disable') return { ok: true }
      return {}
    })
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-slides"]')!.click()
    await flushUi()

    const installBtn = root.querySelector<HTMLButtonElement>('[data-testid="install-from-source-slides"] button')!
    installBtn.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('package.install', { id: 'slides', version: '0.4.0' })
  })
})
