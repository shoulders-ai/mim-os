import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('../services/pingSound.js', () => ({ playPingSound: vi.fn() }))

import { playPingSound } from '../services/pingSound.js'
import { pingOutcome, usePingsStore } from './pings.js'
import {
  useRunsStore,
  type AgentSessionRuntime,
  type PackageRunRecord,
} from './runs.js'

function stubStorage(): Map<string, string> {
  const map = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)) },
    removeItem: (key: string) => { map.delete(key) },
  })
  return map
}

function packageRun(overrides: Partial<PackageRunRecord> = {}): PackageRunRecord {
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

describe('pingOutcome', () => {
  it('only fires on transitions out of working', () => {
    expect(pingOutcome(undefined, 'done')).toBeNull()
    expect(pingOutcome('done', 'done')).toBeNull()
    expect(pingOutcome('working', 'working')).toBeNull()
    expect(pingOutcome('needs-input', 'done')).toBeNull()
  })

  it('maps settled statuses to done / input / error', () => {
    expect(pingOutcome('working', 'done')).toBe('done')
    expect(pingOutcome('working', 'ready')).toBe('done')
    expect(pingOutcome('working', 'idle')).toBe('done')
    expect(pingOutcome('working', 'stopped')).toBe('done')
    expect(pingOutcome('working', 'cancelled')).toBe('done')
    expect(pingOutcome('working', 'needs-input')).toBe('input')
    expect(pingOutcome('working', 'needs-approval')).toBe('input')
    expect(pingOutcome('working', 'paused')).toBe('input')
    expect(pingOutcome('working', 'error')).toBe('error')
    expect(pingOutcome('working', 'missing')).toBe('error')
  })
})

describe('pings store', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = stubStorage()
    setActivePinia(createPinia())
    vi.mocked(playPingSound).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pings once when an armed package run finishes', async () => {
    const runs = useRunsStore()
    const pings = usePingsStore()
    pings.toggle('package:run1')

    runs.setPackageRuns([packageRun({ status: 'running' })])
    await nextTick()
    expect(playPingSound).not.toHaveBeenCalled()

    runs.setPackageRuns([packageRun({ status: 'completed', completedAt: '2026-01-01T00:01:00.000Z' })])
    await nextTick()
    expect(playPingSound).toHaveBeenCalledTimes(1)
    expect(pings.settledOutcome('package:run1')).toBe('done')
  })

  it('stays silent for rows that are not armed', async () => {
    const runs = useRunsStore()
    usePingsStore()

    runs.setPackageRuns([packageRun({ status: 'running' })])
    await nextTick()
    runs.setPackageRuns([packageRun({ status: 'completed' })])
    await nextTick()
    expect(playPingSound).not.toHaveBeenCalled()
  })

  it('does not ping on first sight of an already-settled run', async () => {
    const runs = useRunsStore()
    const pings = usePingsStore()
    pings.toggle('package:run1')

    runs.setPackageRuns([packageRun({ status: 'completed' })])
    await nextTick()
    expect(playPingSound).not.toHaveBeenCalled()
  })

  it('maps agent needs-input to the input outcome', async () => {
    const runs = useRunsStore()
    const pings = usePingsStore()
    pings.toggle('agent:a1')

    runs.setAgentSessions([agentSession()])
    await nextTick()
    runs.setAgentSessions([agentSession({ runtimeStatus: 'needs-input' })])
    await nextTick()
    expect(playPingSound).toHaveBeenCalledTimes(1)
    expect(pings.settledOutcome('agent:a1')).toBe('input')
  })

  it('maps failures to the error outcome', async () => {
    const runs = useRunsStore()
    const pings = usePingsStore()
    pings.toggle('package:run1')

    runs.setPackageRuns([packageRun({ status: 'running' })])
    await nextTick()
    runs.setPackageRuns([packageRun({ status: 'failed', error: 'boom' })])
    await nextTick()
    expect(pings.settledOutcome('package:run1')).toBe('error')
  })

  it('stays armed across runs: re-working clears settled, next finish pings again', async () => {
    const runs = useRunsStore()
    const pings = usePingsStore()
    pings.toggle('agent:a1')

    runs.setAgentSessions([agentSession()])
    await nextTick()
    runs.setAgentSessions([agentSession({ runtimeStatus: 'done' })])
    await nextTick()
    expect(playPingSound).toHaveBeenCalledTimes(1)
    expect(pings.settledOutcome('agent:a1')).toBe('done')

    runs.setAgentSessions([agentSession({ runtimeStatus: 'working' })])
    await nextTick()
    expect(pings.settledOutcome('agent:a1')).toBeNull()
    expect(pings.isArmed('agent:a1')).toBe(true)

    runs.setAgentSessions([agentSession({ runtimeStatus: 'done' })])
    await nextTick()
    expect(playPingSound).toHaveBeenCalledTimes(2)
  })

  it('plays one chime when several armed rows settle in the same tick', async () => {
    const runs = useRunsStore()
    const pings = usePingsStore()
    pings.toggle('package:run1')
    pings.toggle('package:run2')

    runs.setPackageRuns([
      packageRun({ runId: 'run1', status: 'running' }),
      packageRun({ runId: 'run2', status: 'running' }),
    ])
    await nextTick()
    runs.setPackageRuns([
      packageRun({ runId: 'run1', status: 'completed' }),
      packageRun({ runId: 'run2', status: 'completed' }),
    ])
    await nextTick()
    expect(playPingSound).toHaveBeenCalledTimes(1)
    expect(pings.settledOutcome('package:run1')).toBe('done')
    expect(pings.settledOutcome('package:run2')).toBe('done')
  })

  it('persists armed keys across store instances', () => {
    const pings = usePingsStore()
    pings.toggle('chat:s1')
    expect(storage.get('mim:ping-when-done')).toContain('chat:s1')

    setActivePinia(createPinia())
    const fresh = usePingsStore()
    expect(fresh.isArmed('chat:s1')).toBe(true)
  })

  it('unsetting disarms and drops any settled state', async () => {
    const runs = useRunsStore()
    const pings = usePingsStore()
    pings.toggle('package:run1')

    runs.setPackageRuns([packageRun({ status: 'running' })])
    await nextTick()
    runs.setPackageRuns([packageRun({ status: 'completed' })])
    await nextTick()
    expect(pings.settledOutcome('package:run1')).toBe('done')

    pings.toggle('package:run1')
    expect(pings.isArmed('package:run1')).toBe(false)
    expect(pings.settledOutcome('package:run1')).toBeNull()

    setActivePinia(createPinia())
    expect(usePingsStore().isArmed('package:run1')).toBe(false)
  })

  it('clearSettled quiets the indicator without disarming', async () => {
    const runs = useRunsStore()
    const pings = usePingsStore()
    pings.toggle('package:run1')

    runs.setPackageRuns([packageRun({ status: 'running' })])
    await nextTick()
    runs.setPackageRuns([packageRun({ status: 'completed' })])
    await nextTick()

    pings.clearSettled('package:run1')
    expect(pings.settledOutcome('package:run1')).toBeNull()
    expect(pings.isArmed('package:run1')).toBe(true)
  })

  it('caps the armed set by evicting the oldest key', () => {
    const pings = usePingsStore()
    for (let i = 0; i < 201; i++) pings.toggle(`chat:s${i}`)
    expect(pings.isArmed('chat:s0')).toBe(false)
    expect(pings.isArmed('chat:s200')).toBe(true)
  })
})
