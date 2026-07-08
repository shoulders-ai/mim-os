import { describe, expect, it, vi } from 'vitest'
import type { RoutineDefinition } from '@main/routines/routines.js'
import { createMemorySlackEventLedger } from './eventLedger.js'
import {
  createSlackRoutineDispatcher,
  messageMentionsBot,
  slackRoutineBindings,
} from './listener.js'

function routine(id: string, channel: string, mode: 'mention' | 'always' = 'mention'): RoutineDefinition {
  return {
    id,
    name: id,
    path: `routines/${id}.md`,
    trigger: {
      slack: {
        account: 'default',
        channels: [{ id: channel, mode }],
      },
    },
    tools: [],
    approvalAllow: [],
    body: 'Answer.',
    authorityHash: 'hash',
    enabled: true,
    paused: false,
    needsEnablement: false,
  }
}

describe('Slack routine listener foundations', () => {
  it('extracts Slack routine bindings from enabled routines only', () => {
    const enabled = routine('support-bot', 'C1')
    const disabled = { ...routine('paused-bot', 'C2'), enabled: false }

    expect(slackRoutineBindings([enabled, disabled])).toEqual([
      expect.objectContaining({
        routine: enabled,
        account: 'default',
        channelId: 'C1',
        mode: 'mention',
      }),
    ])
  })

  it('matches Slack mention syntax exactly enough for routing', () => {
    expect(messageMentionsBot('hello <@U123>', 'U123')).toBe(true)
    expect(messageMentionsBot('hello <@U123|mim>', 'U123')).toBe(true)
    expect(messageMentionsBot('hello @U123', 'U123')).toBe(false)
  })

  it('records and queues matching mention events without persisting message text', async () => {
    const onFire = vi.fn(async () => {})
    const ledger = createMemorySlackEventLedger()
    const dispatcher = createSlackRoutineDispatcher({
      ledger,
      botUserId: 'U_BOT',
      getRoutines: () => [routine('support-bot', 'C1')],
      onFire,
    })

    const result = await dispatcher.handleMessage({
      eventId: 'Ev1',
      account: 'default',
      teamId: 'T1',
      type: 'app_mention',
      channel: 'C1',
      ts: '100.1',
      user: 'U_USER',
      text: 'hey <@U_BOT> help',
    })

    expect(result).toMatchObject({ status: 'queued', routineId: 'support-bot' })
    expect(onFire).toHaveBeenCalledWith(expect.objectContaining({
      routine: expect.objectContaining({ id: 'support-bot' }),
      input: {
        slack: expect.objectContaining({
          account: 'default',
          teamId: 'T1',
          channel: 'C1',
          ts: '100.1',
          threadTs: '100.1',
          user: 'U_USER',
        }),
        text: 'hey <@U_BOT> help',
      },
    }))
    expect(ledger.get('Ev1')).toMatchObject({
      status: 'queued',
      routineId: 'support-bot',
      channel: 'C1',
    })
    expect(JSON.stringify(ledger.dump())).not.toContain('hey')
  })

  it('dedupes duplicate event ids before firing', async () => {
    const onFire = vi.fn(async () => {})
    const dispatcher = createSlackRoutineDispatcher({
      ledger: createMemorySlackEventLedger(),
      botUserId: 'U_BOT',
      getRoutines: () => [routine('support-bot', 'C1')],
      onFire,
    })
    const event = {
      eventId: 'Ev1',
      account: 'default',
      teamId: 'T1',
      type: 'app_mention' as const,
      channel: 'C1',
      ts: '100.1',
      user: 'U_USER',
      text: '<@U_BOT> help',
    }

    await dispatcher.handleMessage(event)
    const duplicate = await dispatcher.handleMessage(event)

    expect(duplicate.status).toBe('duplicate')
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('ignores bot messages and mention-mode messages without a mention', async () => {
    const onFire = vi.fn(async () => {})
    const dispatcher = createSlackRoutineDispatcher({
      ledger: createMemorySlackEventLedger(),
      botUserId: 'U_BOT',
      getRoutines: () => [routine('support-bot', 'C1')],
      onFire,
    })

    await expect(dispatcher.handleMessage({
      eventId: 'EvBot',
      account: 'default',
      teamId: 'T1',
      type: 'message',
      channel: 'C1',
      ts: '100.1',
      user: 'U_BOT',
      text: '<@U_BOT> loop',
    })).resolves.toMatchObject({ status: 'ignored', reason: 'bot-message' })

    await expect(dispatcher.handleMessage({
      eventId: 'EvQuiet',
      account: 'default',
      teamId: 'T1',
      type: 'message',
      channel: 'C1',
      ts: '100.2',
      user: 'U_USER',
      text: 'quiet',
    })).resolves.toMatchObject({ status: 'ignored', reason: 'no-binding' })

    expect(onFire).not.toHaveBeenCalled()
  })

  it('routes always-mode channel messages without a mention', async () => {
    const onFire = vi.fn(async () => {})
    const dispatcher = createSlackRoutineDispatcher({
      ledger: createMemorySlackEventLedger(),
      botUserId: 'U_BOT',
      getRoutines: () => [routine('support-bot', 'C1', 'always')],
      onFire,
    })

    await expect(dispatcher.handleMessage({
      eventId: 'Ev1',
      account: 'default',
      teamId: 'T1',
      type: 'message',
      channel: 'C1',
      ts: '100.1',
      threadTs: '99.9',
      user: 'U_USER',
      text: 'help',
    })).resolves.toMatchObject({ status: 'queued', routineId: 'support-bot' })
  })
})
