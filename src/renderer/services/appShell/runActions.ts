import {
  agentSessionWorkEntry,
  chatWorkEntry,
  packageRunWorkEntry,
  type WorkEntry,
} from '../workbench/entries.js'
import {
  packageRunDisplayTitle,
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type PackageRunRecord,
} from '../../stores/runs.js'

export interface RunActionsDeps {
  activeWork(): WorkEntry | null
  packageRuns(): PackageRunRecord[]
  agentSessions(): AgentSessionRuntime[]
  getAgentExtraArgs(agentId: string): string[]
  callKernel(tool: string, params?: Record<string, unknown>): Promise<unknown>
  openWorkEntry(entry: WorkEntry): Promise<unknown> | unknown
  openFallbackWork(): Promise<unknown> | unknown
  openFilesWorkPreservingArtifact(): Promise<unknown> | unknown
  removeWorkHistoryEntry(entryId: string): Promise<unknown> | unknown
  setWorkNavigationError(error: unknown): void
  upsertPackageRun(run: PackageRunRecord): void
  removePackageRun(runId: string): void
  applyAgentSessionEvent(event: AgentSessionEvent): void
  removeAgentSession(sessionId: string): void
  archiveChatSession(sessionId: string): Promise<unknown> | unknown
  deleteChatSession(sessionId: string): Promise<unknown> | unknown
  incrementArchiveRefresh(): void
  refreshPackageRuns(): Promise<unknown> | unknown
}

export function createRunActions(deps: RunActionsDeps) {
  async function openPackageRunWork(packageId: string, runId: string) {
    const cachedRun = deps.packageRuns().find(item => item.runId === runId)
    const run = !cachedRun || cachedRun.archived === true
      ? (await hydratePackageRun(runId)) ?? cachedRun
      : cachedRun
    await deps.openWorkEntry(packageRunWorkEntry(
      run?.packageId ?? packageId,
      runId,
      run ? packageRunDisplayTitle(run) : `${packageId} run`,
    ))
  }

  async function hydratePackageRun(runId: string): Promise<PackageRunRecord | null> {
    try {
      const result = await deps.callKernel('package.jobs.get', { runId })
      const run = (result as { run?: PackageRunRecord }).run ?? result as PackageRunRecord
      if (!run || typeof run !== 'object' || typeof run.runId !== 'string') return null
      deps.upsertPackageRun(run)
      return run
    } catch {
      return null
    }
  }

  async function archivePackageRun(packageId: string, runId: string) {
    try {
      const wasActiveWork = deps.activeWork()?.kind === 'package-run' && deps.activeWork()?.runId === runId
      const result = await deps.callKernel('package.jobs.archive', { runId })
      const run = (result as { run?: PackageRunRecord }).run
      if (run) deps.upsertPackageRun(run)
      else deps.removePackageRun(runId)
      await deps.removeWorkHistoryEntry(packageRunWorkEntry(packageId, runId).id)
      if (wasActiveWork) {
        await deps.openFilesWorkPreservingArtifact()
      }
      deps.incrementArchiveRefresh()
      void deps.refreshPackageRuns()
    } catch (err) {
      deps.setWorkNavigationError(err)
    }
  }

  async function deletePackageRun(packageId: string, runId: string) {
    try {
      const wasActiveWork = deps.activeWork()?.kind === 'package-run' && deps.activeWork()?.runId === runId
      await deps.callKernel('package.jobs.delete', { runId })
      deps.removePackageRun(runId)
      await deps.removeWorkHistoryEntry(packageRunWorkEntry(packageId, runId).id)
      if (wasActiveWork) {
        await deps.openFilesWorkPreservingArtifact()
      }
      deps.incrementArchiveRefresh()
      void deps.refreshPackageRuns()
    } catch (err) {
      deps.setWorkNavigationError(err)
    }
  }

  function agentSessionTitle(sessionId: string): string {
    return deps.agentSessions().find(item => item.sessionId === sessionId)?.title ?? 'Agent session'
  }

  async function launchAgentSession(agentId: string) {
    try {
      const extraArgs = deps.getAgentExtraArgs(agentId)
      const result = await deps.callKernel('agent.launch', { agentId, ...(extraArgs.length ? { extraArgs } : {}) }) as {
        session?: AgentSessionRuntime
        ptyId?: number
      }
      if (!result.session) throw new Error('Launch did not return a session')
      deps.applyAgentSessionEvent({ type: 'session.started', session: result.session })
      await deps.openWorkEntry(agentSessionWorkEntry(agentId, result.session.sessionId, result.session.title))
    } catch (err) {
      deps.setWorkNavigationError(err)
    }
  }

  async function openAgentSessionWork(agentId: string, sessionId: string) {
    await deps.openWorkEntry(agentSessionWorkEntry(agentId, sessionId, agentSessionTitle(sessionId)))
  }

  async function stopAgentSession(sessionId: string) {
    try {
      await deps.callKernel('agent.stop', { sessionId })
    } catch (err) {
      deps.setWorkNavigationError(err)
    }
  }

  async function archiveAgentSession(sessionId: string) {
    try {
      const wasActiveWork = deps.activeWork()?.kind === 'agent-session' && deps.activeWork()?.sessionId === sessionId
      const agentId = deps.agentSessions().find(item => item.sessionId === sessionId)?.agentId ?? ''
      const result = await deps.callKernel('agent.sessions.archive', { sessionId }) as { session?: AgentSessionRuntime }
      if (result.session) deps.applyAgentSessionEvent({ type: 'session.changed', session: result.session })
      else deps.removeAgentSession(sessionId)
      await deps.removeWorkHistoryEntry(agentSessionWorkEntry(agentId, sessionId, '').id)
      if (wasActiveWork) {
        await deps.openFilesWorkPreservingArtifact()
      }
      deps.incrementArchiveRefresh()
    } catch (err) {
      deps.setWorkNavigationError(err)
    }
  }

  async function deleteAgentSession(sessionId: string) {
    try {
      const wasActiveWork = deps.activeWork()?.kind === 'agent-session' && deps.activeWork()?.sessionId === sessionId
      const agentId = deps.agentSessions().find(item => item.sessionId === sessionId)?.agentId ?? ''
      await deps.callKernel('agent.sessions.delete', { sessionId })
      deps.removeAgentSession(sessionId)
      await deps.removeWorkHistoryEntry(agentSessionWorkEntry(agentId, sessionId, '').id)
      if (wasActiveWork) {
        await deps.openFilesWorkPreservingArtifact()
      }
      deps.incrementArchiveRefresh()
    } catch (err) {
      deps.setWorkNavigationError(err)
    }
  }

  async function archiveSession(sessionId: string) {
    try {
      const wasActiveWork = deps.activeWork()?.kind === 'chat' && deps.activeWork()?.sessionId === sessionId
      await deps.archiveChatSession(sessionId)
      await deps.removeWorkHistoryEntry(chatWorkEntry(sessionId).id)
      if (wasActiveWork) await deps.openFallbackWork()
      deps.incrementArchiveRefresh()
    } catch (err) {
      deps.setWorkNavigationError(err)
    }
  }

  async function deleteSession(sessionId: string) {
    try {
      const wasActiveWork = deps.activeWork()?.kind === 'chat' && deps.activeWork()?.sessionId === sessionId
      await deps.deleteChatSession(sessionId)
      await deps.removeWorkHistoryEntry(chatWorkEntry(sessionId).id)
      if (wasActiveWork) await deps.openFallbackWork()
      deps.incrementArchiveRefresh()
    } catch (err) {
      deps.setWorkNavigationError(err)
    }
  }

  return {
    openPackageRunWork,
    hydratePackageRun,
    archivePackageRun,
    deletePackageRun,
    agentSessionTitle,
    launchAgentSession,
    openAgentSessionWork,
    stopAgentSession,
    archiveAgentSession,
    deleteAgentSession,
    archiveSession,
    deleteSession,
  }
}
