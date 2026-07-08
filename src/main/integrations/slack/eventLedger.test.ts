import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSlackEventLedger } from './eventLedger.js'

describe('Slack event ledger', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-slack-ledger-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists event metadata without message text and detects duplicates', () => {
    const ledger = createSlackEventLedger(dir, { now: () => '2026-01-01T00:00:00.000Z' })

    const first = ledger.recordReceived({
      eventId: 'Ev1',
      account: 'default',
      teamId: 'T1',
      channel: 'C1',
      ts: '100.1',
      threadTs: '100.1',
      type: 'message',
    })
    const second = ledger.recordReceived({
      eventId: 'Ev1',
      account: 'default',
      teamId: 'T1',
      channel: 'C1',
      ts: '100.1',
      threadTs: '100.1',
      type: 'message',
    })

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(ledger.get('Ev1')).toMatchObject({
      eventId: 'Ev1',
      account: 'default',
      teamId: 'T1',
      channel: 'C1',
      status: 'received',
    })

    const raw = readFileSync(join(dir, '.mim', 'slack', 'event-ledger.json'), 'utf-8')
    expect(raw).not.toContain('hello')
    expect(JSON.parse(raw).events.Ev1.text).toBeUndefined()
  })

  it('updates status, lists replayable events, and prunes old records', () => {
    let tick = 0
    const ledger = createSlackEventLedger(dir, {
      maxEvents: 2,
      now: () => `2026-01-01T00:00:0${tick++}.000Z`,
    })

    for (const eventId of ['Ev1', 'Ev2', 'Ev3']) {
      ledger.recordReceived({
        eventId,
        account: 'default',
        teamId: 'T1',
        channel: 'C1',
        ts: eventId,
        threadTs: eventId,
        type: 'message',
      })
    }
    ledger.updateStatus('Ev3', 'queued', { routineId: 'support-bot' })

    expect(ledger.get('Ev1')).toBeNull()
    expect(ledger.get('Ev2')).toMatchObject({ status: 'received' })
    expect(ledger.replayable()).toEqual([
      expect.objectContaining({ eventId: 'Ev2', status: 'received' }),
      expect.objectContaining({ eventId: 'Ev3', status: 'queued', routineId: 'support-bot' }),
    ])
    expect(existsSync(join(dir, '.mim', 'slack', 'event-ledger.json'))).toBe(true)
  })

  it('sanitizes existing ledger records so raw message text cannot be carried forward', () => {
    const path = join(dir, '.mim', 'slack', 'event-ledger.json')
    const ledger = createSlackEventLedger(dir, { now: () => '2026-01-01T00:00:00.000Z' })
    ledger.recordReceived({
      eventId: 'Ev1',
      account: 'default',
      teamId: 'T1',
      channel: 'C1',
      ts: '100.1',
      threadTs: '100.1',
      type: 'message',
    })

    const file = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, any>
    file.events.Ev1.text = 'private slack text'
    file.events.Ev1.extra = { text: 'nested private slack text' }
    writeFileSync(path, JSON.stringify(file))

    ledger.updateStatus('Ev1', 'queued', { routineId: 'support-bot' })

    const raw = readFileSync(path, 'utf-8')
    expect(raw).not.toContain('private slack text')
    expect(JSON.parse(raw).events.Ev1).toEqual({
      eventId: 'Ev1',
      account: 'default',
      teamId: 'T1',
      channel: 'C1',
      ts: '100.1',
      threadTs: '100.1',
      type: 'message',
      status: 'queued',
      routineId: 'support-bot',
      receivedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })
})
