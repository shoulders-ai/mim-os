// Agent session lifecycle: each launched CLI agent (Claude Code, Codex, ...)
// is a first-class run with a persisted record, scrollback capture, and a
// status lifecycle. Deliberately mirrors packages/packageJobs.ts shapes
// (persist via atomicWriteJson on every transition, boot-time stale
// reconciliation, rename/archive/delete, active count for the close guard).
//
// System boundaries are injected: the pty spawn factory (pty.ts in
// production), the emit-to-windows function, clock, and id generator — so
// tests never touch node-pty or Electron.

import { existsSync, appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { atomicWriteJson } from '@main/atomicJson.js'
import { createAgentStatusTracker, type AgentRuntimeStatus, type AgentStatusTracker } from '@main/agents/agentStatus.js'
import { sessionIdArgs, resumeArgs as catalogResumeArgs } from '@main/agents/agentCatalog.js'
import type { DetectedAgent } from '@main/agents/agentCatalog.js'
import type { PtyHandle, PtySpawnOptions } from '@main/pty.js'

// Scrollback cap: the .scrollback file grows by raw append until it exceeds
// MAX, then is rewritten keeping only the most recent KEEP bytes (truncation
// from the front). Coarse byte-level truncation is fine — xterm replay
// resynchronises on the next escape sequence.
export const SCROLLBACK_MAX_BYTES = 2 * 1024 * 1024
export const SCROLLBACK_KEEP_BYTES = 1024 * 1024

export type AgentSessionStatus = 'running' | 'done' | 'error' | 'stopped' | 'interrupted'

export interface AgentSessionRecord {
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
  titleHint?: string // last OSC 0/1/2 title seen; persisted on change
}

// Record plus live runtime state, merged for the renderer: ptyId lets it
// attach xterm to the running pty; runtimeStatus drives the needs-input dot.
// Neither field is ever persisted.
export interface AgentSessionRuntime extends AgentSessionRecord {
  ptyId?: number
  runtimeStatus?: AgentRuntimeStatus
  scrollback?: string
}

export interface AgentSessionEvent {
  type: 'session.started' | 'session.status' | 'session.exited' | 'session.changed' | 'session.deleted'
  session: AgentSessionRuntime
}

export interface AgentSessionsOptions {
  getWorkspacePath: () => string | null
  spawnPty: (options: PtySpawnOptions) => PtyHandle
  getMcpServerPort: () => number
  createMcpToken: (sessionId: string) => string
  revokeMcpToken: (token: string) => void
  emit?: (event: string, data: unknown) => void
  now?: () => Date
  generateId?: () => string
  scrollbackMaxBytes?: number
  scrollbackKeepBytes?: number
  idleThresholdMs?: number
}

export interface AgentSessions {
  launch(agent: DetectedAgent): { record: AgentSessionRuntime; ptyId: number }
  resume(sessionId: string, agent: DetectedAgent): { record: AgentSessionRuntime; ptyId: number }
  stop(sessionId: string): AgentSessionRuntime
  list(options?: { includeArchived?: boolean; archived?: boolean }): AgentSessionRuntime[]
  get(sessionId: string, options?: { scrollback?: boolean }): AgentSessionRuntime | null
  rename(sessionId: string, title: string): AgentSessionRuntime
  archive(sessionId: string, archived?: boolean): AgentSessionRuntime
  delete(sessionId: string): { deleted: string }
  reconcileStaleSessions(): void
  activeSessionCount(): number
}

interface LiveSession {
  record: AgentSessionRecord
  handle: PtyHandle
  tracker: AgentStatusTracker
  scrollbackPath: string
  scrollbackBytes: number
  // Set before handle.kill() so the exit handler classifies the exit as
  // 'stopped' regardless of the (non-zero) exit code the stop produces.
  stopRequested: boolean
  idleTimer?: ReturnType<typeof setTimeout>
  lastStatus: AgentRuntimeStatus
  lastTitleHint: string | undefined
  mcpToken?: string
}

export function createAgentSessions(options: AgentSessionsOptions): AgentSessions {
  const now = options.now ?? (() => new Date())
  const generateId = options.generateId ?? randomUUID
  const maxBytes = options.scrollbackMaxBytes ?? SCROLLBACK_MAX_BYTES
  const keepBytes = options.scrollbackKeepBytes ?? SCROLLBACK_KEEP_BYTES
  const idleThresholdMs = options.idleThresholdMs ?? 5000
  const active = new Map<string, LiveSession>()

  function requireWorkspace(): string {
    const workspacePath = options.getWorkspacePath()
    if (!workspacePath) throw new Error('No workspace open')
    return workspacePath
  }

  const sessionsDir = () => join(requireWorkspace(), '.mim', 'agent-sessions')
  const recordPath = (sessionId: string) => join(sessionsDir(), `${sessionId}.json`)
  const scrollbackPath = (sessionId: string) => join(sessionsDir(), `${sessionId}.scrollback`)

  function persist(record: AgentSessionRecord): void {
    atomicWriteJson(recordPath(record.sessionId), record)
  }

  function emitEvent(type: AgentSessionEvent['type'], session: AgentSessionRuntime): void {
    options.emit?.('agent:session-event', { type, session } satisfies AgentSessionEvent)
  }

  function withRuntime(record: AgentSessionRecord): AgentSessionRuntime {
    const live = active.get(record.sessionId)
    if (!live) return { ...record }
    return {
      ...record,
      ptyId: live.handle.ptyId,
      runtimeStatus: live.tracker.status(),
    }
  }

  // Quarantine convention from sessions.ts: a corrupt record never poisons
  // list/get — rename it `.corrupt` with a console.error and move on.
  function parseRecordFile(path: string): AgentSessionRecord | null {
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as AgentSessionRecord
    } catch {
      renameSync(path, `${path}.corrupt`)
      console.error(`Corrupt agent session file renamed: ${path} -> ${path}.corrupt`)
      return null
    }
  }

  function readRecord(sessionId: string): AgentSessionRecord | null {
    // Live records are the same objects that get persisted, so disk is only
    // needed for sessions without a live pty.
    const live = active.get(sessionId)
    if (live) return live.record
    const path = recordPath(sessionId)
    if (!existsSync(path)) return null
    return parseRecordFile(path)
  }

  function requireRecord(sessionId: string): AgentSessionRecord {
    const record = readRecord(sessionId)
    if (!record) throw new Error(`Agent session not found: ${sessionId}`)
    return record
  }

  function readAllRecords(): AgentSessionRecord[] {
    const dir = sessionsDir()
    if (!existsSync(dir)) return []
    const records: AgentSessionRecord[] = []
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      const record = parseRecordFile(join(dir, file))
      if (!record) continue
      records.push(active.get(record.sessionId)?.record ?? record)
    }
    return records
  }

  function defaultTitle(name: string): string {
    const taken = new Set(readAllRecords().map(record => record.title))
    if (!taken.has(name)) return name
    let n = 2
    while (taken.has(`${name} ${n}`)) n++
    return `${name} ${n}`
  }

  function appendScrollback(live: LiveSession, chunk: string): void {
    mkdirSync(dirname(live.scrollbackPath), { recursive: true })
    appendFileSync(live.scrollbackPath, chunk)
    live.scrollbackBytes += Buffer.byteLength(chunk)
    if (live.scrollbackBytes > maxBytes) {
      const buf = readFileSync(live.scrollbackPath)
      const tail = buf.subarray(Math.max(0, buf.length - keepBytes))
      writeFileSync(live.scrollbackPath, tail)
      live.scrollbackBytes = tail.length
    }
  }

  function clearIdleTimer(live: LiveSession): void {
    if (live.idleTimer != null) {
      clearTimeout(live.idleTimer)
      live.idleTimer = undefined
    }
  }

  function checkIdleTransition(live: LiveSession): void {
    live.idleTimer = undefined
    const status = live.tracker.status()
    if (status !== live.lastStatus) {
      live.lastStatus = status
      emitEvent('session.status', withRuntime(live.record))
    }
  }

  function onData(live: LiveSession, chunk: string): void {
    appendScrollback(live, chunk)
    live.tracker.feed(chunk)
    const status = live.tracker.status()
    const hint = live.tracker.titleHint()
    const statusChanged = status !== live.lastStatus
    const hintChanged = hint !== live.lastTitleHint

    clearIdleTimer(live)

    if (!statusChanged && !hintChanged) return // never emit per chunk
    live.lastStatus = status
    if (hintChanged) {
      live.lastTitleHint = hint
      live.record.titleHint = hint
      // titleHint changes are rare (one OSC per agent phase), so persisting
      // each one is the cheap way to survive a restart; runtime status
      // (working/needs-input/idle) is intentionally never persisted.
      persist(live.record)
    }
    emitEvent('session.status', withRuntime(live.record))

    if (status === 'done' || status === 'needs-input') {
      live.idleTimer = setTimeout(() => checkIdleTransition(live), idleThresholdMs + 50)
    }
  }

  function onExit(live: LiveSession, exitCode: number): void {
    clearIdleTimer(live)
    active.delete(live.record.sessionId)
    revokeLiveMcpToken(live)
    live.record.status = live.stopRequested ? 'stopped' : exitCode === 0 ? 'done' : 'error'
    live.record.exitCode = exitCode
    live.record.endedAt = now().toISOString()
    persist(live.record)
    emitEvent('session.exited', { ...live.record })
  }

  function launch(agent: DetectedAgent): { record: AgentSessionRuntime; ptyId: number } {
    if (!agent.installed || !agent.binPath) throw new Error(`Agent not installed: ${agent.id}`)
    const cwd = requireWorkspace()
    const sessionId = generateId()
    const mcpToken = options.createMcpToken(sessionId)
    const sidArgs = sessionIdArgs(agent.id, sessionId)
    const spawnArgs = [...agent.args, ...sidArgs]
    const record: AgentSessionRecord = {
      sessionId,
      agentId: agent.id,
      title: defaultTitle(agent.name),
      command: [agent.binPath, ...spawnArgs].join(' '),
      cwd,
      status: 'running',
      startedAt: now().toISOString(),
    }
    const tracker = createAgentStatusTracker({ idleThresholdMs })
    const live: LiveSession = {
      record,
      handle: null as unknown as PtyHandle, // assigned below; pty callbacks fire async
      tracker,
      scrollbackPath: scrollbackPath(sessionId),
      scrollbackBytes: 0,
      stopRequested: false,
      lastStatus: tracker.status(),
      lastTitleHint: tracker.titleHint(),
      mcpToken,
    }
    try {
      live.handle = options.spawnPty({
        file: agent.binPath,
        args: spawnArgs,
        cwd,
        env: {
          MIM_PORT: String(options.getMcpServerPort()),
          MIM_TOKEN: mcpToken,
        },
        onData: (chunk) => onData(live, chunk),
        onExit: (exitCode) => onExit(live, exitCode),
      })
    } catch (err) {
      revokeLiveMcpToken(live)
      throw err
    }
    active.set(sessionId, live)
    persist(record)
    const merged = withRuntime(record)
    emitEvent('session.started', merged)
    return { record: merged, ptyId: live.handle.ptyId }
  }

  function resume(sessionId: string, agent: DetectedAgent): { record: AgentSessionRuntime; ptyId: number } {
    if (!agent.installed || !agent.binPath) throw new Error(`Agent not installed: ${agent.id}`)
    const record = requireRecord(sessionId)
    if (record.status === 'running') throw new Error(`Agent session is already running: ${sessionId}`)

    const rArgs = catalogResumeArgs(record.agentId, sessionId)
    const mcpToken = options.createMcpToken(sessionId)

    record.status = 'running'
    delete record.endedAt
    delete record.exitCode
    record.startedAt = now().toISOString()
    record.command = [agent.binPath, ...rArgs].join(' ')
    if (record.archived) record.archived = false

    const tracker = createAgentStatusTracker({ idleThresholdMs })
    const sbPath = scrollbackPath(sessionId)
    const existingBytes = existsSync(sbPath) ? statSync(sbPath).size : 0

    const live: LiveSession = {
      record,
      handle: null as unknown as PtyHandle,
      tracker,
      scrollbackPath: sbPath,
      scrollbackBytes: existingBytes,
      stopRequested: false,
      lastStatus: tracker.status(),
      lastTitleHint: record.titleHint,
      mcpToken,
    }

    try {
      live.handle = options.spawnPty({
        file: agent.binPath,
        args: rArgs,
        cwd: record.cwd,
        env: {
          MIM_PORT: String(options.getMcpServerPort()),
          MIM_TOKEN: mcpToken,
        },
        onData: (chunk) => onData(live, chunk),
        onExit: (exitCode) => onExit(live, exitCode),
      })
    } catch (err) {
      revokeLiveMcpToken(live)
      throw err
    }

    active.set(sessionId, live)
    persist(record)
    const merged = withRuntime(record)
    emitEvent('session.started', merged)
    return { record: merged, ptyId: live.handle.ptyId }
  }

  function stop(sessionId: string): AgentSessionRuntime {
    const live = active.get(sessionId)
    if (!live) {
      const record = requireRecord(sessionId)
      // Stale record with no live pty (e.g. left over from a crash that
      // reconcile has not seen): transition to a terminal state directly.
      if (record.status === 'running') {
        record.status = 'stopped'
        record.endedAt = now().toISOString()
        persist(record)
        emitEvent('session.exited', { ...record })
      }
      return { ...record }
    }
    live.stopRequested = true
    clearIdleTimer(live)
    revokeLiveMcpToken(live)
    live.handle.kill()
    return withRuntime(live.record)
  }

  function list(listOptions: { includeArchived?: boolean; archived?: boolean } = {}): AgentSessionRuntime[] {
    const records: AgentSessionRuntime[] = []
    for (const record of readAllRecords()) {
      const archived = record.archived === true
      if (listOptions.archived !== undefined && archived !== listOptions.archived) continue
      if (!listOptions.includeArchived && listOptions.archived === undefined && archived) continue
      records.push(withRuntime(record))
    }
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  function get(sessionId: string, getOptions: { scrollback?: boolean } = {}): AgentSessionRuntime | null {
    const record = readRecord(sessionId)
    if (!record) return null
    const merged = withRuntime(record)
    if (getOptions.scrollback) {
      const path = scrollbackPath(sessionId)
      merged.scrollback = existsSync(path) ? readFileSync(path, 'utf-8') : ''
    }
    return merged
  }

  function rename(sessionId: string, title: string): AgentSessionRuntime {
    const record = requireRecord(sessionId)
    const trimmed = title.trim()
    if (!trimmed) throw new Error('Agent session title cannot be empty')
    record.title = trimmed
    persist(record)
    const merged = withRuntime(record)
    emitEvent('session.changed', merged)
    return merged
  }

  function archive(sessionId: string, archived = true): AgentSessionRuntime {
    const record = requireRecord(sessionId)
    record.archived = archived
    persist(record)
    const merged = withRuntime(record)
    emitEvent('session.changed', merged)
    return merged
  }

  function deleteSession(sessionId: string): { deleted: string } {
    if (active.has(sessionId)) throw new Error(`Cannot delete running agent session: ${sessionId}`)
    const record = readRecord(sessionId)
    if (!record) {
      const scrollback = scrollbackPath(sessionId)
      if (existsSync(scrollback)) unlinkSync(scrollback)
      return { deleted: sessionId }
    }
    unlinkSync(recordPath(sessionId))
    const scrollback = scrollbackPath(sessionId)
    if (existsSync(scrollback)) unlinkSync(scrollback)
    // The session field carries the deleted record so listeners prune by id.
    emitEvent('session.deleted', { ...record })
    return { deleted: sessionId }
  }

  function reconcileStaleSessions(): void {
    let records: AgentSessionRecord[]
    try {
      records = readAllRecords()
    } catch {
      return
    }
    for (const record of records) {
      if (record.status !== 'running') continue
      if (active.has(record.sessionId)) continue
      record.status = 'interrupted'
      record.endedAt = now().toISOString()
      persist(record)
    }
  }

  function activeSessionCount(): number {
    return active.size
  }

  function revokeLiveMcpToken(live: LiveSession): void {
    if (!live.mcpToken) return
    options.revokeMcpToken(live.mcpToken)
    live.mcpToken = undefined
  }

  return { launch, resume, stop, list, get, rename, archive, delete: deleteSession, reconcileStaleSessions, activeSessionCount }
}
