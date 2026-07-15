import { describe, expect, it, vi } from 'vitest'
import type { SubagentManager } from '@main/subagents/subagentManager.js'
import { registerSubagentTools } from './subagents.js'

describe('subagent tools', () => {
  function setup() {
    const registered = new Map<string, any>()
    const tools = {
      register: vi.fn((tool: any) => registered.set(tool.name, tool)),
    } as any
    const manager = {
      spawn: vi.fn(async () => ({ sessionId: 'child', turnId: 'turn', status: 'queued' })),
      wait: vi.fn(async () => ({ timedOut: false, agents: [] })),
      send: vi.fn(async () => ({ sessionId: 'child', turnId: 'turn2', status: 'working', delivery: 'follow-up' })),
      interrupt: vi.fn(async () => ({ sessionId: 'child', status: 'interrupted' })),
      stop: vi.fn(async () => ({ sessionId: 'child', status: 'stopped' })),
      status: vi.fn(async () => ({ sessionId: 'child', status: 'done' })),
      list: vi.fn(async () => ({ agents: [] })),
      result: vi.fn(async () => ({ sessionId: 'child', status: 'done', result: 'ok' })),
    } as unknown as SubagentManager
    registerSubagentTools(tools, manager)
    return { registered, manager }
  }

  it('registers the durable-thread surface with explicit input schemas', () => {
    const { registered } = setup()
    expect([...registered.keys()]).toEqual([
      'subagent.spawn',
      'subagent.wait',
      'subagent.send',
      'subagent.interrupt',
      'subagent.stop',
      'subagent.status',
      'subagent.list',
      'subagent.result',
    ])
    for (const tool of registered.values()) expect(tool.inputSchema).toMatchObject({ type: 'object' })
  })

  it('routes calls with the caller context intact', async () => {
    const { registered, manager } = setup()
    const ctx = {
      actor: 'ai' as const,
      sessionId: 'parent',
      subagent: {
        rootSessionId: 'root',
        parentSessionId: 'parent',
        depth: 1,
        originActor: 'ai' as const,
      },
    }
    const params = { prompt: 'Map the repository.' }

    await registered.get('subagent.spawn').execute(params, ctx)

    expect(manager.spawn).toHaveBeenCalledWith(params, ctx)
  })

  it('hard-denies package actors even without a permission gate', async () => {
    const { registered, manager } = setup()

    await expect(registered.get('subagent.spawn').execute(
      { prompt: 'Escape the app sandbox.' },
      { actor: 'package', package_id: 'bad-app' },
    )).rejects.toThrow('Apps cannot create or control subagents')
    expect(manager.spawn).not.toHaveBeenCalled()
  })
})
