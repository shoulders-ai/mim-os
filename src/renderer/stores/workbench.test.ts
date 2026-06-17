import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWorkbenchStore, type ArtifactEntry, type WorkEntry } from './workbench.js'

function work(id: string): WorkEntry {
  return { id: `work:${id}`, kind: 'chat', title: `Work ${id}`, sessionId: id }
}

function artifact(id: string): ArtifactEntry {
  return { id: `artifact:${id}`, kind: 'file', title: `Artifact ${id}`, path: `${id}.md` }
}

describe('workbench store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setActivePinia(createPinia())
  })

  it('keeps Artifact stable when opening Work', async () => {
    const store = useWorkbenchStore()
    await store.openWork(work('a'))
    await store.openArtifact(artifact('one'))

    await store.openWork(work('b'))

    expect(store.activeWork?.id).toBe('work:b')
    expect(store.activeArtifact?.id).toBe('artifact:one')
  })

  it('restores a remembered Work artifact only when there is no active Artifact', async () => {
    const store = useWorkbenchStore()
    await store.openWork(work('a'))
    await store.openArtifact(artifact('one'))
    await store.openWork(work('b'))
    await store.openArtifact(artifact('two'))
    await store.closeArtifact()

    await store.openWork(work('a'))

    expect(store.activeArtifact?.id).toBe('artifact:one')
  })

  it('does not resurrect a Work artifact after that Work explicitly empties its slot', async () => {
    const store = useWorkbenchStore()
    await store.openWork(work('a'))
    await store.openArtifact(artifact('one'))
    await store.closeArtifact()

    await store.openWork(work('b'))
    await store.openWork(work('a'))

    expect(store.activeArtifact).toBe(null)
    expect(store.rememberedArtifacts['work:a']).toBe(null)
  })

  it('Work back and forward do not mutate Artifact history', async () => {
    const store = useWorkbenchStore()
    await store.openWork(work('a'))
    await store.openArtifact(artifact('one'))
    await store.openWork(work('b'))
    await store.openWork(work('c'))

    await store.back('work')
    expect(store.activeWork?.id).toBe('work:b')
    expect(store.activeArtifact?.id).toBe('artifact:one')

    await store.forward('work')
    expect(store.activeWork?.id).toBe('work:c')
    expect(store.activeArtifact?.id).toBe('artifact:one')
  })

  it('Artifact back and forward do not mutate Work history', async () => {
    const store = useWorkbenchStore()
    await store.openWork(work('a'))
    await store.openArtifact(artifact('one'))
    await store.openArtifact(artifact('two'))

    await store.back('artifact')
    expect(store.activeArtifact?.id).toBe('artifact:one')
    expect(store.activeWork?.id).toBe('work:a')

    await store.forward('artifact')
    expect(store.activeArtifact?.id).toBe('artifact:two')
    expect(store.activeWork?.id).toBe('work:a')
  })

  it('enforces at least one expanded pane and recovers all-railed batch layouts to Work', () => {
    const store = useWorkbenchStore()

    store.setPaneLayout({
      navigator: { state: 'rail' },
      artifact: { state: 'rail' },
      work: { state: 'rail' },
    })

    expect(store.paneLayout.work.state).toBe('expanded')
    expect(store.expandedPanes).toEqual(['work'])
  })

  it('exposes pane visibility helpers backed by pane layout state', () => {
    const store = useWorkbenchStore()

    store.setPaneVisibility('navigator', false)
    expect(store.navigatorVisible).toBe(false)
    expect(store.paneLayout.navigator.state).toBe('rail')

    store.togglePane('navigator')
    expect(store.navigatorVisible).toBe(true)
    expect(store.paneLayout.navigator.state).toBe('expanded')

    store.setPaneWidth('navigator', 300)
    expect(store.paneLayout.navigator.width).toBe(300)
  })

  it('clamps pane widths to pane-local ranges', () => {
    const store = useWorkbenchStore()

    store.setPaneWidth('navigator', 10)
    store.setPaneWidth('artifact', 9999)
    store.setPaneWidth('work', 100)

    expect(store.paneLayout.navigator.width).toBe(180)
    expect(store.paneLayout.artifact.width).toBe(9999)
    expect(store.paneLayout.work.width).toBe(336)

    store.setPaneLayout({
      navigator: { width: 9999 },
      artifact: { width: 10 },
    })

    expect(store.paneLayout.navigator.width).toBe(320)
    expect(store.paneLayout.artifact.width).toBe(336)
  })

  it('derives expanded Work and Artifact states by railing the sibling pane', () => {
    const store = useWorkbenchStore()

    store.setArtifactExpanded(true)
    expect(store.artifactExpanded).toBe(true)
    expect(store.workExpanded).toBe(false)
    expect(store.artifactVisible).toBe(true)
    expect(store.workVisible).toBe(false)
    expect(store.navigatorVisible).toBe(true)

    store.setArtifactExpanded(false)
    expect(store.artifactExpanded).toBe(false)
    expect(store.artifactVisible).toBe(true)
    expect(store.workVisible).toBe(true)

    store.setWorkExpanded(true)
    expect(store.workExpanded).toBe(true)
    expect(store.artifactExpanded).toBe(false)
    expect(store.workVisible).toBe(true)
    expect(store.artifactVisible).toBe(false)

    store.setWorkExpanded(false)
    expect(store.workExpanded).toBe(false)
    expect(store.workVisible).toBe(true)
    expect(store.artifactVisible).toBe(true)
  })

  it('restores the opposite Work or Artifact pane instead of leaving two rails', () => {
    const store = useWorkbenchStore()

    store.setPaneState('work', 'rail')
    store.setPaneState('artifact', 'rail')

    expect(store.paneLayout.work.state).toBe('expanded')
    expect(store.paneLayout.artifact.state).toBe('rail')

    store.setPaneState('work', 'rail')

    expect(store.paneLayout.work.state).toBe('rail')
    expect(store.paneLayout.artifact.state).toBe('expanded')
  })

  it('blocks dirty Artifact replacement until confirmed', async () => {
    const store = useWorkbenchStore()
    await store.openArtifact(artifact('dirty'))
    store.setArtifactReplacementGuard(async () => 'needs-confirmation')

    const blocked = await store.openArtifact(artifact('next'))
    expect(blocked.opened).toBe(false)
    expect(blocked.reason).toBe('needs-confirmation')
    expect(store.activeArtifact?.id).toBe('artifact:dirty')

    const opened = await store.openArtifact(artifact('next'), { confirmReplace: true })
    expect(opened.opened).toBe(true)
    expect(store.activeArtifact?.id).toBe('artifact:next')
  })

  it('blocks dirty Artifact history navigation until confirmed', async () => {
    const store = useWorkbenchStore()
    await store.openArtifact(artifact('one'))
    await store.openArtifact(artifact('dirty'))
    const guard = vi.fn(async () => 'needs-confirmation' as const)
    store.setArtifactReplacementGuard(guard)

    const blocked = await store.back('artifact')

    expect(blocked.opened).toBe(false)
    expect(blocked.reason).toBe('needs-confirmation')
    expect(store.activeArtifact?.id).toBe('artifact:dirty')
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'artifact:dirty' }),
      expect.objectContaining({ id: 'artifact:one' }),
    )

    const opened = await store.back('artifact', { confirmReplace: true })

    expect(opened.opened).toBe(true)
    expect(store.activeArtifact?.id).toBe('artifact:one')
  })

  it('blocks closing a dirty Artifact until confirmed', async () => {
    const store = useWorkbenchStore()
    await store.openArtifact(artifact('dirty'))
    const guard = vi.fn(async () => 'needs-confirmation' as const)
    store.setArtifactReplacementGuard(guard)

    const blocked = await store.closeArtifact()

    expect(blocked.opened).toBe(false)
    expect(blocked.reason).toBe('needs-confirmation')
    expect(store.activeArtifact?.id).toBe('artifact:dirty')
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'artifact:dirty' }),
      null,
    )

    const closed = await store.closeArtifact({ confirmReplace: true })

    expect(closed.opened).toBe(true)
    expect(store.activeArtifact).toBe(null)
  })

  it('does not block Work navigation when an Artifact is already open', async () => {
    const store = useWorkbenchStore()
    const first = work('a')
    const second = work('b')
    await store.openWork(first)
    await store.openArtifact(artifact('dirty'))
    store.setArtifactReplacementGuard(async () => 'needs-confirmation')

    const opened = await store.openWork(second)

    expect(opened.opened).toBe(true)
    expect(store.activeWork?.id).toBe(second.id)
    expect(store.activeArtifact?.id).toBe('artifact:dirty')
  })

  it('can open fallback Work while preserving the current Artifact', async () => {
    const store = useWorkbenchStore()
    const first = work('a')
    const fallback = { id: 'work:files', kind: 'files', title: 'Files' } satisfies WorkEntry
    await store.openWork(first)
    await store.openArtifact(artifact('dirty'))
    store.setArtifactReplacementGuard(async () => 'needs-confirmation')

    const opened = await store.openWork(fallback, { preserveArtifact: true })

    expect(opened.opened).toBe(true)
    expect(store.activeWork?.id).toBe('work:files')
    expect(store.activeArtifact?.id).toBe('artifact:dirty')
  })

  it('can restore Artifact state after a Work activation failure', async () => {
    const store = useWorkbenchStore()
    const first = work('a')
    const failed = work('missing')
    await store.openWork(first)
    await store.openArtifact(artifact('one'))

    const snapshot = store.createArtifactNavigationSnapshot()
    await store.openWork(failed)
    expect(store.activeWork?.id).toBe(failed.id)
    expect(store.activeArtifact?.id).toBe('artifact:one')

    store.restoreArtifactNavigationSnapshot(snapshot)

    expect(store.activeWork?.id).toBe(failed.id)
    expect(store.activeArtifact?.id).toBe('artifact:one')
    expect(store.rememberedArtifacts[first.id]?.id).toBe('artifact:one')
    expect(store.rememberedArtifacts[failed.id]).toBeUndefined()
  })

  it('blocks removing the active dirty Artifact from history until confirmed', async () => {
    const store = useWorkbenchStore()
    await store.openArtifact(artifact('dirty'))
    store.setArtifactReplacementGuard(async () => 'needs-confirmation')

    const blocked = await store.removePaneHistoryEntry('artifact', 'artifact:dirty')

    expect(blocked.opened).toBe(false)
    expect(blocked.reason).toBe('needs-confirmation')
    expect(store.activeArtifact?.id).toBe('artifact:dirty')

    const removed = await store.removePaneHistoryEntry(
      'artifact',
      'artifact:dirty',
      { confirmReplace: true },
    )

    expect(removed.opened).toBe(true)
    expect(store.activeArtifact).toBe(null)
  })

  it('preserves per-entry view state across navigation', async () => {
    const store = useWorkbenchStore()
    const launcher = { id: 'work:launcher', kind: 'package-view', title: 'Review Launcher', packageId: 'docx', viewId: 'launch' } satisfies WorkEntry
    const chat = work('chat')

    await store.openWork(launcher)
    store.patchViewState(launcher.id, { draftPath: 'draft.docx', reviewerCount: 3 })
    await store.openWork(chat)
    await store.openWork(launcher)

    expect(store.getViewState(launcher.id)).toEqual({ draftPath: 'draft.docx', reviewerCount: 3 })
  })

  it('clears in-memory histories and view state on workspace reset', async () => {
    const store = useWorkbenchStore()
    await store.openWork(work('a'))
    await store.openArtifact(artifact('one'))
    store.patchViewState('work:a', { draft: 'hello' })

    store.resetForWorkspace()

    expect(store.activeWork).toBe(null)
    expect(store.activeArtifact).toBe(null)
    expect(store.workHistory.backStack).toEqual([])
    expect(store.artifactHistory.backStack).toEqual([])
    expect(store.getViewState('work:a')).toBeUndefined()
    expect(store.expandedPanes.length).toBeGreaterThanOrEqual(1)
  })
})
