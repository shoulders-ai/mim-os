import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { isAbsolute, join, relative, resolve } from 'path'
import { readTracePayloadObject, type TraceEvent, type TraceLog } from '@main/trace/trace.js'

export interface TextSnapshot {
  content: string
  hash: string
  bytes: number
}

export interface AiMutationRecord {
  path: string
  actor: 'ai' | 'package'
  tool: string
  traceId: string
  spanId: string
  packageId?: string
  sessionId?: string
  before?: TextSnapshot | null
  after: TextSnapshot
  at?: number
}

export interface UserMutationRecord {
  path: string
  after: TextSnapshot | null
  at?: number
  kind?: string
}

export interface TraceOutcomeTracker {
  recordAiMutation(record: AiMutationRecord): void
  observeUserMutation(record: UserMutationRecord): void
  observeFileChange(change: { path: string; kind: string }): void
}

export interface TraceOutcomeTrackerOptions {
  trace: TraceLog
  getWorkspacePath: () => string | null
  clock?: () => number
  correlationWindowMs?: number
}

const AI_MUTATION_TOOLS = new Set(['fs.write', 'fs.edit', 'fs.create'])
const DEFAULT_CORRELATION_WINDOW_MS = 7 * 86400000
const REBUILD_DAYS = 7

export function textSnapshot(content: string): TextSnapshot {
  return {
    content,
    hash: createHash('sha256').update(content, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(content, 'utf8'),
  }
}

export function createTraceOutcomeTracker(options: TraceOutcomeTrackerOptions): TraceOutcomeTracker {
  const clock = options.clock ?? Date.now
  const correlationWindowMs = options.correlationWindowMs ?? DEFAULT_CORRELATION_WINDOW_MS
  let workspacePath: string | null = null
  let rebuilt = false
  const lastAiByPath = new Map<string, Required<Pick<AiMutationRecord, 'path' | 'actor' | 'tool' | 'traceId' | 'spanId' | 'after'>> & {
    packageId?: string
    sessionId?: string
    before?: TextSnapshot | null
    at: number
  }>()

  function ensureWorkspace(): string | null {
    const next = options.getWorkspacePath()
    if (next !== workspacePath) {
      workspacePath = next
      rebuilt = false
      lastAiByPath.clear()
    }
    return workspacePath
  }

  function recordAiMutation(record: AiMutationRecord): void {
    if (!ensureWorkspace()) return
    lastAiByPath.set(normalizeRelPath(record.path), {
      path: normalizeRelPath(record.path),
      actor: record.actor,
      tool: record.tool,
      traceId: record.traceId,
      spanId: record.spanId,
      ...(record.packageId ? { packageId: record.packageId } : {}),
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      before: record.before,
      after: record.after,
      at: record.at ?? clock(),
    })
  }

  function observeUserMutation(record: UserMutationRecord): void {
    if (!ensureWorkspace()) return
    ensureRebuilt()
    const path = normalizeRelPath(record.path)
    const ai = lastAiByPath.get(path)
    if (!ai) return
    const at = record.at ?? clock()
    const sinceMs = Math.max(0, at - ai.at)
    if (sinceMs > correlationWindowMs) {
      lastAiByPath.delete(path)
      return
    }

    const after = record.after
    if (after && after.hash === ai.after.hash) return

    const diff = after
      ? changedBytes(ai.after.content, after.content)
      : ai.after.bytes
    const denominator = Math.max(ai.after.bytes, after?.bytes ?? 0, 1)
    const reverted = Boolean(after && ai.before && after.hash === ai.before.hash)

    options.trace.append({
      kind: 'outcome.edit',
      actor: 'system',
      subject: path,
      data: {
        path,
        diffBytes: diff,
        diffRatio: diff / denominator,
        sinceMs,
        reverted,
        deleted: after == null,
        aiTraceId: ai.traceId,
        aiSpanId: ai.spanId,
        aiActor: ai.actor,
        aiTool: ai.tool,
        ...(ai.packageId ? { aiPackageId: ai.packageId } : {}),
        ...(ai.sessionId ? { aiSessionId: ai.sessionId } : {}),
        ...(record.kind ? { changeKind: record.kind } : {}),
      },
    })
    lastAiByPath.delete(path)
  }

  function observeFileChange(change: { path: string; kind: string }): void {
    const workspace = ensureWorkspace()
    if (!workspace) return
    ensureRebuilt()
    const path = normalizeRelPath(change.path)
    if (!lastAiByPath.has(path)) return
    const snapshot = change.kind === 'unlink'
      ? null
      : readWorkspaceSnapshot(workspace, path)
    observeUserMutation({ path, after: snapshot, kind: change.kind, at: clock() })
  }

  function ensureRebuilt(): void {
    const workspace = workspacePath
    if (!workspace || rebuilt || lastAiByPath.size > 0) return
    rebuilt = true
    rebuildRecentMutations(workspace)
  }

  function rebuildRecentMutations(workspace: string): void {
    const tracesDir = join(workspace, '.mim', 'traces')
    if (!existsSync(tracesDir)) return
    const minDay = new Date(clock() - REBUILD_DAYS * 86400000).toISOString().slice(0, 10)
    const pending = new Map<string, TraceEvent>()

    for (const file of readdirSync(tracesDir).filter(f => f.endsWith('.jsonl') && f.slice(0, 10) >= minDay).sort()) {
      let text = ''
      try {
        const path = join(tracesDir, file)
        if (!statSync(path).isFile()) continue
        text = readFileSync(path, 'utf-8')
      } catch {
        continue
      }
      for (const line of text.split(/\r?\n/)) {
        const event = parseEvent(line)
        if (!event) continue
        const key = `${event.traceId}:${event.spanId}`
        if (
          event.kind === 'tool.call'
          && (event.actor === 'ai' || event.actor === 'package')
          && event.tool
          && AI_MUTATION_TOOLS.has(event.tool)
        ) {
          pending.set(key, event)
          continue
        }
        if (event.kind !== 'tool.result' || event.status !== 'ok') continue
        const call = pending.get(key)
        if (!call || !call.tool) continue
        const rebuilt = rebuildMutationFromCall(workspace, tracesDir, call)
        if (rebuilt) recordAiMutation(rebuilt)
        pending.delete(key)
      }
    }
  }

  function rebuildMutationFromCall(workspace: string, tracesDir: string, call: TraceEvent): AiMutationRecord | null {
    const payload = readPayload(tracesDir, call.payloadRef)
    const path = normalizeRelPath(
      typeof call.subject === 'string'
        ? call.subject
        : isRecord(payload) && typeof payload.path === 'string'
          ? payload.path
          : '',
    )
    if (!path) return null

    let after: TextSnapshot | null = null
    if ((call.tool === 'fs.write' || call.tool === 'fs.create') && isRecord(payload) && typeof payload.content === 'string') {
      after = textSnapshot(payload.content)
    } else {
      after = readWorkspaceSnapshot(workspace, path)
    }
    if (!after) return null

    return {
      path,
      actor: call.actor === 'package' ? 'package' : 'ai',
      tool: call.tool ?? 'fs.write',
      traceId: call.traceId,
      spanId: call.spanId,
      packageId: call.packageId,
      sessionId: call.sessionId,
      after,
      at: Date.parse(call.ts),
    }
  }

  return { recordAiMutation, observeUserMutation, observeFileChange }
}

function readWorkspaceSnapshot(workspace: string, relPath: string): TextSnapshot | null {
  try {
    const root = resolve(workspace)
    const resolved = resolve(root, relPath)
    const rel = relative(root, resolved)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    if (!existsSync(resolved) || !statSync(resolved).isFile()) return null
    return textSnapshot(readFileSync(resolved, 'utf-8'))
  } catch {
    return null
  }
}

function changedBytes(a: string, b: string): number {
  const aBytes = Buffer.from(a, 'utf8')
  const bBytes = Buffer.from(b, 'utf8')
  let prefix = 0
  const prefixMax = Math.min(aBytes.length, bBytes.length)
  while (prefix < prefixMax && aBytes[prefix] === bBytes[prefix]) prefix++

  let suffix = 0
  const suffixMax = prefixMax - prefix
  while (
    suffix < suffixMax
    && aBytes[aBytes.length - 1 - suffix] === bBytes[bBytes.length - 1 - suffix]
  ) {
    suffix++
  }

  return Math.max(aBytes.length - prefix - suffix, bBytes.length - prefix - suffix, 0)
}

function readPayload(tracesDir: string, payloadRef: string | undefined): unknown {
  const result = readTracePayloadObject(tracesDir, payloadRef)
  return result?.found ? result.payload : null
}

function parseEvent(line: string): TraceEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as TraceEvent
    if (!parsed || typeof parsed.traceId !== 'string' || typeof parsed.spanId !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRelPath(path: string): string {
  return path.split('\\').join('/').replace(/^\.\//, '')
}
