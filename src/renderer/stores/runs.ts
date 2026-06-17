import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSessionStore, type Session, type SessionStatusKind } from './sessions.js'

export type RunStatus =
  | 'ready'
  | 'working'
  | 'needs-input'
  | 'idle'
  | 'needs-approval'
  | 'done'
  | 'error'
  | 'paused'
  | 'cancelled'
  | 'stopped'
  | 'missing'

export type RunKind = 'chat' | 'package-job' | 'workflow' | 'agent-session'

export interface NavigatorRun {
  id: string
  kind: RunKind
  sourceId: string
  title: string
  status: RunStatus
  updatedAt?: string
  packageId?: string
  jobId?: string
}

export type PackageRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface PackageRunEvent {
  type: string
  packageId: string
  jobId: string
  runId: string
  ts: string
  sequence: number
  ephemeral?: true
  data?: Record<string, unknown>
}

export interface PackageRunRecord {
  runId: string
  packageId: string
  jobId: string
  label?: string
  status: PackageRunStatus
  inputs: Record<string, unknown>
  startedAt: string
  completedAt?: string
  result?: unknown
  error?: string
  archived?: boolean
  events: PackageRunEvent[]
}

// Agent session shapes mirror src/main/agents/agentSessions.ts — the renderer
// defines them locally (same pattern as PackageRunRecord above).
export type AgentSessionStatus = 'running' | 'done' | 'error' | 'stopped' | 'interrupted'
export type AgentRuntimeStatus = 'working' | 'needs-input' | 'done' | 'idle'

export interface AgentSessionRuntime {
  sessionId: string
  agentId: string
  title: string
  command: string
  cwd: string
  status: AgentSessionStatus
  startedAt: string
  endedAt?: string
  exitCode?: number
  archived?: boolean
  titleHint?: string
  // Live-only overlay fields, never persisted by main.
  ptyId?: number
  runtimeStatus?: AgentRuntimeStatus
  scrollback?: string
}

export interface AgentSessionEvent {
  type: 'session.started' | 'session.status' | 'session.exited' | 'session.changed'
  session: AgentSessionRuntime
}

export const useRunsStore = defineStore('runs', () => {
  const packageRuns = ref<PackageRunRecord[]>([])
  const agentSessions = ref<AgentSessionRuntime[]>([])
  const sessionStore = useSessionStore()

  const chatRuns = computed<NavigatorRun[]>(() =>
    sessionStore.visibleSessions.map(sessionToRun)
  )

  const packageJobRuns = computed<NavigatorRun[]>(() =>
    packageRuns.value.filter(run => run.archived !== true).map(packageRunToNavigatorRun)
  )

  const archivedPackageRuns = computed<PackageRunRecord[]>(() =>
    packageRuns.value.filter(run => run.archived === true)
  )

  const agentSessionRuns = computed<NavigatorRun[]>(() =>
    agentSessions.value
      .filter(item => item.archived !== true)
      .map(agentSessionToNavigatorRun)
  )

  const archivedAgentSessions = computed<AgentSessionRuntime[]>(() =>
    agentSessions.value.filter(item => item.archived === true)
  )

  const allRuns = computed<NavigatorRun[]>(() => [
    ...chatRuns.value,
    ...packageJobRuns.value,
    ...agentSessionRuns.value,
  ])

  function setPackageRuns(runs: PackageRunRecord[]) {
    packageRuns.value = runs.map(run => ({ ...run, events: [...(run.events ?? [])] }))
  }

  function upsertPackageRun(run: PackageRunRecord) {
    const idx = packageRuns.value.findIndex(item => item.runId === run.runId)
    const copy = { ...run, events: [...(run.events ?? [])] }
    if (idx >= 0) packageRuns.value[idx] = copy
    else packageRuns.value.unshift(copy)
  }

  function removePackageRun(runId: string) {
    packageRuns.value = packageRuns.value.filter(run => run.runId !== runId)
  }

  // Returns false on failure so callers can keep their edit affordance open.
  async function renamePackageRun(runId: string, label: string): Promise<boolean> {
    try {
      const result = await window.kernel.call('package.jobs.rename', { runId, label }) as { run?: PackageRunRecord }
      if (result.run?.runId) upsertPackageRun(result.run)
      return true
    } catch (err) {
      console.error('[runs] failed to rename package run:', err)
      return false
    }
  }

  function setAgentSessions(list: AgentSessionRuntime[]) {
    agentSessions.value = list.map(item => ({ ...item }))
  }

  function upsertAgentSession(session: AgentSessionRuntime) {
    const idx = agentSessions.value.findIndex(item => item.sessionId === session.sessionId)
    const copy = { ...session }
    if (idx >= 0) agentSessions.value[idx] = copy
    else agentSessions.value.unshift(copy)
  }

  // Every agent:session-event carries the full session record, so all event
  // types reduce to the same upsert.
  function applyAgentSessionEvent(event: AgentSessionEvent) {
    upsertAgentSession(event.session)
  }

  function removeAgentSession(sessionId: string) {
    agentSessions.value = agentSessions.value.filter(item => item.sessionId !== sessionId)
  }

  // Returns false on failure so callers can keep their edit affordance open.
  async function renameAgentSession(sessionId: string, title: string): Promise<boolean> {
    try {
      const result = await window.kernel.call('agent.sessions.rename', { sessionId, title }) as { session?: AgentSessionRuntime }
      if (result.session?.sessionId) upsertAgentSession(result.session)
      return true
    } catch (err) {
      console.error('[runs] failed to rename agent session:', err)
      return false
    }
  }

  function applyPackageJobEvent(event: PackageRunEvent) {
    // Ephemeral runs are package housekeeping. They never become Activity rows.
    if (event.ephemeral === true) return
    const existing = packageRuns.value.find(run => run.runId === event.runId)
    if (!existing) {
      const label = event.type === 'job.started' && typeof event.data?.label === 'string'
        ? event.data.label
        : undefined
      packageRuns.value.unshift({
        runId: event.runId,
        packageId: event.packageId,
        jobId: event.jobId,
        label,
        status: statusFromEvent(event, 'running'),
        inputs: {},
        startedAt: event.ts,
        completedAt: completedAtFromEvent(event),
        error: errorFromEvent(event),
        events: [event],
      })
      return
    }

    existing.events = [
      ...existing.events.filter(item => item.sequence !== event.sequence),
      event,
    ].sort((a, b) => a.sequence - b.sequence)
    existing.status = statusFromEvent(event, existing.status)
    existing.completedAt = completedAtFromEvent(event) ?? existing.completedAt
    existing.error = errorFromEvent(event) ?? existing.error
  }

  return {
    packageRuns,
    agentSessions,
    chatRuns,
    packageJobRuns,
    archivedPackageRuns,
    agentSessionRuns,
    archivedAgentSessions,
    allRuns,
    setPackageRuns,
    upsertPackageRun,
    removePackageRun,
    renamePackageRun,
    applyPackageJobEvent,
    setAgentSessions,
    applyAgentSessionEvent,
    removeAgentSession,
    renameAgentSession,
  }
})

function sessionToRun(session: Session): NavigatorRun {
  const sessionStore = useSessionStore()
  return {
    id: `chat:${session.id}`,
    kind: 'chat',
    sourceId: session.id,
    title: session.label,
    status: mapSessionStatus(sessionStore.sessionStatusKind(session)),
    updatedAt: session.updatedAt,
  }
}

function mapSessionStatus(status: SessionStatusKind): RunStatus {
  if (status === 'working') return 'working'
  if (status === 'error') return 'error'
  if (status === 'needs-approval') return 'needs-approval'
  if (status === 'ready') return 'ready'
  return 'done'
}

function packageRunToNavigatorRun(run: PackageRunRecord): NavigatorRun {
  return {
    id: `package:${run.runId}`,
    kind: 'package-job',
    sourceId: run.runId,
    title: packageRunDisplayTitle(run),
    status: mapPackageStatus(run.status),
    updatedAt: run.completedAt ?? run.startedAt,
    packageId: run.packageId,
    jobId: run.jobId,
  }
}

export function packageRunDisplayTitle(run: Pick<PackageRunRecord, 'packageId' | 'jobId' | 'events' | 'label'>): string {
  if (typeof run.label === 'string' && run.label.trim().length > 0) return run.label
  const started = run.events.find(event => event.type === 'job.started')
  const label = started?.data?.label
  if (typeof label === 'string' && label.length > 0) return label
  return `${run.packageId} / ${run.jobId}`
}

function mapPackageStatus(status: PackageRunStatus): RunStatus {
  if (status === 'running') return 'working'
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'error'
  return 'cancelled'
}

function agentSessionToNavigatorRun(session: AgentSessionRuntime): NavigatorRun {
  return {
    id: `agent:${session.sessionId}`,
    kind: 'agent-session',
    sourceId: session.sessionId,
    title: session.title,
    status: mapAgentSessionStatus(session),
    updatedAt: session.endedAt ?? session.startedAt,
  }
}

function mapAgentSessionStatus(session: AgentSessionRuntime): RunStatus {
  if (session.status === 'running') {
    if (session.runtimeStatus === 'idle') return 'idle'
    if (session.runtimeStatus === 'done') return 'done'
    if (session.runtimeStatus === 'needs-input') return 'needs-input'
    return 'working'
  }
  if (session.status === 'done') return 'done'
  if (session.status === 'stopped') return 'stopped'
  // 'error' and 'interrupted' both surface as errors — mirrors packageJobs
  // boot reconciliation marking interrupted runs failed.
  return 'error'
}

function statusFromEvent(
  event: PackageRunEvent,
  fallback: PackageRunStatus,
): PackageRunStatus {
  if (event.type === 'job.started') return 'running'
  if (event.type === 'job.failed') return 'failed'
  if (event.type === 'job.cancelled') return 'cancelled'
  if (event.type === 'job.done' && event.data && 'result' in event.data) return 'completed'
  return fallback
}

function completedAtFromEvent(event: PackageRunEvent): string | undefined {
  if (event.type === 'job.failed' || event.type === 'job.cancelled') return event.ts
  if (event.type === 'job.done' && event.data && 'result' in event.data) return event.ts
  return undefined
}

function errorFromEvent(event: PackageRunEvent): string | undefined {
  if (event.type !== 'job.failed' && event.type !== 'job.cancelled') return undefined
  const error = event.data?.error
  return typeof error === 'string' ? error : undefined
}
