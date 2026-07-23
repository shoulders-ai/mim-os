import { newSpanId, newTraceId, type TraceLog } from '@main/trace/trace.js'
import { toolEffect, type PermissionGate } from '@main/security/gate.js'
import { existsSync, readFileSync, statSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'
import { textSnapshot, type TextSnapshot, type TraceOutcomeTracker } from '@main/trace/outcomes.js'
import type { HistoryToolObserver } from '@main/history/history.js'
import type { SubagentStatus } from '@main/subagents/types.js'

export interface ToolDef {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  // When false, the registry skips result payload capture for this tool even
  // when workspace content capture is enabled. Use for third-party content
  // (Slack messages, emails) that should not persist in trace blobs.
  captureResult?: boolean
  execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

export interface ToolContext {
  actor: 'user' | 'ai' | 'package' | 'system'
  package_id?: string
  sessionId?: string
  routine?: {
    id: string
    runId: string
    approvalAllow?: string[]
  }
  subagent?: {
    rootSessionId: string
    parentSessionId: string
    depth: number
    modelId?: string
    profileId?: string
    toolAllowlist?: string[]
    approvalAllow?: string[]
    requestedGrants?: string[]
    originActor: 'user' | 'ai' | 'system'
    status?: SubagentStatus
  }
  // Connected MCP client identity (e.g. 'claude-code'); used for attribution,
  // not authorization. The actor field stays the security boundary.
  agent?: string
  // Span hierarchy: a caller (chat turn, package run, nested tool) sets these
  // so this call's span parents correctly. Absent ids start a fresh trace.
  traceId?: string
  spanId?: string
}

export interface ToolRegistry {
  register(tool: ToolDef): void
  call(name: string, params: Record<string, unknown>, ctx: ToolContext): Promise<unknown>
  list(): ToolDef[]
  get(name: string): ToolDef | undefined
  unregister(name: string): void
  getWorkspacePath(): string | null
  setWorkspacePath(path: string): void
  // Whether redacted content capture (model I/O, tool results) is enabled for
  // the current workspace. Read by the AI runtime before blobbing model I/O.
  shouldCaptureContent(): boolean
  trace: TraceLog
}

export interface ToolRegistryOptions {
  outcomes?: TraceOutcomeTracker
  history?: HistoryToolObserver
  onMutation?: (path: string, tool: string) => void
  // Capture redacted tool results as payload blobs (Activity content capture).
  // Defaults to enabled; the secret denylist below always wins regardless.
  getCaptureContent?: () => boolean
}

// Raw params for these tools are captured as full payload blobs: they carry
// the user's own file content (the edit-distance raw material), never keys or
// tokens — the same known-safe set as the gate's approval preview.
const PAYLOAD_CAPTURE_TOOLS = new Set(['fs.write', 'fs.edit', 'fs.create'])
const OUTCOME_MUTATION_TOOLS = new Set(['fs.write', 'fs.edit', 'fs.create'])
const MUTATION_SIGNAL_TOOLS = new Set([
  'fs.write',
  'fs.writeBytes',
  'fs.edit',
  'fs.create',
  'fs.delete',
  'fs.trash',
  'fs.copy',
  'fs.import',
  'fs.mkdir',
  'fs.rename',
])

// A single tool result that exceeds this serialized size is not blobbed — the
// redacted digest still records the call. Keeps a huge fs.read or search dump
// from ballooning the blob store while preserving normal document-sized results.
const RESULT_CAPTURE_MAX_BYTES = 1_000_000

// Secret-bearing tools never capture params or results, even with capture on.
// Keys/tokens/credentials must not land in the blob store under any setting.
export function isSecretBearingTool(name: string): boolean {
  if (
    name === 'ai.setKey' ||
    name === 'ai.clearKey' ||
    name === 'google.setOAuthClient' ||
    name === 'google.exchangeCode' ||
    name === 'google.connect' ||
    name === 'slack.connect' ||
    name === 'slack.bot.connect' ||
    name === 'slack.bot.disconnect' ||
    name === 'slack.bot.setup'
  ) {
    return true
  }
  return /secret|token|credential/i.test(name)
}

export function createToolRegistry(
  trace: TraceLog,
  gate?: Pick<PermissionGate, 'check'>,
  options: ToolRegistryOptions = {},
): ToolRegistry {
  const tools = new Map<string, ToolDef>()
  let workspacePath: string | null = null
  const captureContent = () => options.getCaptureContent?.() ?? true

  return {
    trace,

    shouldCaptureContent: captureContent,

    register(tool) {
      tools.set(tool.name, tool)
    },

    async call(name, params, ctx) {
      const tool = tools.get(name)
      if (!tool) throw new Error(`Unknown tool: ${name}`)

      const traceId = ctx.traceId ?? newTraceId()
      const spanId = newSpanId()
      const spanCtx: ToolContext = { ...ctx, traceId, spanId }
      const startedAt = Date.now()
      const payloadRef = PAYLOAD_CAPTURE_TOOLS.has(name)
        ? trace.writePayload(traceId, spanId, 'params', params)
        : null
      const effect = toolEffect(name)

      const base = {
        traceId,
        spanId,
        ...(ctx.spanId ? { parentSpanId: ctx.spanId } : {}),
        actor: ctx.actor,
        tool: name,
        effect,
        ...(ctx.agent ? { agent: ctx.agent } : {}),
        ...(ctx.package_id ? { packageId: ctx.package_id } : {}),
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        ...((ctx.routine || ctx.subagent) ? {
          data: {
            ...(ctx.routine ? { routineId: ctx.routine.id, routineRunId: ctx.routine.runId } : {}),
            ...(ctx.subagent ? {
              subagentRootSessionId: ctx.subagent.rootSessionId,
              subagentParentSessionId: ctx.subagent.parentSessionId,
              subagentDepth: ctx.subagent.depth,
            } : {}),
          },
        } : {}),
      }

      trace.append({
        ...base,
        kind: 'tool.call',
        subject: (params.path as string) ?? undefined,
        summary: summarize(params),
        ...(payloadRef ? { payloadRef } : {}),
      })

      try {
        await gate?.check(tool, params, spanCtx)
        const mutationPath = mutationSubject(workspacePath, name, params)
        const beforeMutation = mutationPath ? snapshotWorkspaceFile(workspacePath, mutationPath) : null
        const historyPending = safeBeforeHistory(options.history, workspacePath, name, params, spanCtx)
        const result = await tool.execute(params, spanCtx)
        const resultRef = effect !== 'read'
          && captureContent()
          && !isSecretBearingTool(name)
          && tool.captureResult !== false
          ? trace.writePayload(traceId, spanId, 'result', result, RESULT_CAPTURE_MAX_BYTES)
          : null
        trace.append({
          ...base,
          kind: 'tool.result',
          status: 'ok',
          durationMs: Date.now() - startedAt,
          summary: summarize(result),
          ...(resultRef ? { payloadRef: resultRef } : {}),
        })
        if (mutationPath) {
          const afterMutation = snapshotWorkspaceFile(workspacePath, mutationPath)
          recordMutationOutcome(options.outcomes, spanCtx, name, mutationPath, beforeMutation, afterMutation)
        }
        const changedPath = mutationSignalSubject(workspacePath, name, params)
        if (changedPath) options.onMutation?.(changedPath, name)
        safeAfterHistory(options.history, workspacePath, name, params, result, spanCtx, historyPending)
        return result
      } catch (err) {
        trace.append({
          ...base,
          kind: 'tool.error',
          status: 'error',
          durationMs: Date.now() - startedAt,
          summary: { error: (err as Error).message },
        })
        throw err
      }
    },

    list() {
      return Array.from(tools.values())
    },

    get(name) {
      return tools.get(name)
    },

    unregister(name) {
      tools.delete(name)
    },

    getWorkspacePath() {
      return workspacePath
    },

    setWorkspacePath(path: string) {
      workspacePath = path
      trace.setWorkspacePath(path)
    }
  }
}

function safeBeforeHistory(
  history: HistoryToolObserver | undefined,
  workspacePath: string | null,
  tool: string,
  params: Record<string, unknown>,
  ctx: ToolContext,
): unknown {
  try {
    return history?.beforeToolCall(workspacePath, tool, params, ctx)
  } catch {
    return null
  }
}

function safeAfterHistory(
  history: HistoryToolObserver | undefined,
  workspacePath: string | null,
  tool: string,
  params: Record<string, unknown>,
  result: unknown,
  ctx: ToolContext,
  pending: unknown,
): void {
  try {
    history?.afterToolCall(workspacePath, tool, params, result, ctx, pending)
  } catch {
    // Local recovery capture is best-effort; a successful tool call stays successful.
  }
}

function recordMutationOutcome(
  outcomes: TraceOutcomeTracker | undefined,
  ctx: ToolContext,
  tool: string,
  path: string,
  before: TextSnapshot | null,
  after: TextSnapshot | null,
): void {
  if (!outcomes || !after) return
  if ((ctx.actor === 'ai' || ctx.actor === 'package') && ctx.traceId && ctx.spanId) {
    outcomes.recordAiMutation({
      path,
      actor: ctx.actor,
      tool,
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      ...(ctx.package_id ? { packageId: ctx.package_id } : {}),
      ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
      before,
      after,
    })
    return
  }
  if (ctx.actor === 'user') {
    outcomes.observeUserMutation({ path, after })
  }
}

function mutationSubject(
  workspacePath: string | null,
  tool: string,
  params: Record<string, unknown>,
): string | null {
  if (!workspacePath || !OUTCOME_MUTATION_TOOLS.has(tool) || typeof params.path !== 'string') return null
  const root = resolve(workspacePath)
  const resolved = resolve(root, params.path)
  const rel = relative(root, resolved)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split('\\').join('/')
}

function mutationSignalSubject(
  workspacePath: string | null,
  tool: string,
  params: Record<string, unknown>,
): string | null {
  if (!workspacePath || !MUTATION_SIGNAL_TOOLS.has(tool) || typeof params.path !== 'string') return null
  const root = resolve(workspacePath)
  const resolved = resolve(root, params.path)
  const rel = relative(root, resolved)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split('\\').join('/')
}

function snapshotWorkspaceFile(workspacePath: string | null, relPath: string): TextSnapshot | null {
  if (!workspacePath) return null
  try {
    const root = resolve(workspacePath)
    const resolved = resolve(root, relPath)
    const rel = relative(root, resolved)
    if (rel.startsWith('..') || isAbsolute(rel)) return null
    if (!existsSync(resolved) || !statSync(resolved).isFile()) return null
    return textSnapshot(readFileSync(resolved, 'utf-8'))
  } catch {
    return null
  }
}

function summarize(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined
  const summary = summarizeValue(value, '', 0)
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    return summary as Record<string, unknown>
  }
  return { value: summary }
}

function summarizeValue(value: unknown, key: string, depth: number): unknown {
  if (shouldRedactSummaryKey(key)) return '[redacted]'
  if (value == null) return value
  if (typeof value === 'string') return truncateSummaryString(value)
  if (typeof value !== 'object') return value
  if (depth >= 4) return '[truncated]'

  if (Array.isArray(value)) {
    const items = value.slice(0, 5).map(item => summarizeValue(item, '', depth + 1))
    if (value.length > 5) items.push(`[${value.length - 5} more]`)
    return items
  }

  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = summarizeValue(v, k, depth + 1)
  }
  return out
}

function truncateSummaryString(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200)}…` : value
}

function shouldRedactSummaryKey(key: string): boolean {
  return /(^|_)(body|code|content|key|password|secret|snippet|subject|text|token)($|_)/i.test(key)
}
