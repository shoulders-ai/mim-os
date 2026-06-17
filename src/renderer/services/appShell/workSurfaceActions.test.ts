import { describe, expect, it, vi } from 'vitest'
import {
  createWorkSurfaceActions,
  type WorkSurfaceActionsDeps,
} from './workSurfaceActions.js'
import type { LoadedPackage } from './types.js'

function packageFixture(overrides: Partial<LoadedPackage['manifest']> = {}): LoadedPackage {
  return {
    dir: '/packages/demo',
    source: 'local',
    manifest: {
      id: 'demo',
      name: 'Demo',
      views: [
        { id: 'main', label: 'Dashboard', src: 'index.html', role: 'work' },
        { id: 'artifact', label: 'Artifact', src: 'artifact.html', role: 'artifact' },
        { id: 'either', label: 'Either', src: 'either.html', role: 'either' },
      ],
      ...overrides,
    },
  }
}

function makeDeps(overrides: Partial<WorkSurfaceActionsDeps> = {}) {
  let activeSessionId: string | null = null
  let packages: LoadedPackage[] = [packageFixture()]
  const labels = new Map<string, string>([['s1', 'Planning']])
  const deps: WorkSurfaceActionsDeps = {
    activeSessionId: vi.fn(() => activeSessionId),
    sessionLabel: vi.fn(sessionId => labels.get(sessionId) ?? null),
    packages: vi.fn(() => packages),
    openWorkEntry: vi.fn(async () => ({ opened: true })),
    incrementFilesRefresh: vi.fn(),
    incrementArchiveRefresh: vi.fn(),
    ...overrides,
  }
  return {
    deps,
    setActiveSessionId: (sessionId: string | null) => { activeSessionId = sessionId },
    setPackages: (next: LoadedPackage[]) => { packages = next },
  }
}

describe('app shell Work surface actions', () => {
  it('opens chat and core Work entries with the expected entry ids', async () => {
    const { deps } = makeDeps()
    const actions = createWorkSurfaceActions(deps)

    await actions.openDraftChatWork()
    await actions.openChatWork('s1')
    await actions.openTerminalWork()
    await actions.openActivityTrustWork()

    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(1, {
      id: 'work:chat:new',
      kind: 'chat-draft',
      title: 'Chat',
    })
    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(2, {
      id: 'work:chat:s1',
      kind: 'chat',
      title: 'Planning',
      sessionId: 's1',
    })
    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(3, {
      id: 'work:terminal',
      kind: 'terminal',
      title: 'Terminal',
    })
    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(4, {
      id: 'work:activity-trust',
      kind: 'activity-trust',
      title: 'Monitor',
    })
  })

  it('increments Files and History refresh keys only when navigation opens', async () => {
    const { deps } = makeDeps({
      openWorkEntry: vi.fn()
        .mockResolvedValueOnce({ opened: true })
        .mockResolvedValueOnce({ opened: false, reason: 'needs-confirmation' })
        .mockResolvedValueOnce({ opened: true }),
    })
    const actions = createWorkSurfaceActions(deps)

    await actions.openFilesWork()
    await actions.openFilesWorkPreservingArtifact()
    await actions.openArchiveWork()

    expect(deps.incrementFilesRefresh).toHaveBeenCalledOnce()
    expect(deps.incrementArchiveRefresh).toHaveBeenCalledOnce()
    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(2, {
      id: 'work:files',
      kind: 'files',
      title: 'Files',
      query: '',
    }, { preserveArtifact: true })
  })

  it('falls back to the active session with Artifact preservation before Files', async () => {
    const { deps, setActiveSessionId } = makeDeps()
    const actions = createWorkSurfaceActions(deps)

    setActiveSessionId('s1')
    await actions.openFallbackWork()
    setActiveSessionId(null)
    await actions.openFallbackWork()

    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(1, {
      id: 'work:chat:s1',
      kind: 'chat',
      title: 'Planning',
      sessionId: 's1',
    }, { preserveArtifact: true })
    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(2, {
      id: 'work:files',
      kind: 'files',
      title: 'Files',
      query: '',
    }, { preserveArtifact: true })
  })

  it('opens requested and default package Work views and ignores non-Work views', async () => {
    const { deps } = makeDeps()
    const actions = createWorkSurfaceActions(deps)

    await actions.openPackageViewWork('demo', 'either')
    await actions.openPackageViewWork('demo')
    await actions.openPackageViewWork('demo', 'artifact')
    await actions.openPackageViewWork('missing')

    expect(deps.openWorkEntry).toHaveBeenCalledTimes(2)
    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(1, {
      id: 'work:package-view:demo:either',
      kind: 'package-view',
      packageId: 'demo',
      title: 'Either',
      viewId: 'either',
    })
    expect(deps.openWorkEntry).toHaveBeenNthCalledWith(2, {
      id: 'work:package-view:demo:main',
      kind: 'package-view',
      packageId: 'demo',
      title: 'Dashboard',
      viewId: 'main',
    })
  })
})
