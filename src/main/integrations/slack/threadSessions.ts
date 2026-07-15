import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'

export interface SlackThreadSessionLookup {
  account: string
  teamId: string
  channel: string
  threadTs: string
  routineId: string
}

export interface SlackThreadSessionRecord extends SlackThreadSessionLookup {
  key: string
  sessionId: string
  createdAt: string
  updatedAt: string
  lastEventTs?: string
  lastRoutineRunId?: string
}

export interface SlackThreadSessionUpsert extends SlackThreadSessionLookup {
  sessionId: string
  lastEventTs?: string
  lastRoutineRunId?: string
}

export interface SlackThreadSessionState {
  version: 1
  threads: Record<string, SlackThreadSessionRecord>
}

export interface SlackThreadSessionStore {
  get(input: SlackThreadSessionLookup): SlackThreadSessionRecord | null
  upsert(input: SlackThreadSessionUpsert): SlackThreadSessionRecord
  dump(): SlackThreadSessionState
}

export function slackThreadSessionKey(input: SlackThreadSessionLookup): string {
  return [
    input.account,
    input.teamId,
    input.channel,
    input.threadTs,
    input.routineId,
  ].join(':')
}

export function createSlackThreadSessionStore(
  workspacePath: string,
  options: { now?: () => string } = {},
): SlackThreadSessionStore {
  const path = join(workspacePath, '.mim', 'slack', 'thread-sessions.json')
  const now = options.now ?? (() => new Date().toISOString())

  function read(): SlackThreadSessionState {
    if (!existsSync(path)) return emptyState()
    try {
      return normalizeState(JSON.parse(readFileSync(path, 'utf-8')) as unknown)
    } catch {
      return emptyState()
    }
  }

  function write(state: SlackThreadSessionState): void {
    mkdirSync(dirname(path), { recursive: true })
    atomicWriteJson(path, state)
  }

  return {
    get(input) {
      return read().threads[slackThreadSessionKey(input)] ?? null
    },
    upsert(input) {
      const state = read()
      const key = slackThreadSessionKey(input)
      const previous = state.threads[key]
      const timestamp = now()
      const record: SlackThreadSessionRecord = {
        key,
        account: input.account,
        teamId: input.teamId,
        channel: input.channel,
        threadTs: input.threadTs,
        routineId: input.routineId,
        sessionId: input.sessionId,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(input.lastEventTs ? { lastEventTs: input.lastEventTs } : previous?.lastEventTs ? { lastEventTs: previous.lastEventTs } : {}),
        ...(input.lastRoutineRunId
          ? { lastRoutineRunId: input.lastRoutineRunId }
          : previous?.lastRoutineRunId
            ? { lastRoutineRunId: previous.lastRoutineRunId }
            : {}),
      }
      state.threads[key] = record
      write(state)
      return record
    },
    dump() {
      return read()
    },
  }
}

export function createMemorySlackThreadSessionStore(
  options: { now?: () => string } = {},
): SlackThreadSessionStore {
  let state = emptyState()
  const now = options.now ?? (() => new Date().toISOString())
  return {
    get(input) {
      return state.threads[slackThreadSessionKey(input)] ?? null
    },
    upsert(input) {
      const key = slackThreadSessionKey(input)
      const previous = state.threads[key]
      const timestamp = now()
      const record: SlackThreadSessionRecord = {
        key,
        account: input.account,
        teamId: input.teamId,
        channel: input.channel,
        threadTs: input.threadTs,
        routineId: input.routineId,
        sessionId: input.sessionId,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        ...(input.lastEventTs ? { lastEventTs: input.lastEventTs } : previous?.lastEventTs ? { lastEventTs: previous.lastEventTs } : {}),
        ...(input.lastRoutineRunId
          ? { lastRoutineRunId: input.lastRoutineRunId }
          : previous?.lastRoutineRunId
            ? { lastRoutineRunId: previous.lastRoutineRunId }
            : {}),
      }
      state = { version: 1, threads: { ...state.threads, [key]: record } }
      return record
    },
    dump() {
      return state
    },
  }
}

function emptyState(): SlackThreadSessionState {
  return { version: 1, threads: {} }
}

function normalizeState(value: unknown): SlackThreadSessionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyState()
  const rawThreads = (value as { threads?: unknown }).threads
  if (!rawThreads || typeof rawThreads !== 'object' || Array.isArray(rawThreads)) return emptyState()
  const threads: Record<string, SlackThreadSessionRecord> = {}
  for (const [key, raw] of Object.entries(rawThreads)) {
    const record = normalizeRecord(key, raw)
    if (record) threads[key] = record
  }
  return { version: 1, threads }
}

function normalizeRecord(key: string, value: unknown): SlackThreadSessionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const account = stringValue(raw.account)
  const teamId = stringValue(raw.teamId)
  const channel = stringValue(raw.channel)
  const threadTs = stringValue(raw.threadTs)
  const routineId = stringValue(raw.routineId)
  const sessionId = stringValue(raw.sessionId)
  const createdAt = stringValue(raw.createdAt)
  const updatedAt = stringValue(raw.updatedAt)
  if (!account || !teamId || !channel || !threadTs || !routineId || !sessionId || !createdAt || !updatedAt) {
    return null
  }
  return {
    key,
    account,
    teamId,
    channel,
    threadTs,
    routineId,
    sessionId,
    createdAt,
    updatedAt,
    ...(stringValue(raw.lastEventTs) ? { lastEventTs: stringValue(raw.lastEventTs) } : {}),
    ...(stringValue(raw.lastRoutineRunId) ? { lastRoutineRunId: stringValue(raw.lastRoutineRunId) } : {}),
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
