import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useResourcesStore, type ResourceView } from './resources.js'

function view(overrides: Partial<ResourceView> = {}): ResourceView {
  return {
    id: 'designs',
    name: 'Designs',
    source: { kind: 'local_folder', location: '/abs/designs' },
    write: 'readonly',
    origin: 'machine',
    status: 'ok',
    root: '/abs/designs',
    mountPath: '.mim/resources/designs',
    ...overrides,
  }
}

describe('resources store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  it('starts empty before any fetch', () => {
    vi.stubGlobal('window', { kernel: { call: vi.fn() } })
    const store = useResourcesStore()
    expect(store.collections).toEqual([])
  })

  it('refresh() loads collections from resources.collections', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'resources.collections') return { collections: [view()] }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const store = useResourcesStore()
    await store.refresh()
    expect(call).toHaveBeenCalledWith('resources.collections')
    expect(store.collections.map(c => c.id)).toEqual(['designs'])
  })

  it('addFolder() forwards path/name/write then refreshes', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'resources.add') return { collection: view() }
      if (tool === 'resources.collections') return { collections: [view()] }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const store = useResourcesStore()
    await store.addFolder({ path: '/abs/designs', name: 'Designs', write: 'direct' })
    expect(call).toHaveBeenCalledWith('resources.add', { path: '/abs/designs', name: 'Designs', write: 'direct' })
    expect(call).toHaveBeenCalledWith('resources.collections')
  })

  it('addGit() forwards the git url then refreshes', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'resources.add') return { collection: view({ source: { kind: 'git_repo', location: 'https://x/y.git' } }) }
      if (tool === 'resources.collections') return { collections: [] }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const store = useResourcesStore()
    await store.addGit({ git: 'https://x/y.git', name: 'Y' })
    expect(call).toHaveBeenCalledWith('resources.add', { git: 'https://x/y.git', name: 'Y' })
  })

  it('remove() forwards the id then refreshes', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'resources.remove') return { removed: 'designs' }
      if (tool === 'resources.collections') return { collections: [] }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const store = useResourcesStore()
    await store.remove('designs')
    expect(call).toHaveBeenCalledWith('resources.remove', { id: 'designs' })
    expect(store.collections).toEqual([])
  })

  it('sync(id) forwards the id; sync() omits it', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'resources.sync') return { results: [] }
      if (tool === 'resources.collections') return { collections: [] }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const store = useResourcesStore()
    await store.sync('designs')
    expect(call).toHaveBeenCalledWith('resources.sync', { id: 'designs' })
    await store.sync()
    expect(call).toHaveBeenCalledWith('resources.sync', {})
  })

  it('setPolicy() forwards id and write then refreshes', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'resources.setPolicy') return { collection: view({ write: 'direct' }) }
      if (tool === 'resources.collections') return { collections: [view({ write: 'direct' })] }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const store = useResourcesStore()
    await store.setPolicy('designs', 'direct')
    expect(call).toHaveBeenCalledWith('resources.setPolicy', { id: 'designs', write: 'direct' })
    expect(store.collections[0]?.write).toBe('direct')
  })

  it('surfaces kernel errors on the store instead of throwing', async () => {
    const call = vi.fn(async () => { throw new Error('boom') })
    vi.stubGlobal('window', { kernel: { call } })
    const store = useResourcesStore()
    await store.refresh()
    expect(store.error).toBe('boom')
    expect(store.collections).toEqual([])
  })

  it('pickFolder() returns the absolute path from the native dialog', async () => {
    const openFolderDialog = vi.fn(async () => '/picked/folder')
    vi.stubGlobal('window', { kernel: { call: vi.fn(), openFolderDialog } })
    const store = useResourcesStore()
    expect(await store.pickFolder()).toBe('/picked/folder')
  })
})
