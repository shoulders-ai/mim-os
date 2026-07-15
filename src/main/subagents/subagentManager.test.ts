import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSessionTools, type Session } from '@main/sessions.js'
import { createToolRegistry, type ToolContext } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import {
  createSubagentManager,
  effectiveSubagentToolAllowlist,
  type SubagentTurnRunner,
} from './subagentManager.js'

describe('subagent manager', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const managers: Array<{ dispose(): Promise<void> }> = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-subagent-test-'))
    mkdirSync(join(dir, '.mim'), { recursive: true })
    tools = createToolRegistry(createTraceLog({ devConsole: false }))
    tools.setWorkspacePath(dir)
    registerSessionTools(tools)
  })

  afterEach(async () => {
    await Promise.all(managers.splice(0).map(manager => manager.dispose()))
    rmSync(dir, { recursive: true, force: true })
  })

  function managerWith(runTurn: SubagentTurnRunner, options: { maxConcurrency?: number } = {}) {
    const manager = createSubagentManager({
      tools,
      runTurn,
      maxConcurrency: options.maxConcurrency,
      getAgentProfile: async () => ({
        id: 'chat',
        toolSurface: 'chat',
        modelFeature: 'chat',
        useCatalogs: true,
        persistSession: true,
        stepCap: 100,
        sendReasoning: true,
        buildInstructions: () => 'test',
      }),
    })
    managers.push(manager)
    return manager
  }

  it('spawns asynchronously, persists lineage, and returns the completed result through wait', async () => {
    let release!: () => void
    const running = new Promise<void>(resolve => { release = resolve })
    const runTurn = vi.fn<SubagentTurnRunner>(async ({ request }) => {
      await running
      await tools.call('session.update', {
        id: request.id,
        messages: [
          ...request.messages,
          { id: 'answer_1', role: 'assistant', parts: [{ type: 'text', text: 'Mapped the repository.' }] },
        ],
      }, { actor: 'system' })
    })
    const manager = managerWith(runTurn)
    const parent: ToolContext = {
      actor: 'ai',
      sessionId: 'session_parent',
      subagent: {
        rootSessionId: 'session_parent',
        parentSessionId: 'session_parent',
        depth: 0,
        modelId: 'parent-model',
        toolAllowlist: ['fs.read', 'search', 'subagent.spawn'],
        originActor: 'ai',
      },
    }

    const spawned = await manager.spawn({ prompt: 'Map the repository.' }, parent)

    expect(spawned).toMatchObject({ status: expect.stringMatching(/queued|working/), sessionId: expect.any(String), turnId: expect.any(String) })
    const before = await tools.call('session.get', { id: spawned.sessionId }, { actor: 'system' }) as Session
    expect(before.subagent).toMatchObject({
      parentSessionId: 'session_parent',
      rootSessionId: 'session_parent',
      depth: 1,
      modelId: 'parent-model',
      effectiveToolAllowlist: ['fs.read', 'search', 'subagent.spawn'],
    })
    expect(before.messages[0]).toMatchObject({ role: 'user', parts: [{ type: 'text', text: 'Map the repository.' }] })

    const heartbeat = await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 5 }, parent)
    expect(heartbeat).toMatchObject({ timedOut: true, agents: [{ sessionId: spawned.sessionId }] })
    expect((await manager.status({ sessionId: spawned.sessionId }, parent)).status).not.toBe('stopped')

    release()
    const completed = await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, parent)
    expect(completed).toEqual({
      timedOut: false,
      agents: [expect.objectContaining({
        sessionId: spawned.sessionId,
        status: 'done',
        result: 'Mapped the repository.',
        resultTruncated: false,
      })],
    })
  })

  it('records an error when a turn finishes without an assistant response', async () => {
    const manager = managerWith(async () => {})
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }
    const spawned = await manager.spawn({ prompt: 'Do the work.' }, ctx)

    const completed = await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, ctx)

    expect(completed).toMatchObject({
      timedOut: false,
      agents: [{
        sessionId: spawned.sessionId,
        status: 'error',
        error: 'Subagent turn finished without an assistant response.',
      }],
    })
  })

  it('does not reuse an earlier answer when a follow-up produces no response', async () => {
    let turn = 0
    const manager = managerWith(async ({ request }) => {
      turn += 1
      if (turn !== 1) return
      await tools.call('session.update', {
        id: request.id,
        messages: [
          ...request.messages,
          { id: 'first_answer', role: 'assistant', parts: [{ type: 'text', text: 'first result' }] },
        ],
      }, { actor: 'system' })
    })
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }
    const spawned = await manager.spawn({ prompt: 'First turn.' }, ctx)
    await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, ctx)

    await manager.send({ sessionId: spawned.sessionId, message: 'Follow up.' }, ctx)
    const followed = await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, ctx)

    expect(followed).toMatchObject({
      timedOut: false,
      agents: [{ status: 'error', error: 'Subagent turn finished without an assistant response.' }],
    })
  })

  it('delivers steering at a safe boundary and starts contextual follow-ups after completion', async () => {
    const seen: string[][] = []
    let firstBoundary!: () => void
    const boundary = new Promise<void>(resolve => { firstBoundary = resolve })
    const runTurn = vi.fn<SubagentTurnRunner>(async ({ request, consumeInbox }) => {
      if (seen.length === 0) await boundary
      const inbox = await consumeInbox()
      const steering = inbox.map(message => message.parts?.map(part => part.type === 'text' ? part.text : '').join('') ?? '')
      seen.push(steering)
      await tools.call('session.update', {
        id: request.id,
        messages: [
          ...request.messages,
          ...inbox,
          { id: `answer_${seen.length}`, role: 'assistant', parts: [{ type: 'text', text: `turn-${seen.length}` }] },
        ],
      }, { actor: 'system' })
    })
    const manager = managerWith(runTurn)
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }
    const spawned = await manager.spawn({ prompt: 'Build it.' }, ctx)

    const steered = await manager.send({ sessionId: spawned.sessionId, message: 'Also update the docs.' }, ctx)
    expect(steered.delivery).toBe('steer')
    firstBoundary()
    await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, ctx)
    expect(seen[0]).toEqual(['Also update the docs.'])

    const followed = await manager.send({ sessionId: spawned.sessionId, message: 'Now review the tests.' }, ctx)
    expect(followed).toMatchObject({ delivery: 'follow-up', status: expect.stringMatching(/queued|working/) })
    await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, ctx)
    expect(runTurn).toHaveBeenCalledTimes(2)
    expect(runTurn.mock.calls[1][0].request.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', parts: [{ type: 'text', text: 'turn-1' }] }),
      expect.objectContaining({ role: 'user', parts: [{ type: 'text', text: 'Now review the tests.' }] }),
    ]))
  })

  it('turns steering that misses the last safe boundary into a follow-up turn', async () => {
    let letFirstTurnReturn!: () => void
    let firstTurnPersisted!: () => void
    const firstCanReturn = new Promise<void>(resolve => { letFirstTurnReturn = resolve })
    const firstPersisted = new Promise<void>(resolve => { firstTurnPersisted = resolve })
    let turn = 0
    const runTurn = vi.fn<SubagentTurnRunner>(async ({ request }) => {
      turn += 1
      await tools.call('session.update', {
        id: request.id,
        messages: [
          ...request.messages,
          { id: `answer_${turn}`, role: 'assistant', parts: [{ type: 'text', text: `turn-${turn}` }] },
        ],
      }, { actor: 'system' })
      if (turn === 1) {
        firstTurnPersisted()
        await firstCanReturn
      }
    })
    const manager = managerWith(runTurn)
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }
    const spawned = await manager.spawn({ prompt: 'Build it.' }, ctx)
    await firstPersisted

    const steered = await manager.send({
      sessionId: spawned.sessionId,
      message: 'Also verify the migration.',
    }, ctx)
    expect(steered.delivery).toBe('steer')
    letFirstTurnReturn()

    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2))
    const completed = await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, ctx)
    expect(completed).toMatchObject({ timedOut: false, agents: [{ status: 'done', result: 'turn-2' }] })
    expect(runTurn.mock.calls[1][0].request.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', parts: [{ type: 'text', text: 'turn-1' }] }),
      expect.objectContaining({ role: 'user', parts: [{ type: 'text', text: 'Also verify the migration.' }] }),
    ]))
  })

  it('does not miss a completion event between its status read and listener registration', async () => {
    let finish!: () => void
    let started!: () => void
    const canFinish = new Promise<void>(resolve => { finish = resolve })
    const didStart = new Promise<void>(resolve => { started = resolve })
    const manager = managerWith(async ({ request }) => {
      started()
      await canFinish
      await tools.call('session.update', {
        id: request.id,
        messages: [
          ...request.messages,
          { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
        ],
      }, { actor: 'system' })
    })
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }
    const spawned = await manager.spawn({ prompt: 'Work.' }, ctx)
    await didStart

    const originalCall = tools.call.bind(tools)
    let forceRace = true
    vi.spyOn(tools, 'call').mockImplementation(async (name, params, callCtx) => {
      const stale = await originalCall(name, params, callCtx)
      if (forceRace && name === 'session.get' && params.id === spawned.sessionId) {
        forceRace = false
        finish()
        await vi.waitFor(async () => {
          const current = await originalCall('session.get', { id: spawned.sessionId }, { actor: 'system' }) as Session
          expect(current.subagent?.status).toBe('done')
        })
      }
      return stale
    })

    const startedAt = Date.now()
    const completed = await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 500 }, ctx)

    expect(completed.timedOut).toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(200)
  })

  it('interrupts the active turn without deleting the thread and can redirect it', async () => {
    const runTurn = vi.fn<SubagentTurnRunner>(async ({ request }) => {
      await new Promise<void>((resolve, reject) => {
        request.abortSignal?.addEventListener('abort', () => reject(request.abortSignal?.reason), { once: true })
      })
    })
    const manager = managerWith(runTurn)
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }
    const spawned = await manager.spawn({ prompt: 'Take the long route.' }, ctx)

    const interrupted = await manager.interrupt({ sessionId: spawned.sessionId }, ctx)
    expect(interrupted).toMatchObject({ sessionId: spawned.sessionId, status: 'interrupted' })
    const session = await tools.call('session.get', { id: spawned.sessionId }, { actor: 'system' }) as Session
    expect(session.subagent?.status).toBe('interrupted')
    expect(session.messages[0]).toMatchObject({ role: 'user' })
  })

  it('treats approval state as a pause and resumes the same turn after resolution', async () => {
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const manager = managerWith(async ({ request }) => {
      await blocked
      await tools.call('session.update', {
        id: request.id,
        messages: [
          ...request.messages,
          { id: 'answer', role: 'assistant', parts: [{ type: 'text', text: 'recovered' }] },
        ],
      }, { actor: 'system' })
    })
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }
    const spawned = await manager.spawn({ prompt: 'Try the operation.' }, ctx)

    await manager.markApproval(spawned.sessionId, 'needs-approval')
    expect((await manager.status({ sessionId: spawned.sessionId }, ctx)).status).toBe('needs-approval')
    await manager.markApproval(spawned.sessionId, 'working')
    expect((await manager.status({ sessionId: spawned.sessionId }, ctx)).status).toBe('working')

    release()
    const completed = await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, ctx)
    expect(completed.agents[0]).toMatchObject({ status: 'done', result: 'recovered' })
  })

  it('cancels pending approvals when a child is stopped and ignores late approval callbacks', async () => {
    let rejectApproval!: (error: Error) => void
    const approval = new Promise<void>((_resolve, reject) => { rejectApproval = reject })
    const cancelApprovals = vi.fn(() => rejectApproval(new Error('Approval cancelled')))
    const manager = createSubagentManager({
      tools,
      runTurn: async () => approval,
      cancelApprovals,
      getAgentProfile: async () => ({
        id: 'chat',
        toolSurface: 'chat',
        modelFeature: 'chat',
        useCatalogs: true,
        persistSession: true,
        stepCap: 100,
        sendReasoning: true,
        buildInstructions: () => 'test',
      }),
    })
    managers.push(manager)
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }
    const spawned = await manager.spawn({ prompt: 'Needs approval.' }, ctx)
    await manager.markApproval(spawned.sessionId, 'needs-approval')

    await manager.stop({ sessionId: spawned.sessionId }, ctx)
    await manager.markApproval(spawned.sessionId, 'working')

    expect(cancelApprovals).toHaveBeenCalledWith(spawned.sessionId)
    expect((await manager.status({ sessionId: spawned.sessionId }, ctx)).status).toBe('stopped')
  })

  it('queues excess work instead of imposing a runtime deadline', async () => {
    const releases: Array<() => void> = []
    const runTurn = vi.fn<SubagentTurnRunner>(async ({ request }) => {
      await new Promise<void>(resolve => releases.push(resolve))
      await tools.call('session.update', { id: request.id, messages: request.messages }, { actor: 'system' })
    })
    const manager = managerWith(runTurn, { maxConcurrency: 1 })
    const ctx: ToolContext = { actor: 'ai', sessionId: 'parent' }

    const first = await manager.spawn({ prompt: 'First.' }, ctx)
    const second = await manager.spawn({ prompt: 'Second.' }, ctx)
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1))
    expect((await manager.status({ sessionId: second.sessionId }, ctx)).status).toBe('queued')

    releases.shift()?.()
    await manager.wait({ sessionIds: [first.sessionId], timeoutMs: 1_000 }, ctx)
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2))
    releases.shift()?.()
  })

  it('releases its scheduler lease while waiting for a descendant', async () => {
    let manager!: ReturnType<typeof createSubagentManager>
    const runTurn: SubagentTurnRunner = async ({ request }) => {
      const prompt = JSON.stringify(request.messages)
      if (prompt.includes('Parent task')) {
        const child = await manager.spawn({ prompt: 'Nested task' }, {
          actor: 'ai',
          sessionId: request.id,
          subagent: request.subagent,
        })
        const nested = await manager.wait({ sessionIds: [child.sessionId], timeoutMs: 1_000 }, {
          actor: 'ai',
          sessionId: request.id,
          subagent: request.subagent,
        })
        expect(nested.timedOut).toBe(false)
      }
      await tools.call('session.update', {
        id: request.id,
        messages: [
          ...request.messages,
          { id: `answer_${request.id}`, role: 'assistant', parts: [{ type: 'text', text: 'done' }] },
        ],
      }, { actor: 'system' })
    }
    manager = createSubagentManager({
      tools,
      runTurn,
      maxConcurrency: 1,
      getAgentProfile: async () => ({
        id: 'chat',
        toolSurface: 'chat',
        modelFeature: 'chat',
        useCatalogs: true,
        persistSession: true,
        stepCap: 100,
        sendReasoning: true,
        buildInstructions: () => 'test',
      }),
    })
    managers.push(manager)

    const parent = await manager.spawn({ prompt: 'Parent task' }, { actor: 'ai', sessionId: 'root' })
    const completed = await manager.wait({ sessionIds: [parent.sessionId], timeoutMs: 1_000 }, { actor: 'ai', sessionId: 'root' })

    expect(completed).toMatchObject({ timedOut: false, agents: [{ status: 'done', result: 'done' }] })
    expect((await manager.list({}, { actor: 'ai', sessionId: 'root' })).agents).toHaveLength(2)
  })

  it('pages large final responses without treating a page limit as a worker output limit', async () => {
    const longResult = 'x'.repeat(30_000)
    const manager = managerWith(async ({ request }) => {
      await tools.call('session.update', {
        id: request.id,
        messages: [
          ...request.messages,
          { id: 'long_answer', role: 'assistant', parts: [{ type: 'text', text: longResult }] },
        ],
      }, { actor: 'system' })
    })
    const ctx: ToolContext = { actor: 'ai', sessionId: 'root' }
    const spawned = await manager.spawn({ prompt: 'Return the full analysis.' }, ctx)
    const waited = await manager.wait({ sessionIds: [spawned.sessionId], timeoutMs: 1_000 }, ctx)
    expect(waited.agents[0]).toMatchObject({ resultTruncated: true })

    const page = await manager.result({ sessionId: spawned.sessionId, offset: 24_000, maxChars: 10_000 }, ctx)
    expect(page).toMatchObject({ offset: 24_000, totalChars: 30_000, nextOffset: null })
    expect(page.result).toHaveLength(6_000)
  })

  it('reconciles persisted active turns to interrupted on startup', async () => {
    const created = await tools.call('session.create', {
      label: 'Orphaned child',
      subagent: {
        rootSessionId: 'root',
        parentSessionId: 'parent',
        depth: 1,
        status: 'working',
        currentTurnId: 'turn_old',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }, { actor: 'system' }) as Session
    const manager = managerWith(async () => {})

    await manager.reconcile()

    const session = await tools.call('session.get', { id: created.id }, { actor: 'system' }) as Session
    expect(session.subagent).toMatchObject({ status: 'interrupted', error: 'Mim stopped while this turn was active.' })
  })
})

describe('effectiveSubagentToolAllowlist', () => {
  it('can only preserve or narrow parent and selected-agent authority', () => {
    expect(effectiveSubagentToolAllowlist(
      ['fs.read', 'fs.write', 'search'],
      ['fs.read', 'search', 'web.read'],
      ['fs.read', 'web.read'],
    )).toEqual(['fs.read'])
  })

  it('leaves an unrestricted surface unrestricted only when every layer is omitted', () => {
    expect(effectiveSubagentToolAllowlist(undefined, undefined, undefined)).toBeUndefined()
    expect(effectiveSubagentToolAllowlist(undefined, ['fs.read'], undefined)).toEqual(['fs.read'])
  })
})
