import { describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceActions,
  workspaceDisplayName,
  type WorkspaceActionsDeps,
} from './workspaceActions.js'

function makeDeps(overrides: Partial<WorkspaceActionsDeps> = {}) {
  let workspacePath: string | null = '/work/Alpha'
  let status: { initialized: boolean; missing: string[] } | null = null
  let authoritativeName: string | null = null
  const deps: WorkspaceActionsDeps = {
    workspacePath: vi.fn(() => workspacePath),
    setWorkspaceStatus: vi.fn(next => { status = next }),
    setWorkspaceAuthoritativeName: vi.fn(next => { authoritativeName = next }),
    callKernel: vi.fn(async (tool: string) => {
      if (tool === 'workspace.status') return { initialized: true, missing: [] }
      if (tool === 'workspace.info') return { name: 'Alpha Project' }
      return undefined
    }),
    openWorkspaceDialog: vi.fn(async () => '/work/Beta'),
    openWorkspacePathInKernel: vi.fn(async path => path),
    addRecentWorkspace: vi.fn(),
    ...overrides,
  }
  return {
    deps,
    setWorkspacePath: (path: string | null) => { workspacePath = path },
    getStatus: () => status,
    getAuthoritativeName: () => authoritativeName,
  }
}

describe('app shell workspace actions', () => {
  it('uses authoritative workspace name before the path basename', () => {
    expect(workspaceDisplayName({ authoritativeName: 'Project', path: '/tmp/fallback' })).toBe('Project')
    expect(workspaceDisplayName({ authoritativeName: null, path: '/tmp/fallback' })).toBe('fallback')
    expect(workspaceDisplayName({ authoritativeName: null, path: null })).toBeNull()
  })

  it('clears status and authoritative name when no workspace is open', async () => {
    const { deps, setWorkspacePath, getStatus, getAuthoritativeName } = makeDeps()
    setWorkspacePath(null)
    const actions = createWorkspaceActions(deps)

    await actions.refreshWorkspaceStatus()

    expect(getStatus()).toBeNull()
    expect(getAuthoritativeName()).toBeNull()
    expect(deps.callKernel).not.toHaveBeenCalled()
  })

  it('refreshes workspace status and name independently', async () => {
    const { deps, getStatus, getAuthoritativeName } = makeDeps()
    const actions = createWorkspaceActions(deps)

    await actions.refreshWorkspaceStatus()

    expect(getStatus()).toEqual({ initialized: true, missing: [] })
    expect(getAuthoritativeName()).toBe('Alpha Project')
  })

  it('preserves independent fallback behavior when status or info calls fail', async () => {
    const { deps, getStatus, getAuthoritativeName } = makeDeps({
      callKernel: vi.fn(async (tool: string) => {
        if (tool === 'workspace.status') throw new Error('status failed')
        if (tool === 'workspace.info') throw new Error('info failed')
        return undefined
      }),
    })
    const actions = createWorkspaceActions(deps)

    await actions.refreshWorkspaceStatus()

    expect(getStatus()).toBeNull()
    expect(getAuthoritativeName()).toBeNull()
  })

  it('initializes workspace best-effort and always refreshes status', async () => {
    const deps = makeDeps({
      callKernel: vi.fn(async (tool: string) => {
        if (tool === 'workspace.init') throw new Error('init failed')
        if (tool === 'workspace.status') return { initialized: false, missing: ['.mim'] }
        if (tool === 'workspace.info') return { name: 'Alpha' }
        return undefined
      }),
    }).deps
    const actions = createWorkspaceActions(deps)

    await actions.initializeWorkspace()

    expect(deps.callKernel).toHaveBeenNthCalledWith(1, 'workspace.init', {})
    expect(deps.callKernel).toHaveBeenNthCalledWith(2, 'workspace.status')
    expect(deps.callKernel).toHaveBeenNthCalledWith(3, 'workspace.info')
  })

  it('adds recents only for successful workspace opens', async () => {
    const deps = makeDeps({
      openWorkspaceDialog: vi.fn()
        .mockResolvedValueOnce('/work/Beta')
        .mockResolvedValueOnce(null),
      openWorkspacePathInKernel: vi.fn()
        .mockResolvedValueOnce('/work/Gamma')
        .mockResolvedValueOnce(null),
    }).deps
    const actions = createWorkspaceActions(deps)

    await actions.openWorkspace()
    await actions.openWorkspace()
    await actions.openWorkspacePath('/requested/Gamma')
    await actions.openWorkspacePath('')
    await actions.openWorkspacePath('/requested/Missing')

    expect(deps.addRecentWorkspace).toHaveBeenCalledTimes(2)
    expect(deps.addRecentWorkspace).toHaveBeenNthCalledWith(1, '/work/Beta')
    expect(deps.addRecentWorkspace).toHaveBeenNthCalledWith(2, '/work/Gamma')
    expect(deps.openWorkspacePathInKernel).toHaveBeenCalledTimes(2)
  })
})
