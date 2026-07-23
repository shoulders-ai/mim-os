// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ShellSidebar from './ShellSidebar.vue'
import { useAppsStore } from '../../stores/coreApps.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

const PACKAGES = [
  {
    manifest: { id: 'board', name: 'Board', icon: 'B', views: [{ id: 'main', label: 'Board', src: './ui/index.html', role: 'work' }] },
    dir: '/home/test/.mim/packages/board/0.1.0',
    source: 'mim',
  },
  {
    manifest: { id: 'knowledge', name: 'Knowledge', icon: 'K', views: [{ id: 'main', label: 'Knowledge', src: './ui/index.html', role: 'work' }] },
    dir: '/home/test/.mim/packages/knowledge/0.1.0',
    source: 'mim',
  },
  {
    manifest: { id: 'docx-review', name: 'DOCX Review', icon: 'D', views: [{ id: 'main', label: 'DOCX Review', src: './ui/index.html', role: 'work' }] },
    dir: '/home/test/.mim/packages/docx-review/0.1.0',
    source: 'mim',
  },
  {
    manifest: { id: 'runtime-demo', name: 'Runtime Demo', icon: 'R', views: [{ id: 'main', label: 'Runtime', src: './ui/index.html', role: 'work' }] },
    dir: '/home/test/.mim/packages/runtime-demo/0.1.0',
    source: 'mim',
  },
]

function stubKernel(apps: Array<{ id: string; enabled: boolean; layer?: string; source?: string; shadowed?: boolean; needsTrust?: boolean; folderPresent?: boolean }>) {
  const fullApps = apps.map(a => ({
    id: a.id,
    enabled: a.enabled,
    layer: a.layer ?? 'default',
    source: a.source ?? 'mim',
    shadowed: a.shadowed ?? false,
    needsTrust: a.needsTrust ?? false,
    folderPresent: a.folderPresent ?? false,
  }))
  const call = vi.fn(async (tool: string) => {
    if (tool === 'app.status') return { apps: fullApps }
    if (tool === 'session.list') return { sessions: [] }
    return {}
  })
  Object.defineProperty(window, 'kernel', {
    configurable: true,
    value: { call, on: vi.fn(), off: vi.fn() },
  })
  return call
}

function mountSidebar(root: HTMLElement, pinia: ReturnType<typeof createPinia>, extraProps: Record<string, unknown> = {}) {
  const app = createApp(ShellSidebar, {
    width: 220,
    packages: PACKAGES,
    activeWorkId: '',
    workspaceName: 'Workspace',
    recentWorkspaces: [],
    port: 43211,
    ...extraProps,
  })
  app.use(pinia)
  app.mount(root)
  return app
}

function visiblePackageIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('button[data-package-id]')]
    .map(el => el.dataset.packageId || '')
    .filter(Boolean)
}

describe('ShellSidebar core-app visibility', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    pinia = createPinia()
    setActivePinia(pinia)
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.restoreAllMocks()
  })

  it('hides the Board launch row when board is disabled', async () => {
    stubKernel([
      { id: 'board', enabled: false, folderPresent: true },
      { id: 'knowledge', enabled: true, folderPresent: true },
      { id: 'docx-review', enabled: true },
    ])
    app = mountSidebar(root, pinia)
    await useAppsStore().refresh()
    await flushUi()

    const ids = visiblePackageIds(root)
    expect(ids).not.toContain('board')
    expect(ids).toContain('knowledge')
    // Non-core user app is always visible.
    expect(ids).toContain('docx-review')
    // Demo apps stay out of the normal Navigator.
    expect(ids).not.toContain('runtime-demo')
  })

  it('shows the Board launch row when board is enabled', async () => {
    stubKernel([
      { id: 'board', enabled: true },
      { id: 'knowledge', enabled: false },
      { id: 'docx-review', enabled: true },
    ])
    app = mountSidebar(root, pinia)
    await useAppsStore().refresh()
    await flushUi()

    const ids = visiblePackageIds(root)
    expect(ids).toContain('board')
    expect(ids).not.toContain('knowledge')
    expect(ids).toContain('docx-review')
    expect(ids).not.toContain('runtime-demo')
  })

  it('hides both core apps and a disabled Board is not launchable', async () => {
    stubKernel([
      { id: 'board', enabled: false },
      { id: 'knowledge', enabled: false },
      { id: 'docx-review', enabled: true },
    ])
    const onSelectWork = vi.fn()
    app = mountSidebar(root, pinia, { onSelectWork })
    await useAppsStore().refresh()
    await flushUi()

    const ids = visiblePackageIds(root)
    expect(ids).not.toContain('board')
    expect(ids).not.toContain('knowledge')
    // There is no Board row to click, so it cannot be launched.
    expect(onSelectWork).not.toHaveBeenCalledWith('board')
  })
})
