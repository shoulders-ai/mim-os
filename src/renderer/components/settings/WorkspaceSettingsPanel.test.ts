// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import WorkspaceSettingsPanel from './WorkspaceSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function button(root: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find(item => item.textContent?.trim() === label) as HTMLButtonElement | undefined
}

describe('WorkspaceSettingsPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>
  let on: ReturnType<typeof vi.fn>
  let off: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    call = vi.fn(async (tool: string) => {
      if (tool === 'workspace.sharedWorkspace.status') {
        return {
          configured: true,
          id: 'team-server',
          name: 'HTA Model',
          url: 'https://mim.example.com/mcp',
          namespaces: ['issues.*', 'knowledge.*'],
          tokenConfigured: true,
          tokenKey: 'MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN',
        }
      }
      if (tool === 'resources.collections') return { collections: [] }
      if (tool === 'history.stats') return { bytes: 0, blobBytes: 0, fileCount: 0, versionCount: 0 }
      if (tool === 'sync.status') {
        return { mode: 'manual', state: 'manual', git: false, remote: null, dirty: false, ahead: false, behind: false, conflicts: [], message: 'Manual' }
      }
      return {}
    })
    on = vi.fn()
    off = vi.fn()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on, off, getWorkspace: vi.fn(async () => '/workspace') },
    })
    app = null
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  function mount() {
    app = createApp(WorkspaceSettingsPanel)
    app.mount(root)
  }

  it('shows shared workspace mount status without exposing the bearer token', async () => {
    mount()
    await flushUi()

    expect(call).toHaveBeenCalledWith('workspace.sharedWorkspace.status')
    expect(root.textContent).toContain('Shared workspace')
    expect(root.textContent).toContain('Connected')
    expect(root.textContent).toContain('HTA Model')
    expect(root.textContent).toContain('mim.example.com')
    expect(root.textContent).toContain('Issues and Knowledge')
    expect(root.textContent).not.toContain('https://mim.example.com/mcp')
    expect(root.textContent).not.toContain('MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN')
    expect(root.textContent).not.toContain('tok_')
    expect(on).toHaveBeenCalledWith('workspace:changed', expect.any(Function))
  })

  it('lets a local user review and join from a shared workspace invite', async () => {
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'workspace.sharedWorkspace.status') return { configured: false }
      if (tool === 'workspace.sharedWorkspace.inspectInvite') {
        expect(params).toEqual({ invite: 'mim-invite-demo' })
        return {
          workspaceId: 'team-server',
          workspaceName: 'HTA Model',
          callerName: 'Anna',
          host: 'mim.example.com',
          namespaces: ['issues.*', 'knowledge.*'],
        }
      }
      if (tool === 'workspace.sharedWorkspace.join') {
        expect(params).toEqual({ invite: 'mim-invite-demo' })
        return {
          joined: true,
          callerName: 'Anna',
          tokenStored: true,
          sharedWorkspace: {
            id: 'team-server',
            name: 'HTA Model',
            url: 'https://mim.example.com/mcp',
            namespaces: ['issues.*', 'knowledge.*'],
          },
        }
      }
      if (tool === 'resources.collections') return { collections: [] }
      if (tool === 'history.stats') return { bytes: 0, blobBytes: 0, fileCount: 0, versionCount: 0 }
      if (tool === 'sync.status') return { mode: 'manual', state: 'manual', git: false, remote: null, dirty: false, ahead: false, behind: false, conflicts: [], message: 'Manual' }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on, off, getWorkspace: vi.fn(async () => '/workspace') },
    })
    mount()
    await flushUi()

    expect(root.textContent).toContain('Local only')
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'mim-invite-demo'
    textarea.dispatchEvent(new Event('input'))
    await flushUi()

    button(root, 'Review invite')!.click()
    await flushUi()
    expect(root.textContent).toContain('Files stay on this machine. Issues and Knowledge come from HTA Model.')

    button(root, 'Join')!.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('workspace.sharedWorkspace.join', { invite: 'mim-invite-demo' })
    expect(root.textContent).not.toContain('mim_serve')
  })
})
