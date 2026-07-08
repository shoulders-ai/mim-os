import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoutineDefinition } from '@main/routines/routines.js'
import { runRoutineOnce } from './routines.js'

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
      enabled: false,
      paused: false,
      needsEnablement: true,
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
})
