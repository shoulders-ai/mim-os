// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AppsSettingsPanel from './AppsSettingsPanel.vue'
import { useAppsStore } from '../../stores/coreApps.js'
import { useToastStore } from '../../stores/toasts.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('AppsSettingsPanel smoke — remove, updates, included apps', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let call: ReturnType<typeof vi.fn>
  let appsState: Array<Record<string, unknown>>
  let updatesData: Array<Record<string, unknown>>
  let createdPackages: Array<Record<string, unknown>>
  let revealInFinder: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())

    appsState = [
      { id: 'board', enabled: true, layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
      { id: 'slides', enabled: true, layer: 'workspace', installed: true, installedVersions: ['1.0.0'], source: 'workspace', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
    ]
    updatesData = []
    createdPackages = []
    revealInFinder = vi.fn(async () => undefined)

    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.templateList') {
        return {
          templates: [
            { id: 'word-count', label: 'Word Count', summary: 'Headless named tool.', defaultId: 'word-count', defaultName: 'Word Count' },
            { id: 'summarize', label: 'Summarize', summary: 'AI job UI.', defaultId: 'summarize', defaultName: 'Summarize' },
          ],
        }
      }
      if (tool === 'app.templateContent') {
        return {
          id: params?.id,
          name: params?.name,
          description: 'Count words from chat.',
          backend: 'export const tools = {}',
          skills: [{ name: params?.id, content: '---\nname: word-count\n---\n' }],
          readme: '# Word Count\n',
        }
      }
      if (tool === 'package.create') {
        createdPackages.push({
          id: params?.id,
          name: params?.name,
          enabled: true,
          source: 'workspace',
          views: [],
          permissions: {},
        })
        appsState.push({ id: params?.id, enabled: true, layer: 'workspace', installed: true, installedVersions: ['0.1.0'], source: 'workspace', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: true })
        return { created: params?.id, path: `/workspace/packages/${params?.id}` }
      }
      if (tool === 'package.validate') return { id: params?.id, valid: true, errors: [], warnings: [] }
      if (tool === 'package.reload') return { reloaded: params?.id, packages: [] }
      if (tool === 'app.enable') return { ok: true, id: params?.id }
      if (tool === 'app.disable') return { ok: true, id: params?.id }
      if (tool === 'app.trust') return { ok: true }
      if (tool === 'app.remove') return { ok: true, id: params?.id }
      if (tool === 'app.updates') return { updates: updatesData }
      if (tool === 'package.list') {
        return {
          packages: [
            { id: 'board', name: 'Board', enabled: true, source: 'global', views: [], permissions: {} },
            { id: 'slides', name: 'Slides', enabled: true, source: 'workspace', views: [{ id: 'main', label: 'Slides', src: './ui/index.html', role: 'work' }], permissions: { workspace: { read: true } } },
            ...createdPackages,
          ],
          diagnostics: [],
        }
      }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: [], entries: [] }
      if (tool === 'package.update') return { installed: params?.id, version: '2.0.0' }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, revealInFinder, on: vi.fn(), off: vi.fn(), clearTimeout: vi.fn() },
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

  // ---- Remove ----

  it('Remove confirm calls app.remove and refreshes', async () => {
    mount()
    await flushUi()

    const row = root.querySelector<HTMLButtonElement>('[data-testid="apps-row-slides"]')!
    if (row.getAttribute('aria-expanded') !== 'true') {
      row.click()
      await flushUi()
    }

    // Click "Remove from workspace" to get the confirm.
    const removeBtn = root.querySelector<HTMLButtonElement>('[data-testid="app-remove-slides"]')
    expect(removeBtn).toBeTruthy()
    removeBtn!.click()
    await flushUi()

    // Confirm removal.
    const confirmBtn = root.querySelector<HTMLButtonElement>('[data-testid="app-remove-confirm-slides"]')
    expect(confirmBtn).toBeTruthy()
    expect(root.textContent).toContain('Remove Slides from this workspace?')
    confirmBtn!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('app.remove', { id: 'slides' })
    // app.status is called again after remove (refresh).
    const statusCalls = call.mock.calls.filter((c: unknown[]) => c[0] === 'app.status')
    expect(statusCalls.length).toBeGreaterThanOrEqual(2)
  })

  // ---- Included apps ----

  it('renders current built-in rows with remove-from-sidebar action', async () => {
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="apps-row-board"]')).toBeTruthy()
    root.querySelector<HTMLButtonElement>('[data-testid="apps-row-board"]')!.click()
    await flushUi()

    expect(root.querySelector('[data-testid="app-remove-sidebar-board"]')).toBeTruthy()
    expect(root.textContent).not.toContain('Built in')
  })

  // ---- Update chip ----

  it('renders update chip from store updates', async () => {
    updatesData = [
      { id: 'slides', installed: '1.0.0', latest: '2.0.0', registryId: 'default' },
    ]
    mount()
    await flushUi()

    const updateChip = root.querySelector('[data-testid="app-update-slides"]')
    expect(updateChip).toBeTruthy()
    expect(updateChip!.textContent).toContain('Update available')
  })

  it('does not render update chip when no updates exist', async () => {
    updatesData = []
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="app-update-slides"]')).toBeNull()
    expect(root.querySelector('[data-testid="app-update-board"]')).toBeNull()
  })

  it('creates a starter app, validates it, then reloads packages', async () => {
    mount()
    await flushUi()

    const openButton = root.querySelector<HTMLButtonElement>('[data-testid="app-new-template-open"]')
    expect(openButton).toBeTruthy()
    openButton!.click()
    await flushUi()

    expect(document.body.querySelector<HTMLInputElement>('[data-testid="app-new-id"]')?.value).toBe('word-count')
    expect(document.body.querySelector<HTMLInputElement>('[data-testid="app-new-name"]')?.value).toBe('Word Count')

    document.body.querySelector<HTMLButtonElement>('[data-testid="app-template-create"]')!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('app.templateContent', {
      templateId: 'word-count',
      id: 'word-count',
      name: 'Word Count',
    })
    expect(call).toHaveBeenCalledWith('package.create', expect.objectContaining({
      id: 'word-count',
      name: 'Word Count',
      backend: expect.stringContaining('tools'),
    }))
    expect(call).toHaveBeenCalledWith('package.validate', { id: 'word-count' })
    expect(call).toHaveBeenCalledWith('package.reload', { id: 'word-count' })
    expect(revealInFinder).toHaveBeenCalledWith('/workspace/packages/word-count')
    const tools = call.mock.calls.map(callArgs => callArgs[0])
    expect(tools.indexOf('package.validate')).toBeLessThan(tools.indexOf('package.reload'))
    const toasts = useToastStore()
    expect(toasts.list.at(-1)).toMatchObject({
      kind: 'info',
      message: 'App created, showing folder contents',
    })
    expect(root.querySelector('[data-testid="apps-row-word-count"]')).toBeTruthy()
  })

  // ---- Store remove() ----

  it('store.remove() calls app.remove and refreshes', async () => {
    mount()
    await flushUi()

    const store = useAppsStore()
    await store.remove('slides')

    expect(call).toHaveBeenCalledWith('app.remove', { id: 'slides' })
    // Refresh was called after remove.
    const statusCalls = call.mock.calls.filter((c: unknown[]) => c[0] === 'app.status')
    expect(statusCalls.length).toBeGreaterThanOrEqual(2)
  })

  // ---- Store updates ----

  it('store.fetchUpdates populates updates and updateCount', async () => {
    updatesData = [
      { id: 'slides', installed: '1.0.0', latest: '2.0.0', registryId: 'default' },
    ]
    mount()
    await flushUi()

    const store = useAppsStore()
    await store.fetchUpdates()

    expect(store.updates['slides']).toEqual({ installed: '1.0.0', latest: '2.0.0', registryId: 'default' })
    expect(store.updateCount).toBe(1)
  })

  it('store.setUpdates replaces the updates map', async () => {
    mount()
    await flushUi()

    const store = useAppsStore()
    store.setUpdates({
      'board': { installed: '1.0.0', latest: '1.1.0', registryId: 'default' },
    })

    expect(store.updates['board']).toBeTruthy()
    expect(store.updateCount).toBe(1)
  })
})
