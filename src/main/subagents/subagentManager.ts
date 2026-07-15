import { EventEmitter } from 'events'
import { availableParallelism } from 'os'
import { randomUUID } from 'crypto'
import type { UIMessage } from 'ai'
import {
  chatProfile,
  streamProfileResponse,
  type AgentProfile,
  type StreamRequest,
} from '@main/ai/aiRuntime.js'
import type { Session, SessionMessage } from '@main/sessions.js'
import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import {
  isTerminalSubagentStatus,
  type SubagentInboxMessage,
  type SubagentSessionMetadata,
  type SubagentStatus,
} from './types.js'

const DEFAULT_MAX_DESCENDANTS = 64
const DEFAULT_MAX_DEPTH = 4
const DEFAULT_RESULT_CHARS = 24_000
const MAX_RESULT_PAGE_CHARS = 100_000
const MAX_WAIT_MS = 240_000
const MAX_CONTEXT_FILE_CHARS = 50_000

export interface SubagentSpawnParams {
  prompt: string
  label?: string
  model?: string
  agent?: string
  skills?: string[]
  tools?: string[]
  context?: string[]
  requestedGrants?: string[]
}

export interface SubagentTurnRunnerInput {
  profile: AgentProfile
  request: StreamRequest
  consumeInbox: () => Promise<UIMessage[]>
  onActivity: (activity: string) => Promise<void>
}

export type SubagentTurnRunner = (input: SubagentTurnRunnerInput) => Promise<void>

export interface SubagentManagerOptions {
  tools: ToolRegistry
  getAgentProfile?: (agentId?: string) => Promise<AgentProfile>
  runTurn?: SubagentTurnRunner
  maxConcurrency?: number
  maxDepth?: number
  maxDescendants?: number
  cancelApprovals?: (sessionId: string) => void
  emit?: (event: SubagentEvent) => void
}

export interface SubagentEvent {
  type: 'created' | 'status' | 'activity' | 'inbox'
  sessionId: string
  rootSessionId: string
  parentSessionId: string
  status: SubagentStatus
  turnId?: string
  activity?: string
}

export interface SubagentManager {
  spawn(params: SubagentSpawnParams, ctx: ToolContext): Promise<{ sessionId: string; turnId: string; status: 'queued' | 'working' }>
  wait(params: { sessionIds: string[]; until?: 'any' | 'all'; timeoutMs?: number }, ctx: ToolContext): Promise<SubagentWaitResult>
  send(params: { sessionId: string; message: string }, ctx: ToolContext): Promise<{ sessionId: string; turnId: string; status: SubagentStatus; delivery: 'steer' | 'follow-up' }>
  interrupt(params: { sessionId: string; message?: string }, ctx: ToolContext): Promise<{ sessionId: string; status: SubagentStatus; turnId?: string }>
  stop(params: { sessionId: string }, ctx: ToolContext): Promise<{ sessionId: string; status: 'stopped' }>
  status(params: { sessionId: string }, ctx: ToolContext): Promise<SubagentStatusResult>
  list(_params: Record<string, never>, ctx: ToolContext): Promise<{ agents: SubagentStatusResult[] }>
  result(params: { sessionId: string; offset?: number; maxChars?: number }, ctx: ToolContext): Promise<{ sessionId: string; status: SubagentStatus; result: string; offset: number; nextOffset: number | null; totalChars: number }>
  reconcile(): Promise<void>
  interruptActive(reason?: string): Promise<void>
  markApproval(sessionId: string, status: 'needs-approval' | 'working' | 'error', error?: string): Promise<void>
  dispose(): Promise<void>
}

export interface SubagentStatusResult {
  sessionId: string
  parentSessionId: string
  rootSessionId: string
  status: SubagentStatus
  turnId?: string
  label: string
  modelId?: string
  agentId?: string
  lastActivity?: string
  error?: string
  result?: string
  resultTruncated?: boolean
  updatedAt: string
}

export interface SubagentWaitResult {
  timedOut: boolean
  agents: SubagentStatusResult[]
}

interface ActiveTurn {
  sessionId: string
  turnId: string
  phase: 'running' | 'finishing'
  controller: AbortController
  completion: Promise<void>
  resolveCompletion: () => void
  leaseRelease?: () => void
  stopStatus?: 'interrupted' | 'stopped'
  nextTurn?: {
    turnId: string
    profile: AgentProfile
  }
}

export function effectiveSubagentToolAllowlist(
  parent: string[] | undefined,
  selectedAgent: string[] | undefined,
  requested: string[] | undefined,
): string[] | undefined {
  const layers = [parent, selectedAgent, requested].filter((layer): layer is string[] => layer !== undefined)
  if (!layers.length) return undefined
  const [first, ...rest] = layers
  const remaining = rest.map(layer => new Set(layer))
  return [...new Set(first)].filter(toolName => remaining.every(layer => layer.has(toolName)))
}

export function createSubagentManager(options: SubagentManagerOptions): SubagentManager {
  const { tools } = options
  const getAgentProfile = options.getAgentProfile ?? (async (agentId?: string) => {
    if (agentId) throw new Error(`Agent profile is unavailable: ${agentId}`)
    return chatProfile
  })
  const runTurn = options.runTurn ?? (async ({ profile, request }: SubagentTurnRunnerInput) => {
    const response = await streamProfileResponse({ profile, tools, request })
    await response.text()
  })
  const pool = new AsyncPool(options.maxConcurrency ?? Math.min(8, Math.max(1, availableParallelism())))
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxDescendants = options.maxDescendants ?? DEFAULT_MAX_DESCENDANTS
  const cancelApprovals = options.cancelApprovals ?? (() => {})
  const active = new Map<string, ActiveTurn>()
  const events = new EventEmitter()
  const changeVersions = new Map<string, number>()
  events.setMaxListeners(0)
  let disposed = false

  async function spawn(
    params: SubagentSpawnParams,
    ctx: ToolContext,
  ): Promise<{ sessionId: string; turnId: string; status: 'queued' | 'working' }> {
    assertUsable()
    const prompt = requireText(params.prompt, 'prompt')
    const parentSessionId = ctx.sessionId
    if (!parentSessionId) throw new Error('Subagents require a parent session')
    const rootSessionId = ctx.subagent?.rootSessionId ?? parentSessionId
    const depth = (ctx.subagent?.depth ?? 0) + 1
    if (depth > maxDepth) throw new Error(`Subagent depth limit reached (${maxDepth})`)
    const descendants = await lineageSessions(rootSessionId)
    const liveDescendants = descendants.filter(session => session.subagent && !isTerminalSubagentStatus(session.subagent.status))
    if (liveDescendants.length >= maxDescendants) {
      throw new Error(`Subagent descendant limit reached (${maxDescendants})`)
    }

    const profile = await getAgentProfile(params.agent)
    const effectiveToolAllowlist = effectiveSubagentToolAllowlist(
      ctx.subagent?.toolAllowlist,
      profile.toolAllowlist,
      cleanStringArray(params.tools),
    )
    const requestedGrants = cleanStringArray(params.requestedGrants) ?? []
    if (effectiveToolAllowlist) {
      const allowed = new Set(effectiveToolAllowlist)
      const invalidGrant = requestedGrants.find(toolName => !allowed.has(toolName))
      if (invalidGrant) throw new Error(`Requested grant is outside the child tool surface: ${invalidGrant}`)
    }
    const modelId = params.model ?? ctx.subagent?.modelId ?? profile.defaultModelId
    const now = new Date().toISOString()
    const turnId = newTurnId()
    const metadata: SubagentSessionMetadata = {
      rootSessionId,
      parentSessionId,
      depth,
      status: 'queued',
      currentTurnId: turnId,
      ...(modelId ? { modelId } : {}),
      ...(params.agent ? { agentId: params.agent } : {}),
      ...(effectiveToolAllowlist ? { effectiveToolAllowlist } : {}),
      ...(ctx.subagent?.approvalAllow?.length ? { approvalAllow: [...ctx.subagent.approvalAllow] } : {}),
      ...(requestedGrants.length ? { requestedGrants } : {}),
      originActor: ctx.subagent?.originActor ?? (ctx.actor === 'package' ? 'ai' : ctx.actor),
      ...(ctx.subagent?.principal ?? ctx.principal ? { principal: ctx.subagent?.principal ?? ctx.principal } : {}),
      ...(ctx.subagent?.callerName ?? ctx.callerName ? { callerName: ctx.subagent?.callerName ?? ctx.callerName } : {}),
      ...(ctx.subagent?.transport ?? ctx.transport ? { transport: ctx.subagent?.transport ?? ctx.transport } : {}),
      inbox: [],
      createdAt: now,
      updatedAt: now,
    }
    const session = await tools.call('session.create', {
      label: cleanLabel(params.label) ?? labelFromPrompt(prompt),
      ...(modelId ? { modelId } : {}),
      ...(params.agent ? { agentId: params.agent } : {}),
      subagent: metadata,
    }, systemContext(ctx)) as Session
    const firstMessage = await buildInitialMessage(prompt, params.context, ctx)
    await tools.call('session.update', {
      id: session.id,
      messages: [firstMessage],
    }, systemContext(ctx))
    scheduleTurn(session.id, turnId, profile, params.skills, ctx.traceId && ctx.spanId ? { traceId: ctx.traceId, spanId: ctx.spanId } : undefined)
    emit('created', { ...metadata, status: active.get(session.id)?.leaseRelease ? 'working' : 'queued' }, session.id)
    trace('subagent.spawn', session.id, metadata, ctx, { turnId })
    return {
      sessionId: session.id,
      turnId,
      status: active.get(session.id)?.leaseRelease ? 'working' : 'queued',
    }
  }

  async function wait(
    params: { sessionIds: string[]; until?: 'any' | 'all'; timeoutMs?: number },
    ctx: ToolContext,
  ): Promise<SubagentWaitResult> {
    const sessionIds = [...new Set(params.sessionIds.filter(id => typeof id === 'string' && id.length > 0))]
    if (!sessionIds.length) throw new Error('sessionIds must contain at least one subagent session')
    const until = params.until ?? 'any'
    const timeoutMs = Math.max(0, Math.min(params.timeoutMs ?? MAX_WAIT_MS, MAX_WAIT_MS))
    return withCallerLeaseReleased(ctx, async () => {
      const deadline = Date.now() + timeoutMs
      while (true) {
        const observedVersions = new Map(sessionIds.map(id => [id, changeVersions.get(id) ?? 0]))
        const agents = await Promise.all(sessionIds.map(id => status({ sessionId: id }, ctx)))
        const settled = agents.map(agent => isWaitSettled(agent.status))
        if ((until === 'all' && settled.every(Boolean)) || (until === 'any' && settled.some(Boolean))) {
          await markCollected(agents.filter(agent => isWaitSettled(agent.status)))
          return { timedOut: false, agents }
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) return { timedOut: true, agents }
        await waitForEvent(sessionIds, remaining, observedVersions)
      }
    })
  }

  async function send(
    params: { sessionId: string; message: string },
    ctx: ToolContext,
  ): Promise<{ sessionId: string; turnId: string; status: SubagentStatus; delivery: 'steer' | 'follow-up' }> {
    assertUsable()
    const message = requireText(params.message, 'message')
    const session = await ownedSession(params.sessionId, ctx)
    const metadata = session.subagent!
    if (metadata.status === 'stopped') throw new Error('Stopped subagent threads cannot receive more work')
    const activeTurn = active.get(session.id)
    if (activeTurn?.phase === 'finishing') {
      await activeTurn.completion
      return send(params, ctx)
    }
    if (activeTurn && !isTerminalSubagentStatus(metadata.status)) {
      const entry: SubagentInboxMessage = {
        id: `inbox_${randomUUID()}`,
        message,
        createdAt: new Date().toISOString(),
      }
      await updateMetadata(session.id, {
        inbox: [...metadata.inbox, entry],
        lastActivity: 'Steering message queued',
        lastActivityAt: entry.createdAt,
      })
      emit('inbox', { ...metadata, status: metadata.status }, session.id)
      trace('subagent.steer', session.id, metadata, ctx, { turnId: activeTurn.turnId })
      return { sessionId: session.id, turnId: activeTurn.turnId, status: metadata.status, delivery: 'steer' }
    }

    const turnId = newTurnId()
    const userMessage = uiTextMessage(message)
    await tools.call('session.update', {
      id: session.id,
      messages: [...session.messages, userMessage],
      subagent: {
        status: 'queued',
        currentTurnId: turnId,
        result: '',
        resultUpdatedAt: '',
        completedAt: '',
        error: '',
        updatedAt: new Date().toISOString(),
      },
    }, systemContext(ctx))
    const profile = await getAgentProfile(metadata.agentId)
    scheduleTurn(session.id, turnId, profile, undefined, undefined)
    trace('subagent.follow-up', session.id, metadata, ctx, { turnId })
    return {
      sessionId: session.id,
      turnId,
      status: active.get(session.id)?.leaseRelease ? 'working' : 'queued',
      delivery: 'follow-up',
    }
  }

  async function interrupt(
    params: { sessionId: string; message?: string },
    ctx: ToolContext,
  ): Promise<{ sessionId: string; status: SubagentStatus; turnId?: string }> {
    const session = await ownedSession(params.sessionId, ctx)
    const activeTurn = active.get(session.id)
    if (!activeTurn) {
      await updateMetadata(session.id, { status: 'interrupted', completedAt: new Date().toISOString() })
      cancelApprovals(session.id)
      if (params.message) {
        const redirected = await send({ sessionId: session.id, message: params.message }, ctx)
        return { sessionId: session.id, status: redirected.status, turnId: redirected.turnId }
      }
      return { sessionId: session.id, status: 'interrupted', turnId: session.subagent?.currentTurnId }
    }
    activeTurn.stopStatus = 'interrupted'
    await updateMetadata(session.id, {
      status: 'interrupted',
      completedAt: new Date().toISOString(),
      lastActivity: 'Turn interrupted',
      lastActivityAt: new Date().toISOString(),
    })
    cancelApprovals(session.id)
    activeTurn.controller.abort(new Error('Subagent turn interrupted'))
    trace('subagent.interrupt', session.id, session.subagent!, ctx, { turnId: activeTurn.turnId })
    if (params.message) {
      await activeTurn.completion
      const redirected = await send({ sessionId: session.id, message: params.message }, ctx)
      return { sessionId: session.id, status: redirected.status, turnId: redirected.turnId }
    }
    return { sessionId: session.id, status: 'interrupted', turnId: activeTurn.turnId }
  }

  async function stop(
    params: { sessionId: string },
    ctx: ToolContext,
  ): Promise<{ sessionId: string; status: 'stopped' }> {
    const session = await ownedSession(params.sessionId, ctx)
    const activeTurn = active.get(session.id)
    if (activeTurn) {
      activeTurn.stopStatus = 'stopped'
      activeTurn.controller.abort(new Error('Subagent stopped'))
    }
    await updateMetadata(session.id, {
      status: 'stopped',
      completedAt: new Date().toISOString(),
      lastActivity: 'Stopped',
      lastActivityAt: new Date().toISOString(),
    })
    cancelApprovals(session.id)
    trace('subagent.stop', session.id, session.subagent!, ctx, { turnId: activeTurn?.turnId })
    return { sessionId: session.id, status: 'stopped' }
  }

  async function status(params: { sessionId: string }, ctx: ToolContext): Promise<SubagentStatusResult> {
    return statusSummary(await ownedSession(params.sessionId, ctx))
  }

  async function list(_params: Record<string, never>, ctx: ToolContext): Promise<{ agents: SubagentStatusResult[] }> {
    const rootSessionId = contextRoot(ctx)
    if (!rootSessionId && ctx.actor !== 'user' && ctx.actor !== 'system') throw new Error('Subagents require a task lineage')
    const sessions = await allSessions()
    return {
      agents: sessions
        .filter(session => session.subagent && (!rootSessionId || session.subagent.rootSessionId === rootSessionId))
        .map(statusSummary),
    }
  }

  async function result(
    params: { sessionId: string; offset?: number; maxChars?: number },
    ctx: ToolContext,
  ): Promise<{ sessionId: string; status: SubagentStatus; result: string; offset: number; nextOffset: number | null; totalChars: number }> {
    const session = await ownedSession(params.sessionId, ctx)
    const full = session.subagent?.result ?? latestAssistantText(session.messages) ?? ''
    const offset = Math.max(0, Math.min(integer(params.offset) ?? 0, full.length))
    const maxChars = Math.max(1, Math.min(integer(params.maxChars) ?? DEFAULT_RESULT_CHARS, MAX_RESULT_PAGE_CHARS))
    const page = full.slice(offset, offset + maxChars)
    const nextOffset = offset + page.length < full.length ? offset + page.length : null
    await markCollected([statusSummary(session)])
    return { sessionId: session.id, status: session.subagent!.status, result: page, offset, nextOffset, totalChars: full.length }
  }

  async function reconcile(): Promise<void> {
    const sessions = await allSessions()
    await Promise.all(sessions.flatMap(session => {
      const metadata = session.subagent
      if (!metadata || !['queued', 'working', 'waiting', 'needs-approval'].includes(metadata.status)) return []
      return [updateMetadata(session.id, {
        status: 'interrupted',
        error: 'Mim stopped while this turn was active.',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })]
    }))
  }

  async function markApproval(
    sessionId: string,
    approvalStatus: 'needs-approval' | 'working' | 'error',
    error?: string,
  ): Promise<void> {
    const session = await getSession(sessionId).catch(() => null)
    if (!session?.subagent) return
    if (isTerminalSubagentStatus(session.subagent.status)) return
    await updateMetadata(sessionId, {
      status: approvalStatus,
      ...(error ? { error } : { error: '' }),
      ...(approvalStatus === 'error' ? { completedAt: new Date().toISOString() } : {}),
    })
  }

  async function interruptActive(reason = 'Workspace changed while this turn was active.'): Promise<void> {
    const turns = [...active.values()]
    for (const turn of turns) {
      turn.stopStatus = 'interrupted'
      await updateMetadata(turn.sessionId, {
        status: 'interrupted',
        error: reason,
        completedAt: new Date().toISOString(),
      }).catch(() => {})
      cancelApprovals(turn.sessionId)
      turn.controller.abort(new Error(reason))
    }
    await Promise.allSettled(turns.map(turn => turn.completion))
  }

  async function dispose(): Promise<void> {
    if (disposed) return
    disposed = true
    const turns = [...active.values()]
    for (const turn of turns) {
      turn.stopStatus = 'interrupted'
      cancelApprovals(turn.sessionId)
      turn.controller.abort(new Error('Mim stopped while this turn was active.'))
    }
    await Promise.allSettled(turns.map(turn => turn.completion))
    events.removeAllListeners()
  }

  function scheduleTurn(
    sessionId: string,
    turnId: string,
    profile: AgentProfile,
    skills: string[] | undefined,
    parentTrace: { traceId: string; spanId: string } | undefined,
  ): void {
    let resolveCompletion!: () => void
    const completion = new Promise<void>(resolve => { resolveCompletion = resolve })
    const turn: ActiveTurn = {
      sessionId,
      turnId,
      phase: 'running',
      controller: new AbortController(),
      completion,
      resolveCompletion,
    }
    active.set(sessionId, turn)
    void executeTurn(turn, profile, skills, parentTrace)
  }

  async function executeTurn(
    turn: ActiveTurn,
    profile: AgentProfile,
    skills: string[] | undefined,
    parentTrace: { traceId: string; spanId: string } | undefined,
  ): Promise<void> {
    try {
      turn.leaseRelease = await pool.acquire()
      if (turn.controller.signal.aborted) throw turn.controller.signal.reason
      const session = await getSession(turn.sessionId)
      const metadata = session.subagent!
      const startedAt = new Date().toISOString()
      await updateMetadata(session.id, {
        status: 'working',
        startedAt,
        updatedAt: startedAt,
        lastActivity: 'Turn started',
        lastActivityAt: startedAt,
      })
      trace('subagent.start', session.id, metadata, { actor: 'system' }, { turnId: turn.turnId })
      await runTurn({
        profile: {
          ...profile,
          persistSession: true,
          toolAllowlist: metadata.effectiveToolAllowlist,
        },
        request: {
          id: session.id,
          messages: session.messages as UIMessage[],
          modelId: metadata.modelId,
          agentId: metadata.agentId,
          skills,
          trace: parentTrace,
          abortSignal: turn.controller.signal,
          subagent: delegationContext(metadata),
          consumeSubagentInbox: () => consumeInbox(session.id),
          onSubagentActivity: activity => updateActivity(session.id, activity),
        },
        consumeInbox: () => consumeInbox(session.id),
        onActivity: activity => updateActivity(session.id, activity),
      })
      turn.phase = 'finishing'
      if (turn.stopStatus) return
      let completed = await getSession(session.id)
      const resultText = latestAssistantText(completed.messages, session.messages.length)
      if (!resultText) throw new Error('Subagent turn finished without an assistant response.')
      const completedAt = new Date().toISOString()
      const lateSteering = await consumeInbox(session.id)
      if (lateSteering.length) {
        const nextTurnId = newTurnId()
        completed = await tools.call('session.update', {
          id: session.id,
          messages: [...completed.messages, ...lateSteering],
          subagent: {
            status: 'queued',
            currentTurnId: nextTurnId,
            result: resultText,
            resultUpdatedAt: completedAt,
            error: '',
            completedAt: '',
            updatedAt: completedAt,
            lastActivity: 'Late steering queued as a follow-up',
            lastActivityAt: completedAt,
          },
        }, { actor: 'system' }) as Session
        if (completed.subagent) emit('status', completed.subagent, completed.id)
        signalChange(completed.id)
        turn.nextTurn = { turnId: nextTurnId, profile }
        trace('subagent.follow-up', session.id, metadata, { actor: 'system' }, { turnId: nextTurnId })
      } else {
        await updateMetadata(session.id, {
          status: 'done',
          result: resultText,
          resultUpdatedAt: completedAt,
          error: '',
          completedAt,
          updatedAt: completedAt,
          lastActivity: 'Turn completed',
          lastActivityAt: completedAt,
        })
      }
      trace('subagent.done', session.id, metadata, { actor: 'system' }, { turnId: turn.turnId })
    } catch (error) {
      turn.phase = 'finishing'
      if (!turn.stopStatus) {
        const message = error instanceof Error ? error.message : String(error)
        const completedAt = new Date().toISOString()
        await updateMetadata(turn.sessionId, {
          status: 'error',
          error: message,
          completedAt,
          updatedAt: completedAt,
          lastActivity: 'Turn failed',
          lastActivityAt: completedAt,
        }).catch(() => {})
      }
    } finally {
      turn.leaseRelease?.()
      turn.leaseRelease = undefined
      if (active.get(turn.sessionId) === turn) active.delete(turn.sessionId)
      turn.resolveCompletion()
      signalChange(turn.sessionId)
      if (turn.nextTurn && !disposed && !turn.stopStatus) {
        scheduleTurn(turn.sessionId, turn.nextTurn.turnId, turn.nextTurn.profile, undefined, undefined)
      }
    }
  }

  async function consumeInbox(sessionId: string): Promise<UIMessage[]> {
    const session = await getSession(sessionId)
    const metadata = session.subagent!
    const pending = metadata.inbox.filter(message => !message.deliveredAt)
    if (!pending.length) return []
    const deliveredAt = new Date().toISOString()
    await updateMetadata(sessionId, {
      inbox: metadata.inbox.map(message => pending.some(item => item.id === message.id)
        ? { ...message, deliveredAt }
        : message),
      lastActivity: `Received ${pending.length} steering message${pending.length === 1 ? '' : 's'}`,
      lastActivityAt: deliveredAt,
    })
    return pending.map(message => uiTextMessage(message.message)) as UIMessage[]
  }

  async function updateActivity(sessionId: string, activity: string): Promise<void> {
    const value = activity.trim().slice(0, 240)
    if (!value) return
    const session = await getSession(sessionId)
    await updateMetadata(sessionId, {
      lastActivity: value,
      lastActivityAt: new Date().toISOString(),
    })
    emit('activity', session.subagent!, sessionId, value)
  }

  async function withCallerLeaseReleased<T>(ctx: ToolContext, work: () => Promise<T>): Promise<T> {
    const caller = ctx.sessionId ? active.get(ctx.sessionId) : undefined
    if (!caller?.leaseRelease) return work()
    caller.leaseRelease()
    caller.leaseRelease = undefined
    await updateMetadata(caller.sessionId, {
      status: 'waiting',
      lastActivity: 'Waiting for subagents',
      lastActivityAt: new Date().toISOString(),
    })
    try {
      return await work()
    } finally {
      if (!caller.controller.signal.aborted) {
        caller.leaseRelease = await pool.acquire()
        await updateMetadata(caller.sessionId, {
          status: 'working',
          lastActivity: 'Resumed after subagent wait',
          lastActivityAt: new Date().toISOString(),
        })
      }
    }
  }

  async function buildInitialMessage(prompt: string, contextPaths: string[] | undefined, ctx: ToolContext): Promise<SessionMessage> {
    const parts: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
    for (const path of cleanStringArray(contextPaths) ?? []) {
      const read = await tools.call('fs.read', { path, max_chars: MAX_CONTEXT_FILE_CHARS }, ctx) as { content?: unknown; path?: unknown; truncated?: unknown }
      if (typeof read.content !== 'string') continue
      parts.push({
        type: 'data-context',
        data: {
          filename: typeof read.path === 'string' ? read.path : path,
          content: read.content,
          truncated: read.truncated === true,
        },
      })
    }
    return { id: `message_${randomUUID()}`, role: 'user', parts, createdAt: new Date().toISOString() }
  }

  async function updateMetadata(sessionId: string, patch: Partial<SubagentSessionMetadata>): Promise<Session> {
    const session = await tools.call('session.update', {
      id: sessionId,
      subagent: { ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() },
    }, { actor: 'system' }) as Session
    if (session.subagent) emit('status', session.subagent, session.id)
    signalChange(sessionId)
    return session
  }

  async function getSession(sessionId: string): Promise<Session> {
    const session = await tools.call('session.get', { id: sessionId }, { actor: 'system' }) as Session
    if (!session.subagent) throw new Error(`Not a subagent session: ${sessionId}`)
    return session
  }

  async function ownedSession(sessionId: string, ctx: ToolContext): Promise<Session> {
    const session = await getSession(sessionId)
    if (ctx.actor === 'user' || ctx.actor === 'system') return session
    const root = contextRoot(ctx)
    if (!root || session.subagent?.rootSessionId !== root) throw new Error('Subagent is outside this task lineage')
    return session
  }

  async function allSessions(): Promise<Session[]> {
    const result = await tools.call('session.list', {}, { actor: 'system' }) as { sessions?: Session[] }
    return result.sessions ?? []
  }

  async function lineageSessions(rootSessionId: string): Promise<Session[]> {
    return (await allSessions()).filter(session => session.subagent?.rootSessionId === rootSessionId)
  }

  async function markCollected(agents: SubagentStatusResult[]): Promise<void> {
    const now = new Date().toISOString()
    await Promise.all(agents.map(agent => updateMetadata(agent.sessionId, { collectedAt: now }).catch(() => undefined)))
  }

  function waitForEvent(
    sessionIds: string[],
    timeoutMs: number,
    observedVersions: Map<string, number>,
  ): Promise<void> {
    return new Promise(resolve => {
      let timer: NodeJS.Timeout | undefined
      const changed = () => sessionIds.some(id => (changeVersions.get(id) ?? 0) !== observedVersions.get(id))
      const listener = (sessionId: string) => {
        if (!sessionIds.includes(sessionId)) return
        cleanup()
        resolve()
      }
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        events.off('change', listener)
      }
      if (changed()) {
        resolve()
        return
      }
      events.on('change', listener)
      if (changed()) {
        cleanup()
        resolve()
        return
      }
      timer = setTimeout(() => {
        cleanup()
        resolve()
      }, timeoutMs)
      timer.unref?.()
    })
  }

  function signalChange(sessionId: string): void {
    changeVersions.set(sessionId, (changeVersions.get(sessionId) ?? 0) + 1)
    events.emit('change', sessionId)
  }

  function emit(type: SubagentEvent['type'], metadata: SubagentSessionMetadata, sessionId: string, activity?: string): void {
    options.emit?.({
      type,
      sessionId,
      rootSessionId: metadata.rootSessionId,
      parentSessionId: metadata.parentSessionId,
      status: metadata.status,
      ...(metadata.currentTurnId ? { turnId: metadata.currentTurnId } : {}),
      ...(activity ? { activity } : {}),
    })
  }

  function trace(
    kind: string,
    sessionId: string,
    metadata: SubagentSessionMetadata,
    ctx: Pick<ToolContext, 'actor' | 'traceId' | 'spanId'>,
    data: Record<string, unknown>,
  ): void {
    tools.trace.append({
      kind,
      actor: ctx.actor,
      ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
      ...(ctx.spanId ? { parentSpanId: ctx.spanId } : {}),
      sessionId,
      data: {
        rootSessionId: metadata.rootSessionId,
        parentSessionId: metadata.parentSessionId,
        depth: metadata.depth,
        ...data,
      },
    })
  }

  function assertUsable(): void {
    if (disposed) throw new Error('Subagent manager is stopped')
  }

  return { spawn, wait, send, interrupt, stop, status, list, result, reconcile, interruptActive, markApproval, dispose }
}

class AsyncPool {
  private active = 0
  private readonly queue: Array<(release: () => void) => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Subagent concurrency must be at least 1')
  }

  acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve(this.releaseOnce())
    }
    return new Promise(resolve => this.queue.push(resolve))
  }

  private releaseOnce(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.queue.shift()
      if (next) {
        next(this.releaseOnce())
        return
      }
      this.active -= 1
    }
  }
}

function statusSummary(session: Session): SubagentStatusResult {
  const metadata = session.subagent!
  const fullResult = metadata.result ?? (metadata.status === 'done' ? latestAssistantText(session.messages) : undefined)
  const result = fullResult?.slice(0, DEFAULT_RESULT_CHARS)
  return {
    sessionId: session.id,
    parentSessionId: metadata.parentSessionId,
    rootSessionId: metadata.rootSessionId,
    status: metadata.status,
    ...(metadata.currentTurnId ? { turnId: metadata.currentTurnId } : {}),
    label: session.label,
    ...(metadata.modelId ? { modelId: metadata.modelId } : {}),
    ...(metadata.agentId ? { agentId: metadata.agentId } : {}),
    ...(metadata.lastActivity ? { lastActivity: metadata.lastActivity } : {}),
    ...(metadata.error ? { error: metadata.error } : {}),
    ...(result !== undefined ? { result, resultTruncated: Boolean(fullResult && fullResult.length > result.length) } : {}),
    updatedAt: metadata.updatedAt,
  }
}

function latestAssistantText(messages: SessionMessage[], startIndex = 0): string | undefined {
  for (let index = messages.length - 1; index >= startIndex; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    if (typeof message.content === 'string' && message.content.length > 0) return message.content
    const text = (message.parts ?? [])
      .filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string)
      .join('')
    if (text) return text
  }
  return undefined
}

function delegationContext(metadata: SubagentSessionMetadata): NonNullable<ToolContext['subagent']> {
  return {
    rootSessionId: metadata.rootSessionId,
    parentSessionId: metadata.parentSessionId,
    depth: metadata.depth,
    modelId: metadata.modelId,
    profileId: metadata.agentId ?? 'chat',
    toolAllowlist: metadata.effectiveToolAllowlist,
    approvalAllow: metadata.approvalAllow,
    requestedGrants: metadata.requestedGrants,
    originActor: metadata.originActor ?? 'ai',
    principal: metadata.principal,
    callerName: metadata.callerName,
    transport: metadata.transport,
    status: metadata.status,
  }
}

function contextRoot(ctx: ToolContext): string | undefined {
  return ctx.subagent?.rootSessionId ?? ctx.sessionId
}

function systemContext(ctx: ToolContext): ToolContext {
  return {
    actor: 'system',
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
    ...(ctx.spanId ? { spanId: ctx.spanId } : {}),
  }
}

function uiTextMessage(text: string): SessionMessage {
  return {
    id: `message_${randomUUID()}`,
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
  }
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} is required`)
  return value
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('Expected an array of strings')
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
}

function cleanLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 80) : undefined
}

function labelFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim()
  return compact.length <= 60 ? compact : `${compact.slice(0, 57)}...`
}

function newTurnId(): string {
  return `subagent_turn_${randomUUID()}`
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function isWaitSettled(status: SubagentStatus): boolean {
  return isTerminalSubagentStatus(status) || status === 'needs-approval'
}
