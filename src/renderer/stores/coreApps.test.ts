import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as coreAppsModule from './coreApps.js'
import { useAppsStore, type ResolvedApp } from './coreApps.js'

// AppStatus shape matches src/main/tools/coreApps.ts — the resolved state
// returned by app.status as { apps: AppStatus[] }.
function makeApp(overrides: Partial<ResolvedApp> = {}): ResolvedApp {
  return {
    id: 'test-pkg',
    enabled: false,
    layer: 'default',
    installed: true,
    source: 'global',
    shadowed: false,
    needsTrust: false,
    needsInstall: false,
    visible: false,
    folderPresent: false,
    ...overrides,
  }
}

function stubKernel(apps: ResolvedApp[] = []) {
  const call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
    if (tool === 'app.status') return { apps }
    if (tool === 'app.enable') return { ok: true, id: params?.id }
    if (tool === 'app.disable') return { ok: true, id: params?.id }
    if (tool === 'app.trust') return { ok: true, id: params?.id }
    throw new Error(`Unexpected tool: ${tool}`)
  })
  vi.stubGlobal('window', { kernel: { call, on: vi.fn(), off: vi.fn() } })
  return call
}

describe('apps store (resolved state)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  it('starts empty before any fetch', () => {
    stubKernel()
    const store = useAppsStore()
    expect(store.apps).toEqual({})
    expect(store.isEnabled('board')).toBe(false)
    expect(store.isVisible('board')).toBe(false)
  })

  it('refreshes from app.status and populates per-id resolved state', async () => {
    const call = stubKernel([
      makeApp({ id: 'board', enabled: true, layer: 'workspace', source: 'global', visible: true, folderPresent: true }),
      makeApp({ id: 'knowledge', enabled: false, layer: 'default', source: 'global' }),
      makeApp({ id: 'hello', enabled: true, layer: 'default', source: 'global', visible: true }),
    ])
    const store = useAppsStore()
    await store.refresh()

    expect(call).toHaveBeenCalledWith('app.status')
    expect(store.isEnabled('board')).toBe(true)
    expect(store.isEnabled('knowledge')).toBe(false)
    expect(store.isEnabled('hello')).toBe(true)
    expect(store.apps['board']?.layer).toBe('workspace')
    expect(store.apps['board']?.folderPresent).toBe(true)
    expect(store.apps['board']?.source).toBe('global')
  })

  it('isVisible returns the resolved visible flag', async () => {
    stubKernel([
      makeApp({ id: 'board', enabled: true, visible: true }),
      makeApp({ id: 'knowledge', enabled: false, visible: false }),
    ])
    const store = useAppsStore()
    await store.refresh()

    expect(store.isVisible('board')).toBe(true)
    expect(store.isVisible('knowledge')).toBe(false)
    // Unknown packages are not visible
    expect(store.isVisible('unknown')).toBe(false)
  })

  it('exposes needsTrust and needsInstall from resolved state', async () => {
    stubKernel([
      makeApp({ id: 'vendor-pkg', needsTrust: true, installed: true }),
      makeApp({ id: 'missing-pkg', needsInstall: true, installed: false }),
    ])
    const store = useAppsStore()
    await store.refresh()

    expect(store.apps['vendor-pkg']?.needsTrust).toBe(true)
    expect(store.apps['missing-pkg']?.needsInstall).toBe(true)
  })

  it('exposes shadowed flag from resolved state', async () => {
    stubKernel([
      makeApp({ id: 'my-pkg', shadowed: true }),
    ])
    const store = useAppsStore()
    await store.refresh()

    expect(store.apps['my-pkg']?.shadowed).toBe(true)
  })

  it('enable() calls app.enable with id + layer and refreshes', async () => {
    let enabled = false
    const call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'app.status') {
        return { apps: [makeApp({ id: 'board', enabled, visible: enabled })] }
      }
      if (tool === 'app.enable') { enabled = true; return { ok: true, id: params?.id } }
      if (tool === 'app.disable') { enabled = false; return { ok: true, id: params?.id } }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call, on: vi.fn(), off: vi.fn() } })

    const store = useAppsStore()
    await store.setEnabled('board', true)

    expect(call).toHaveBeenCalledWith('app.enable', { id: 'board' })
    expect(store.isEnabled('board')).toBe(true)

    await store.setEnabled('board', false)
    expect(call).toHaveBeenCalledWith('app.disable', { id: 'board' })
    expect(store.isEnabled('board')).toBe(false)
  })

  it('trust() calls app.trust with id as user actor (default) and refreshes', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'app.status') {
        return { apps: [makeApp({ id: 'vendor-pkg', needsTrust: false, enabled: true, visible: true })] }
      }
      if (tool === 'app.trust') return { ok: true }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call, on: vi.fn(), off: vi.fn() } })

    const store = useAppsStore()
    await store.trust('vendor-pkg')

    // app.trust is called without an explicit actor option — the renderer
    // IPC bridge defaults to 'user', which is the only actor the gate allows.
    expect(call).toHaveBeenCalledWith('app.trust', { id: 'vendor-pkg' })
    // After trust, refresh should reflect the updated state
    expect(store.apps['vendor-pkg']?.needsTrust).toBe(false)
  })

  it('survives kernel failure on refresh gracefully', async () => {
    const call = vi.fn(async () => { throw new Error('no workspace') })
    vi.stubGlobal('window', { kernel: { call, on: vi.fn(), off: vi.fn() } })

    const store = useAppsStore()
    await store.refresh()

    // State stays empty — no crash
    expect(store.apps).toEqual({})
  })

  it('disabled apps are hidden from launcher visibility', async () => {
    stubKernel([
      makeApp({ id: 'board', enabled: false, visible: false }),
      makeApp({ id: 'hello', enabled: true, visible: true }),
    ])
    const store = useAppsStore()
    await store.refresh()

    // The store's isVisible reflects the resolved visible flag.
    // Disabled packages are not visible in launchers.
    expect(store.isVisible('board')).toBe(false)
    expect(store.isVisible('hello')).toBe(true)
  })

  it('PACKAGE_APP_MAP is no longer exported', () => {
    // The hardcoded package-to-app mapping is deleted; all state comes from
    // resolved app.status. Verify the module does not export it.
    const mod = coreAppsModule as Record<string, unknown>
    expect(mod.PACKAGE_APP_MAP).toBeUndefined()
  })
})
