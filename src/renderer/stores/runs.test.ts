import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  packageRunDisplayTitle,
  useRunsStore,
  type AgentSessionRuntime,
  type PackageRunRecord,
} from './runs.js'
import { useSessionStore, type Session } from './sessions.js'

function session(overrides: Partial<Session>): Session {
  return {
    id: 's1',
    label: 'Chat',
    modelId: '',
    controlId: '',
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    lastContextTokens: 0,
    lastInputTokens: 0,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function packageRun(overrides: Partial<PackageRunRecord>): PackageRunRecord {
  return {
    runId: 'run1',
    packageId: 'pkg',
    jobId: 'job',
    status: 'running',
    inputs: {},
    startedAt: '2026-01-01T00:00:00.000Z',
    events: [],
    ...overrides,
  }
}

// AgentSessionRuntime mirrors src/main/agents/agentSessions.ts — the renderer
// defines the type locally (same pattern as PackageRunRecord above).
function agentSession(overrides: Partial<AgentSessionRuntime> = {}): AgentSessionRuntime {
  return {
    sessionId: 'a1',
    agentId: 'claude-code',
    title: 'Claude Code',
    command: 'claude',
    cwd: '/ws',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('runs store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('aggregates chat session statuses into Navigator-ready runs', () => {
    const sessions = useSessionStore()
    const runs = useRunsStore()
    sessions.sessions = [
      session({ id: 's1', label: 'Active chat', messages: [{ id: 'm1', role: 'user', content: 'hi' }] }),
      session({ id: 'archived', archived: true }),
    ]
    sessions.setSessionStatus('s1', 'working')

    expect(runs.allRuns).toEqual([
      expect.objectContaining({
        id: 'chat:s1',
        kind: 'chat',
        sourceId: 's1',
        title: 'Active chat',
        status: 'working',
      }),
    ])
  })

  it('aggregates app jobs without becoming their persistence layer', () => {
    const runs = useRunsStore()
    runs.setPackageRuns([
      packageRun({ runId: 'done', status: 'completed', packageId: 'docs', jobId: 'review' }),
      packageRun({ runId: 'failed', status: 'failed', packageId: 'docs', jobId: 'extract' }),
      packageRun({ runId: 'archived', status: 'completed', packageId: 'docs', jobId: 'old', archived: true }),
    ])

    expect(runs.packageRuns).toHaveLength(3)
    expect(runs.archivedPackageRuns.map(run => run.runId)).toEqual(['archived'])
    expect(runs.allRuns.map(run => [run.id, run.status])).toEqual([
      ['package:done', 'done'],
      ['package:failed', 'error'],
    ])
  })

  it('can remove app runs from the Navigator aggregate after deletion', () => {
    const runs = useRunsStore()
    runs.setPackageRuns([
      packageRun({ runId: 'done', status: 'completed', packageId: 'docs', jobId: 'review' }),
    ])

    runs.removePackageRun('done')

    expect(runs.packageRuns).toEqual([])
    expect(runs.allRuns).toEqual([])
  })

  it('updates app run records from job events without requiring a full reload', () => {
    const runs = useRunsStore()

    runs.applyPackageJobEvent({
      type: 'job.started',
      packageId: 'docs',
      jobId: 'review',
      runId: 'run1',
      ts: '2026-01-01T00:00:00.000Z',
      sequence: 1,
      data: { label: 'Review' },
    })
    runs.applyPackageJobEvent({
      type: 'job.done',
      packageId: 'docs',
      jobId: 'review',
      runId: 'run1',
      ts: '2026-01-01T00:01:00.000Z',
      sequence: 2,
      data: { result: 'ok' },
    })

    expect(runs.packageRuns[0].status).toBe('completed')
    expect(runs.allRuns[0]).toEqual(expect.objectContaining({
      id: 'package:run1',
      status: 'done',
      title: 'Review',
    }))
  })

  it('ignores ephemeral app job events so they never reach Activity', () => {
    const runs = useRunsStore()

    runs.applyPackageJobEvent({
      type: 'job.started',
      packageId: 'github-monitor',
      jobId: 'sync',
      runId: 'eph1',
      ts: '2026-01-01T00:00:00.000Z',
      sequence: 1,
      ephemeral: true,
      data: { label: 'Sync' },
    })
    runs.applyPackageJobEvent({
      type: 'job.done',
      packageId: 'github-monitor',
      jobId: 'sync',
      runId: 'eph1',
      ts: '2026-01-01T00:01:00.000Z',
      sequence: 2,
      ephemeral: true,
      data: { result: 'ok' },
    })

    expect(runs.packageRuns).toEqual([])
    expect(runs.allRuns).toEqual([])
  })

  it('uses the started job label as the Navigator title when available', () => {
    expect(packageRunDisplayTitle(packageRun({
      label: 'Renamed review',
      packageId: 'docs',
      jobId: 'review',
      events: [{
        type: 'job.started',
        packageId: 'docs',
        jobId: 'review',
        runId: 'run1',
        ts: '2026-01-01T00:00:00.000Z',
        sequence: 1,
        data: { label: 'Original review' },
      }],
    }))).toBe('Renamed review')
    expect(packageRunDisplayTitle(packageRun({
      packageId: 'docs',
      jobId: 'review',
      events: [{
        type: 'job.started',
        packageId: 'docs',
        jobId: 'review',
        runId: 'run1',
        ts: '2026-01-01T00:00:00.000Z',
        sequence: 1,
        data: { label: 'Review document' },
      }],
    }))).toBe('Review document')
    expect(packageRunDisplayTitle(packageRun({
      packageId: 'docs',
      jobId: 'review',
      events: [],
    }))).toBe('docs / review')
  })
})

describe('runs store app run rename', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renames through the kernel and upserts the persisted run', async () => {
    const call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'package.jobs.rename') {
        return { run: packageRun({ runId: String(params?.runId), label: String(params?.label) }) }
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const runs = useRunsStore()
    runs.setPackageRuns([packageRun({ runId: 'run1', label: 'Old label' })])

    await expect(runs.renamePackageRun('run1', 'New label')).resolves.toBe(true)
    expect(call).toHaveBeenCalledWith('package.jobs.rename', { runId: 'run1', label: 'New label' })
    expect(runs.packageRuns[0]?.label).toBe('New label')
  })

  it('reports a failed rename without mutating state', async () => {
    const call = vi.fn(async () => { throw new Error('boom') })
    vi.stubGlobal('window', { kernel: { call } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const runs = useRunsStore()
    runs.setPackageRuns([packageRun({ runId: 'run1', label: 'Old label' })])

    await expect(runs.renamePackageRun('run1', 'New label')).resolves.toBe(false)
    expect(runs.packageRuns[0]?.label).toBe('Old label')
  })
})

describe('runs store agent sessions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('maps agent session records to Navigator runs with agent-scoped ids', () => {
    const runs = useRunsStore()
    runs.setAgentSessions([agentSession({
      sessionId: 'a1',
      title: 'Claude Code',
      status: 'done',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:05:00.000Z',
    })])

    expect(runs.agentSessionRuns).toEqual([{
      id: 'agent:a1',
      kind: 'agent-session',
      sourceId: 'a1',
      title: 'Claude Code',
      status: 'done',
      updatedAt: '2026-01-01T00:05:00.000Z',
    }])
  })

  it('falls back to startedAt for updatedAt while the session is still running', () => {
    const runs = useRunsStore()
    runs.setAgentSessions([agentSession({ sessionId: 'a1', status: 'running' })])

    expect(runs.agentSessionRuns[0]?.updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('maps each session status onto the Navigator status vocabulary', () => {
    const runs = useRunsStore()
    runs.setAgentSessions([
      agentSession({ sessionId: 'working', status: 'running' }),
      agentSession({ sessionId: 'input', status: 'running', runtimeStatus: 'needs-input' }),
      agentSession({ sessionId: 'task-done', status: 'running', runtimeStatus: 'done' }),
      agentSession({ sessionId: 'idle', status: 'running', runtimeStatus: 'idle' }),
      agentSession({ sessionId: 'done', status: 'done' }),
      agentSession({ sessionId: 'error', status: 'error' }),
      agentSession({ sessionId: 'stopped', status: 'stopped' }),
      // Interrupted sessions (app quit mid-run) surface as errors, mirroring
      // app jobs boot reconciliation marking interrupted runs failed.
      agentSession({ sessionId: 'interrupted', status: 'interrupted' }),
    ])

    expect(runs.agentSessionRuns.map(run => [run.sourceId, run.status])).toEqual([
      ['working', 'working'],
      ['input', 'needs-input'],
      ['task-done', 'done'],
      ['idle', 'idle'],
      ['done', 'done'],
      ['error', 'error'],
      ['stopped', 'stopped'],
      ['interrupted', 'error'],
    ])
  })

  it('ignores the needs-input runtime overlay once the session has ended', () => {
    const runs = useRunsStore()
    runs.setAgentSessions([
      agentSession({ sessionId: 'a1', status: 'done', runtimeStatus: 'needs-input' }),
      agentSession({ sessionId: 'a2', status: 'done', runtimeStatus: 'idle' }),
    ])

    expect(runs.agentSessionRuns[0]?.status).toBe('done')
    expect(runs.agentSessionRuns[1]?.status).toBe('done')
  })

  it('excludes archived sessions from Navigator runs but exposes them for History', () => {
    const runs = useRunsStore()
    runs.setAgentSessions([
      agentSession({ sessionId: 'live', status: 'running' }),
      agentSession({ sessionId: 'old', status: 'done', archived: true }),
    ])

    expect(runs.agentSessionRuns.map(run => run.sourceId)).toEqual(['live'])
    expect(runs.archivedAgentSessions.map(item => item.sessionId)).toEqual(['old'])
  })

  it('merges agent sessions into allRuns after chats and app runs', () => {
    const sessions = useSessionStore()
    const runs = useRunsStore()
    sessions.sessions = [session({ id: 's1', label: 'Chat', messages: [{ id: 'm1', role: 'user', content: 'hi' }] })]
    runs.setPackageRuns([packageRun({ runId: 'p1', status: 'completed' })])
    runs.setAgentSessions([agentSession({ sessionId: 'a1' })])

    expect(runs.allRuns.map(run => run.id)).toEqual(['chat:s1', 'package:p1', 'agent:a1'])
  })

  it('upserts sessions from each agent session event type', () => {
    const runs = useRunsStore()

    runs.applyAgentSessionEvent({
      type: 'session.started',
      session: agentSession({ sessionId: 'a1', status: 'running' }),
    })
    expect(runs.agentSessions.map(item => [item.sessionId, item.status])).toEqual([['a1', 'running']])

    runs.applyAgentSessionEvent({
      type: 'session.status',
      session: agentSession({ sessionId: 'a1', status: 'running', runtimeStatus: 'needs-input' }),
    })
    expect(runs.agentSessions[0]?.runtimeStatus).toBe('needs-input')

    runs.applyAgentSessionEvent({
      type: 'session.exited',
      session: agentSession({ sessionId: 'a1', status: 'done', endedAt: '2026-01-01T00:09:00.000Z', exitCode: 0 }),
    })
    expect(runs.agentSessions[0]?.status).toBe('done')
    expect(runs.agentSessions[0]?.endedAt).toBe('2026-01-01T00:09:00.000Z')

    runs.applyAgentSessionEvent({
      type: 'session.changed',
      session: agentSession({ sessionId: 'a1', status: 'done', title: 'Renamed run', endedAt: '2026-01-01T00:09:00.000Z' }),
    })
    expect(runs.agentSessions).toHaveLength(1)
    expect(runs.agentSessions[0]?.title).toBe('Renamed run')
  })

  it('inserts unknown sessions from events at the front of the list', () => {
    const runs = useRunsStore()
    runs.setAgentSessions([agentSession({ sessionId: 'old' })])

    runs.applyAgentSessionEvent({
      type: 'session.started',
      session: agentSession({ sessionId: 'new' }),
    })

    expect(runs.agentSessions.map(item => item.sessionId)).toEqual(['new', 'old'])
  })

  it('removes deleted sessions from the aggregate', () => {
    const runs = useRunsStore()
    runs.setAgentSessions([agentSession({ sessionId: 'a1' })])

    runs.removeAgentSession('a1')

    expect(runs.agentSessions).toEqual([])
    expect(runs.allRuns).toEqual([])
  })

  it('renames through the kernel and upserts the persisted session', async () => {
    const call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'agent.sessions.rename') {
        return { session: agentSession({ sessionId: String(params?.sessionId), title: String(params?.title) }) }
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const runs = useRunsStore()
    runs.setAgentSessions([agentSession({ sessionId: 'a1', title: 'Old title' })])

    await expect(runs.renameAgentSession('a1', 'New title')).resolves.toBe(true)
    expect(call).toHaveBeenCalledWith('agent.sessions.rename', { sessionId: 'a1', title: 'New title' })
    expect(runs.agentSessions[0]?.title).toBe('New title')
  })

  it('reports a failed agent session rename without mutating state', async () => {
    const call = vi.fn(async () => { throw new Error('boom') })
    vi.stubGlobal('window', { kernel: { call } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const runs = useRunsStore()
    runs.setAgentSessions([agentSession({ sessionId: 'a1', title: 'Old title' })])

    await expect(runs.renameAgentSession('a1', 'New title')).resolves.toBe(false)
    expect(runs.agentSessions[0]?.title).toBe('Old title')
  })
})
