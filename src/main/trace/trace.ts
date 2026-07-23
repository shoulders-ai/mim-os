import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { createHash, randomBytes } from 'crypto'
import { gunzipSync, gzipSync } from 'zlib'

// The unified trace envelope: one event shape for audit and observability
// across every actor (user, ai, package, system). Events nest via
// traceId/spanId/parentSpanId so a chat turn or package run renders as a
// span tree. Identity is the principal -> agent (session/run) -> package
// chain; it must be stamped at write time because it cannot be retrofitted.
export type TraceActor = 'user' | 'ai' | 'package' | 'system'

export interface TraceEvent {
  ts: string
  traceId: string
  spanId: string
  parentSpanId?: string
  kind: string
  actor: TraceActor
  principal?: string
  agent?: string
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

export type TraceInput = Omit<TraceEvent, 'ts' | 'traceId' | 'spanId'> & {
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
  storageStats(): TraceStorageStats
  prune(): TracePruneResult
  setWorkspacePath(path: string): void
}

export interface TraceStorageStats {
  digestBytes: number
  payloadBytes: number
  payloadCount: number
  totalBytes: number
}

export interface TracePruneResult extends TraceStorageStats {
  removedPayloads: number
  removedDigestFiles: number
}

export interface TraceLogOptions {
  sinks?: TraceSink[]
  getPrincipal?: () => string | undefined
  getRetentionDays?: () => number | undefined
  getPayloadRetentionDays?: () => number | undefined
  getPayloadMaxBytes?: () => number | undefined
  retentionCheckIntervalMs?: number
  now?: () => Date
  devConsole?: boolean
}

const DEFAULT_RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000
const DEFAULT_PAYLOAD_RETENTION_DAYS = 7
const DEFAULT_PAYLOAD_MAX_BYTES = 250 * 1024 * 1024
const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/
const PAYLOAD_REF_RE = /^objects\/([a-f0-9]{2})\/([a-f0-9]{64})\.json\.gz$/
const MUTATION_PARAM_TOOLS = new Set(['fs.write', 'fs.edit', 'fs.create'])
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
  let localStorageDisabled = false

  function tracesDir(): string | null {
    if (!workspacePath || !directoryExists(workspacePath)) return null
    return join(workspacePath, '.mim', 'traces')
  }

  function append(input: TraceInput): TraceEvent {
    const { traceId, spanId, principal: inputPrincipal, ...rest } = input
    const principal = inputPrincipal ?? safePrincipal(options.getPrincipal)
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
        if (!localStorageDisabled) {
          mkdirSync(dir, { recursive: true })
          appendFileSync(join(dir, `${event.ts.slice(0, 10)}.jsonl`), JSON.stringify(event) + '\n')
        }
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
      if (localStorageDisabled) return null
      const dir = tracesDir()
      if (!dir) return null
      const serialized = JSON.stringify(payload)
      if (serialized === undefined) return null
      if (maxBytes !== undefined && Buffer.byteLength(serialized) > maxBytes) return null
      // Identity belongs in the event envelope, not the object path. Hashing the
      // serialized value lets repeated reads/session snapshots share one object.
      void traceId
      void spanId
      void name
      const hash = createHash('sha256').update(serialized, 'utf8').digest('hex')
      const ref = `objects/${hash.slice(0, 2)}/${hash}.json.gz`
      const path = join(dir, ref)
      if (!existsSync(path)) {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, gzipSync(serialized))
      }
      return ref
    } catch {
      return null
    }
  }

  return {
    append,
    writePayload,
    storageStats() {
      const dir = tracesDir()
      return dir ? traceStorageStats(dir) : emptyTraceStorageStats()
    },
    prune() {
      const dir = tracesDir()
      if (!dir) return { ...emptyTraceStorageStats(), removedPayloads: 0, removedDigestFiles: 0 }
      const retentionDays = refreshLocalStorageMode()
      return maintainTraceStorage(dir, currentDate(options.now), {
        retentionDays,
        payloadRetentionDays: safePayloadRetentionDays(options.getPayloadRetentionDays),
        payloadMaxBytes: safePayloadMaxBytes(options.getPayloadMaxBytes),
      })
    },
    setWorkspacePath(path: string) {
      workspacePath = path
      refreshLocalStorageMode()
    },
  }

  function maybePruneRetention(dir: string, now: Date): void {
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
    const retentionDays = refreshLocalStorageMode()
    maintainTraceStorage(dir, now, {
      retentionDays,
      payloadRetentionDays: safePayloadRetentionDays(options.getPayloadRetentionDays),
      payloadMaxBytes: safePayloadMaxBytes(options.getPayloadMaxBytes),
    })
  }

  function refreshLocalStorageMode(): number | undefined {
    const retentionDays = safeRetentionDays(options.getRetentionDays)
    localStorageDisabled = retentionDays === 0
    return retentionDays
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
    if (days === undefined) return undefined
    if (days === 0) return 0
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return undefined
    return Math.max(1, Math.floor(days))
  } catch {
    return undefined
  }
}

function safePayloadRetentionDays(getDays?: () => number | undefined): number | undefined {
  try {
    const days = getDays?.() ?? DEFAULT_PAYLOAD_RETENTION_DAYS
    if (days === 0) return undefined
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return DEFAULT_PAYLOAD_RETENTION_DAYS
    return Math.max(1, Math.floor(days))
  } catch {
    return DEFAULT_PAYLOAD_RETENTION_DAYS
  }
}

function safePayloadMaxBytes(getBytes?: () => number | undefined): number {
  try {
    const bytes = getBytes?.() ?? DEFAULT_PAYLOAD_MAX_BYTES
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return DEFAULT_PAYLOAD_MAX_BYTES
    return Math.floor(bytes)
  } catch {
    return DEFAULT_PAYLOAD_MAX_BYTES
  }
}

function maintainTraceStorage(
  tracesDir: string,
  now: Date,
  policy: { retentionDays?: number; payloadRetentionDays?: number; payloadMaxBytes: number },
): TracePruneResult {
  const removedDigestFiles = policy.retentionDays === 0
    ? clearTraceDayFiles(tracesDir)
    : policy.retentionDays
      ? pruneTraceDayFiles(tracesDir, policy.retentionDays, now)
      : 0
  const removedPayloads = policy.retentionDays === 0
    ? clearTracePayloadObjects(tracesDir)
    : pruneTracePayloads(
        tracesDir,
        policy.payloadRetentionDays,
        policy.payloadMaxBytes,
        now,
      )
  // The object store intentionally replaces the old trace/span blob layout.
  // There is no compatibility contract for local runtime data.
  try { rmSync(join(tracesDir, 'blobs'), { recursive: true, force: true }) } catch { /* best effort */ }
  return { ...traceStorageStats(tracesDir), removedPayloads, removedDigestFiles }
}

function clearTracePayloadObjects(tracesDir: string): number {
  const root = join(tracesDir, 'objects')
  const removed = countFiles(root)
  try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
  return removed
}

function countFiles(path: string): number {
  let entries: ReturnType<typeof readdirSync>
  try { entries = readdirSync(path, { withFileTypes: true }) } catch { return 0 }
  let count = 0
  for (const entry of entries) {
    if (entry.isDirectory()) count += countFiles(join(path, entry.name))
    else if (entry.isFile()) count++
  }
  return count
}

function clearTraceDayFiles(tracesDir: string): number {
  let removed = 0
  for (const file of listDayFiles(tracesDir)) {
    try {
      rmSync(file.path, { force: true })
      removed++
    } catch {
      // Disabling local audit storage is best effort and never blocks work.
    }
  }
  return removed
}

function pruneTraceDayFiles(tracesDir: string, retentionDays: number, now: Date): number {
  const cutoffDay = dayString(startOfUtcDayMs(now) - (retentionDays - 1) * DAY_MS)
  const dayFiles = listDayFiles(tracesDir)
  const expired = dayFiles.filter(file => file.day < cutoffDay)
  let removed = 0
  for (const file of expired) {
    try {
      rmSync(file.path, { force: true })
      removed++
    } catch {
      // Retention is a best-effort storage budget, never a tracing failure.
    }
  }
  return removed
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

function pruneTracePayloads(
  tracesDir: string,
  retentionDays: number | undefined,
  maxBytes: number,
  now: Date,
): number {
  const cutoffDay = retentionDays
    ? dayString(startOfUtcDayMs(now) - (retentionDays - 1) * DAY_MS)
    : ''
  const refs = new Map<string, { latestTs: number; protected: boolean }>()

  for (const file of listDayFiles(tracesDir)) {
    let text = ''
    try { text = readFileSync(file.path, 'utf-8') } catch { continue }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line) as TraceEvent
        if (!isTracePayloadRef(event.payloadRef)) continue
        if (cutoffDay && event.ts.slice(0, 10) < cutoffDay) continue
        const at = Date.parse(event.ts)
        const current = refs.get(event.payloadRef)
        const protectedPayload = event.kind === 'tool.call'
          && typeof event.tool === 'string'
          && MUTATION_PARAM_TOOLS.has(event.tool)
        refs.set(event.payloadRef, {
          latestTs: Math.max(current?.latestTs ?? 0, Number.isFinite(at) ? at : 0),
          protected: Boolean(current?.protected || protectedPayload),
        })
      } catch {
        // Malformed digest lines do not make maintenance fail.
      }
    }
  }

  const objects = listPayloadObjects(tracesDir)
  let removed = 0
  let bytes = objects.reduce((sum, object) => sum + object.bytes, 0)
  const retained: typeof objects = []
  for (const object of objects) {
    if (!refs.has(object.ref)) {
      if (removePayloadObject(object.path)) {
        removed++
        bytes -= object.bytes
      }
    } else {
      retained.push(object)
    }
  }

  if (bytes > maxBytes) {
    retained.sort((a, b) => (refs.get(a.ref)?.latestTs ?? 0) - (refs.get(b.ref)?.latestTs ?? 0))
    for (const object of retained) {
      if (bytes <= maxBytes) break
      if (refs.get(object.ref)?.protected) continue
      if (removePayloadObject(object.path)) {
        removed++
        bytes -= object.bytes
      }
    }
  }
  return removed
}

function listPayloadObjects(tracesDir: string): Array<{ ref: string; path: string; bytes: number }> {
  const root = join(tracesDir, 'objects')
  const out: Array<{ ref: string; path: string; bytes: number }> = []
  let prefixes: ReturnType<typeof readdirSync>
  try { prefixes = readdirSync(root, { withFileTypes: true }) } catch { return out }
  for (const prefix of prefixes) {
    if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) continue
    const dir = join(root, prefix.name)
    let files: ReturnType<typeof readdirSync>
    try { files = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const file of files) {
      if (!file.isFile()) continue
      const ref = `objects/${prefix.name}/${file.name}`
      if (!isTracePayloadRef(ref)) continue
      const path = join(dir, file.name)
      try { out.push({ ref, path, bytes: statSync(path).size }) } catch { /* best effort */ }
    }
  }
  return out
}

function removePayloadObject(path: string): boolean {
  try {
    rmSync(path, { force: true })
    const parent = dirname(path)
    if (readdirSync(parent).length === 0) rmSync(parent, { force: true })
    return true
  } catch {
    return false
  }
}

function traceStorageStats(tracesDir: string): TraceStorageStats {
  const digestBytes = listDayFiles(tracesDir).reduce((sum, file) => {
    try { return sum + statSync(file.path).size } catch { return sum }
  }, 0)
  const objects = listPayloadObjects(tracesDir)
  const payloadBytes = objects.reduce((sum, object) => sum + object.bytes, 0)
  return { digestBytes, payloadBytes, payloadCount: objects.length, totalBytes: digestBytes + payloadBytes }
}

function emptyTraceStorageStats(): TraceStorageStats {
  return { digestBytes: 0, payloadBytes: 0, payloadCount: 0, totalBytes: 0 }
}

export function isTracePayloadRef(ref: unknown): ref is string {
  return typeof ref === 'string' && PAYLOAD_REF_RE.test(ref)
}

export function readTracePayloadObject(tracesDir: string, ref: unknown): { found: boolean; payload?: unknown } | null {
  if (!isTracePayloadRef(ref)) return null
  const path = join(tracesDir, ref)
  if (!existsSync(path)) return { found: false }
  try {
    return { found: true, payload: JSON.parse(gunzipSync(readFileSync(path)).toString('utf-8')) }
  } catch {
    return { found: false }
  }
}

function startOfUtcDayMs(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
