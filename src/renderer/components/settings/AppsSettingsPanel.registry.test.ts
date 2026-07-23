// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AppsSettingsPanel from './AppsSettingsPanel.vue'

async function settle() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('Apps & agents direct sources', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    call = vi.fn(async (tool: string) => {
      if (tool === 'package.list') return {
        packages: [
          { id: 'built-in', name: 'Built in', enabled: false, source: 'mim', views: [], permissions: {} },
          { id: 'shared', name: 'Shared', enabled: false, source: 'team', views: [], permissions: {} },
          { id: 'local', name: 'Local', enabled: false, source: 'project', views: [], permissions: {} },
        ],
        diagnostics: [],
      }
      if (tool === 'app.status') return {
        apps: ['built-in', 'shared', 'local'].map(id => ({
          id,
          enabled: false,
          layer: 'default',
          installed: true,
          installedVersions: ['1.0.0'],
          source: id === 'built-in' ? 'mim' : id === 'shared' ? 'team' : 'project',
          shadowed: false,
          needsTrust: false,
          needsInstall: false,
          folderPresent: false,
        })),
      }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'app.templateList') return { templates: [] }
      if (tool === 'team.status') return { team: { name: 'Shoulders' } }
      if (tool === 'agent.list') return { agents: [] }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call,
        on: vi.fn(),
        off: vi.fn(),
        getWorkspace: vi.fn(async () => '/work/Acme Proposal'),
      },
    })
    setActivePinia(createPinia())
    app = createApp(AppsSettingsPanel)
    app.use(createPinia())
    app.mount(root)
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('labels direct origins with the Project, actual Team, and Mim', async () => {
    await settle()
    expect(root.querySelector('[data-testid="app-origin-built-in"]')?.textContent).toBe('Mim')
    expect(root.querySelector('[data-testid="app-origin-shared"]')?.textContent).toBe('Shoulders')
    expect(root.querySelector('[data-testid="app-origin-local"]')?.textContent).toBe('Acme Proposal')
  })

  it('does not call registry or account tools', async () => {
    await settle()
    expect(call.mock.calls.some(([tool]) => String(tool).startsWith('registry.'))).toBe(false)
    expect(call.mock.calls.some(([tool]) => String(tool).startsWith('account.'))).toBe(false)
  })
})
