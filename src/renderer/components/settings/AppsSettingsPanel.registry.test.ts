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

function makeRegistryEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'github-monitor',
    name: 'GitHub Monitor',
    description: 'Org-wide issues/PRs/activity monitoring',
    repo: 'https://github.com/shoulders-ai/mim-github-monitor',
    version: '1.2.0',
    ref: 'v1.2.0',
    commit: 'a'.repeat(40),
    permissions: { http: ['api.github.com'], secrets: ['github_token'] },
    engines: { mim: 'runtime-v1' },
    installedVersions: [],
    enabledHere: false,
    permissionMismatch: false,
    registryId: 'default',
    ...overrides,
  }
}

function makeRegistry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'default',
    kind: 'git',
    location: 'https://github.com/shoulders-ai/mim-registry',
    origin: 'default',
    status: 'ok',
    diagnostics: [],
    ...overrides,
  }
}

describe('AppsSettingsPanel registry UI', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let call: ReturnType<typeof vi.fn>
  let appsState: Array<Record<string, unknown>>
  let registryEntries: Array<Record<string, unknown>>
  let registrySources: Array<Record<string, unknown>>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())

    appsState = [
      { id: 'board', enabled: true, layer: 'default', installed: true, installedVersions: ['1.0.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
    ]
    registryEntries = []
    registrySources = [makeRegistry()]

    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.enable') return { ok: true, id: params?.id }
      if (tool === 'app.disable') return { ok: true, id: params?.id }
      if (tool === 'app.trust') return { ok: true, id: params?.id }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') return { packages: [{ id: 'board', name: 'Board', enabled: true, source: 'global', views: [] }], diagnostics: [] }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: registrySources, entries: registryEntries }
      if (tool === 'registry.trust') return { ok: true }
      if (tool === 'package.install') return { installed: params?.id ?? 'pkg', version: params?.version ?? '1.0.0', dir: '/install' }
      if (tool === 'package.update') return { installed: params?.id ?? 'pkg', version: '2.0.0', dir: '/install' }
      if (tool === 'app.add') return { added: params?.id, version: params?.version }
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

  // ---- Browse section shows registry entries ----

  it('renders registry entries in the Browse section', async () => {
    registryEntries = [
      makeRegistryEntry(),
      makeRegistryEntry({
        id: 'docx-review',
        name: 'DOCX Review',
        description: 'Review Word documents',
        version: '0.3.0',
        permissions: {},
        installedVersions: ['0.2.0'],
        enabledHere: true,
      }),
    ]
    mount()
    await flushUi()

    expect(root.textContent).toContain('GitHub Monitor')
    expect(root.textContent).toContain('Org-wide issues/PRs/activity monitoring')
  })

  it('shows Add button for registry entries not in this workspace', async () => {
    registryEntries = [makeRegistryEntry({ installedVersions: [] })]
    mount()
    await flushUi()

    const addBtn = root.querySelector<HTMLButtonElement>('[data-testid="registry-add-github-monitor"]')
    expect(addBtn).toBeTruthy()
    expect(addBtn!.textContent).toContain('Add')
  })

  it('shows a plain-language permission confirm before adding', async () => {
    registryEntries = [makeRegistryEntry({ installedVersions: [] })]
    mount()
    await flushUi()

    // Access details are not dumped into the list view.
    expect(root.textContent).not.toContain('api.github.com')

    root.querySelector<HTMLButtonElement>('[data-testid="registry-add-github-monitor"]')!.click()
    await flushUi()

    const card = document.body.querySelector('[data-testid="registry-add-card-github-monitor"]')
    expect(card).toBeTruthy()
    expect(card!.textContent).toContain('GitHub Monitor can:')
    expect(card!.textContent).toContain('Connect to api.github.com')
    expect(card!.textContent).toContain('Use your github_token secret from the system keychain')
    expect(call).not.toHaveBeenCalledWith('app.add', expect.anything())
  })

  it('calls app.add once the permission confirm is accepted', async () => {
    registryEntries = [makeRegistryEntry({ installedVersions: [] })]
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="registry-add-github-monitor"]')!.click()
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="registry-add-confirm-github-monitor"]')!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('app.add', { id: 'github-monitor', version: '1.2.0' })
  })

  it('shows Update button for registry entries with a newer version', async () => {
    registryEntries = [makeRegistryEntry({ version: '1.2.0', installedVersions: ['1.0.0'] })]
    mount()
    await flushUi()

    const updateBtn = root.querySelector<HTMLButtonElement>('[data-testid="registry-update-github-monitor"]')
    expect(updateBtn).toBeTruthy()
    expect(updateBtn!.textContent).toContain('Update')
  })

  it('calls package.update when Update button is clicked', async () => {
    registryEntries = [makeRegistryEntry({ version: '1.2.0', installedVersions: ['1.0.0'] })]
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="registry-update-github-monitor"]')!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('package.update', { id: 'github-monitor' })
  })

  it('shows In workspace label when the app is added at the current version', async () => {
    registryEntries = [makeRegistryEntry({ version: '1.2.0', installedVersions: ['1.2.0'], enabledHere: true })]
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="registry-add-github-monitor"]')).toBeNull()
    expect(root.querySelector('[data-testid="registry-update-github-monitor"]')).toBeNull()
    expect(root.querySelector('[data-testid="registry-added-github-monitor"]')?.textContent).toContain('In workspace')
  })

  it('still offers Add when installed elsewhere but not in this workspace', async () => {
    registryEntries = [makeRegistryEntry({ version: '1.2.0', installedVersions: ['1.2.0'], enabledHere: false })]
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="registry-add-github-monitor"]')).toBeTruthy()
  })

  it('shows error state when adding fails', async () => {
    registryEntries = [makeRegistryEntry({ installedVersions: [] })]
    call.mockImplementation(async (tool: string) => {
      if (tool === 'app.status') return { apps: appsState }
      if (tool === 'app.updates') return { updates: [] }
      if (tool === 'package.list') return { packages: [{ id: 'board', name: 'Board', enabled: true, source: 'global', views: [] }], diagnostics: [] }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'package.jobs.list') return { runs: [] }
      if (tool === 'registry.list') return { registries: registrySources, entries: registryEntries }
      if (tool === 'app.add') throw new Error('Commit mismatch')
      return {}
    })
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="registry-add-github-monitor"]')!.click()
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="registry-add-confirm-github-monitor"]')!.click()
    await flushUi()

    expect(root.textContent).toContain('Commit mismatch')
  })

  // ---- Multi-registry: trust card ----

  it('renders a trust card for needs-trust registries and calls registry.trust on click', async () => {
    registrySources = [
      makeRegistry(),
      makeRegistry({ id: 'acme', kind: 'git', location: 'https://github.com/acme/mim-registry', name: 'Acme Apps', origin: 'workspace', status: 'needs-trust' }),
    ]
    registryEntries = [makeRegistryEntry()]
    mount()
    await flushUi()

    const trustCard = root.querySelector('[data-testid="registry-trust-acme"]')
    expect(trustCard).toBeTruthy()
    expect(trustCard!.textContent).toContain('Acme Apps')
    expect(trustCard!.textContent).toContain('This workspace uses this registry')

    const trustBtn = trustCard!.querySelector<HTMLButtonElement>('button')!
    trustBtn.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('registry.trust', { id: 'acme' })
    const registryListCalls = call.mock.calls.filter((c: unknown[]) => c[0] === 'registry.list')
    expect(registryListCalls.length).toBeGreaterThanOrEqual(2)
  })

  // ---- Multi-registry: stale note ----

  it('renders a stale note for registries with status stale', async () => {
    registrySources = [makeRegistry({ id: 'default', status: 'stale', error: 'network timeout', name: 'Default' })]
    registryEntries = [makeRegistryEntry()]
    mount()
    await flushUi()

    const staleNote = root.querySelector('[data-testid="registry-stale-default"]')
    expect(staleNote).toBeTruthy()
    expect(staleNote!.textContent).toContain('showing cached')
    expect(staleNote!.textContent).toContain('network timeout')
  })

  // ---- Multi-registry: error status ----

  it('renders an error row for registries with status error', async () => {
    registrySources = [
      makeRegistry(),
      makeRegistry({ id: 'broken', status: 'error', error: 'clone failed', name: 'Broken' }),
    ]
    registryEntries = [makeRegistryEntry()]
    mount()
    await flushUi()

    const errorRow = root.querySelector('[data-testid="registry-error-broken"]')
    expect(errorRow).toBeTruthy()
    expect(errorRow!.textContent).toContain('clone failed')
  })

  // ---- Shadowed entries hidden ----

  it('hides shadowed registry entries from Browse', async () => {
    registrySources = [
      makeRegistry(),
      makeRegistry({ id: 'acme', kind: 'git', location: 'https://github.com/acme/registry', origin: 'workspace', status: 'ok' }),
    ]
    registryEntries = [
      makeRegistryEntry({ registryId: 'acme' }),
      makeRegistryEntry({ id: 'github-monitor', name: 'GitHub Monitor (default)', registryId: 'default', shadowed: true, shadowedBy: 'acme' }),
    ]
    mount()
    await flushUi()

    expect(root.textContent).toContain('GitHub Monitor')
    expect(root.textContent).not.toContain('GitHub Monitor (default)')
  })

  // ---- Source tags ----

  it('shows source tag per entry when more than one registry is configured', async () => {
    registrySources = [
      makeRegistry(),
      makeRegistry({ id: 'acme', kind: 'git', location: 'https://github.com/acme/registry', name: 'Acme Apps', origin: 'workspace', status: 'ok' }),
    ]
    registryEntries = [
      makeRegistryEntry({ registryId: 'default' }),
      makeRegistryEntry({ id: 'docx-review', name: 'DOCX Review', registryId: 'acme' }),
    ]
    mount()
    await flushUi()

    const defaultTag = root.querySelector('[data-testid="registry-source-tag-github-monitor"]')
    expect(defaultTag).toBeTruthy()
    expect(defaultTag!.textContent).toContain('default')

    const acmeTag = root.querySelector('[data-testid="registry-source-tag-docx-review"]')
    expect(acmeTag).toBeTruthy()
    expect(acmeTag!.textContent).toContain('Acme Apps')
  })

  it('does NOT show source tag when only one registry exists', async () => {
    registrySources = [makeRegistry()]
    registryEntries = [makeRegistryEntry()]
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="registry-source-tag-github-monitor"]')).toBeNull()
  })
})
