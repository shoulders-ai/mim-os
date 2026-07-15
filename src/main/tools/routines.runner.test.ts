import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoutineDefinition } from '@main/routines/routines.js'
import { continueRoutineRunInSession, createRoutineChatSession, runRoutineOnce, startRoutineRun } from './routines.js'

const ai = vi.hoisted(() => ({
  streamProfileResponse: vi.fn(),
  chatProfile: {
    id: 'chat',
    toolSurface: 'chat',
    modelFeature: 'chat',
    useCatalogs: true,
    persistSession: true,
    stepCap: 100,
    sendReasoning: true,
    buildInstructions: () => 'system',
  },
}))

vi.mock('@main/ai/aiRuntime.js', () => ({
  chatProfile: ai.chatProfile,
  streamProfileResponse: ai.streamProfileResponse,
}))

describe('routine runner', () => {
  beforeEach(() => {
    ai.streamProfileResponse.mockReset().mockResolvedValue(new Response('ok'))
  })

  it('creates a routine session, narrows visible tools, and passes routine grants into the AI turn', async () => {
    const calls: Array<{ name: string; params: Record<string, unknown>; ctx: Record<string, unknown> }> = []
    const tools = {
      call: vi.fn(async (name: string, params: Record<string, unknown>, ctx: Record<string, unknown>) => {
        calls.push({ name, params, ctx })
        if (name === 'session.create') return { id: 'session_routine' }
        return { ok: true }
      }),
      trace: { append: vi.fn() },
    } as any
    const routine = {
      id: 'support-bot',
      name: 'support-bot',
      path: 'routines/support-bot.md',
      body: 'Handle the support request.',
      approvalAllow: ['fs.write'],
      tools: ['fs.read', 'fs.write'],
      authorityHash: 'hash',
      revision: 'revision',
      activation: 'manual',
    } satisfies RoutineDefinition

    const result = await runRoutineOnce(tools, routine, { trigger: 'manual' })

    expect(result).toMatchObject({ sessionId: 'session_routine', status: 'done' })
    expect(calls[0]).toMatchObject({
      name: 'session.create',
      params: {
        label: 'Routine: support-bot',
        routineId: 'support-bot',
        routineStatus: 'working',
      },
      ctx: { actor: 'system' },
    })
    expect(ai.streamProfileResponse).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        id: 'routine:support-bot',
        toolAllowlist: ['fs.read', 'fs.write'],
      }),
      request: expect.objectContaining({
        id: 'session_routine',
        routine: {
          id: 'support-bot',
          runId: expect.stringMatching(/^routine_run_/),
          approvalAllow: ['fs.write'],
        },
        trace: expect.objectContaining({
          traceId: expect.any(String),
          spanId: expect.any(String),
        }),
      }),
    }))
    expect(calls.at(-1)).toMatchObject({
      name: 'session.update',
      params: { id: 'session_routine', routineStatus: 'done', routineError: '' },
      ctx: { actor: 'system' },
    })
  })

  it('can return a started routine session before the stream completes', async () => {
    let resolveStream!: (response: Response) => void
    ai.streamProfileResponse.mockReturnValue(new Promise<Response>((resolve) => {
      resolveStream = resolve
    }))
    const calls: Array<{ name: string; params: Record<string, unknown>; ctx: Record<string, unknown> }> = []
    const tools = {
      call: vi.fn(async (name: string, params: Record<string, unknown>, ctx: Record<string, unknown>) => {
        calls.push({ name, params, ctx })
        if (name === 'session.create') return { id: 'session_routine' }
        return { ok: true }
      }),
      trace: { append: vi.fn() },
    } as any
    const routine = {
      id: 'support-bot',
      name: 'support-bot',
      path: 'routines/support-bot.md',
      body: 'Handle the support request.',
      approvalAllow: [],
      tools: [],
      authorityHash: 'hash',
      revision: 'revision',
      activation: 'manual',
    } satisfies RoutineDefinition

    const started = await startRoutineRun(tools, routine, { trigger: 'manual' })

    expect(started.result).toMatchObject({ sessionId: 'session_routine', status: 'working' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ name: 'session.create' })

    resolveStream(new Response('ok'))
    await expect(started.completion).resolves.toMatchObject({ sessionId: 'session_routine', status: 'done' })
    expect(calls.at(-1)).toMatchObject({
      name: 'session.update',
      params: { id: 'session_routine', routineStatus: 'done', routineError: '' },
      ctx: { actor: 'system' },
    })
  })

  it('creates a visible queued routine chat session without streaming in main', async () => {
    const calls: Array<{ name: string; params: Record<string, unknown>; ctx: Record<string, unknown> }> = []
    const tools = {
      call: vi.fn(async (name: string, params: Record<string, unknown>, ctx: Record<string, unknown>) => {
        calls.push({ name, params, ctx })
        if (name === 'session.create') return { id: 'session_routine' }
        return { ok: true }
      }),
      trace: { append: vi.fn() },
    } as any
    const routine = {
      id: 'support-bot',
      name: 'support-bot',
      path: 'routines/support-bot.md',
      body: 'Handle the support request.',
      approvalAllow: ['fs.create'],
      tools: ['fs.create'],
      model: 'claude-sonnet-5',
      authorityHash: 'hash',
      revision: 'revision',
      activation: 'manual',
    } satisfies RoutineDefinition

    const result = await createRoutineChatSession(tools, routine, { trigger: 'manual' })

    expect(result).toMatchObject({ sessionId: 'session_routine', status: 'working' })
    expect(ai.streamProfileResponse).not.toHaveBeenCalled()
    expect(calls[0]).toMatchObject({
      name: 'session.create',
      params: {
        label: 'Routine: support-bot',
        modelId: 'claude-sonnet-5',
        routineId: 'support-bot',
        routineStatus: 'working',
      },
      ctx: { actor: 'system' },
    })
    expect(calls[1]).toMatchObject({
      name: 'session.update',
      params: {
        id: 'session_routine',
        messages: [
          expect.objectContaining({
            role: 'user',
            parts: [{ type: 'text', text: 'Handle the support request.' }],
            metadata: expect.objectContaining({
              routine: expect.objectContaining({
                id: 'support-bot',
                queued: true,
              }),
            }),
          }),
        ],
      },
      ctx: { actor: 'system' },
    })
  })

  it('continues a routine inside an existing session with prior messages', async () => {
    const existingMessages = [
      { id: 'u0', role: 'user', parts: [{ type: 'text', text: 'Earlier question' }] },
      { id: 'a0', role: 'assistant', parts: [{ type: 'text', text: 'Earlier answer' }] },
    ]
    const calls: Array<{ name: string; params: Record<string, unknown>; ctx: Record<string, unknown> }> = []
    const tools = {
      call: vi.fn(async (name: string, params: Record<string, unknown>, ctx: Record<string, unknown>) => {
        calls.push({ name, params, ctx })
        if (name === 'session.get') {
          return {
            id: 'session_thread',
            messages: existingMessages,
            routineId: 'support-bot',
            routineRunId: 'routine_run_previous',
          }
        }
        return { ok: true, ...params }
      }),
      trace: { append: vi.fn() },
    } as any
    const routine = {
      id: 'support-bot',
      name: 'support-bot',
      path: 'routines/support-bot.md',
      body: 'Handle the support request.',
      approvalAllow: ['fs.read'],
      tools: ['fs.read'],
      authorityHash: 'hash',
      revision: 'revision',
      activation: 'active',
    } satisfies RoutineDefinition

    const result = await continueRoutineRunInSession(
      tools,
      routine,
      { trigger: 'slack', payload: { text: 'Follow up', slack: { channel: 'C1', threadTs: '100.1' } } },
      'session_thread',
    )

    expect(result).toMatchObject({ sessionId: 'session_thread', status: 'done' })
    expect(calls.some(call => call.name === 'session.create')).toBe(false)
    expect(calls[1]).toMatchObject({
      name: 'session.update',
      params: {
        id: 'session_thread',
        routineStatus: 'working',
        routineError: '',
        routineCompletedAt: '',
        messages: [
          existingMessages[0],
          existingMessages[1],
          expect.objectContaining({
            role: 'user',
            id: expect.stringMatching(/^routine_prompt_support-bot_routine_run_/),
          }),
        ],
      },
      ctx: { actor: 'system' },
    })
    expect(ai.streamProfileResponse).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({
        id: 'session_thread',
        messages: [
          existingMessages[0],
          existingMessages[1],
          expect.objectContaining({
            role: 'user',
            parts: [expect.objectContaining({
              type: 'text',
              text: expect.stringContaining('Follow up'),
            })],
          }),
        ],
        routine: {
          id: 'support-bot',
          runId: expect.stringMatching(/^routine_run_/),
          approvalAllow: ['fs.read'],
        },
      }),
    }))
    expect(calls.at(-1)).toMatchObject({
      name: 'session.update',
      params: { id: 'session_thread', routineStatus: 'done', routineError: '' },
      ctx: { actor: 'system' },
    })
  })
})
