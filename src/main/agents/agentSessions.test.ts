import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { atomicWriteJson } from '@main/atomicJson.js'
import {
  createAgentSessions,
  SCROLLBACK_MAX_BYTES,
  SCROLLBACK_KEEP_BYTES,
  type AgentSessionRecord,
  type AgentSessionsOptions,
} from '@main/agents/agentSessions.js'
import type { DetectedAgent } from '@main/agents/agentCatalog.js'
import type { PtyHandle, PtySpawnOptions } from '@main/pty.js'

const claude: DetectedAgent = {
  id: 'claude-code',
  name: 'Claude Code',
  bin: 'claude',
  args: ['--verbose'],
  installed: true,
  binPath: '/opt/homebrew/bin/claude',
}

const codexMissing: DetectedAgent = {
  id: 'codex',
  name: 'Codex',
  bin: 'codex',
  args: [],
  installed: false,
}

interface FakePty {
  ptyId: number
  opts: PtySpawnOptions
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  data(chunk: string): void
  exit(code: number): void
}

interface SessionEvent {
  type: string
  session: AgentSessionRecord & { ptyId?: number; runtimeStatus?: string; titleHint?: string }
}

describe('agent sessions', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-agent-sessions-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const sessionsDir = () => join(dir, '.mim', 'agent-sessions')

  function makeHarness(overrides: Partial<AgentSessionsOptions> = {}) {
    const channels: string[] = []
    const events: SessionEvent[] = []
    const ptys: FakePty[] = []
    const mcpSessionIds: string[] = []
    const revokedMcpTokens: string[] = []
    let nextPtyId = 100
    const spawnPty = (opts: PtySpawnOptions): PtyHandle => {
      const fake: FakePty = {
        ptyId: nextPtyId++,
        opts,
        write: vi.fn(),
        resize: vi.fn(),
        // Real kills end the process with a non-zero exit; the stopped
        // classification must come from recorded intent, not the exit code.
        kill: vi.fn(() => fake.exit(1)),
        data: (chunk) => opts.onData?.(chunk),
        exit: (code) => opts.onExit?.(code),
      }
      ptys.push(fake)
      return { ptyId: fake.ptyId, write: fake.write, resize: fake.resize, kill: fake.kill }
    }
    const sessions = createAgentSessions({
      getWorkspacePath: () => dir,
      spawnPty,
      getMcpServerPort: () => 54321,
      createMcpToken: (sessionId) => {
        mcpSessionIds.push(sessionId)
        return `mcp-token-for-${sessionId}`
      },
      revokeMcpToken: (token) => {
        revokedMcpTokens.push(token)
      },
      emit: (channel, data) => {
        channels.push(channel)
        events.push(data as SessionEvent)
      },
      ...overrides,
    })
    return { sessions, events, channels, ptys, mcpSessionIds, revokedMcpTokens }
  }

  it('quarantines corrupt record files instead of failing list and get', () => {
    const { sessions, ptys } = makeHarness()
    sessions.launch(claude)
    ptys[0].exit(0)
    const corruptPath = join(sessionsDir(), 'broken.json')
    writeFileSync(corruptPath, '{ not json')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(sessions.list()).toHaveLength(1)
      expect(existsSync(corruptPath)).toBe(false)
      expect(existsSync(`${corruptPath}.corrupt`)).toBe(true)
      expect(error).toHaveBeenCalled()
      expect(sessions.get('broken')).toBeNull()
    } finally {
      error.mockRestore()
    }
  })

  it('documents the scrollback cap constants', () => {
    expect(SCROLLBACK_MAX_BYTES).toBe(2 * 1024 * 1024)
    expect(SCROLLBACK_KEEP_BYTES).toBe(1024 * 1024)
  })

  it('refuses to launch an agent that is not installed', () => {
    const { sessions, ptys } = makeHarness()
    expect(() => sessions.launch(codexMissing)).toThrow('Agent not installed: codex')
    expect(ptys).toHaveLength(0)
  })

  it('launch spawns the resolved binary in the workspace root and persists a running record', () => {
    const { sessions, events, channels, ptys, mcpSessionIds } = makeHarness()

    const { record, ptyId } = sessions.launch(claude)

    expect(ptys).toHaveLength(1)
    expect(ptys[0].opts.file).toBe('/opt/homebrew/bin/claude')
    expect(ptys[0].opts.args).toEqual(['--verbose'])
    expect(ptys[0].opts.cwd).toBe(dir)
    expect(ptys[0].opts.env).toEqual({
      MIM_PORT: '54321',
      MIM_TOKEN: `mcp-token-for-${record.sessionId}`,
    })
    expect(ptys[0].opts.shellIntegration).toBeUndefined()
    expect(mcpSessionIds).toEqual([record.sessionId])
    expect(ptyId).toBe(ptys[0].ptyId)

    expect(record.agentId).toBe('claude-code')
    expect(record.title).toBe('Claude Code')
    expect(record.command).toBe('/opt/homebrew/bin/claude --verbose')
    expect(record.cwd).toBe(dir)
    expect(record.status).toBe('running')
    expect(record.startedAt).toBeTruthy()
    expect(record.ptyId).toBe(ptyId)

    const onDisk = JSON.parse(readFileSync(join(sessionsDir(), `${record.sessionId}.json`), 'utf-8'))
    expect(onDisk.status).toBe('running')
    expect(onDisk.ptyId).toBeUndefined() // runtime state never persists

    expect(channels).toEqual(['agent:session-event'])
    expect(events[0]).toMatchObject({ type: 'session.started', session: { sessionId: record.sessionId, status: 'running' } })
    expect(sessions.activeSessionCount()).toBe(1)
  })

  it('counters duplicate default titles', () => {
    const { sessions } = makeHarness()
    expect(sessions.launch(claude).record.title).toBe('Claude Code')
    expect(sessions.launch(claude).record.title).toBe('Claude Code 2')
    expect(sessions.launch(claude).record.title).toBe('Claude Code 3')
  })

  it('maps exit code 0 to done and persists the transition', () => {
    const { sessions, events, ptys } = makeHarness()
    const { record } = sessions.launch(claude)

    ptys[0].exit(0)

    const ended = sessions.get(record.sessionId)!
    expect(ended.status).toBe('done')
    expect(ended.exitCode).toBe(0)
    expect(ended.endedAt).toBeTruthy()
    expect(ended.ptyId).toBeUndefined()
    expect(ended.runtimeStatus).toBeUndefined()
    expect(sessions.activeSessionCount()).toBe(0)

    const onDisk = JSON.parse(readFileSync(join(sessionsDir(), `${record.sessionId}.json`), 'utf-8'))
    expect(onDisk.status).toBe('done')
    expect(events.at(-1)).toMatchObject({ type: 'session.exited', session: { status: 'done', exitCode: 0 } })
  })

  it('revokes the per-session MCP token when a live session exits or is stopped', () => {
    const { sessions, ptys, revokedMcpTokens } = makeHarness()
    const first = sessions.launch(claude).record

    ptys[0].exit(0)

    expect(revokedMcpTokens).toEqual([`mcp-token-for-${first.sessionId}`])

    const second = sessions.launch(claude).record
    sessions.stop(second.sessionId)

    expect(revokedMcpTokens).toEqual([
      `mcp-token-for-${first.sessionId}`,
      `mcp-token-for-${second.sessionId}`,
    ])
  })

  it('revokes the MCP token if pty spawn fails after token creation', () => {
    const { sessions, revokedMcpTokens } = makeHarness({
      spawnPty: () => {
        throw new Error('spawn failed')
      },
    })

    expect(() => sessions.launch(claude)).toThrow('spawn failed')
    expect(revokedMcpTokens).toHaveLength(1)
    expect(revokedMcpTokens[0]).toMatch(/^mcp-token-for-/)
    expect(sessions.activeSessionCount()).toBe(0)
  })

  it('maps non-zero exit codes to error', () => {
    const { sessions, ptys } = makeHarness()
    const { record } = sessions.launch(claude)

    ptys[0].exit(3)

    const ended = sessions.get(record.sessionId)!
    expect(ended.status).toBe('error')
    expect(ended.exitCode).toBe(3)
  })

  it('classifies stop() as stopped even though the process exits non-zero', () => {
    const { sessions, events, ptys } = makeHarness()
    const { record } = sessions.launch(claude)

    sessions.stop(record.sessionId)

    expect(ptys[0].kill).toHaveBeenCalledTimes(1)
    const ended = sessions.get(record.sessionId)!
    expect(ended.status).toBe('stopped')
    expect(ended.endedAt).toBeTruthy()
    expect(sessions.activeSessionCount()).toBe(0)
    expect(events.at(-1)).toMatchObject({ type: 'session.exited', session: { status: 'stopped' } })
  })

  it('stop on a stale running record (no live pty) transitions it to stopped', () => {
    const staleId = randomUUID()
    atomicWriteJson(join(sessionsDir(), `${staleId}.json`), {
      sessionId: staleId,
      agentId: 'claude-code',
      title: 'Claude Code',
      command: '/opt/homebrew/bin/claude',
      cwd: dir,
      status: 'running',
      startedAt: '2026-06-01T00:00:00.000Z',
    })
    const { sessions } = makeHarness()

    const record = sessions.stop(staleId)

    expect(record.status).toBe('stopped')
    expect(record.endedAt).toBeTruthy()
    const onDisk = JSON.parse(readFileSync(join(sessionsDir(), `${staleId}.json`), 'utf-8'))
    expect(onDisk.status).toBe('stopped')
  })

  it('stop on an unknown session throws', () => {
    const { sessions } = makeHarness()
    expect(() => sessions.stop('nope')).toThrow('Agent session not found: nope')
  })

  it('reconcileStaleSessions marks persisted running records as interrupted', () => {
    const staleId = randomUUID()
    atomicWriteJson(join(sessionsDir(), `${staleId}.json`), {
      sessionId: staleId,
      agentId: 'claude-code',
      title: 'Claude Code',
      command: '/opt/homebrew/bin/claude',
      cwd: dir,
      status: 'running',
      startedAt: '2026-06-01T00:00:00.000Z',
    })
    const { sessions, ptys } = makeHarness()
    const live = sessions.launch(claude)

    sessions.reconcileStaleSessions()

    expect(sessions.get(staleId)!.status).toBe('interrupted')
    expect(sessions.get(staleId)!.endedAt).toBeTruthy()
    // Live sessions are untouched
    expect(sessions.get(live.record.sessionId)!.status).toBe('running')
    ptys[0].exit(0)
  })

  it('appends raw pty output to the scrollback file and returns it from get', () => {
    const { sessions, ptys } = makeHarness()
    const { record } = sessions.launch(claude)

    ptys[0].data('hello ')
    ptys[0].data('world')
    ptys[0].exit(0)

    const withScrollback = sessions.get(record.sessionId, { scrollback: true })!
    expect(withScrollback.scrollback).toBe('hello world')
    expect(sessions.get(record.sessionId)!.scrollback).toBeUndefined()
    expect(readFileSync(join(sessionsDir(), `${record.sessionId}.scrollback`), 'utf-8')).toBe('hello world')
  })

  it('truncates scrollback from the front once it exceeds the cap', () => {
    const { sessions, ptys } = makeHarness({ scrollbackMaxBytes: 100, scrollbackKeepBytes: 40 })
    const { record } = sessions.launch(claude)

    ptys[0].data('a'.repeat(60))
    expect(statSync(join(sessionsDir(), `${record.sessionId}.scrollback`)).size).toBe(60)

    ptys[0].data('b'.repeat(60)) // 120 > 100 → rewrite keeping the last 40 bytes
    expect(sessions.get(record.sessionId, { scrollback: true })!.scrollback).toBe('b'.repeat(40))

    ptys[0].data('c'.repeat(10))
    expect(sessions.get(record.sessionId, { scrollback: true })!.scrollback).toBe('b'.repeat(40) + 'c'.repeat(10))
  })

  it('emits session.status only when runtime status or title hint changes', () => {
    const { sessions, events, ptys } = makeHarness()
    sessions.launch(claude)
    events.length = 0

    ptys[0].data('plain output') // initial status is already working → no event
    expect(events).toHaveLength(0)

    ptys[0].data('\x07') // BEL → needs-input
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'needs-input' } })

    ptys[0].data('typed reply') // back to working
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'working' } })

    ptys[0].data('more of the same') // still working → no event
    expect(events).toHaveLength(2)
  })

  it('emits session.status with idle after the silence threshold', () => {
    vi.useFakeTimers()
    try {
      const { sessions, events, ptys } = makeHarness({ idleThresholdMs: 100 })
      sessions.launch(claude)
      events.length = 0

      ptys[0].data('\x07') // BEL → needs-input
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'needs-input' } })

      vi.advanceTimersByTime(200) // past threshold + 50ms timer delay
      expect(events).toHaveLength(2)
      expect(events[1]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'idle' } })

      ptys[0].data('back to work') // resets to working
      expect(events).toHaveLength(3)
      expect(events[2]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'working' } })

      ptys[0].exit(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits session.status with done then idle for OSC 9 progress signals', () => {
    vi.useFakeTimers()
    try {
      const { sessions, events, ptys } = makeHarness({ idleThresholdMs: 100 })
      sessions.launch(claude)
      events.length = 0

      // Boot done → enters progress mode, status changes from working to done
      ptys[0].data('\x1b]9;4;0;\x07')
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'done' } })

      // Start work → back to working
      ptys[0].data('\x1b]9;4;3;\x07')
      expect(events).toHaveLength(2)
      expect(events[1]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'working' } })

      // Task done → done
      ptys[0].data('\x1b]9;4;0;\x07')
      expect(events).toHaveLength(3)
      expect(events[2]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'done' } })

      // After threshold → idle
      vi.advanceTimersByTime(200)
      expect(events).toHaveLength(4)
      expect(events[3]).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'idle' } })

      ptys[0].exit(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits needs-input when the title spinner stops (Codex/Gemini pattern)', () => {
    const { sessions, events, ptys } = makeHarness()
    sessions.launch(claude)
    events.length = 0

    // Title gains Braille prefix → working (via title spinner detection)
    ptys[0].data('\x1b]0;⠴ tmp\x07')
    expect(events.at(-1)).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'working' } })

    // Title loses Braille prefix → needs-input
    ptys[0].data('\x1b]0;tmp\x07')
    expect(events.at(-1)).toMatchObject({ type: 'session.status', session: { runtimeStatus: 'needs-input' } })

    ptys[0].exit(0)
  })

  it('persists titleHint changes and surfaces them on the merged record', () => {
    const { sessions, events, ptys } = makeHarness()
    const { record } = sessions.launch(claude)
    events.length = 0

    ptys[0].data('\x1b]0;Refactoring auth\x07')

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'session.status', session: { titleHint: 'Refactoring auth' } })
    expect(sessions.get(record.sessionId)!.titleHint).toBe('Refactoring auth')
    const onDisk = JSON.parse(readFileSync(join(sessionsDir(), `${record.sessionId}.json`), 'utf-8'))
    expect(onDisk.titleHint).toBe('Refactoring auth')
  })

  it('merges live runtime state into list and get', () => {
    const { sessions, ptys } = makeHarness()
    const { record, ptyId } = sessions.launch(claude)

    ptys[0].data('\x07')
    const listed = sessions.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].ptyId).toBe(ptyId)
    expect(listed[0].runtimeStatus).toBe('needs-input')
    expect(sessions.get(record.sessionId)!.runtimeStatus).toBe('needs-input')

    ptys[0].exit(0)
    expect(sessions.list()[0].ptyId).toBeUndefined()
    expect(sessions.list()[0].runtimeStatus).toBeUndefined()
  })

  it('renames sessions, persists, and emits session.changed', () => {
    const { sessions, events, ptys } = makeHarness()
    const { record } = sessions.launch(claude)
    ptys[0].exit(0)
    events.length = 0

    const renamed = sessions.rename(record.sessionId, '  Auth refactor  ')

    expect(renamed.title).toBe('Auth refactor')
    expect(events.at(-1)).toMatchObject({ type: 'session.changed', session: { title: 'Auth refactor' } })
    const onDisk = JSON.parse(readFileSync(join(sessionsDir(), `${record.sessionId}.json`), 'utf-8'))
    expect(onDisk.title).toBe('Auth refactor')
    expect(() => sessions.rename(record.sessionId, '   ')).toThrow('Agent session title cannot be empty')
    expect(() => sessions.rename('nope', 'x')).toThrow('Agent session not found: nope')
  })

  it('archives, restores, and filters sessions in list', () => {
    const { sessions, ptys } = makeHarness()
    const { record } = sessions.launch(claude)
    ptys[0].exit(0)

    expect(sessions.archive(record.sessionId).archived).toBe(true)
    expect(sessions.list()).toHaveLength(0)
    expect(sessions.list({ archived: true }).map(s => s.sessionId)).toEqual([record.sessionId])
    expect(sessions.list({ includeArchived: true })).toHaveLength(1)

    expect(sessions.archive(record.sessionId, false).archived).toBe(false)
    expect(sessions.list()).toHaveLength(1)
  })

  it('deletes the record and the scrollback file together, then treats repeat deletes as done', () => {
    const { sessions, ptys } = makeHarness()
    const { record } = sessions.launch(claude)
    ptys[0].data('output')

    expect(() => sessions.delete(record.sessionId)).toThrow(`Cannot delete running agent session: ${record.sessionId}`)

    ptys[0].exit(0)
    expect(sessions.delete(record.sessionId)).toEqual({ deleted: record.sessionId })
    expect(sessions.get(record.sessionId)).toBeNull()
    expect(existsSync(join(sessionsDir(), `${record.sessionId}.json`))).toBe(false)
    expect(existsSync(join(sessionsDir(), `${record.sessionId}.scrollback`))).toBe(false)
    expect(sessions.delete(record.sessionId)).toEqual({ deleted: record.sessionId })
  })

  it('emits a deleted event so renderers remove the stale aggregate row', () => {
    const { sessions, events, ptys } = makeHarness()
    const { record } = sessions.launch(claude)
    ptys[0].exit(0)
    events.length = 0

    sessions.delete(record.sessionId)

    expect(events.at(-1)).toMatchObject({
      type: 'session.deleted',
      session: { sessionId: record.sessionId },
    })
  })

  it('removes orphan scrollback when deleting an already-missing record', () => {
    const { sessions } = makeHarness()
    const sessionId = 'orphan-session'
    mkdirSync(sessionsDir(), { recursive: true })
    writeFileSync(join(sessionsDir(), `${sessionId}.scrollback`), 'orphan output')

    expect(sessions.delete(sessionId)).toEqual({ deleted: sessionId })

    expect(existsSync(join(sessionsDir(), `${sessionId}.scrollback`))).toBe(false)
  })

  it('lists sessions newest first', () => {
    let tick = 0
    const { sessions, ptys } = makeHarness({
      now: () => new Date(Date.UTC(2026, 5, 12, 0, 0, tick++)),
    })
    const first = sessions.launch(claude)
    const second = sessions.launch(claude)

    expect(sessions.list().map(s => s.sessionId)).toEqual([second.record.sessionId, first.record.sessionId])
    ptys.forEach(p => p.exit(0))
  })

  it('counts only live sessions', () => {
    const { sessions, ptys } = makeHarness()
    sessions.launch(claude)
    sessions.launch(claude)
    expect(sessions.activeSessionCount()).toBe(2)
    ptys[0].exit(0)
    expect(sessions.activeSessionCount()).toBe(1)
    ptys[1].exit(0)
    expect(sessions.activeSessionCount()).toBe(0)
  })

  it('throws when no workspace is open', () => {
    const { sessions } = makeHarness({ getWorkspacePath: () => null })
    expect(() => sessions.launch(claude)).toThrow('No workspace open')
  })
})
