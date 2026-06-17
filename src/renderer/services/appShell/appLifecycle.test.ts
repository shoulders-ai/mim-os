import { describe, expect, it, vi } from 'vitest'
import {
  createAppLifecycleActions,
  type AppLifecycleDeps,
} from './appLifecycle.js'
import type { LoadedPackage } from './types.js'

function makeDeps(overrides: Partial<AppLifecycleDeps> = {}) {
  let workspace: string | null = null
  let port = 0
  let packages: LoadedPackage[] = []
  let welcomeDismissed = false
  const deps: AppLifecycleDeps = {
    loadSettings: vi.fn(async () => undefined),
    restoreWorkbenchSettings: vi.fn(async () => undefined),
    installArtifactReplacementGuard: vi.fn(),
    getPort: vi.fn(async () => 3741),
    setPort: vi.fn(next => { port = next }),
    getPackages: vi.fn(async () => [
      {
        dir: '/pkg/demo',
        source: 'local',
        manifest: { id: 'demo', name: 'Demo' },
      },
    ]),
    setPackages: vi.fn(next => { packages = next }),
    getWorkspace: vi.fn(async () => '/work/Alpha'),
    setWorkspacePath: vi.fn(next => { workspace = next }),
    addRecentWorkspace: vi.fn(),
    refreshWorkspaceStatus: vi.fn(async () => undefined),
    refreshPackageRuns: vi.fn(async () => undefined),
    refreshAgentSessions: vi.fn(async () => undefined),
    refreshApps: vi.fn(async () => undefined),
    refreshAgents: vi.fn(async () => undefined),
    restoreInitialWork: vi.fn(async () => undefined),
    loadFileIndex: vi.fn(async () => undefined),
    welcomeDismissed: vi.fn(() => welcomeDismissed),
    markWelcomeDismissed: vi.fn(() => { welcomeDismissed = true }),
    openWelcome: vi.fn(),
    resetWorkbenchForWorkspace: vi.fn(),
    ...overrides,
  }
  return {
    deps,
    getWorkspace: () => workspace,
    getPort: () => port,
    getPackages: () => packages,
  }
}

describe('app shell lifecycle actions', () => {
  it('bootstraps settings, Workbench layout, kernel state, workspace refreshes, and welcome', async () => {
    const { deps, getWorkspace, getPort, getPackages } = makeDeps()
    const lifecycle = createAppLifecycleActions(deps)

    await lifecycle.bootstrapAppShell()

    expect(deps.loadSettings).toHaveBeenCalledBefore(deps.restoreWorkbenchSettings)
    expect(deps.restoreWorkbenchSettings).toHaveBeenCalledBefore(deps.installArtifactReplacementGuard)
    expect(getPort()).toBe(3741)
    expect(getPackages()).toHaveLength(1)
    expect(getWorkspace()).toBe('/work/Alpha')
    expect(deps.addRecentWorkspace).toHaveBeenCalledWith('/work/Alpha')
    expect(deps.refreshWorkspaceStatus).toHaveBeenCalledOnce()
    expect(deps.refreshPackageRuns).toHaveBeenCalledOnce()
    expect(deps.refreshAgentSessions).toHaveBeenCalledOnce()
    expect(deps.refreshApps).toHaveBeenCalledOnce()
    expect(deps.refreshAgents).toHaveBeenCalledOnce()
    expect(deps.restoreInitialWork).toHaveBeenCalledOnce()
    expect(deps.loadFileIndex).toHaveBeenCalledOnce()
    expect(deps.openWelcome).toHaveBeenCalledOnce()
    expect(deps.markWelcomeDismissed).toHaveBeenCalledOnce()
  })

  it('skips workspace refresh and welcome when no workspace is open and welcome was dismissed', async () => {
    const deps = makeDeps({
      getWorkspace: vi.fn(async () => null),
      welcomeDismissed: vi.fn(() => true),
    }).deps
    const lifecycle = createAppLifecycleActions(deps)

    await lifecycle.bootstrapAppShell()

    expect(deps.addRecentWorkspace).not.toHaveBeenCalled()
    expect(deps.refreshWorkspaceStatus).not.toHaveBeenCalled()
    expect(deps.refreshPackageRuns).not.toHaveBeenCalled()
    expect(deps.refreshAgentSessions).not.toHaveBeenCalled()
    expect(deps.refreshApps).not.toHaveBeenCalled()
    expect(deps.refreshAgents).not.toHaveBeenCalled()
    expect(deps.restoreInitialWork).toHaveBeenCalledOnce()
    expect(deps.loadFileIndex).toHaveBeenCalledOnce()
    expect(deps.openWelcome).not.toHaveBeenCalled()
    expect(deps.markWelcomeDismissed).not.toHaveBeenCalled()
  })

  it('handles workspace changes by resetting layout and kicking off refresh work', async () => {
    const { deps, getWorkspace } = makeDeps()
    const lifecycle = createAppLifecycleActions(deps)

    await lifecycle.handleWorkspaceChanged('/work/Beta')

    expect(getWorkspace()).toBe('/work/Beta')
    expect(deps.addRecentWorkspace).toHaveBeenCalledWith('/work/Beta')
    expect(deps.loadSettings).toHaveBeenCalledOnce()
    expect(deps.resetWorkbenchForWorkspace).toHaveBeenCalledOnce()
    expect(deps.restoreWorkbenchSettings).toHaveBeenCalledOnce()
    expect(deps.installArtifactReplacementGuard).toHaveBeenCalledOnce()
    expect(deps.restoreInitialWork).toHaveBeenCalledOnce()
    expect(deps.refreshPackageRuns).toHaveBeenCalledOnce()
    expect(deps.refreshAgentSessions).toHaveBeenCalledOnce()
    expect(deps.refreshWorkspaceStatus).toHaveBeenCalledOnce()
    expect(deps.refreshApps).toHaveBeenCalledOnce()
    expect(deps.refreshAgents).toHaveBeenCalledOnce()
    expect(deps.loadFileIndex).toHaveBeenCalledOnce()
  })
})
