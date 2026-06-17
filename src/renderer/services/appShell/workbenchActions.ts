import {
  filesWorkEntry,
  type ArtifactEntry,
  type PaneId,
  type PaneState,
  type WorkEntry,
} from '../workbench/entries.js'
import type {
  NavigationResult,
  OpenArtifactOptions,
  OpenWorkOptions,
} from '../../stores/workbench.js'

export interface WorkbenchActionsDeps {
  activeWork(): WorkEntry | null
  activeArtifact(): ArtifactEntry | null
  activeSessionId(): string | null
  setActiveSessionId(sessionId: string | null): void
  selectSession(sessionId: string): Promise<unknown> | unknown
  createArtifactNavigationSnapshot(): unknown
  restoreArtifactNavigationSnapshot(snapshot: unknown): void
  openWorkInStore(entry: WorkEntry, options?: OpenWorkOptions): Promise<NavigationResult>
  openArtifactInStore(entry: ArtifactEntry, options?: OpenArtifactOptions): Promise<NavigationResult>
  backInStore(pane: 'work' | 'artifact', options?: { confirmReplace?: boolean }): Promise<NavigationResult>
  forwardInStore(pane: 'work' | 'artifact', options?: { confirmReplace?: boolean }): Promise<NavigationResult>
  removePaneHistoryEntry(
    pane: 'work' | 'artifact',
    entryId: string,
    options?: { confirmReplace?: boolean },
  ): Promise<NavigationResult>
  setPaneState(pane: PaneId, state: PaneState): void
  setPaneVisibility(pane: PaneId, visible: boolean): void
  setNavigationError(pane: 'work' | 'artifact', error: unknown | null): void
  confirmArtifactReplacement(): boolean
  nextTick(): Promise<void>
  openFileInArtifactHost(path: string): void
}

export function createWorkbenchActions(deps: WorkbenchActionsDeps) {
  async function confirmArtifactMutation(
    result: NavigationResult,
    retry: () => Promise<NavigationResult>,
  ) {
    if (!result.opened && result.reason === 'needs-confirmation') {
      if (deps.confirmArtifactReplacement()) return retry()
    }
    return result
  }

  async function openWorkEntry(entry: WorkEntry, options: OpenWorkOptions = {}) {
    const artifactSnapshot = deps.createArtifactNavigationSnapshot()
    let result = await deps.openWorkInStore(entry, options)
    if (!options.confirmReplace) {
      result = await confirmArtifactMutation(
        result,
        () => deps.openWorkInStore(entry, { ...options, confirmReplace: true }),
      )
    }
    if (!result.opened) return result

    const activated = await activateWorkEntryWithRecovery(deps.activeWork())
    if (!activated) {
      deps.restoreArtifactNavigationSnapshot(artifactSnapshot)
    }
    return result
  }

  async function activateWorkEntry(entry: WorkEntry | null) {
    if (!entry) return

    deps.setPaneState('work', 'expanded')

    if (entry.kind === 'chat') {
      if (deps.activeSessionId() !== entry.sessionId) {
        await deps.selectSession(entry.sessionId)
      }
    } else if (entry.kind === 'chat-draft') {
      deps.setActiveSessionId(null)
    }
  }

  async function activateWorkEntryWithRecovery(entry: WorkEntry | null) {
    try {
      await activateWorkEntry(entry)
      clearNavigationError('work')
      return true
    } catch (err) {
      deps.setNavigationError('work', err)
      return false
    }
  }

  async function openArtifactEntry(entry: ArtifactEntry, options: OpenArtifactOptions = {}) {
    let result = await deps.openArtifactInStore(entry, options)

    if (!options.confirmReplace) {
      result = await confirmArtifactMutation(
        result,
        () => deps.openArtifactInStore(entry, { ...options, confirmReplace: true }),
      )
    }

    if (!result.opened) return result

    await activateArtifactEntryWithRecovery(deps.activeArtifact())
    return result
  }

  async function activateArtifactEntry(entry: ArtifactEntry | null) {
    if (!entry) {
      deps.setPaneState('artifact', 'rail')
      deps.setPaneState('work', 'expanded')
      return
    }

    deps.setPaneVisibility('artifact', true)
    await deps.nextTick()

    if (entry.kind === 'file') {
      deps.openFileInArtifactHost(entry.path)
    }
  }

  async function activateArtifactEntryWithRecovery(entry: ArtifactEntry | null) {
    try {
      await activateArtifactEntry(entry)
      clearNavigationError('artifact')
      return true
    } catch (err) {
      deps.setNavigationError('artifact', err)
      return false
    }
  }

  async function recordMountedArtifactActivation(entry: ArtifactEntry) {
    const result = await deps.openArtifactInStore(entry, { confirmReplace: true })
    if (!result.opened) return
    deps.setPaneVisibility('artifact', true)
    clearNavigationError('artifact')
  }

  function clearNavigationError(pane: 'work' | 'artifact') {
    deps.setNavigationError(pane, null)
  }

  async function retryWorkRecovery() {
    clearNavigationError('work')
    await activateWorkEntryWithRecovery(deps.activeWork())
  }

  async function retryArtifactRecovery() {
    clearNavigationError('artifact')
    await activateArtifactEntryWithRecovery(deps.activeArtifact())
  }

  async function removeFailedWorkEntry() {
    const entryId = deps.activeWork()?.id
    clearNavigationError('work')
    if (entryId) {
      await deps.removePaneHistoryEntry('work', entryId)
    }
    if (deps.activeWork()) {
      await activateWorkEntryWithRecovery(deps.activeWork())
      return
    }
    await openWorkEntry(filesWorkEntry())
  }

  async function removeFailedArtifactEntry() {
    const entryId = deps.activeArtifact()?.id
    clearNavigationError('artifact')
    if (!entryId) return

    let result = await deps.removePaneHistoryEntry('artifact', entryId)
    result = await confirmArtifactMutation(
      result,
      () => deps.removePaneHistoryEntry('artifact', entryId, { confirmReplace: true }),
    )
    if (!result.opened) return
    await activateArtifactEntryWithRecovery(deps.activeArtifact())
  }

  async function navigateWorkHistory(direction: 'back' | 'forward') {
    let result = direction === 'back'
      ? await deps.backInStore('work')
      : await deps.forwardInStore('work')
    result = await confirmArtifactMutation(
      result,
      () => direction === 'back'
        ? deps.backInStore('work', { confirmReplace: true })
        : deps.forwardInStore('work', { confirmReplace: true }),
    )
    if (!result.opened) return
    await activateWorkEntryWithRecovery(deps.activeWork())
  }

  async function navigateArtifactHistory(direction: 'back' | 'forward') {
    let result = direction === 'back'
      ? await deps.backInStore('artifact')
      : await deps.forwardInStore('artifact')
    result = await confirmArtifactMutation(
      result,
      () => direction === 'back'
        ? deps.backInStore('artifact', { confirmReplace: true })
        : deps.forwardInStore('artifact', { confirmReplace: true }),
    )
    if (!result.opened) return
    await activateArtifactEntryWithRecovery(deps.activeArtifact())
  }

  return {
    openWorkEntry,
    activateWorkEntry,
    activateWorkEntryWithRecovery,
    openArtifactEntry,
    activateArtifactEntry,
    activateArtifactEntryWithRecovery,
    recordMountedArtifactActivation,
    clearNavigationError,
    retryWorkRecovery,
    retryArtifactRecovery,
    removeFailedWorkEntry,
    removeFailedArtifactEntry,
    navigateWorkHistory,
    navigateArtifactHistory,
  }
}
