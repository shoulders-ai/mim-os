import type { RoutineDefinition } from '@main/routines/routines.js'
import { routineSlackTrigger, type RoutineSlackTriggerMode } from '@main/routines/routines.js'
import type { SlackEventLedger } from './eventLedger.js'

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
  onFire?: (fire: SlackRoutineFire) => Promise<void> | void
}

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
      if (received.duplicate) return { status: 'duplicate', eventId: event.eventId }

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
      return { status: 'queued', eventId: event.eventId, routineId: binding.routine.id }
    },
  }
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
