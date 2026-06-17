import {
  activityTrustWorkEntry,
  archiveWorkEntry,
  chatDraftWorkEntry,
  chatWorkEntry,
  filesWorkEntry,
  packageViewWorkEntry,
  terminalWorkEntry,
  type WorkEntry,
} from '../workbench/entries.js'
import { navigationDidOpen } from '../workbench/commands.js'
import {
  defaultWorkPackageView,
  isWorkPackageView,
} from '../workbench/packageViews.js'
import type { LoadedPackage } from './types.js'

export interface OpenWorkEntryOptions {
  preserveArtifact?: boolean
}

export interface WorkSurfaceActionsDeps {
  activeSessionId(): string | null
  sessionLabel(sessionId: string): string | null | undefined
  packages(): LoadedPackage[]
  openWorkEntry(entry: WorkEntry, options?: OpenWorkEntryOptions): Promise<unknown> | unknown
  incrementFilesRefresh(): void
  incrementArchiveRefresh(): void
}

export function createWorkSurfaceActions(deps: WorkSurfaceActionsDeps) {
  function sessionWorkEntry(sessionId: string): WorkEntry {
    return chatWorkEntry(sessionId, deps.sessionLabel(sessionId) ?? 'Chat')
  }

  async function openDraftChatWork() {
    await deps.openWorkEntry(chatDraftWorkEntry())
  }

  async function openChatWork(sessionId: string) {
    await deps.openWorkEntry(sessionWorkEntry(sessionId))
  }

  async function openTerminalWork() {
    return deps.openWorkEntry(terminalWorkEntry())
  }

  async function openFilesWork() {
    const result = await deps.openWorkEntry(filesWorkEntry())
    if (navigationDidOpen(result)) deps.incrementFilesRefresh()
    return result
  }

  async function openActivityTrustWork() {
    await deps.openWorkEntry(activityTrustWorkEntry())
  }

  async function openFallbackWork() {
    const sessionId = deps.activeSessionId()
    if (sessionId) {
      await deps.openWorkEntry(sessionWorkEntry(sessionId), { preserveArtifact: true })
      return
    }
    await openFilesWorkPreservingArtifact()
  }

  async function openFilesWorkPreservingArtifact() {
    const result = await deps.openWorkEntry(filesWorkEntry(), { preserveArtifact: true })
    if (navigationDidOpen(result)) deps.incrementFilesRefresh()
    return result
  }

  async function openArchiveWork() {
    const result = await deps.openWorkEntry(archiveWorkEntry())
    if (navigationDidOpen(result)) deps.incrementArchiveRefresh()
  }

  async function openPackageViewWork(packageId: string, viewId?: string) {
    const pkg = deps.packages().find(item => item.manifest.id === packageId)
    if (!pkg) return
    const view = viewId
      ? pkg.manifest.views?.find(item => item.id === viewId)
      : defaultWorkPackageView(pkg)
    if (!view || !isWorkPackageView(view)) return
    await deps.openWorkEntry(packageViewWorkEntry(packageId, view.label || pkg.manifest.name, view.id))
  }

  return {
    sessionWorkEntry,
    openDraftChatWork,
    openChatWork,
    openTerminalWork,
    openFilesWork,
    openActivityTrustWork,
    openFallbackWork,
    openFilesWorkPreservingArtifact,
    openArchiveWork,
    openPackageViewWork,
  }
}
