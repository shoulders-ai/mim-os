// Deterministic, model-free narration for the Activity surface.
//
// Every sentence here is assembled from structured trace fields — never an LLM.
// It mirrors the existing plain-language grammar used for finished chat turns
// (design-system §6.9, e.g. "edited report.md · 2 actions · 10s") and the
// approval magnitude lines (§6.6). On-demand AI summaries are a separate,
// opt-in path and never run through this module.

import { type FoldedSpan, type SpanKind, type TraceActor, type TraceEvent, type TraceStatus, foldSpans } from './spans'

export interface RunSummary {
  traceId: string
  title: string
  detail: string
  // Root span kind of the run. A run rooted on a bare `model` span is a
  // single-shot housekeeping call (task-label, summary, ghost) — the feed hides
  // these so they don't masquerade as their own chat run.
  kind: SpanKind
  actor: TraceActor
  status: TraceStatus
  startedAt: string
  endedAt: string
  durationMs: number
  cost: number
  totalTokens: number
  actionCount: number
  files: string[]
  errorCount: number
  approvalCount: number
  externalCount: number
}

export interface StoryStep {
  spanId: string
  label: string
  meta: string
  tone: 'normal' | 'ok' | 'error' | 'attention'
  startedAt: string
}

const FILE_MUTATION_VERBS: Record<string, string> = {
  'fs.write': 'Wrote',
  'fs.create': 'Created',
  'fs.edit': 'Edited',
  'fs.delete': 'Deleted',
  'fs.trash': 'Deleted',
  'fs.rename': 'Renamed',
  'fs.copy': 'Copied',
}
// Precedence when several file ops happen in one run — the most substantive wins.
const VERB_PRECEDENCE = ['fs.edit', 'fs.create', 'fs.write', 'fs.delete', 'fs.trash', 'fs.rename', 'fs.copy']

function isFileMutation(tool: string | undefined): boolean {
  return tool ? tool in FILE_MUTATION_VERBS : false
}

export function summarizeRun(events: TraceEvent[]): RunSummary {
  const spans = foldSpans(events)
  const present = new Set(spans.map(s => s.spanId))
  const root = pickRoot(spans, present)

  const toolSpans = spans.filter(s => s.kind === 'tool')
  const changed = toolSpans.filter(s => isFileMutation(s.tool) && s.error === false && s.subject)
  const files = [...new Set(changed.map(s => s.subject as string))]

  // Cost and tokens are authoritative only on model spans (per-step model.call).
  // Summing every span would double-count if a turn/job rolls usage up onto a
  // close event as well.
  const modelSpans = spans.filter(s => s.kind === 'model')
  const cost = modelSpans.reduce((sum, s) => sum + numberValue(s.data.estimatedCost), 0)
  const totalTokens = modelSpans.reduce((sum, s) => sum + numberValue(s.data.totalTokens), 0)
  const errorCount = spans.filter(s => s.error).length
  const approvalCount = spans.filter(
    s => s.kind === 'gate' && (s.data.decision === 'approved' || s.data.decision === 'denied'),
  ).length
  const externalCount = spans.filter(s => s.kind === 'http').length

  const startedAt = spans.length ? spans[0].startedAt : (events[0]?.ts ?? '')
  const endedAt = spans.reduce((latest, s) => (Date.parse(s.endedAt) > Date.parse(latest) ? s.endedAt : latest), startedAt)
  const durationMs = rootDuration(spans, root, startedAt, endedAt)

  return {
    traceId: root?.traceId ?? events[0]?.traceId ?? '',
    title: runTitle(root, toolSpans, changed),
    detail: runDetail(files, toolSpans.length, durationMs, errorCount),
    kind: root?.kind ?? 'other',
    actor: root?.actor ?? 'system',
    status: errorCount > 0 ? 'error' : (root?.status ?? 'ok'),
    startedAt,
    endedAt,
    durationMs,
    cost,
    totalTokens,
    actionCount: toolSpans.length,
    files,
    errorCount,
    approvalCount,
    externalCount,
  }
}

function runTitle(root: FoldedSpan | undefined, toolSpans: FoldedSpan[], changed: FoldedSpan[]): string {
  if (!root) return 'Activity'

  if (root.kind === 'job') {
    const jobName = jobNameOf(root)
    const pkg = root.packageId ?? 'Package'
    return jobName ? `${pkg} ran ${jobName}` : `${pkg} job`
  }

  if (root.kind === 'chat') {
    if (changed.length > 0) {
      const verbTool = dominantTool(changed)
      const verb = FILE_MUTATION_VERBS[verbTool] ?? 'Changed'
      const primarySpan = changed.find(s => s.tool === verbTool) ?? changed[0]
      const primary = primarySpan.subject as string
      const others = [...new Set(changed.map(s => s.subject))].filter(f => f !== primary).length
      return others > 0 ? `${verb} ${primary} and ${others} more` : `${verb} ${primary}`
    }
    const action = primaryToolAction(toolSpans)
    return action ?? 'Answered in chat'
  }

  if (root.kind === 'package') return `${root.packageId ?? 'Package'} activity`
  if (root.kind === 'model') return 'Model call'
  if (root.kind === 'tool') return primaryToolAction([root]) ?? `Ran ${root.tool ?? 'a tool'}`
  return 'Activity'
}

function runDetail(files: string[], actionCount: number, durationMs: number, errorCount: number): string {
  const parts: string[] = []
  if (files.length) parts.push(files.length <= 2 ? files.join(', ') : `${files.length} files`)
  if (actionCount > 0) parts.push(`${actionCount} ${actionCount === 1 ? 'action' : 'actions'}`)
  if (durationMs > 0) parts.push(formatDuration(durationMs))
  if (errorCount > 0) parts.push(`${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`)
  return parts.join(' · ')
}

// Visible story steps: the human-meaningful moments, in time order. Model and
// chat spans are intentionally omitted (the Story is the readable lens; the
// Timeline lens shows everything). Auto-allowed / bypassed gate decisions are
// noise and hidden — only real approvals, denials, and requests show.
export function storySteps(events: TraceEvent[]): StoryStep[] {
  const steps: StoryStep[] = []
  for (const span of foldSpans(events)) {
    const step = narrateStep(span)
    if (step) steps.push(step)
  }
  return steps.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}

export function narrateStep(span: FoldedSpan): StoryStep | null {
  const base = { spanId: span.spanId, startedAt: span.startedAt }

  if (span.kind === 'tool') {
    return {
      ...base,
      label: toolLabel(span),
      meta: stepMeta(span),
      tone: span.error ? 'error' : 'normal',
    }
  }

  if (span.kind === 'gate') {
    // Only real decisions are trust moments. `requested` is the transient
    // pre-resolution marker; `allowed`/`bypassed` are silent policy passes — all
    // noise in the Story.
    const decision = stringValue(span.data.decision)
    if (decision !== 'approved' && decision !== 'denied') return null
    return {
      ...base,
      label: `${decision === 'approved' ? 'Approved' : 'Denied'} ${span.tool ?? 'an action'}`,
      meta: '',
      tone: decision === 'denied' ? 'attention' : 'ok',
    }
  }

  if (span.kind === 'outcome') {
    const reverted = span.data.reverted === true
    return {
      ...base,
      label: reverted ? `You reverted ${span.subject ?? 'the output'}` : `You edited ${span.subject ?? 'the output'}`,
      meta: percentMeta(span),
      tone: reverted ? 'attention' : 'normal',
    }
  }

  if (span.kind === 'http') {
    return {
      ...base,
      label: `Contacted ${span.subject ?? 'an external service'}`,
      meta: stringValue(span.data.method),
      tone: span.error ? 'error' : 'normal',
    }
  }

  if (span.kind === 'job') {
    if (span.rawKind === 'job.failed') return { ...base, label: 'Job failed', meta: stepMeta(span), tone: 'error' }
    if (span.rawKind === 'job.cancelled') return { ...base, label: 'Cancelled', meta: stepMeta(span), tone: 'attention' }
    if (span.rawKind === 'job.done') return { ...base, label: 'Finished', meta: stepMeta(span), tone: 'ok' }
    if (span.rawKind === 'job.step') {
      const name = stringValue(span.data.name)
      return name ? { ...base, label: `Step: ${name}`, meta: '', tone: 'normal' } : null
    }
    if (span.rawKind === 'job.started') return { ...base, label: 'Started', meta: '', tone: 'normal' }
    return null
  }

  return null
}

// A compact, technical-leaning label for the Timeline waterfall, where every
// span (including model/chat) appears.
export function spanLabel(span: FoldedSpan): string {
  if (span.kind === 'chat') return 'Chat turn'
  if (span.kind === 'model') return span.model ?? 'Model step'
  if (span.kind === 'gate') return `${capitalize(stringValue(span.data.decision) || 'gate')} ${span.tool ?? ''}`.trim()
  if (span.kind === 'http') return `${stringValue(span.data.method) || 'HTTP'} ${span.subject ?? ''}`.trim()
  if (span.kind === 'job') return span.rawKind.replace('job.', 'Job ')
  if (span.kind === 'outcome') return span.data.reverted === true ? 'User reverted' : 'User edited'
  if (span.tool) return span.tool
  return span.rawKind
}

function toolLabel(span: FoldedSpan): string {
  const tool = span.tool ?? ''
  const subject = span.subject
  if (tool === 'fs.read') return `Read ${subject ?? 'a file'}`
  if (tool === 'fs.list') return `Listed ${subject ?? 'a folder'}`
  if (tool === 'editor.open') return `Opened ${subject ?? 'a file'}`
  if (tool === 'terminal.run') return 'Ran a terminal command'
  if (tool.startsWith('search.')) return 'Searched the workspace'
  if (tool in FILE_MUTATION_VERBS && subject) return `${FILE_MUTATION_VERBS[tool]} ${subject}`
  if (tool in FILE_MUTATION_VERBS) return `${FILE_MUTATION_VERBS[tool]} a file`
  return tool ? `Ran ${tool}` : 'Ran a tool'
}

function primaryToolAction(toolSpans: FoldedSpan[]): string | null {
  const real = toolSpans.find(s => s.tool && s.tool !== 'fs.read' && s.tool !== 'fs.list')
  return real ? toolLabel(real) : null
}

// The most substantive file op present, used to pick the run-title verb.
function dominantTool(changed: FoldedSpan[]): string {
  const tools = new Set(changed.map(s => s.tool))
  return VERB_PRECEDENCE.find(tool => tools.has(tool)) ?? (changed[0]?.tool ?? '')
}

// A span is a root if it has no parent, or its parent fell outside the queried
// window (e.g. a chat turn clipped at the range edge) — mirrors buildSpanTree so
// the run header never derives from an arbitrary leaf.
function pickRoot(spans: FoldedSpan[], present: Set<string>): FoldedSpan | undefined {
  const isRoot = (s: FoldedSpan) => !s.parentSpanId || !present.has(s.parentSpanId)
  return (
    spans.find(s => s.kind === 'chat' && isRoot(s)) ??
    spans.find(s => s.kind === 'job' && isRoot(s)) ??
    spans.find(isRoot) ??
    spans[0]
  )
}

const TERMINAL_JOB_KINDS = new Set(['job.done', 'job.failed', 'job.cancelled'])

function rootDuration(spans: FoldedSpan[], root: FoldedSpan | undefined, startedAt: string, endedAt: string): number {
  if (root?.durationMs !== undefined) return root.durationMs
  // Jobs put duration on the terminal child of the run root — match the terminal
  // kind, not merely the first child that happens to carry a duration.
  if (root) {
    const terminal = spans.find(
      s => s.parentSpanId === root.spanId && TERMINAL_JOB_KINDS.has(s.rawKind) && s.durationMs !== undefined,
    )
    if (terminal?.durationMs !== undefined) return terminal.durationMs
  }
  const span = Date.parse(endedAt) - Date.parse(startedAt)
  return Number.isFinite(span) && span > 0 ? span : 0
}

function jobNameOf(root: FoldedSpan): string {
  const subject = root.subject ?? ''
  if (root.packageId && subject.startsWith(`${root.packageId}.`)) return subject.slice(root.packageId.length + 1)
  const dot = subject.lastIndexOf('.')
  return dot >= 0 ? subject.slice(dot + 1) : subject
}

function stepMeta(span: FoldedSpan): string {
  return span.durationMs !== undefined && span.durationMs > 0 ? formatDuration(span.durationMs) : ''
}

function percentMeta(span: FoldedSpan): string {
  const ratio = numberValue(span.data.diffRatio)
  return ratio > 0 ? `${Math.round(ratio * 100)}% changed` : ''
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace(/\.0$/, '')}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function capitalize(value: string): string {
  return value ? value.slice(0, 1).toUpperCase() + value.slice(1) : ''
}
