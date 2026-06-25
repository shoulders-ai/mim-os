import { describe, expect, it, vi } from 'vitest'
import {
  createWorkbenchActions,
  type WorkbenchActionsDeps,
} from './workbenchActions.js'
import type { ArtifactEntry, WorkEntry } from '../workbench/entries.js'

function makeDeps(overrides: Partial<WorkbenchActionsDeps> = {}) {
  let activeWork: WorkEntry | null = null
  let activeArtifact: ArtifactEntry | null = null
  let activeSessionId: string | null = null
  const deps: WorkbenchActionsDeps = {
    activeWork: vi.fn(() => activeWork),
    activeArtifact: vi.fn(() => activeArtifact),
    setActiveWorkForTest: work => { activeWork = work },
    setActiveArtifactForTest: artifact => { activeArtifact = artifact },
    activeSessionId: vi.fn(() => activeSessionId),
    setActiveSessionId: vi.fn(id => { activeSessionId = id }),
    selectSession: vi.fn(async id => { activeSessionId = id }),
    createArtifactNavigationSnapshot: vi.fn(() => ({ snapshot: true })),
    restoreArtifactNavigationSnapshot: vi.fn(),
    openWorkInStore: vi.fn(async entry => {
      activeWork = entry
      return { opened: true }
    }),
    openArtifactInStore: vi.fn(async entry => {
      activeArtifact = entry
      return { opened: true }
    }),
    backInStore: vi.fn(async pane => {
      if (pane === 'work') activeWork = { id: 'work:files', kind: 'files', title: 'Files' }
      else activeArtifact = { id: 'artifact:editor', kind: 'editor', title: 'Editor' }
      return { opened: true }
    }),
    forwardInStore: vi.fn(async () => ({ opened: true })),
    removePaneHistoryEntry: vi.fn(async () => ({ opened: true })),
    removeFailedWorkBackingEntry: vi.fn(async () => false),
    setPaneState: vi.fn(),
    setPaneVisibility: vi.fn(),
    setNavigationError: vi.fn(),
    confirmArtifactReplacement: vi.fn(() => true),
    nextTick: vi.fn(async () => {}),
    openFileInArtifactHost: vi.fn(),
    ...overrides,
  }
  return {
    deps,
    setActiveWork: (work: WorkEntry | null) => { activeWork = work },
    setActiveArtifact: (artifact: ArtifactEntry | null) => { activeArtifact = artifact },
    setActiveSessionId: (id: string | null) => { activeSessionId = id },
  }
}

describe('app shell workbench actions', () => {
  it('confirms dirty Artifact replacement and retries Work navigation with confirmReplace', async () => {
    const work: WorkEntry = { id: 'work:files', kind: 'files', title: 'Files' }
    const { deps } = makeDeps({
      openWorkInStore: vi.fn()
        .mockResolvedValueOnce({ opened: false, reason: 'needs-confirmation' })
        .mockResolvedValueOnce({ opened: true }),
    })
    const actions = createWorkbenchActions(deps)

    const result = await actions.openWorkEntry(work)

    expect(result).toEqual({ opened: true })
    expect(deps.confirmArtifactReplacement).toHaveBeenCalledOnce()
    expect(deps.openWorkInStore).toHaveBeenNthCalledWith(1, work, {})
    expect(deps.openWorkInStore).toHaveBeenNthCalledWith(2, work, { confirmReplace: true })
  })

  it('restores the Artifact snapshot when Work activation fails after opening', async () => {
    const err = new Error('select failed')
    const chat: WorkEntry = { id: 'work:chat:s1', kind: 'chat', title: 'Chat', sessionId: 's1' }
    const { deps } = makeDeps({
      selectSession: vi.fn(async () => { throw err }),
    })
    const actions = createWorkbenchActions(deps)

    await actions.openWorkEntry(chat)

    expect(deps.restoreArtifactNavigationSnapshot).toHaveBeenCalledWith({ snapshot: true })
    expect(deps.setNavigationError).toHaveBeenCalledWith('work', err)
  })

  it('activates chat and chat-draft Work entries against the session store boundary', async () => {
    const { deps, setActiveSessionId } = makeDeps()
    setActiveSessionId('s-old')
    const actions = createWorkbenchActions(deps)

    await actions.activateWorkEntry({ id: 'work:chat:s1', kind: 'chat', title: 'Chat', sessionId: 's1' })
    await actions.activateWorkEntry({ id: 'work:chat:new', kind: 'chat-draft', title: 'Chat' })

    expect(deps.setPaneState).toHaveBeenCalledWith('work', 'expanded')
    expect(deps.selectSession).toHaveBeenCalledWith('s1')
    expect(deps.setActiveSessionId).toHaveBeenCalledWith(null)
  })

  it('activates file Artifacts by showing the pane and forwarding the file to the Artifact host', async () => {
    const file: ArtifactEntry = { id: 'file:docs/a.md', kind: 'file', title: 'a.md', path: 'docs/a.md' }
    const { deps } = makeDeps()
    const actions = createWorkbenchActions(deps)

    await actions.openArtifactEntry(file)

    expect(deps.setPaneVisibility).toHaveBeenCalledWith('artifact', true)
    expect(deps.nextTick).toHaveBeenCalled()
    expect(deps.openFileInArtifactHost).toHaveBeenCalledWith('docs/a.md')
  })

  it('rails Artifact and expands Work when activating an empty Artifact entry', async () => {
    const { deps } = makeDeps()
    const actions = createWorkbenchActions(deps)

    await actions.activateArtifactEntry(null)

    expect(deps.setPaneState).toHaveBeenCalledWith('artifact', 'rail')
    expect(deps.setPaneState).toHaveBeenCalledWith('work', 'expanded')
  })

  it('removes failed Artifact entries through the same confirmation path', async () => {
    const file: ArtifactEntry = { id: 'file:docs/a.md', kind: 'file', title: 'a.md', path: 'docs/a.md' }
    const { deps, setActiveArtifact } = makeDeps({
      removePaneHistoryEntry: vi.fn()
        .mockResolvedValueOnce({ opened: false, reason: 'needs-confirmation' })
        .mockResolvedValueOnce({ opened: true }),
    })
    setActiveArtifact(file)
    const actions = createWorkbenchActions(deps)

    await actions.removeFailedArtifactEntry()

    expect(deps.removePaneHistoryEntry).toHaveBeenNthCalledWith(1, 'artifact', file.id)
    expect(deps.removePaneHistoryEntry).toHaveBeenNthCalledWith(2, 'artifact', file.id, { confirmReplace: true })
  })

  it('lets a backing Work cleanup handle failed entries before generic history removal', async () => {
    const work: WorkEntry = {
      id: 'work:agent-session:sess-1',
      kind: 'agent-session',
      agentId: 'codex',
      sessionId: 'sess-1',
      title: 'Codex session',
    }
    const { deps, setActiveWork } = makeDeps({
      removeFailedWorkBackingEntry: vi.fn(async () => true),
    })
    setActiveWork(work)
    const actions = createWorkbenchActions(deps)

    await actions.removeFailedWorkEntry()

    expect(deps.removeFailedWorkBackingEntry).toHaveBeenCalledWith(work)
    expect(deps.removePaneHistoryEntry).not.toHaveBeenCalled()
    expect(deps.openWorkInStore).not.toHaveBeenCalled()
  })

  it('navigates pane history and activates the resulting pane entry', async () => {
    const { deps } = makeDeps()
    const actions = createWorkbenchActions(deps)

    await actions.navigateWorkHistory('back')
    await actions.navigateArtifactHistory('back')

    expect(deps.backInStore).toHaveBeenCalledWith('work')
    expect(deps.backInStore).toHaveBeenCalledWith('artifact')
    expect(deps.setPaneState).toHaveBeenCalledWith('work', 'expanded')
    expect(deps.setPaneVisibility).toHaveBeenCalledWith('artifact', true)
  })
})
