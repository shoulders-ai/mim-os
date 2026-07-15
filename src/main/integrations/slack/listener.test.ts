import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import type { RoutineDefinition } from '@main/routines/routines.js'
import { createMemorySlackEventLedger } from './eventLedger.js'
import {
  createSlackSocketModeListener,
  createSlackRoutineDispatcher,
  messageMentionsBot,
  slackRoutineBindings,
  type SlackWebSocketLike,
} from './listener.js'
import { createMemorySlackThreadSessionStore } from './threadSessions.js'

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
    revision: 'revision',
    activation: 'active',
  }
}

describe('Slack routine listener foundations', () => {
  it('extracts Slack routine bindings from enabled routines only', () => {
    const enabled = routine('support-bot', 'C1')
    const disabled = { ...routine('paused-bot', 'C2'), activation: 'disabled' as const }

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
      status: 'dispatched',
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

  it('dedupes app_mention and message events for the same Slack message', async () => {
    const onFire = vi.fn(async () => {})
    const ledger = createMemorySlackEventLedger()
    const dispatcher = createSlackRoutineDispatcher({
      ledger,
      botUserId: 'U_BOT',
      getRoutines: () => [routine('support-bot', 'C1')],
      onFire,
    })

    await expect(dispatcher.handleMessage({
      eventId: 'EvMessage',
      account: 'default',
      teamId: 'T1',
      type: 'message',
      channel: 'C1',
      ts: '100.1',
      user: 'U_USER',
      text: '<@U_BOT> help',
    })).resolves.toMatchObject({ status: 'queued', routineId: 'support-bot' })

    await expect(dispatcher.handleMessage({
      eventId: 'EvMention',
      account: 'default',
      teamId: 'T1',
      type: 'app_mention',
      channel: 'C1',
      ts: '100.1',
      user: 'U_USER',
      text: '<@U_BOT> help',
    })).resolves.toMatchObject({ status: 'ignored', reason: 'duplicate-message' })

    expect(onFire).toHaveBeenCalledTimes(1)
    expect(ledger.get('EvMention')).toMatchObject({
      status: 'ignored',
      reason: 'duplicate-message',
    })
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

  it('routes unmentioned replies inside an active mention-mode Slack thread', async () => {
    const onFire = vi.fn(async () => {})
    const hasActiveThread = vi.fn(() => true)
    const dispatcher = createSlackRoutineDispatcher({
      ledger: createMemorySlackEventLedger(),
      botUserId: 'U_BOT',
      getRoutines: () => [routine('support-bot', 'C1')],
      hasActiveThread,
      onFire,
    })

    await expect(dispatcher.handleMessage({
      eventId: 'EvThreadReply',
      account: 'default',
      teamId: 'T1',
      type: 'message',
      channel: 'C1',
      ts: '100.2',
      threadTs: '100.1',
      user: 'U_USER',
      text: 'continue without a mention',
    })).resolves.toMatchObject({ status: 'queued', routineId: 'support-bot' })

    expect(hasActiveThread).toHaveBeenCalledWith({
      account: 'default',
      teamId: 'T1',
      channel: 'C1',
      threadTs: '100.1',
      routineId: 'support-bot',
    })
    expect(onFire).toHaveBeenCalledOnce()
  })
})

class FakeSocket extends EventEmitter implements SlackWebSocketLike {
  sent: string[] = []
  closed = false

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
    this.emit('close', 1000, Buffer.from('closed'))
  }
}

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

describe('Slack Socket Mode listener', () => {
  it('acks events, runs the matching routine, and posts the assistant reply in the Slack thread', async () => {
    const socket = new FakeSocket()
    const ledger = createMemorySlackEventLedger()
    const slack = {
      hasBotTokens: vi.fn(async () => ({ configured: true, botTokenConfigured: true, appTokenConfigured: true })),
      botAuthTest: vi.fn(async () => ({ user_id: 'U_BOT', team_id: 'T1' })),
      connectionsOpen: vi.fn(async () => 'wss://slack.example/socket'),
      botPostThreadReply: vi.fn(async () => ({ ok: true })),
    }
    const runRoutine = vi.fn(async () => ({ sessionId: 's1', routineRunId: 'rr1', status: 'done' as const }))
    const listener = createSlackSocketModeListener({
      getWorkspacePath: () => '/workspace',
      getRoutines: () => [routine('support-bot', 'C1')],
      createLedger: () => ledger,
      createThreadSessionStore: () => createMemorySlackThreadSessionStore(),
      slack,
      runRoutine,
      getSessionReplyText: vi.fn(async () => 'Here is the answer.'),
      socketFactory: vi.fn(() => socket),
    })

    await listener.refresh()
    socket.emit('open')
    socket.emit('message', JSON.stringify({
      envelope_id: 'En1',
      type: 'events_api',
      payload: {
        event_id: 'Ev1',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          ts: '100.1',
          user: 'U_USER',
          text: '<@U_BOT> help',
        },
      },
    }))
    await flush()

    expect(socket.sent).toContain(JSON.stringify({ envelope_id: 'En1' }))
    expect(runRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'support-bot' }),
      {
        trigger: 'slack',
        payload: {
          slack: expect.objectContaining({
            account: 'default',
            teamId: 'T1',
            channel: 'C1',
            ts: '100.1',
            threadTs: '100.1',
            user: 'U_USER',
          }),
          text: '<@U_BOT> help',
        },
      },
    )
    expect(slack.botPostThreadReply).toHaveBeenCalledWith({
      account: 'default',
      channel: 'C1',
      threadTs: '100.1',
      text: 'Here is the answer.',
    })
    expect(ledger.get('Ev1')).toMatchObject({ status: 'dispatched', routineId: 'support-bot' })
    expect(listener.status().accounts).toEqual([
      expect.objectContaining({ account: 'default', state: 'open', connected: true, botUserId: 'U_BOT' }),
    ])
  })

  it('reports missing credentials without opening a socket', async () => {
    const socketFactory = vi.fn(() => new FakeSocket())
    const listener = createSlackSocketModeListener({
      getWorkspacePath: () => '/workspace',
      getRoutines: () => [routine('support-bot', 'C1')],
      createLedger: () => createMemorySlackEventLedger(),
      slack: {
        hasBotTokens: vi.fn(async () => ({ configured: false, botTokenConfigured: false, appTokenConfigured: false })),
        botAuthTest: vi.fn(),
        connectionsOpen: vi.fn(),
        botPostThreadReply: vi.fn(),
      },
      runRoutine: vi.fn(),
      getSessionReplyText: vi.fn(),
      socketFactory,
    })

    await listener.refresh()

    expect(socketFactory).not.toHaveBeenCalled()
    expect(listener.status()).toMatchObject({
      implemented: true,
      running: false,
      live: false,
      accounts: [
        {
          account: 'default',
          state: 'not_configured',
          configured: false,
          connected: false,
        },
      ],
    })
  })

  it('marks a dispatched event as error and replies in thread when the routine run fails', async () => {
    const socket = new FakeSocket()
    const ledger = createMemorySlackEventLedger()
    const listener = createSlackSocketModeListener({
      getWorkspacePath: () => '/workspace',
      getRoutines: () => [routine('support-bot', 'C1')],
      createLedger: () => ledger,
      slack: {
        hasBotTokens: vi.fn(async () => ({ configured: true, botTokenConfigured: true, appTokenConfigured: true })),
        botAuthTest: vi.fn(async () => ({ user_id: 'U_BOT', team_id: 'T1' })),
        connectionsOpen: vi.fn(async () => 'wss://slack.example/socket'),
        botPostThreadReply: vi.fn(async () => ({ ok: true })),
      },
      runRoutine: vi.fn(async () => { throw new Error('model unavailable') }),
      getSessionReplyText: vi.fn(),
      socketFactory: vi.fn(() => socket),
    })

    await listener.refresh()
    socket.emit('open')
    socket.emit('message', JSON.stringify({
      envelope_id: 'En1',
      type: 'events_api',
      payload: {
        event_id: 'Ev1',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          ts: '100.1',
          user: 'U_USER',
          text: '<@U_BOT> help',
        },
      },
    }))
    await flush()

    expect(ledger.get('Ev1')).toMatchObject({ status: 'error', reason: 'model unavailable' })
  })

  it('continues follow-up Slack thread replies in the same Mim routine session', async () => {
    const socket = new FakeSocket()
    const ledger = createMemorySlackEventLedger()
    const threadSessions = createMemorySlackThreadSessionStore()
    const startRoutine = vi.fn(async () => ({
      result: { sessionId: 'session_thread', routineRunId: 'rr1', status: 'working' },
      completion: Promise.resolve({ sessionId: 'session_thread', routineRunId: 'rr1', status: 'done' }),
    }))
    const continueRoutine = vi.fn(async () => ({
      sessionId: 'session_thread',
      routineRunId: 'rr2',
      status: 'done',
    }))
    const runRoutine = vi.fn(async () => ({ sessionId: 'new_session', routineRunId: 'rr_unused', status: 'done' as const }))
    const listener = createSlackSocketModeListener({
      getWorkspacePath: () => '/workspace',
      getRoutines: () => [routine('support-bot', 'C1')],
      createLedger: () => ledger,
      createThreadSessionStore: () => threadSessions,
      slack: {
        hasBotTokens: vi.fn(async () => ({ configured: true, botTokenConfigured: true, appTokenConfigured: true })),
        botAuthTest: vi.fn(async () => ({ user_id: 'U_BOT', team_id: 'T1' })),
        connectionsOpen: vi.fn(async () => 'wss://slack.example/socket'),
        botPostThreadReply: vi.fn(async () => ({ ok: true })),
      },
      runRoutine,
      startRoutine,
      continueRoutine,
      getSessionReplyText: vi.fn(async () => 'Thread answer.'),
      socketFactory: vi.fn(() => socket),
    })

    await listener.refresh()
    socket.emit('open')
    socket.emit('message', JSON.stringify({
      envelope_id: 'En1',
      type: 'events_api',
      payload: {
        event_id: 'Ev1',
        team_id: 'T1',
        event: {
          type: 'app_mention',
          channel: 'C1',
          ts: '100.1',
          user: 'U_USER',
          text: '<@U_BOT> start',
        },
      },
    }))
    await flush()

    socket.emit('message', JSON.stringify({
      envelope_id: 'En2',
      type: 'events_api',
      payload: {
        event_id: 'Ev2',
        team_id: 'T1',
        event: {
          type: 'message',
          channel: 'C1',
          ts: '100.2',
          thread_ts: '100.1',
          user: 'U_USER',
          text: 'follow up without tagging the bot',
        },
      },
    }))
    await flush()

    expect(startRoutine).toHaveBeenCalledOnce()
    expect(continueRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'support-bot' }),
      expect.objectContaining({
        trigger: 'slack',
        payload: expect.objectContaining({
          slack: expect.objectContaining({ threadTs: '100.1' }),
          text: 'follow up without tagging the bot',
        }),
      }),
      expect.objectContaining({ sessionId: 'session_thread' }),
    )
    expect(runRoutine).not.toHaveBeenCalled()
    expect(threadSessions.get({
      account: 'default',
      teamId: 'T1',
      channel: 'C1',
      threadTs: '100.1',
      routineId: 'support-bot',
    })).toMatchObject({
      sessionId: 'session_thread',
      routineId: 'support-bot',
      lastEventTs: '100.2',
      lastRoutineRunId: 'rr2',
    })
  })
})
