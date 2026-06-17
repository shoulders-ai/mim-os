// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ResourcesSettingsPanel from './ResourcesSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

const FOLDER = {
  id: 'designs',
  name: 'Designs',
  source: { kind: 'local_folder', location: '/abs/designs' },
  write: 'readonly',
  origin: 'machine',
  status: 'ok',
  root: '/abs/designs',
  mountPath: '.mim/resources/designs',
}

const GIT = {
  id: 'brand',
  name: 'Brand',
  source: { kind: 'git_repo', location: 'https://x/brand.git' },
  write: 'readonly',
  origin: 'workspace',
  status: 'not-synced',
  root: '/cache/brand/repo',
  mountPath: '.mim/resources/brand',
}

describe('ResourcesSettingsPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>
  let openFolderDialog: ReturnType<typeof vi.fn>
  let collections: unknown[]

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    collections = [FOLDER, GIT]
    call = vi.fn(async (tool: string) => {
      if (tool === 'resources.collections') return { collections }
      if (tool === 'resources.add') return { collection: FOLDER }
      if (tool === 'resources.remove') return { removed: 'designs' }
      if (tool === 'resources.sync') return { results: [] }
      return {}
    })
    openFolderDialog = vi.fn(async () => '/picked/folder')
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, openFolderDialog, on: vi.fn(), off: vi.fn() },
    })
    app = null
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  function mountPanel() {
    const pinia = createPinia()
    setActivePinia(pinia)
    app = createApp(ResourcesSettingsPanel)
    app.use(pinia)
    app.mount(root)
  }

  it('lists collections with mount path and status', async () => {
    mountPanel()
    await flushUi()
    expect(call).toHaveBeenCalledWith('resources.collections')
    expect(root.textContent).toContain('Designs')
    expect(root.textContent).toContain('.mim/resources/designs')
    expect(root.textContent).toContain('Brand')
    expect(root.textContent).toContain('not-synced')
  })

  it('syncs a git collection', async () => {
    mountPanel()
    await flushUi()
    root.querySelector<HTMLButtonElement>('[data-testid="resource-sync-brand"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('resources.sync', { id: 'brand' })
  })

  it('removes a collection', async () => {
    mountPanel()
    await flushUi()
    root.querySelector<HTMLButtonElement>('[data-testid="resource-remove-designs"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('resources.remove', { id: 'designs' })
  })

  it('adds a folder in one step: picker resolves and the collection is mounted read-only', async () => {
    mountPanel()
    await flushUi()
    root.querySelector<HTMLButtonElement>('[data-testid="resource-pick-folder"]')?.click()
    await flushUi()
    expect(openFolderDialog).toHaveBeenCalled()
    // No confirm step: add fires straight from the picker with a derived name.
    expect(call).toHaveBeenCalledWith('resources.add', { path: '/picked/folder', name: 'folder' })
  })

  it('toggles a local collection write policy in place; git stays locked', async () => {
    mountPanel()
    await flushUi()
    root.querySelector<HTMLButtonElement>('[data-testid="resource-write-designs"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('resources.setPolicy', { id: 'designs', write: 'direct' })
    // Git collections are always readonly: no toggle rendered.
    expect(root.querySelector('[data-testid="resource-write-brand"]')).toBeNull()
  })

  it('binds a missing-binding collection via the picker, keeping its id', async () => {
    collections = [{
      id: 'templates',
      name: 'Templates',
      source: null,
      write: 'readonly',
      origin: 'workspace',
      status: 'missing-binding',
      root: null,
      mountPath: '.mim/resources/templates',
    }]
    mountPanel()
    await flushUi()
    root.querySelector<HTMLButtonElement>('[data-testid="resource-bind-templates"]')?.click()
    await flushUi()
    expect(openFolderDialog).toHaveBeenCalled()
    expect(call).toHaveBeenCalledWith('resources.add', { id: 'templates', path: '/picked/folder' })
  })

  it('adds a git repository', async () => {
    mountPanel()
    await flushUi()
    const input = root.querySelector<HTMLInputElement>('[data-testid="resource-git-url"]')!
    input.value = 'https://x/y.git'
    input.dispatchEvent(new Event('input'))
    await flushUi()
    root.querySelector<HTMLButtonElement>('[data-testid="resource-add-git"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('resources.add', expect.objectContaining({ git: 'https://x/y.git' }))
  })
})
