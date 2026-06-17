import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

// The unified trace envelope: one event shape for audit and observability
// across every actor (user, ai, package, system). Events nest via
// traceId/spanId/parentSpanId so a chat turn or package run renders as a
// span tree. Identity is the principal -> agent (session/run) -> package
// chain; it must be stamped at write time because it cannot be retrofitted.
export interface TraceEvent {
  ts: string
  traceId: string
  spanId: string
  parentSpanId?: string
  kind: string
  actor: 'user' | 'ai' | 'package' | 'system'
  principal?: string
  status?: 'ok' | 'error'
  durationMs?: number
  sessionId?: string
  runId?: string
  packageId?: string
  packageVersion?: string
  tool?: string
  effect?: 'read' | 'mutate' | 'external'
  model?: string
  subject?: string
  // Redacted digest only — raw payloads go to the blob store via writePayload.
  summary?: Record<string, unknown>
  payloadRef?: string
  data?: Record<string, unknown>
}

export type TraceInput = Omit<TraceEvent, 'ts' | 'traceId' | 'spanId' | 'principal'> & {
  traceId?: string
  spanId?: string
}

// A sink receives every stamped event. The default workspace JSONL file is
// one sink; a hosted streaming sink is another. Sinks must never assume
// local-only storage exists.
export interface TraceSink {
  write(event: TraceEvent): void
}

export interface TraceLog {
  append(input: TraceInput): TraceEvent
  // Full raw payload capture, pointer-referenced from the envelope. Returns
  // the ref (relative to .mim/traces/) or null when it cannot be stored.
  // When maxBytes is set, payloads whose serialized form exceeds it are
  // skipped (return null) so a single huge result cannot blow up the blob dir.
  writePayload(traceId: string, spanId: string, name: string, payload: unknown, maxBytes?: number): string | null
  setWorkspacePath(path: string): void
}

export interface TraceLogOptions {
  sinks?: TraceSink[]
  getPrincipal?: () => string | undefined
  getRetentionDays?: () => number | undefined
  retentionCheckIntervalMs?: number
  now?: () => Date
  devConsole?: boolean
}

const DEFAULT_RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000
const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/
const SAFE_TRACE_ID_RE = /^[A-Za-z0-9_-]+$/
const DAY_MS = 24 * 60 * 60 * 1000

export function newTraceId(): string {
  return randomBytes(8).toString('hex')
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex')
}

export function createTraceLog(options: TraceLogOptions = {}): TraceLog {
  let workspacePath: string | null = null
  const devConsole = options.devConsole ?? true
  const extraSinks = options.sinks ?? []
  const retentionCheckIntervalMs = options.retentionCheckIntervalMs ?? DEFAULT_RETENTION_CHECK_INTERVAL_MS
  let lastRetentionCheckMs = 0
  let lastRetentionDir = ''

  function tracesDir(): string | null {
    if (!workspacePath || !directoryExists(workspacePath)) return null
    return join(workspacePath, '.mim', 'traces')
  }

  function append(input: TraceInput): TraceEvent {
    const principal = safePrincipal(options.getPrincipal)
    const { traceId, spanId, ...rest } = input
    const now = currentDate(options.now)
    const event: TraceEvent = {
      ts: now.toISOString(),
      traceId: traceId ?? newTraceId(),
      spanId: spanId ?? newSpanId(),
      ...(principal ? { principal } : {}),
      ...rest,
    }

    try {
      const dir = tracesDir()
      if (dir) {
        mkdirSync(dir, { recursive: true })
        appendFileSync(join(dir, `${event.ts.slice(0, 10)}.jsonl`), JSON.stringify(event) + '\n')
        maybePruneRetention(dir, now)
      }
    } catch {
      // Tracing must never block the action being traced.
    }

    for (const sink of extraSinks) {
      try {
        sink.write(event)
      } catch {
        // A failing sink (e.g. unreachable hosted endpoint) never blocks.
      }
    }

    if (devConsole && process.env.NODE_ENV !== 'production') {
      console.log('[trace]', event.kind, event.tool ?? event.subject ?? '')
    }
    return event
  }

  function writePayload(traceId: string, spanId: string, name: string, payload: unknown, maxBytes?: number): string | null {
    try {
      const dir = tracesDir()
      if (!dir) return null
      const serialized = JSON.stringify(payload)
      if (serialized === undefined) return null
      if (maxBytes !== undefined && Buffer.byteLength(serialized) > maxBytes) return null
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
      const blobDir = join(dir, 'blobs', traceId)
      mkdirSync(blobDir, { recursive: true })
      const ref = `blobs/${traceId}/${spanId}.${safeName}.json`
      writeFileSync(join(dir, ref), serialized)
      return ref
    } catch {
      return null
    }
  }

  return {
    append,
    writePayload,
    setWorkspacePath(path: string) {
      workspacePath = path
    },
  }

  function maybePruneRetention(dir: string, now: Date): void {
    const retentionDays = safeRetentionDays(options.getRetentionDays)
    if (retentionDays === undefined) return
    const nowMs = now.getTime()
    if (
      retentionCheckIntervalMs > 0 &&
      lastRetentionDir === dir &&
      nowMs - lastRetentionCheckMs < retentionCheckIntervalMs
    ) {
      return
    }
    lastRetentionDir = dir
    lastRetentionCheckMs = nowMs
    pruneTraceRetention(dir, retentionDays, now)
  }
}

function safePrincipal(getPrincipal?: () => string | undefined): string | undefined {
  try {
    return getPrincipal?.()
  } catch {
    return undefined
  }
}

function directoryExists(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function currentDate(now?: () => Date): Date {
  try {
    const value = now?.()
    return value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date()
  } catch {
    return new Date()
  }
}

function safeRetentionDays(getRetentionDays?: () => number | undefined): number | undefined {
  try {
    const days = getRetentionDays?.()
    if (days === undefined || days === 0) return undefined
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return undefined
    return Math.max(1, Math.floor(days))
  } catch {
    return undefined
  }
}

function pruneTraceRetention(tracesDir: string, retentionDays: number, now: Date): void {
  const cutoffDay = dayString(startOfUtcDayMs(now) - (retentionDays - 1) * DAY_MS)
  const dayFiles = listDayFiles(tracesDir)
  const expired = dayFiles.filter(file => file.day < cutoffDay)
  if (expired.length === 0) return

  const deletedTraceIds = new Set<string>()
  for (const file of expired) {
    const traceIds = readTraceIds(file.path)
    try {
      rmSync(file.path, { force: true })
      for (const traceId of traceIds) deletedTraceIds.add(traceId)
    } catch {
      // Retention is a best-effort storage budget, never a tracing failure.
    }
  }
  if (deletedTraceIds.size === 0) return

  const retainedTraceIds = new Set<string>()
  for (const file of listDayFiles(tracesDir)) {
    for (const traceId of readTraceIds(file.path)) retainedTraceIds.add(traceId)
  }

  for (const traceId of deletedTraceIds) {
    if (retainedTraceIds.has(traceId) || !SAFE_TRACE_ID_RE.test(traceId)) continue
    try {
      rmSync(join(tracesDir, 'blobs', traceId), { recursive: true, force: true })
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function listDayFiles(tracesDir: string): Array<{ day: string; path: string }> {
  try {
    return readdirSync(tracesDir)
      .filter(file => DAY_FILE_RE.test(file))
      .map(file => ({ day: file.slice(0, 10), path: join(tracesDir, file) }))
      .filter(file => {
        try {
          return statSync(file.path).isFile()
        } catch {
          return false
        }
      })
      .sort((a, b) => a.day.localeCompare(b.day))
  } catch {
    return []
  }
}

function readTraceIds(path: string): Set<string> {
  const traceIds = new Set<string>()
  let text = ''
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return traceIds
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as { traceId?: unknown }
      if (typeof parsed.traceId === 'string') traceIds.add(parsed.traceId)
    } catch {
      // Skip malformed trace lines.
    }
  }
  return traceIds
}

function startOfUtcDayMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
