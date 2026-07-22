import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { appendSessionCompaction, registerSessionTools } from '@main/sessions.js'
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Session tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-session-test-'))
    mkdirSync(join(dir, '.mim'), { recursive: true })
    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)
    registerSessionTools(tools)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a session and persists to disk', async () => {
    const session = await tools.call('session.create', { label: 'Test chat' }, ctx) as Record<string, unknown>
    const id = String(session.id)
    expect(session.id).toMatch(/^session_/)
    expect(session.label).toBe('Test chat')
    expect(session.lastContextTokens).toBe(0)
    expect(session).not.toHaveProperty('pinned')
    expect(existsSync(join(dir, '.mim', 'sessions', `${id}.json`))).toBe(true)
  })

  it('persists and lists durable subagent metadata', async () => {
    const created = await tools.call('session.create', {
      label: 'Child',
      subagent: {
        rootSessionId: 'session_root',
        parentSessionId: 'session_parent',
        depth: 2,
        status: 'queued',
        currentTurnId: 'turn_1',
        modelId: 'test-model',
        effectiveToolAllowlist: ['fs.read'],
        inbox: [],
        createdAt: '2026-07-14T10:00:00.000Z',
        updatedAt: '2026-07-14T10:00:00.000Z',
      },
    }, ctx) as { id: string }

    await tools.call('session.update', {
      id: created.id,
      subagent: {
        status: 'working',
        lastActivity: 'Reading the repository',
        updatedAt: '2026-07-14T10:01:00.000Z',
      },
    }, ctx)

    const got = await tools.call('session.get', { id: created.id }, ctx) as Record<string, any>
    expect(got.subagent).toMatchObject({
      rootSessionId: 'session_root',
      parentSessionId: 'session_parent',
      depth: 2,
      status: 'working',
      currentTurnId: 'turn_1',
      lastActivity: 'Reading the repository',
      effectiveToolAllowlist: ['fs.read'],
    })
    const listed = await tools.call('session.list', {}, ctx) as { sessions: Array<Record<string, any>> }
    expect(listed.sessions[0].subagent).toMatchObject({ parentSessionId: 'session_parent', status: 'working' })
  })

  it('lists sessions', async () => {
    await tools.call('session.create', { label: 'A' }, ctx)
    await tools.call('session.create', { label: 'B' }, ctx)
    const result = await tools.call('session.list', {}, ctx) as { sessions: Array<{ label: string }> }
    expect(result.sessions).toHaveLength(2)
  })

  it('gets a session with full data', async () => {
    const created = await tools.call('session.create', { label: 'Full' }, ctx) as { id: string }
    const got = await tools.call('session.get', { id: created.id }, ctx) as { id: string; label: string; messages: unknown[]; compactions: unknown[] }
    expect(got.label).toBe('Full')
    expect(got.messages).toEqual([])
    expect(got.compactions).toEqual([])
  })

  it('updates a session', async () => {
    const created = await tools.call('session.create', { label: 'Original' }, ctx) as { id: string }
    await tools.call('session.update', {
      id: created.id,
      label: 'Updated',
      lastContextTokens: 123,
      taskLabelGenerated: true,
      pinned: true,
      messages: [{ id: 'm1', role: 'user', content: 'hello' }]
    }, ctx)
    const got = await tools.call('session.get', { id: created.id }, ctx) as { label: string; lastContextTokens: number; taskLabelGenerated?: boolean; messages: Array<{ content: string }> } & Record<string, unknown>
    expect(got.label).toBe('Updated')
    expect(got.lastContextTokens).toBe(123)
    expect(got.taskLabelGenerated).toBe(true)
    expect(got.messages).toHaveLength(1)
    expect(got.messages[0].content).toBe('hello')
    expect(got).not.toHaveProperty('pinned')
  })

  it('ignores compactions passed through generic session.update', async () => {
    const created = await tools.call('session.create', { label: 'Compaction' }, ctx) as { id: string }

    await tools.call('session.update', {
      id: created.id,
      compactions: [{ id: 'bad', summary: 'renderer should not write this' }],
    }, ctx)

    const got = await tools.call('session.get', { id: created.id }, ctx) as { compactions: unknown[] }
    expect(got.compactions).toEqual([])
  })

  it('appends compaction records without changing messages and updates effective context counters', async () => {
    const created = await tools.call('session.create', { label: 'Compaction append' }, ctx) as { id: string }
    const messages = [{ id: 'm1', role: 'user', content: 'keep me' }]
    await tools.call('session.update', {
      id: created.id,
      messages,
      lastContextTokens: 1200,
      lastInputTokens: 1200,
    }, ctx)

    appendSessionCompaction(dir, created.id, {
      id: 'cmp_1',
      eventMessageId: 'm1',
      eventMessageIndex: 0,
      firstKeptMessageId: 'm1',
      firstKeptMessageIndex: 0,
      summarizedMessageCount: 0,
      summary: 'Earlier context summary.',
      tokensBefore: 1200,
      tokensAfter: 800,
      savedRatio: 0.333,
      modelId: 'test-model',
      trigger: 'post_turn',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    const got = await tools.call('session.get', { id: created.id }, ctx) as {
      messages: typeof messages
      compactions: Array<{ id: string; eventMessageId?: string; eventMessageIndex?: number; summary: string }>
      lastContextTokens: number
      lastInputTokens: number
    }
    expect(got.messages).toEqual(messages)
    expect(got.lastContextTokens).toBe(800)
    expect(got.lastInputTokens).toBe(800)
    expect(got.compactions).toEqual([
      expect.objectContaining({
        id: 'cmp_1',
        eventMessageId: 'm1',
        eventMessageIndex: 0,
        summary: 'Earlier context summary.',
      }),
    ])

    const listed = await tools.call('session.list', {}, ctx) as { sessions: Array<Record<string, unknown>> }
    expect(listed.sessions[0].compactions).toBeUndefined()
    expect(listed.sessions[0].lastContextTokens).toBe(800)
    expect(listed.sessions[0].lastInputTokens).toBe(800)
  })

  it('reorders sessions without touching updatedAt', async () => {
    const first = await tools.call('session.create', { label: 'First' }, ctx) as { id: string }
    const second = await tools.call('session.create', { label: 'Second' }, ctx) as { id: string }
    const firstBefore = await tools.call('session.get', { id: first.id }, ctx) as { updatedAt: string }
    const secondBefore = await tools.call('session.get', { id: second.id }, ctx) as { updatedAt: string }

    await tools.call('session.reorder', { ids: [second.id, first.id] }, ctx)

    const listed = await tools.call('session.list', {}, ctx) as { sessions: Array<{ id: string; sortOrder?: number }> }
    const firstAfter = await tools.call('session.get', { id: first.id }, ctx) as { updatedAt: string; sortOrder?: number }
    const secondAfter = await tools.call('session.get', { id: second.id }, ctx) as { updatedAt: string; sortOrder?: number }
    expect(listed.sessions.map(s => s.id)).toEqual([second.id, first.id])
    expect(secondAfter.sortOrder).toBe(0)
    expect(firstAfter.sortOrder).toBe(1)
    expect(firstAfter.updatedAt).toBe(firstBefore.updatedAt)
    expect(secondAfter.updatedAt).toBe(secondBefore.updatedAt)
  })

  it('preserves AI SDK UI message parts when updating a session', async () => {
    const created = await tools.call('session.create', { label: 'Parts' }, ctx) as { id: string }
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'checking files' },
          { type: 'tool-fs_read', toolCallId: 'call_1', state: 'output-available', input: { path: 'notes.md' }, output: { content: 'hello' } },
          { type: 'text', text: 'Here is the answer.' },
        ],
      },
    ]

    await tools.call('session.update', { id: created.id, messages }, ctx)

    const got = await tools.call('session.get', { id: created.id }, ctx) as { messages: typeof messages }
    expect(got.messages).toEqual(messages)
  })

  it('preserves browser tool result payloads when persisted messages exceed the context threshold', async () => {
    const created = await tools.call('session.create', { label: 'Browser' }, ctx) as { id: string }
    const messages = [{
      id: 'm1',
      role: 'assistant',
      parts: Array.from({ length: 4 }, (_value, index) => ({
        type: 'tool-browser_open',
        toolCallId: `call_${index + 1}`,
        state: 'output-available',
        input: { url: `https://example.com/${index + 1}` },
        output: {
          title: `Page ${index + 1}`,
          observation: 'browser content '.repeat(8_000),
          refs: [{ ref: '1', kind: 'link', label: 'Open' }],
          ref_count: 1,
        },
      })),
    }]

    await tools.call('session.update', { id: created.id, messages }, ctx)

    const got = await tools.call('session.get', { id: created.id }, ctx) as { messages: typeof messages }
    const parts = got.messages[0].parts
    expect(parts[0].output.compacted).toBeUndefined()
    expect(parts[1].output.compacted).toBeUndefined()
    expect(parts[0].output.observation).toContain('browser content')
    expect(parts[1].output.observation).toContain('browser content')
    expect(parts[2].output.observation).toContain('browser content')
    expect(parts[3].output.observation).toContain('browser content')
  })

  it('deletes a session', async () => {
    const created = await tools.call('session.create', { label: 'Doomed' }, ctx) as { id: string }
    await tools.call('session.delete', { id: created.id }, ctx)
    const files = readdirSync(join(dir, '.mim', 'sessions')).filter(f => f !== '_manifest.json')
    expect(files).toHaveLength(0)
  })

  it('throws when getting non-existent session', async () => {
    await expect(
      tools.call('session.get', { id: 'nonexistent' }, ctx)
    ).rejects.toThrow('not found')
  })

  it('renames corrupt session files to .corrupt and still lists valid sessions', async () => {
    const created = await tools.call('session.create', { label: 'Good' }, ctx) as { id: string }

    // Write a corrupt JSON file alongside the valid session
    const sessionsDir = join(dir, '.mim', 'sessions')
    writeFileSync(join(sessionsDir, 'session_broken.json'), 'NOT VALID JSON{{{')

    const result = await tools.call('session.list', {}, ctx) as { sessions: Array<{ id: string }> }

    // Only the good session should appear
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].id).toBe(created.id)

    // The corrupt file should be renamed to .corrupt
    expect(existsSync(join(sessionsDir, 'session_broken.json'))).toBe(false)
    expect(existsSync(join(sessionsDir, 'session_broken.json.corrupt'))).toBe(true)

    // The original bytes are preserved
    const corruptContent = readFileSync(join(sessionsDir, 'session_broken.json.corrupt'), 'utf-8')
    expect(corruptContent).toBe('NOT VALID JSON{{{')
  })

  it('uses atomic writes for session create', async () => {
    const session = await tools.call('session.create', { label: 'Atomic' }, ctx) as { id: string }
    const sessionsDir = join(dir, '.mim', 'sessions')
    const files = readdirSync(sessionsDir)
    // No leftover .tmp files
    expect(files.filter(f => f.includes('.tmp'))).toHaveLength(0)
    // The session file exists and is valid JSON
    const content = JSON.parse(readFileSync(join(sessionsDir, `${session.id}.json`), 'utf-8'))
    expect(content.label).toBe('Atomic')
  })

  it('uses atomic writes for session update', async () => {
    const created = await tools.call('session.create', { label: 'Before' }, ctx) as { id: string }
    await tools.call('session.update', { id: created.id, label: 'After' }, ctx)
    const sessionsDir = join(dir, '.mim', 'sessions')
    const files = readdirSync(sessionsDir)
    expect(files.filter(f => f.includes('.tmp'))).toHaveLength(0)
    const content = JSON.parse(readFileSync(join(sessionsDir, `${created.id}.json`), 'utf-8'))
    expect(content.label).toBe('After')
  })

  it('creates a session with agentId and persists it to file and manifest', async () => {
    const session = await tools.call('session.create', {
      label: 'Agent chat',
      agentId: 'package:review-app/referee',
    }, ctx) as Record<string, unknown>
    const id = String(session.id)
    expect(session.agentId).toBe('package:review-app/referee')

    // Persisted to disk
    const raw = JSON.parse(readFileSync(join(dir, '.mim', 'sessions', `${id}.json`), 'utf-8'))
    expect(raw.agentId).toBe('package:review-app/referee')

    // Listed with agentId
    const result = await tools.call('session.list', {}, ctx) as { sessions: Array<{ agentId?: string }> }
    expect(result.sessions[0].agentId).toBe('package:review-app/referee')
  })

  it('creates a routine session and persists routine metadata to file and manifest', async () => {
    const firedAt = '2026-01-01T01:00:00.000Z'
    const session = await tools.call('session.create', {
      label: 'Routine: support-bot',
      agentId: 'package:support/responder',
      routineId: 'support-bot',
      routineRunId: 'routine_run_1',
      routineStatus: 'working',
      routineFiredAt: firedAt,
    }, ctx) as Record<string, unknown>
    const id = String(session.id)
    expect(session.routineId).toBe('support-bot')
    expect(session.routineRunId).toBe('routine_run_1')
    expect(session.routineStatus).toBe('working')
    expect(session.routineFiredAt).toBe(firedAt)

    const raw = JSON.parse(readFileSync(join(dir, '.mim', 'sessions', `${id}.json`), 'utf-8'))
    expect(raw.routineId).toBe('support-bot')
    expect(raw.routineRunId).toBe('routine_run_1')
    expect(raw.routineStatus).toBe('working')
    expect(raw.routineFiredAt).toBe(firedAt)

    const result = await tools.call('session.list', {}, ctx) as {
      sessions: Array<{ routineId?: string; routineRunId?: string; routineStatus?: string; routineFiredAt?: string }>
    }
    expect(result.sessions[0].routineId).toBe('support-bot')
    expect(result.sessions[0].routineRunId).toBe('routine_run_1')
    expect(result.sessions[0].routineStatus).toBe('working')
    expect(result.sessions[0].routineFiredAt).toBe(firedAt)
  })

  it('session without agentId does not serialize an agentId key', async () => {
    const session = await tools.call('session.create', { label: 'Plain' }, ctx) as { id: string } & Record<string, unknown>
    expect(session.agentId).toBeUndefined()

    const raw = JSON.parse(readFileSync(join(dir, '.mim', 'sessions', `${session.id}.json`), 'utf-8'))
    expect('agentId' in raw).toBe(false)
  })

  it('session.update ignores agentId param and does not change stored agentId', async () => {
    const created = await tools.call('session.create', {
      label: 'With agent',
      agentId: 'package:app/agent-a',
    }, ctx) as { id: string }
    await tools.call('session.update', {
      id: created.id,
      label: 'Updated',
      agentId: 'package:app/agent-b',
    }, ctx)
    const got = await tools.call('session.get', { id: created.id }, ctx) as { agentId?: string; label: string }
    expect(got.label).toBe('Updated')
    expect(got.agentId).toBe('package:app/agent-a')
  })

  it('updates routine run status without allowing the standing routine identity to change', async () => {
    const created = await tools.call('session.create', {
      label: 'Routine',
      routineId: 'nightly',
      routineRunId: 'routine_run_1',
      routineStatus: 'working',
    }, ctx) as { id: string }
    await tools.call('session.update', {
      id: created.id,
      routineId: 'other',
      routineRunId: 'routine_run_2',
      routineStatus: 'done',
      routineCompletedAt: '2026-01-01T02:00:00.000Z',
    }, ctx)

    const got = await tools.call('session.get', { id: created.id }, ctx) as {
      routineId?: string
      routineRunId?: string
      routineStatus?: string
      routineCompletedAt?: string
    }
    expect(got.routineId).toBe('nightly')
    expect(got.routineRunId).toBe('routine_run_1')
    expect(got.routineStatus).toBe('done')
    expect(got.routineCompletedAt).toBe('2026-01-01T02:00:00.000Z')
  })
})
