import type { RoutineDefinition } from '@main/routines/routines.js'
import { routineSlackTrigger, type RoutineSlackTriggerMode } from '@main/routines/routines.js'
import { createSlackEventLedger, type SlackEventLedger } from './eventLedger.js'
import { WebSocket } from 'ws'

export interface SlackRoutineBinding {
  routine: RoutineDefinition
  account: string
  channelId: string
  mode: RoutineSlackTriggerMode
}

export interface SlackMessageEvent {
  eventId: string
  account: string
  teamId: string
  type: 'message' | 'app_mention'
  channel: string
  ts: string
  threadTs?: string
  user?: string
  text?: string
  subtype?: string
  botId?: string
}

export interface SlackRoutineFire {
  eventId: string
  routine: RoutineDefinition
  binding: SlackRoutineBinding
  input: {
    slack: {
      account: string
      teamId: string
      channel: string
      ts: string
      threadTs: string
      user?: string
    }
    text: string
  }
}

export type SlackDispatchResult =
  | { status: 'duplicate'; eventId: string }
  | { status: 'ignored'; eventId: string; reason: string }
  | { status: 'queued'; eventId: string; routineId: string }

export interface SlackRoutineDispatcherOptions {
  ledger: SlackEventLedger
  botUserId: string
  getRoutines: () => RoutineDefinition[]
  acknowledge?: (eventId: string) => void
  onFire?: (fire: SlackRoutineFire) => Promise<void> | void
}

export interface SlackBotTokenStatusLike {
  configured: boolean
  botTokenConfigured: boolean
  appTokenConfigured: boolean
}

export interface SlackListenerSlackClient {
  hasBotTokens(account: string): Promise<SlackBotTokenStatusLike>
  botAuthTest(input: { account: string }): Promise<unknown>
  connectionsOpen(input: { account: string }): Promise<string>
  botPostThreadReply(input: { account: string; channel: string; threadTs: string; text: string }): Promise<unknown>
}

export interface SlackWebSocketLike {
  on(event: 'open', listener: () => void): this
  on(event: 'message', listener: (data: unknown) => void): this
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  send(data: string): void
  close(): void
}

export interface SlackSocketModeListenerOptions {
  getWorkspacePath(): string | null
  getRoutines(): RoutineDefinition[]
  runRoutine(
    routine: RoutineDefinition,
    context: { trigger: 'slack'; payload: Record<string, unknown> },
  ): Promise<{ sessionId: string; routineRunId: string; status: string }>
  getSessionReplyText(sessionId: string): Promise<string | null>
  slack: SlackListenerSlackClient
  createLedger?: (workspacePath: string) => SlackEventLedger
  socketFactory?: (url: string) => SlackWebSocketLike
  reconnectDelayMs?: (attempt: number) => number
  trace?: {
    append(event: Record<string, unknown>): void
  }
}

export type SlackListenerAccountState =
  | 'not_configured'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'stopped'
  | 'error'

export interface SlackListenerAccountStatus {
  account: string
  configured: boolean
  connected: boolean
  state: SlackListenerAccountState
  botUserId?: string
  teamId?: string
  lastStartedAt?: string
  lastConnectedAt?: string
  lastEventAt?: string
  lastError?: string
  reconnectAttempt?: number
}

export interface SlackListenerStatus {
  implemented: true
  running: boolean
  live: boolean
  accounts: SlackListenerAccountStatus[]
}

interface SlackAccountRuntime extends SlackListenerAccountStatus {
  desired: boolean
  socket?: SlackWebSocketLike
  ledger?: SlackEventLedger
  reconnectTimer?: ReturnType<typeof setTimeout>
}

interface SlackSocketEnvelope {
  type?: string
  envelope_id?: string
  payload?: unknown
  reason?: string
  debug_info?: unknown
}

const DEFAULT_RECONNECT_DELAY_MS = 1_000
const MAX_REPLY_CHARS = 3_500

export function slackRoutineBindings(routines: RoutineDefinition[]): SlackRoutineBinding[] {
  const bindings: SlackRoutineBinding[] = []
  for (const routine of routines) {
    if (!routine.enabled) continue
    const slack = routineSlackTrigger(routine)
    if (!slack) continue
    for (const channel of slack.channels) {
      bindings.push({
        routine,
        account: slack.account,
        channelId: channel.id,
        mode: channel.mode,
      })
    }
  }
  return bindings
}

export function messageMentionsBot(text: string | undefined, botUserId: string): boolean {
  if (!text || !botUserId) return false
  const escaped = botUserId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<@${escaped}(?:\\|[^>]+)?>`).test(text)
}

export function createSlackRoutineDispatcher(options: SlackRoutineDispatcherOptions) {
  return {
    async handleMessage(event: SlackMessageEvent): Promise<SlackDispatchResult> {
      const threadTs = event.threadTs ?? event.ts
      const received = options.ledger.recordReceived({
        eventId: event.eventId,
        account: event.account,
        teamId: event.teamId,
        channel: event.channel,
        ts: event.ts,
        threadTs,
        type: event.type,
      })
      options.acknowledge?.(event.eventId)
      if (received.duplicate) return { status: 'duplicate', eventId: event.eventId }

      if (hasPriorSlackMessageRecord(options.ledger, received.record.eventId)) {
        options.ledger.updateStatus(event.eventId, 'ignored', { reason: 'duplicate-message' })
        return { status: 'ignored', eventId: event.eventId, reason: 'duplicate-message' }
      }

      if (isBotMessage(event, options.botUserId)) {
        options.ledger.updateStatus(event.eventId, 'ignored', { reason: 'bot-message' })
        return { status: 'ignored', eventId: event.eventId, reason: 'bot-message' }
      }

      const binding = resolveSlackRoutineBinding(
        slackRoutineBindings(options.getRoutines()),
        event,
        options.botUserId,
      )
      if (!binding) {
        options.ledger.updateStatus(event.eventId, 'ignored', { reason: 'no-binding' })
        return { status: 'ignored', eventId: event.eventId, reason: 'no-binding' }
      }

      options.ledger.updateStatus(event.eventId, 'queued', { routineId: binding.routine.id })
      await options.onFire?.({
        eventId: event.eventId,
        routine: binding.routine,
        binding,
        input: {
          slack: {
            account: binding.account,
            teamId: event.teamId,
            channel: event.channel,
            ts: event.ts,
            threadTs,
            ...(event.user ? { user: event.user } : {}),
          },
          text: event.text ?? '',
        },
      })
      options.ledger.updateStatus(event.eventId, 'dispatched', { routineId: binding.routine.id })
      return { status: 'queued', eventId: event.eventId, routineId: binding.routine.id }
    },
  }
}

export function createSlackSocketModeListener(options: SlackSocketModeListenerOptions) {
  const createLedger = options.createLedger ?? createSlackEventLedger
  const socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url) as SlackWebSocketLike)
  const reconnectDelayMs = options.reconnectDelayMs ?? ((attempt: number) =>
    Math.min(DEFAULT_RECONNECT_DELAY_MS * Math.max(1, attempt), 30_000))
  const accounts = new Map<string, SlackAccountRuntime>()

  async function refresh(): Promise<void> {
    const workspace = options.getWorkspacePath()
    if (!workspace) {
      await stop()
      return
    }

    const desired = new Set(slackRoutineBindings(options.getRoutines()).map(binding => binding.account))
    for (const account of [...accounts.keys()]) {
      if (!desired.has(account)) stopAccount(account)
    }
    for (const account of desired) {
      const runtime = ensureRuntime(account)
      runtime.desired = true
      if (runtime.state === 'open' || runtime.state === 'connecting') continue
      await connectAccount(workspace, runtime)
    }
  }

  async function stop(): Promise<void> {
    for (const account of [...accounts.keys()]) stopAccount(account)
  }

  function status(): SlackListenerStatus {
    const accountStatuses = [...accounts.values()]
      .map(({ socket: _socket, ledger: _ledger, reconnectTimer: _timer, desired: _desired, ...item }) => ({ ...item }))
      .sort((a, b) => a.account.localeCompare(b.account))
    return {
      implemented: true,
      running: accountStatuses.some(item => item.state === 'connecting' || item.state === 'open' || item.state === 'reconnecting'),
      live: accountStatuses.some(item => item.connected),
      accounts: accountStatuses,
    }
  }

  async function connectAccount(workspace: string, runtime: SlackAccountRuntime): Promise<void> {
    clearReconnect(runtime)
    runtime.configured = false
    runtime.connected = false
    runtime.state = 'connecting'
    runtime.lastStartedAt = now()
    runtime.lastError = undefined
    runtime.ledger = createLedger(workspace)

    try {
      const credentialStatus = await options.slack.hasBotTokens(runtime.account)
      runtime.configured = credentialStatus.configured
      if (!credentialStatus.configured) {
        runtime.state = 'not_configured'
        return
      }
      const auth = await options.slack.botAuthTest({ account: runtime.account })
      runtime.botUserId = authString(auth, 'user_id')
      runtime.teamId = authString(auth, 'team_id')
      if (!runtime.botUserId) throw new Error('Slack bot auth did not return a bot user id')

      const url = await options.slack.connectionsOpen({ account: runtime.account })
      const socket = socketFactory(url)
      runtime.socket = socket
      socket.on('open', () => {
        runtime.connected = true
        runtime.state = 'open'
        runtime.lastConnectedAt = now()
        runtime.reconnectAttempt = 0
        trace('slack.listener.open', runtime, { teamId: runtime.teamId })
      })
      socket.on('message', data => handleSocketMessage(runtime, data))
      socket.on('error', err => {
        runtime.lastError = err.message
        runtime.state = runtime.connected ? 'open' : 'error'
        trace('slack.listener.error', runtime, { error: err.message })
      })
      socket.on('close', (code, reason) => {
        runtime.connected = false
        runtime.socket = undefined
        const reasonText = reason?.toString('utf-8') || String(code)
        runtime.lastError = reasonText
        trace('slack.listener.close', runtime, { code, reason: reasonText })
        if (!runtime.desired) {
          runtime.state = 'stopped'
          return
        }
        scheduleReconnect(runtime)
      })
    } catch (err) {
      runtime.connected = false
      runtime.state = 'error'
      runtime.lastError = errorMessage(err)
      trace('slack.listener.error', runtime, { error: runtime.lastError })
      if (runtime.desired) scheduleReconnect(runtime)
    }
  }

  function handleSocketMessage(runtime: SlackAccountRuntime, data: unknown): void {
    const message = parseEnvelope(data)
    if (!message) return

    if (message.type === 'hello') {
      runtime.connected = true
      runtime.state = 'open'
      runtime.lastConnectedAt ??= now()
      return
    }

    if (message.type === 'disconnect') {
      const reason = typeof message.reason === 'string' ? message.reason : 'disconnect'
      runtime.lastError = reason
      if (reason === 'link_disabled') {
        runtime.desired = false
        runtime.state = 'error'
        runtime.socket?.close()
        return
      }
      runtime.state = 'reconnecting'
      runtime.socket?.close()
      scheduleReconnect(runtime)
      return
    }

    const event = slackMessageEventFromEnvelope(runtime, message)
    if (!event && message.envelope_id) {
      acknowledge(runtime, message.envelope_id)
    }
    if (!event || !runtime.ledger || !runtime.botUserId) return
    runtime.lastEventAt = now()
    const dispatcher = createSlackRoutineDispatcher({
      ledger: runtime.ledger,
      botUserId: runtime.botUserId,
      getRoutines: options.getRoutines,
      acknowledge: () => {
        if (message.envelope_id) acknowledge(runtime, message.envelope_id)
      },
      onFire: fire => processFire(runtime, fire),
    })
    void dispatcher.handleMessage(event).catch(err => {
      runtime.ledger?.updateStatus(event.eventId, 'error', { reason: errorMessage(err) })
      trace('slack.listener.dispatch.error', runtime, { eventId: event.eventId, error: errorMessage(err) })
    })
  }

  function acknowledge(runtime: SlackAccountRuntime, envelopeId: string): void {
    runtime.socket?.send(JSON.stringify({ envelope_id: envelopeId }))
  }

  async function processFire(runtime: SlackAccountRuntime, fire: SlackRoutineFire): Promise<void> {
    try {
      const result = await options.runRoutine(fire.routine, {
        trigger: 'slack',
        payload: fire.input,
      })
      const reply = await safeSessionReply(result.sessionId)
      await options.slack.botPostThreadReply({
        account: fire.binding.account,
        channel: fire.input.slack.channel,
        threadTs: fire.input.slack.threadTs,
        text: reply,
      })
      trace('slack.listener.dispatched', runtime, {
        eventId: fire.eventId,
        routineId: fire.routine.id,
        routineRunId: result.routineRunId,
        sessionId: result.sessionId,
      })
    } catch (err) {
      const message = errorMessage(err)
      runtime.ledger?.updateStatus(fire.eventId, 'error', { routineId: fire.routine.id, reason: message })
      trace('slack.listener.dispatch.error', runtime, { eventId: fire.eventId, routineId: fire.routine.id, error: message })
      await options.slack.botPostThreadReply({
        account: fire.binding.account,
        channel: fire.input.slack.channel,
        threadTs: fire.input.slack.threadTs,
        text: `I couldn't complete that routine: ${message}`,
      }).catch(() => {})
      throw err
    }
  }

  async function safeSessionReply(sessionId: string): Promise<string> {
    try {
      const reply = await options.getSessionReplyText(sessionId)
      if (reply && reply.trim()) return truncateReply(reply.trim())
    } catch {
      // Fall through to the stable fallback below.
    }
    return 'I ran the routine, but I could not find a reply text to post back here.'
  }

  function scheduleReconnect(runtime: SlackAccountRuntime): void {
    if (!runtime.desired) return
    runtime.state = 'reconnecting'
    const attempt = (runtime.reconnectAttempt ?? 0) + 1
    runtime.reconnectAttempt = attempt
    const delay = reconnectDelayMs(attempt)
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = undefined
      const workspace = options.getWorkspacePath()
      if (!workspace || !runtime.desired) return
      void connectAccount(workspace, runtime)
    }, delay)
    runtime.reconnectTimer.unref?.()
  }

  function stopAccount(account: string): void {
    const runtime = accounts.get(account)
    if (!runtime) return
    runtime.desired = false
    clearReconnect(runtime)
    try { runtime.socket?.close() } catch { /* best effort */ }
    runtime.socket = undefined
    runtime.connected = false
    runtime.state = 'stopped'
    accounts.delete(account)
  }

  function ensureRuntime(account: string): SlackAccountRuntime {
    const existing = accounts.get(account)
    if (existing) return existing
    const runtime: SlackAccountRuntime = {
      account,
      configured: false,
      connected: false,
      state: 'stopped',
      desired: true,
    }
    accounts.set(account, runtime)
    return runtime
  }

  function clearReconnect(runtime: SlackAccountRuntime): void {
    if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer)
    runtime.reconnectTimer = undefined
  }

  function trace(kind: string, runtime: SlackAccountRuntime, data: Record<string, unknown> = {}): void {
    options.trace?.append({
      kind,
      actor: 'system',
      status: kind.endsWith('.error') ? 'error' : 'ok',
      data: {
        account: runtime.account,
        state: runtime.state,
        ...data,
      },
    })
  }

  return { refresh, stop, status }
}

export function resolveSlackRoutineBinding(
  bindings: SlackRoutineBinding[],
  event: Pick<SlackMessageEvent, 'account' | 'channel' | 'type' | 'text'>,
  botUserId: string,
): SlackRoutineBinding | null {
  for (const binding of bindings) {
    if (binding.account !== event.account) continue
    if (binding.channelId !== event.channel) continue
    if (binding.mode === 'always') return binding
    if (event.type === 'app_mention' || messageMentionsBot(event.text, botUserId)) return binding
  }
  return null
}

function isBotMessage(event: SlackMessageEvent, botUserId: string): boolean {
  if (event.botId) return true
  if (event.subtype === 'bot_message') return true
  return Boolean(event.user && event.user === botUserId)
}

function hasPriorSlackMessageRecord(ledger: SlackEventLedger, eventId: string): boolean {
  const current = ledger.get(eventId)
  if (!current) return false
  return Object.values(ledger.dump().events).some(record =>
    record.eventId !== eventId &&
    record.account === current.account &&
    record.teamId === current.teamId &&
    record.channel === current.channel &&
    record.ts === current.ts &&
    record.threadTs === current.threadTs &&
    record.status !== 'ignored',
  )
}

function slackMessageEventFromEnvelope(
  runtime: Pick<SlackAccountRuntime, 'account' | 'botUserId' | 'teamId'>,
  envelope: SlackSocketEnvelope,
): SlackMessageEvent | null {
  if (envelope.type !== 'events_api') return null
  const payload = isRecord(envelope.payload) ? envelope.payload : null
  const rawEvent = isRecord(payload?.event) ? payload.event : null
  if (!payload || !rawEvent) return null
  const type = rawEvent.type
  if (type !== 'message' && type !== 'app_mention') return null
  const channel = stringValue(rawEvent.channel)
  const ts = stringValue(rawEvent.ts)
  if (!channel || !ts) return null
  return {
    eventId: stringValue(payload.event_id) ?? envelope.envelope_id ?? `${channel}:${ts}`,
    account: runtime.account,
    teamId: stringValue(payload.team_id) ?? stringValue(rawEvent.team) ?? runtime.teamId ?? '',
    type,
    channel,
    ts,
    ...(stringValue(rawEvent.thread_ts) ? { threadTs: stringValue(rawEvent.thread_ts) } : {}),
    ...(stringValue(rawEvent.user) ? { user: stringValue(rawEvent.user) } : {}),
    ...(stringValue(rawEvent.text) ? { text: stringValue(rawEvent.text) } : {}),
    ...(stringValue(rawEvent.subtype) ? { subtype: stringValue(rawEvent.subtype) } : {}),
    ...(stringValue(rawEvent.bot_id) ? { botId: stringValue(rawEvent.bot_id) } : {}),
  }
}

function parseEnvelope(data: unknown): SlackSocketEnvelope | null {
  const text = messageText(data)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function messageText(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf-8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf-8')
  if (Array.isArray(data) && data.every(Buffer.isBuffer)) return Buffer.concat(data).toString('utf-8')
  return null
}

function authString(auth: unknown, key: string): string | undefined {
  if (!isRecord(auth)) return undefined
  return stringValue(auth[key])
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function truncateReply(text: string): string {
  if (text.length <= MAX_REPLY_CHARS) return text
  return `${text.slice(0, MAX_REPLY_CHARS - 20).trimEnd()}\n\n[truncated]`
}

function now(): string {
  return new Date().toISOString()
}
