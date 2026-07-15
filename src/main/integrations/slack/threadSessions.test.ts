import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSlackThreadSessionStore, slackThreadSessionKey } from './threadSessions.js'

describe('Slack thread session store', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-slack-thread-sessions-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('uses a stable key for one routine-bound Slack thread', () => {
    expect(slackThreadSessionKey({
      account: 'bot',
      teamId: 'T1',
      channel: 'C1',
      threadTs: '100.1',
      routineId: 'channel-bot',
    })).toBe('bot:T1:C1:100.1:channel-bot')
  })

  it('persists session mappings without storing Slack message text', () => {
    const store = createSlackThreadSessionStore(dir, { now: () => '2026-07-14T12:00:00.000Z' })

    store.upsert({
      account: 'bot',
      teamId: 'T1',
      channel: 'C1',
      threadTs: '100.1',
      routineId: 'channel-bot',
      sessionId: 'session_1',
      lastEventTs: '100.2',
      lastRoutineRunId: 'routine_run_1',
    })

    const reloaded = createSlackThreadSessionStore(dir, { now: () => '2026-07-14T12:01:00.000Z' })
    expect(reloaded.get({
      account: 'bot',
      teamId: 'T1',
      channel: 'C1',
      threadTs: '100.1',
      routineId: 'channel-bot',
    })).toEqual({
      key: 'bot:T1:C1:100.1:channel-bot',
      account: 'bot',
      teamId: 'T1',
      channel: 'C1',
      threadTs: '100.1',
      routineId: 'channel-bot',
      sessionId: 'session_1',
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z',
      lastEventTs: '100.2',
      lastRoutineRunId: 'routine_run_1',
    })
    expect(JSON.stringify(reloaded.dump())).not.toContain('follow up')
  })

  it('updates the existing record instead of replacing its creation metadata', () => {
    const store = createSlackThreadSessionStore(dir, { now: () => '2026-07-14T12:00:00.000Z' })
    const input = {
      account: 'bot',
      teamId: 'T1',
      channel: 'C1',
      threadTs: '100.1',
      routineId: 'channel-bot',
      sessionId: 'session_1',
    }

    store.upsert(input)
    createSlackThreadSessionStore(dir, { now: () => '2026-07-14T12:05:00.000Z' }).upsert({
      ...input,
      lastEventTs: '100.3',
      lastRoutineRunId: 'routine_run_2',
    })

    expect(createSlackThreadSessionStore(dir).get(input)).toMatchObject({
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:05:00.000Z',
      lastEventTs: '100.3',
      lastRoutineRunId: 'routine_run_2',
    })
  })
})
