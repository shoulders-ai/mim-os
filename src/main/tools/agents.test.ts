import { describe, it, expect, vi } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerAgentTools } from '@main/tools/agents.js'
import type { DetectedAgent } from '@main/agents/agentCatalog.js'
import type { AgentSessions } from '@main/agents/agentSessions.js'

const ctx = { actor: 'user' as const }

const detected: DetectedAgent[] = [
  { id: 'claude-code', name: 'Claude Code', bin: 'claude', args: [], installed: true, binPath: '/opt/homebrew/bin/claude' },
  { id: 'codex', name: 'Codex', bin: 'codex', args: [], installed: false },
  { id: 'gemini-cli', name: 'Gemini CLI', bin: 'gemini', args: [], installed: false },
]

const record = {
  sessionId: 's1',
  agentId: 'claude-code',
  title: 'Claude Code',
  command: '/opt/homebrew/bin/claude',
  cwd: '/workspace',
  status: 'running' as const,
  startedAt: '2026-06-12T00:00:00.000Z',
}

function fakeSessions() {
  return {
    launch: vi.fn(() => ({ record: { ...record, ptyId: 7 }, ptyId: 7 })),
    stop: vi.fn(() => ({ ...record, status: 'stopped' as const })),
    list: vi.fn(() => [{ ...record }]),
    get: vi.fn((_id: string, options?: { scrollback?: boolean }) =>
      options?.scrollback ? { ...record, scrollback: 'output' } : { ...record }),
    rename: vi.fn((_id: string, title: string) => ({ ...record, title })),
    archive: vi.fn((_id: string, archived = true) => ({ ...record, archived })),
    delete: vi.fn(() => ({ deleted: 's1' })),
    reconcileStaleSessions: vi.fn(),
    activeSessionCount: vi.fn(() => 1),
  } satisfies AgentSessions
}

function harness(agents: DetectedAgent[] = detected) {
  const tools = createToolRegistry(createTraceLog())
  const detect = vi.fn(async () => agents)
  const sessions = fakeSessions()
  registerAgentTools(tools, { detect, sessions })
  return { tools, detect, sessions }
}

describe('agent tools', () => {
  it('agent.list returns detected agents from the injected detector', async () => {
    const { tools, detect } = harness()

    const result = await tools.call('agent.list', {}, ctx) as { agents: DetectedAgent[] }

    expect(detect).toHaveBeenCalledTimes(1)
    expect(result.agents).toEqual(detected)
  })

  it('registers the full agent tool surface', () => {
    const { tools } = harness()

    const agentTools = tools.list().filter(t => t.name.startsWith('agent.'))
    expect(agentTools.map(t => t.name).sort()).toEqual([
      'agent.launch',
      'agent.list',
      'agent.sessions.archive',
      'agent.sessions.delete',
      'agent.sessions.get',
      'agent.sessions.list',
      'agent.sessions.rename',
      'agent.stop',
    ])
    for (const tool of agentTools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(tool.description).toBeTruthy()
    }
  })

  it('agent.launch resolves the detected agent and launches a session', async () => {
    const { tools, sessions } = harness()

    const result = await tools.call('agent.launch', { agentId: 'claude-code' }, ctx) as { session: typeof record; ptyId: number }

    expect(sessions.launch).toHaveBeenCalledWith(detected[0])
    expect(result.ptyId).toBe(7)
    expect(result.session.sessionId).toBe('s1')
  })

  it('agent.launch forwards extraArgs to the session, appended after catalog args', async () => {
    const { tools, sessions } = harness()

    await tools.call('agent.launch', { agentId: 'claude-code', extraArgs: ['--dangerously-skip-permissions', '--verbose'] }, ctx)

    const launchedAgent = sessions.launch.mock.calls[0][0]
    expect(launchedAgent.args).toEqual(['--dangerously-skip-permissions', '--verbose'])
    expect(launchedAgent.id).toBe('claude-code')
    // Original catalog entry is not mutated.
    expect(detected[0].args).toEqual([])
  })

  it('agent.launch rejects unknown and uninstalled agents', async () => {
    const { tools, sessions } = harness()

    await expect(tools.call('agent.launch', { agentId: 'nope' }, ctx)).rejects.toThrow('Unknown agent: nope')
    await expect(tools.call('agent.launch', { agentId: 'codex' }, ctx)).rejects.toThrow('Agent not installed: codex')
    expect(sessions.launch).not.toHaveBeenCalled()
  })

  it('agent.stop forwards to the sessions service', async () => {
    const { tools, sessions } = harness()

    const result = await tools.call('agent.stop', { sessionId: 's1' }, ctx) as { session: { status: string } }

    expect(sessions.stop).toHaveBeenCalledWith('s1')
    expect(result.session.status).toBe('stopped')
  })

  it('agent.sessions.list returns session records', async () => {
    const { tools, sessions } = harness()

    const result = await tools.call('agent.sessions.list', {}, ctx) as { sessions: Array<{ sessionId: string }> }

    expect(sessions.list).toHaveBeenCalled()
    expect(result.sessions.map(s => s.sessionId)).toEqual(['s1'])
  })

  it('agent.sessions.get returns the record, with scrollback on request', async () => {
    const { tools, sessions } = harness()

    const plain = await tools.call('agent.sessions.get', { sessionId: 's1' }, ctx) as { session: { scrollback?: string } }
    expect(plain.session.scrollback).toBeUndefined()

    const full = await tools.call('agent.sessions.get', { sessionId: 's1', scrollback: true }, ctx) as { session: { scrollback?: string } }
    expect(full.session.scrollback).toBe('output')
    expect(sessions.get).toHaveBeenLastCalledWith('s1', { scrollback: true })
  })

  it('agent.sessions.get throws for unknown sessions', async () => {
    const { tools, sessions } = harness()
    sessions.get.mockReturnValueOnce(null as never)

    await expect(tools.call('agent.sessions.get', { sessionId: 'nope' }, ctx)).rejects.toThrow('Agent session not found: nope')
  })

  it('agent.sessions.rename / archive / delete forward to the sessions service', async () => {
    const { tools, sessions } = harness()

    const renamed = await tools.call('agent.sessions.rename', { sessionId: 's1', title: 'Auth' }, ctx) as { session: { title: string } }
    expect(sessions.rename).toHaveBeenCalledWith('s1', 'Auth')
    expect(renamed.session.title).toBe('Auth')

    await tools.call('agent.sessions.archive', { sessionId: 's1' }, ctx)
    expect(sessions.archive).toHaveBeenCalledWith('s1', true)
    await tools.call('agent.sessions.archive', { sessionId: 's1', archived: false }, ctx)
    expect(sessions.archive).toHaveBeenCalledWith('s1', false)

    const deleted = await tools.call('agent.sessions.delete', { sessionId: 's1' }, ctx) as { deleted: string }
    expect(sessions.delete).toHaveBeenCalledWith('s1')
    expect(deleted.deleted).toBe('s1')
  })
})
