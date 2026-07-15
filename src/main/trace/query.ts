import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { createInterface } from 'readline'
import { join } from 'path'
import { readTracePayloadObject, type TraceEvent } from '@main/trace/trace.js'

export interface TracePayloadResult {
  ref: string
  found: boolean
  payload?: unknown
}

export function readTracePayload(workspacePath: string, ref: unknown): TracePayloadResult | null {
  const tracesDir = join(workspacePath, '.mim', 'traces')
  const result = readTracePayloadObject(tracesDir, ref)
  if (!result || typeof ref !== 'string') return null
  return { ref, ...result }
}

export interface TraceQueryFilters {
  from?: string
  to?: string
  days?: number
  kind?: string
  actor?: TraceEvent['actor']
  tool?: string
  packageId?: string
  sessionId?: string
  runId?: string
  traceId?: string
  status?: TraceEvent['status']
  order?: 'asc' | 'desc'
  limit?: number
  now?: number
}

export interface TraceQueryResult {
  events: TraceEvent[]
  truncated: boolean
}

export interface ToolTraceStats {
  tool: string
  calls: number
  successes: number
  errors: number
  errorRate: number
  avgDurationMs: number
  totalDurationMs: number
}

export interface PackageTraceStats {
  packageId: string
  events: number
  errors: number
  errorRate: number
}

export interface ModelTraceStats {
  model: string
  calls: number
  totalTokens: number
  estimatedCost: number
  avgDurationMs: number
}

export interface DayTraceStats {
  day: string
  events: number
  errors: number
  estimatedCost: number
}

export interface GateTraceStats {
  tool: string
  allowed: number
  requested: number
  approved: number
  denied: number
  bypassed: number
  denialRate: number
  approvalRate: number
}

export interface JobTraceStats {
  subject: string
  started: number
  completed: number
  failed: number
  cancelled: number
  avgDurationMs: number
}

export interface TraceStats {
  events: { total: number; errors: number }
  byTool: ToolTraceStats[]
  byPackage: PackageTraceStats[]
  byModel: ModelTraceStats[]
  byDay: DayTraceStats[]
  gates: GateTraceStats[]
  jobs: JobTraceStats[]
  outcomes: { edits: number; reverted: number; avgDiffRatio: number }
}

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
// A single run (one traceId) is read as a unit by the Run drill-down, so it must
// not be clipped at the feed cap — a long agent run can hold thousands of spans.
const TRACE_SCOPED_MAX_LIMIT = 5000

export async function queryTraceEvents(
  workspacePath: string,
  filters: TraceQueryFilters = {},
): Promise<TraceQueryResult> {
  const maxLimit = filters.traceId ? TRACE_SCOPED_MAX_LIMIT : MAX_LIMIT
  const limit = clampPositiveInteger(filters.limit, DEFAULT_LIMIT, maxLimit)
  const events: TraceEvent[] = []
  let truncated = false

  if (filters.order === 'desc') {
    await visitTraceEventsNewestFirst(workspacePath, filters, async (event) => {
      if (events.length >= limit) {
        truncated = true
        return false
      }
      events.push(event)
      return true
    })
    return { events, truncated }
  }

  await visitTraceEvents(workspacePath, filters, async (event) => {
    if (events.length >= limit) {
      truncated = true
      return false
    }
    events.push(event)
    return true
  })

  return { events, truncated }
}

async function visitTraceEventsNewestFirst(
  workspacePath: string,
  filters: TraceQueryFilters,
  visitor: (event: TraceEvent) => Promise<boolean> | boolean,
): Promise<void> {
  const files = traceFiles(workspacePath, filters).slice().reverse()
  for (const file of files) {
    let text = ''
    try {
      text = readFileSync(file.path, 'utf-8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/).reverse()
    for (const line of lines) {
      const event = parseTraceLine(line)
      if (!event || !matchesFilters(event, filters)) continue
      const keepGoing = await visitor(event)
      if (!keepGoing) return
    }
  }
}

export async function computeTraceStats(
  workspacePath: string,
  filters: TraceQueryFilters = {},
): Promise<TraceStats> {
  const accumulator = createStatsAccumulator()
  await visitTraceEvents(workspacePath, filters, async (event) => {
    accumulator.add(event)
    return true
  })
  return accumulator.finish()
}

export function computeTraceStatsSync(
  workspacePath: string,
  filters: TraceQueryFilters = {},
): TraceStats {
  const accumulator = createStatsAccumulator()
  for (const file of traceFiles(workspacePath, filters)) {
    let text = ''
    try {
      text = readFileSync(file.path, 'utf-8')
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const event = parseTraceLine(line)
      if (!event || !matchesFilters(event, filters)) continue
      accumulator.add(event)
    }
  }
  return accumulator.finish()
}

export function renderTraceHealth(stats: TraceStats): string[] {
  if (stats.events.total === 0) return []
  const lines: string[] = []

  const failingTools = stats.byTool
    .filter(t => t.errors > 0)
    .sort((a, b) => b.errors - a.errors || b.errorRate - a.errorRate || a.tool.localeCompare(b.tool))
    .slice(0, 3)
  if (failingTools.length > 0) {
    lines.push(`Top failing tools: ${failingTools.map(t => `${t.tool} ${t.errors}/${t.calls} errors`).join(', ')}`)
  }

  const failingJobs = stats.jobs
    .filter(j => j.failed > 0 || j.cancelled > 0)
    .sort((a, b) => (b.failed + b.cancelled) - (a.failed + a.cancelled) || a.subject.localeCompare(b.subject))
    .slice(0, 3)
  if (failingJobs.length > 0) {
    lines.push(`Top failing jobs: ${failingJobs.map(j => `${j.subject} ${j.failed} failed, ${j.cancelled} cancelled`).join(', ')}`)
  }

  const denialHotspots = stats.gates
    .filter(g => g.denied > 0)
    .sort((a, b) => b.denied - a.denied || a.tool.localeCompare(b.tool))
    .slice(0, 3)
  if (denialHotspots.length > 0) {
    lines.push(`Denial hotspots: ${denialHotspots.map(g => `${g.tool} ${g.denied} denied`).join(', ')}`)
  }

  const modelCalls = stats.byModel.reduce((sum, model) => sum + model.calls, 0)
  const modelCost = stats.byModel.reduce((sum, model) => sum + model.estimatedCost, 0)
  if (modelCalls > 0) {
    lines.push(`Model cost: $${modelCost.toFixed(4)} estimated across ${modelCalls} calls`)
  }

  const costDays = stats.byDay.filter(day => day.estimatedCost > 0)
  if (costDays.length >= 2) {
    const first = costDays[0]
    const last = costDays[costDays.length - 1]
    lines.push(`Cost trend: ${first.day} $${first.estimatedCost.toFixed(4)} -> ${last.day} $${last.estimatedCost.toFixed(4)}`)
  }

  if (stats.outcomes.edits > 0) {
    lines.push(`Post-AI edits: ${stats.outcomes.edits} observed, ${stats.outcomes.reverted} reverted, avg diff ${(stats.outcomes.avgDiffRatio * 100).toFixed(0)}%`)
  }

  return lines
}

async function visitTraceEvents(
  workspacePath: string,
  filters: TraceQueryFilters,
  visitor: (event: TraceEvent) => Promise<boolean> | boolean,
): Promise<void> {
  for (const file of traceFiles(workspacePath, filters)) {
    const stream = createReadStream(file.path, { encoding: 'utf-8' })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        const event = parseTraceLine(line)
        if (!event || !matchesFilters(event, filters)) continue
        const keepGoing = await visitor(event)
        if (!keepGoing) {
          lines.close()
          stream.destroy()
          return
        }
      }
    } catch {
      stream.destroy()
    }
  }
}

function traceFiles(workspacePath: string, filters: TraceQueryFilters): Array<{ day: string; path: string }> {
  const dir = join(workspacePath, '.mim', 'traces')
  if (!existsSync(dir)) return []

  const range = filterRange(filters)
  return readdirSync(dir)
    .filter(file => file.endsWith('.jsonl'))
    .map(file => ({ day: file.slice(0, 10), path: join(dir, file) }))
    .filter(file => {
      try {
        if (!statSync(file.path).isFile()) return false
      } catch {
        return false
      }
      if (range.fromDay && file.day < range.fromDay) return false
      if (range.toDay && file.day > range.toDay) return false
      return true
    })
    .sort((a, b) => a.day.localeCompare(b.day))
}

function parseTraceLine(line: string): TraceEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as TraceEvent
    if (!parsed || typeof parsed.ts !== 'string' || typeof parsed.kind !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function matchesFilters(event: TraceEvent, filters: TraceQueryFilters): boolean {
  const range = filterRange(filters)
  if (range.fromMs !== undefined && Date.parse(event.ts) < range.fromMs) return false
  if (range.toMs !== undefined && Date.parse(event.ts) > range.toMs) return false
  if (filters.kind && event.kind !== filters.kind) return false
  if (filters.actor && event.actor !== filters.actor) return false
  if (filters.tool && event.tool !== filters.tool) return false
  if (filters.packageId && event.packageId !== filters.packageId) return false
  if (filters.sessionId && event.sessionId !== filters.sessionId) return false
  if (filters.runId && event.runId !== filters.runId) return false
  if (filters.traceId && event.traceId !== filters.traceId) return false
  if (filters.status === 'error' && !isErrorEvent(event)) return false
  if (filters.status && filters.status !== 'error' && event.status !== filters.status) return false
  return true
}

function filterRange(filters: TraceQueryFilters): {
  fromMs?: number
  toMs?: number
  fromDay?: string
  toDay?: string
} {
  let fromMs = validTime(filters.from)
  const toMs = validTime(filters.to)
  if (fromMs === undefined && typeof filters.days === 'number' && Number.isFinite(filters.days) && filters.days > 0) {
    const days = Math.min(Math.floor(filters.days), 365)
    const now = filters.now ?? Date.now()
    fromMs = now - days * 86400000
  }
  return {
    ...(fromMs !== undefined ? { fromMs, fromDay: new Date(fromMs).toISOString().slice(0, 10) } : {}),
    ...(toMs !== undefined ? { toMs, toDay: new Date(toMs).toISOString().slice(0, 10) } : {}),
  }
}

function createStatsAccumulator() {
  const tool = new Map<string, { calls: number; successes: number; errors: number; totalDurationMs: number; durationCount: number }>()
  const pkg = new Map<string, { events: number; errors: number }>()
  const model = new Map<string, { calls: number; totalTokens: number; estimatedCost: number; totalDurationMs: number; durationCount: number }>()
  const day = new Map<string, { events: number; errors: number; estimatedCost: number }>()
  const gates = new Map<string, { allowed: number; requested: number; approved: number; denied: number; bypassed: number }>()
  const jobs = new Map<string, { started: number; completed: number; failed: number; cancelled: number; totalDurationMs: number; durationCount: number }>()
  let total = 0
  let errors = 0
  let outcomeEdits = 0
  let outcomeReverted = 0
  let outcomeDiffRatio = 0

  return {
    add(event: TraceEvent) {
      total++
      const error = isErrorEvent(event)
      if (error) errors++

      const dayKey = event.ts.slice(0, 10)
      const dayStats = getOrCreate(day, dayKey, () => ({ events: 0, errors: 0, estimatedCost: 0 }))
      dayStats.events++
      if (error) dayStats.errors++
      dayStats.estimatedCost += numberValue(event.data?.estimatedCost)

      if (event.packageId) {
        const packageStats = getOrCreate(pkg, event.packageId, () => ({ events: 0, errors: 0 }))
        packageStats.events++
        if (error) packageStats.errors++
      }

      if ((event.kind === 'tool.result' || event.kind === 'tool.error') && event.tool) {
        const toolStats = getOrCreate(tool, event.tool, () => ({
          calls: 0,
          successes: 0,
          errors: 0,
          totalDurationMs: 0,
          durationCount: 0,
        }))
        toolStats.calls++
        if (error) toolStats.errors++
        else toolStats.successes++
        addDuration(toolStats, event.durationMs)
      }

      if (event.kind === 'model.call' && event.model) {
        const modelStats = getOrCreate(model, event.model, () => ({
          calls: 0,
          totalTokens: 0,
          estimatedCost: 0,
          totalDurationMs: 0,
          durationCount: 0,
        }))
        modelStats.calls++
        modelStats.totalTokens += numberValue(event.data?.totalTokens)
        modelStats.estimatedCost += numberValue(event.data?.estimatedCost)
        addDuration(modelStats, event.durationMs)
      }

      if (event.kind === 'gate.decision' && event.tool) {
        const gateStats = getOrCreate(gates, event.tool, () => ({
          allowed: 0,
          requested: 0,
          approved: 0,
          denied: 0,
          bypassed: 0,
        }))
        const decision = typeof event.data?.decision === 'string' ? event.data.decision : ''
        if (decision === 'allowed') gateStats.allowed++
        if (decision === 'requested') gateStats.requested++
        if (decision === 'approved') gateStats.approved++
        if (decision === 'denied') gateStats.denied++
        if (decision === 'bypassed') gateStats.bypassed++
      }

      if (event.kind.startsWith('job.')) {
        const subject = event.subject ?? event.packageId ?? event.runId ?? 'unknown'
        const jobStats = getOrCreate(jobs, subject, () => ({
          started: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
          totalDurationMs: 0,
          durationCount: 0,
        }))
        if (event.kind === 'job.started') jobStats.started++
        if (event.kind === 'job.done') jobStats.completed++
        if (event.kind === 'job.failed') jobStats.failed++
        if (event.kind === 'job.cancelled') jobStats.cancelled++
        if (event.kind === 'job.done' || event.kind === 'job.failed' || event.kind === 'job.cancelled') {
          addDuration(jobStats, event.durationMs)
        }
      }

      if (event.kind === 'outcome.edit') {
        outcomeEdits++
        if (event.data?.reverted === true) outcomeReverted++
        outcomeDiffRatio += numberValue(event.data?.diffRatio)
      }
    },

    finish(): TraceStats {
      return {
        events: { total, errors },
        byTool: [...tool.entries()]
          .map(([name, stats]) => ({
            tool: name,
            calls: stats.calls,
            successes: stats.successes,
            errors: stats.errors,
            errorRate: ratio(stats.errors, stats.calls),
            avgDurationMs: average(stats.totalDurationMs, stats.durationCount),
            totalDurationMs: stats.totalDurationMs,
          }))
          .sort((a, b) => b.errors - a.errors || b.calls - a.calls || a.tool.localeCompare(b.tool)),
        byPackage: [...pkg.entries()]
          .map(([packageId, stats]) => ({
            packageId,
            events: stats.events,
            errors: stats.errors,
            errorRate: ratio(stats.errors, stats.events),
          }))
          .sort((a, b) => b.errors - a.errors || b.events - a.events || a.packageId.localeCompare(b.packageId)),
        byModel: [...model.entries()]
          .map(([name, stats]) => ({
            model: name,
            calls: stats.calls,
            totalTokens: stats.totalTokens,
            estimatedCost: stats.estimatedCost,
            avgDurationMs: average(stats.totalDurationMs, stats.durationCount),
          }))
          .sort((a, b) => b.estimatedCost - a.estimatedCost || b.calls - a.calls || a.model.localeCompare(b.model)),
        byDay: [...day.entries()]
          .map(([dayKey, stats]) => ({ day: dayKey, ...stats }))
          .sort((a, b) => a.day.localeCompare(b.day)),
        gates: [...gates.entries()]
          .map(([name, stats]) => {
            const terminal = stats.approved + stats.denied
            return {
              tool: name,
              ...stats,
              denialRate: ratio(stats.denied, terminal),
              approvalRate: ratio(stats.approved, terminal),
            }
          })
          .sort((a, b) => b.denied - a.denied || a.tool.localeCompare(b.tool)),
        jobs: [...jobs.entries()]
          .map(([subject, stats]) => ({
            subject,
            started: stats.started,
            completed: stats.completed,
            failed: stats.failed,
            cancelled: stats.cancelled,
            avgDurationMs: average(stats.totalDurationMs, stats.durationCount),
          }))
          .sort((a, b) => (b.failed + b.cancelled) - (a.failed + a.cancelled) || a.subject.localeCompare(b.subject)),
        outcomes: {
          edits: outcomeEdits,
          reverted: outcomeReverted,
          avgDiffRatio: average(outcomeDiffRatio, outcomeEdits),
        },
      }
    },
  }
}

function addDuration(target: { totalDurationMs: number; durationCount: number }, durationMs: unknown): void {
  const duration = numberValue(durationMs)
  if (duration <= 0 && durationMs !== 0) return
  target.totalDurationMs += duration
  target.durationCount++
}

function isErrorEvent(event: TraceEvent): boolean {
  return event.status === 'error' || event.kind === 'tool.error' || event.kind === 'job.failed'
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key)
  if (existing) return existing
  const value = create()
  map.set(key, value)
  return value
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0
}

function average(total: number, count: number): number {
  return count > 0 ? total / count : 0
}

function validTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function clampPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}
