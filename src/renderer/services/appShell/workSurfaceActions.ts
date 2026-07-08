import {
  activityTrustWorkEntry,
  archiveWorkEntry,
  chatDraftWorkEntry,
  chatWorkEntry,
  filesWorkEntry,
  packageViewWorkEntry,
  routinesWorkEntry,
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
  visibleSessions?(): Array<{ id: string; agentId?: string }>
}

export function createWorkSurfaceActions(deps: WorkSurfaceActionsDeps) {
  function sessionWorkEntry(sessionId: string): WorkEntry {
    return chatWorkEntry(sessionId, deps.sessionLabel(sessionId) ?? 'Chat')
  }

  async function openDraftChatWork(options?: { agentId?: string }) {
    await deps.openWorkEntry(chatDraftWorkEntry(options?.agentId ? { agentId: options.agentId } : undefined))
  }

  async function openChatWork(sessionId: string) {
    await deps.openWorkEntry(sessionWorkEntry(sessionId))
  }

  async function openRoutinesWork() {
    return deps.openWorkEntry(routinesWorkEntry())
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

  async function openAgentChatOrDraft(agentId: string, agentName: string) {
    // Find the most recent non-archived session with the matching agentId.
    // visibleSessions is sorted by the store so the first match is the most
    // recently active.
    const sessions = deps.visibleSessions?.() ?? []
    const existing = sessions.find(s => s.agentId === agentId)
    if (existing) {
      await openChatWork(existing.id)
      return
    }
    await deps.openWorkEntry(chatDraftWorkEntry({ agentId, title: agentName }))
  }

  return {
    sessionWorkEntry,
    openDraftChatWork,
    openChatWork,
    openRoutinesWork,
    openTerminalWork,
    openFilesWork,
    openActivityTrustWork,
    openFallbackWork,
    openFilesWorkPreservingArtifact,
    openArchiveWork,
    openPackageViewWork,
    openAgentChatOrDraft,
  }
}
