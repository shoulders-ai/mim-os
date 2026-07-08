import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'

export type SlackLedgerStatus = 'received' | 'queued' | 'ignored' | 'dispatched' | 'error'

export interface SlackEventLedgerRecord {
  eventId: string
  account: string
  teamId: string
  channel: string
  ts: string
  threadTs: string
  type: string
  status: SlackLedgerStatus
  routineId?: string
  reason?: string
  receivedAt: string
  updatedAt: string
}

export interface SlackEventLedgerInput {
  eventId: string
  account: string
  teamId: string
  channel: string
  ts: string
  threadTs: string
  type: string
}

export interface SlackEventLedger {
  recordReceived(input: SlackEventLedgerInput): { duplicate: boolean; record: SlackEventLedgerRecord }
  updateStatus(
    eventId: string,
    status: SlackLedgerStatus,
    patch?: Pick<SlackEventLedgerRecord, 'routineId' | 'reason'>,
  ): SlackEventLedgerRecord | null
  get(eventId: string): SlackEventLedgerRecord | null
  replayable(): SlackEventLedgerRecord[]
  dump(): SlackEventLedgerFile
}

export interface SlackEventLedgerOptions {
  now?: () => string
  maxEvents?: number
}

export interface SlackEventLedgerFile {
  version: 1
  events: Record<string, SlackEventLedgerRecord>
}

const LEDGER_PATH = join('.mim', 'slack', 'event-ledger.json')
const DEFAULT_MAX_EVENTS = 1000

export function createSlackEventLedger(workspacePath: string, options: SlackEventLedgerOptions = {}): SlackEventLedger {
  const path = join(workspacePath, LEDGER_PATH)
  return createLedger({
    read: () => readLedgerFile(path),
    write: file => atomicWriteJson(path, file),
    now: options.now ?? (() => new Date().toISOString()),
    maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
  })
}

export function createMemorySlackEventLedger(options: SlackEventLedgerOptions = {}): SlackEventLedger {
  let state: SlackEventLedgerFile = { version: 1, events: {} }
  return createLedger({
    read: () => state,
    write: file => { state = file },
    now: options.now ?? (() => new Date().toISOString()),
    maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
  })
}

function createLedger(deps: {
  read: () => SlackEventLedgerFile
  write: (file: SlackEventLedgerFile) => void
  now: () => string
  maxEvents: number
}): SlackEventLedger {
  return {
    recordReceived(input) {
      const file = deps.read()
      const existing = file.events[input.eventId]
      if (existing) return { duplicate: true, record: existing }

      const now = deps.now()
      const record: SlackEventLedgerRecord = {
        eventId: input.eventId,
        account: input.account,
        teamId: input.teamId,
        channel: input.channel,
        ts: input.ts,
        threadTs: input.threadTs,
        type: input.type,
        status: 'received',
        receivedAt: now,
        updatedAt: now,
      }
      file.events[input.eventId] = record
      deps.write(pruneLedger(file, deps.maxEvents))
      return { duplicate: false, record }
    },

    updateStatus(eventId, status, patch = {}) {
      const file = deps.read()
      const existing = file.events[eventId]
      if (!existing) return null
      const updated: SlackEventLedgerRecord = {
        ...existing,
        status,
        updatedAt: deps.now(),
      }
      if (patch.routineId !== undefined) updated.routineId = patch.routineId
      if (patch.reason !== undefined) updated.reason = patch.reason
      file.events[eventId] = updated
      deps.write(pruneLedger(file, deps.maxEvents))
      return updated
    },

    get(eventId) {
      return deps.read().events[eventId] ?? null
    },

    replayable() {
      return Object.values(deps.read().events)
        .filter(record => record.status === 'received' || record.status === 'queued')
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    },

    dump() {
      return deps.read()
    },
  }
}

function readLedgerFile(path: string): SlackEventLedgerFile {
  if (!existsSync(path)) return { version: 1, events: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, events: {} }
    const events = (parsed as SlackEventLedgerFile).events
    if (!events || typeof events !== 'object' || Array.isArray(events)) return { version: 1, events: {} }
    const sanitized: Record<string, SlackEventLedgerRecord> = {}
    for (const [eventId, record] of Object.entries(events)) {
      const clean = sanitizeLedgerRecord(eventId, record)
      if (clean) sanitized[eventId] = clean
    }
    return { version: 1, events: sanitized }
  } catch {
    return { version: 1, events: {} }
  }
}

function sanitizeLedgerRecord(eventId: string, value: unknown): SlackEventLedgerRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Partial<SlackEventLedgerRecord>
  const status = record.status
  if (status !== 'received' && status !== 'queued' && status !== 'ignored' && status !== 'dispatched' && status !== 'error') {
    return null
  }
  if (
    typeof record.account !== 'string' ||
    typeof record.teamId !== 'string' ||
    typeof record.channel !== 'string' ||
    typeof record.ts !== 'string' ||
    typeof record.threadTs !== 'string' ||
    typeof record.type !== 'string' ||
    typeof record.receivedAt !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null
  }

  return {
    eventId,
    account: record.account,
    teamId: record.teamId,
    channel: record.channel,
    ts: record.ts,
    threadTs: record.threadTs,
    type: record.type,
    status,
    ...(typeof record.routineId === 'string' ? { routineId: record.routineId } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    receivedAt: record.receivedAt,
    updatedAt: record.updatedAt,
  }
}

function pruneLedger(file: SlackEventLedgerFile, maxEvents: number): SlackEventLedgerFile {
  const entries = Object.entries(file.events)
  if (entries.length <= maxEvents) return file
  const keep = entries
    .sort(([, a], [, b]) => a.receivedAt.localeCompare(b.receivedAt))
    .slice(Math.max(0, entries.length - maxEvents))
  return { version: 1, events: Object.fromEntries(keep) }
}
