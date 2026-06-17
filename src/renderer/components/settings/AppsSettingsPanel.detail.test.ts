// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AppsSettingsPanel from './AppsSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('AppsSettingsPanel detail expansion', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let call: ReturnType<typeof vi.fn>
  let appsEnabled: Record<string, boolean>
  let loaderDiagnostics: Array<{ path: string; message: string; packageId?: string }>
  let capabilityDiagnostics: string[]

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())

    appsEnabled = { board: true, knowledge: true, slides: true, 'runtime-demo': true }
    loaderDiagnostics = []
    capabilityDiagnostics = []

    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') {
        return {
          apps: [
            { id: 'board', enabled: appsEnabled['board'], layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: true },
            { id: 'knowledge', enabled: appsEnabled['knowledge'], layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: true },
            { id: 'slides', enabled: appsEnabled['slides'], layer: 'workspace', installed: true, installedVersions: ['1.0.0'], source: 'workspace', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
            { id: 'runtime-demo', enabled: appsEnabled['runtime-demo'], layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'workspace', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
          ],
        }
      }
      if (tool === 'app.enable') { appsEnabled[params!.id as string] = true; return { ok: true } }
      if (tool === 'app.disable') { appsEnabled[params!.id as string] = false; return { ok: true } }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') {
        return {
          packages: [
            { id: 'board', name: 'Board', version: '0.1.1', enabled: appsEnabled['board'], source: 'global', views: [{ id: 'main', label: 'Board', src: './ui/index.html', role: 'work' }], permissions: { workspace: { read: true, write: true } } },
            { id: 'knowledge', name: 'Knowledge', version: '0.1.1', enabled: appsEnabled['knowledge'], source: 'global', views: [{ id: 'main', label: 'Knowledge', src: './ui/index.html', role: 'work' }], permissions: { workspace: { read: true, write: true } } },
            { id: 'slides', name: 'Slides', version: '0.1.1', enabled: appsEnabled['slides'], source: 'workspace', views: [{ id: 'main', label: 'Slides', src: './ui/index.html', role: 'work' }], permissions: {}, hasReadme: true },
            { id: 'runtime-demo', name: 'Runtime Demo', version: '2.3.0', enabled: appsEnabled['runtime-demo'], source: 'workspace', backend: './backend/index.mjs', views: [{ id: 'main', label: 'Runtime', src: './ui/index.html', role: 'work' }], permissions: { workspace: { read: true, write: false }, ai: true, http: ['api.example.com'] } },
          ],
          diagnostics: loaderDiagnostics,
        }
      }
      if (tool === 'package.capabilities.list') {
        return {
          packages: [{
            packageId: 'runtime-demo',
            jobs: [{ id: 'inspectWorkspace', label: 'Inspect workspace' }],
            tools: [{ id: 'summarize', name: 'pkg_runtime__summarizeWorkspace', label: 'Summarize workspace' }],
            skills: [{ id: 'runtime-skill', label: 'Runtime skill' }],
            diagnostics: capabilityDiagnostics,
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

  // ---- Expand / collapse ----

  it('does not auto-expand rows on mount', async () => {
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="apps-row-board"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(root.querySelector('[data-testid="apps-row-slides"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(root.textContent).not.toContain('Access')
  })

  it('collapses current row and expands another on click', async () => {
    mount()
    await flushUi()

    const slidesRow = root.querySelector<HTMLButtonElement>('[data-testid="apps-row-slides"]')!
    const runtimeRow = root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!
    slidesRow.click()
    await flushUi()
    expect(slidesRow.getAttribute('aria-expanded')).toBe('true')
    expect(runtimeRow.getAttribute('aria-expanded')).toBe('false')

    runtimeRow.click()
    await flushUi()
    expect(slidesRow.getAttribute('aria-expanded')).toBe('false')
    expect(runtimeRow.getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses an expanded row when clicked again', async () => {
    mount()
    await flushUi()

    const slidesRow = root.querySelector<HTMLButtonElement>('[data-testid="apps-row-slides"]')!
    slidesRow.click()
    await flushUi()
    expect(slidesRow.getAttribute('aria-expanded')).toBe('true')

    slidesRow.click()
    await flushUi()
    expect(slidesRow.getAttribute('aria-expanded')).toBe('false')
  })

  // ---- Access ----

  it('shows plain-language access in expanded detail', async () => {
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!.click()
    await flushUi()

    expect(root.textContent).toContain('Access')
    expect(root.textContent).toContain('Read files in this workspace')
    expect(root.textContent).toContain('Use AI from its backend')
    expect(root.textContent).toContain('Connect to api.example.com')
    expect(root.textContent).not.toContain('Read workspace')
    expect(root.textContent).not.toContain('HTTP')
    expect(root.textContent).toContain('api.example.com')
  })

  it('shows "No special access" when a package declares none', async () => {
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') {
        return { apps: [{ id: 'slides', enabled: true, layer: 'workspace', installed: true, installedVersions: ['1.0.0'], source: 'workspace', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false }] }
      }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') {
        return { packages: [{ id: 'slides', name: 'Slides', enabled: true, source: 'workspace', views: [], permissions: {} }], diagnostics: [] }
      }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      if (tool === 'app.enable') return { ok: true }
      if (tool === 'app.disable') return { ok: true }
      return {}
    })
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-slides"]')!.click()
    await flushUi()

    expect(root.textContent).toContain('No special access')
  })

  // ---- Developer details ----

  it('hides capability groups until Developer details is opened', async () => {
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!.click()
    await flushUi()

    expect(root.textContent).not.toContain('Jobs')
    expect(root.textContent).not.toContain('Inspect workspace')
    expect(root.textContent).not.toContain('Tools')
    expect(root.textContent).not.toContain('Summarize workspace')
    expect(root.textContent).not.toContain('Teaches the agent')
    expect(root.textContent).not.toContain('Runtime skill')

    root.querySelector<HTMLButtonElement>('[data-testid="app-developer-toggle-runtime-demo"]')!.click()
    await flushUi()

    expect(root.querySelector('[data-testid="app-developer-details-runtime-demo"]')).toBeTruthy()
    expect(root.textContent).toContain('Jobs')
    expect(root.textContent).toContain('Inspect workspace')
    expect(root.textContent).toContain('Tools')
    expect(root.textContent).toContain('Summarize workspace')
    expect(root.textContent).toContain('Teaches the agent')
    expect(root.textContent).toContain('Runtime skill')
  })

  it('shows package version in developer details', async () => {
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!.click()
    await flushUi()
    root.querySelector<HTMLButtonElement>('[data-testid="app-developer-toggle-runtime-demo"]')!.click()
    await flushUi()

    const details = root.querySelector('[data-testid="app-developer-details-runtime-demo"]')!
    expect(details.textContent).toContain('Version')
    expect(details.textContent).toContain('2.3.0')
  })

  // ---- Diagnostics ----

  it('shows diagnostics in expanded detail', async () => {
    loaderDiagnostics = [
      { path: '/home/test/.mim/packages/runtime-demo/0.1.0/package.json', message: 'Invalid field "xyz"', packageId: 'runtime-demo' },
    ]
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!.click()
    await flushUi()

    expect(root.textContent).toContain('Needs attention')
    expect(root.textContent).toContain('Invalid field "xyz"')
  })

  it('merges loader and capability diagnostics', async () => {
    loaderDiagnostics = [
      { path: '/home/test/.mim/packages/runtime-demo/0.1.0/package.json', message: 'Loader warning', packageId: 'runtime-demo' },
    ]
    capabilityDiagnostics = ['Missing backend export']
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!.click()
    await flushUi()

    expect(root.textContent).toContain('Loader warning')
    expect(root.textContent).toContain('Missing backend export')
  })

  // ---- Open button ----

  it('emits openPackage when Open is clicked for an enabled app with views', async () => {
    const onOpenPackage = vi.fn()
    const pinia = createPinia()
    setActivePinia(pinia)
    app = createApp(AppsSettingsPanel, { onOpenPackage })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!.click()
    await flushUi()

    // The Open button is in the row actions (not inside expanded detail).
    const openBtn = root.querySelector<HTMLButtonElement>('[data-testid="app-open-runtime-demo"]')
    expect(openBtn).toBeTruthy()
    openBtn!.click()
    expect(onOpenPackage).toHaveBeenCalledWith('runtime-demo')
  })

  it('shows Documentation for apps with README metadata and emits openPackageDocs', async () => {
    const onOpenPackageDocs = vi.fn()
    const pinia = createPinia()
    setActivePinia(pinia)
    app = createApp(AppsSettingsPanel, { onOpenPackageDocs })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-slides"]')!.click()
    await flushUi()

    const docsBtn = root.querySelector<HTMLButtonElement>('[data-testid="app-docs-slides"]')
    expect(docsBtn).toBeTruthy()
    docsBtn!.click()
    expect(onOpenPackageDocs).toHaveBeenCalledWith('slides')

    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-runtime-demo"]')!.click()
    await flushUi()
    expect(root.querySelector('[data-testid="app-docs-runtime-demo"]')).toBeNull()
  })
})
