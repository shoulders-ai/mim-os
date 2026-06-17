// Pure span folding + tree reconstruction for the Activity surface.
//
// The trace stream emits *events*, not spans. Some events share a spanId on
// purpose (`tool.call` + `tool.result`/`tool.error`, `chat.turn` +
// `chat.turn.done`) and fold into one span; others (`model.call`,
// `gate.decision`, `job.step`) get an auto-assigned spanId at write time and
// stand alone as leaf nodes under their `parentSpanId`. This module turns a
// flat event list into the folded span tree the UI renders.
//
// Renderer-side and dependency-free: it operates on the plain JSON that
// `trace.query` returns over IPC, never on main-process types.

export type TraceActor = 'user' | 'ai' | 'package' | 'system'
export type TraceStatus = 'ok' | 'error'

export interface TraceEvent {
  ts: string
  traceId: string
  spanId: string
  parentSpanId?: string
  kind: string
  actor: TraceActor
  principal?: string
  status?: TraceStatus
  durationMs?: number
  sessionId?: string
  runId?: string
  packageId?: string
  packageVersion?: string
  tool?: string
  effect?: 'read' | 'mutate' | 'external'
  model?: string
  subject?: string
  summary?: Record<string, unknown>
  payloadRef?: string
  data?: Record<string, unknown>
}

// The one taxonomy that drives icon + label. Derived from the event kind, never
// stored — see `spanKindOf`. Kept deliberately small; `other` is the catch-all
// so an unknown future kind degrades to a neutral row rather than throwing.
export type SpanKind =
  | 'chat'
  | 'model'
  | 'tool'
  | 'gate'
  | 'job'
  | 'http'
  | 'package'
  | 'outcome'
  | 'other'

export function spanKindOf(event: Pick<TraceEvent, 'kind'>): SpanKind {
  const kind = event.kind
  if (kind === 'model.call') return 'model'
  if (kind === 'gate.decision') return 'gate'
  if (kind === 'package.http.request') return 'http'
  if (kind.startsWith('chat.')) return 'chat'
  if (kind.startsWith('tool.')) return 'tool'
  if (kind.startsWith('job.')) return 'job'
  if (kind.startsWith('package.')) return 'package'
  if (kind.startsWith('outcome.')) return 'outcome'
  return 'other'
}

export interface FoldedSpan {
  spanId: string
  parentSpanId?: string
  traceId: string
  kind: SpanKind
  // The kind of the representative (opening) event, e.g. `tool.call`.
  rawKind: string
  actor: TraceActor
  status?: TraceStatus
  error: boolean
  startedAt: string
  endedAt: string
  durationMs?: number
  tool?: string
  effect?: 'read' | 'mutate' | 'external'
  model?: string
  subject?: string
  packageId?: string
  packageVersion?: string
  sessionId?: string
  runId?: string
  payloadRef?: string
  // Merged structured data (open event first, later events override) so the
  // detail pane and narration can read cost/tokens/decision from one place.
  data: Record<string, unknown>
  summary?: Record<string, unknown>
  // Every raw event that folded into this span, ascending by ts.
  events: TraceEvent[]
}

export interface SpanNode extends FoldedSpan {
  depth: number
  children: SpanNode[]
}

const OPENING_KINDS = new Set(['tool.call', 'chat.turn', 'job.started'])

function isErrorEvent(event: TraceEvent): boolean {
  return event.status === 'error' || event.kind === 'tool.error' || event.kind === 'job.failed'
}

// Fold events that share a spanId into one span. The representative is the
// opening event (so subject/tool/payloadRef come from the call, not the
// result); status and duration come from whichever event carries them
// (the close).
export function foldSpans(events: TraceEvent[]): FoldedSpan[] {
  const groups = new Map<string, TraceEvent[]>()
  for (const event of events) {
    const list = groups.get(event.spanId)
    if (list) list.push(event)
    else groups.set(event.spanId, [event])
  }

  const spans: FoldedSpan[] = []
  for (const [spanId, raw] of groups) {
    const ordered = raw.slice().sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    const opener =
      ordered.find(event => OPENING_KINDS.has(event.kind)) ?? ordered[0]

    let status: TraceStatus | undefined
    let durationMs: number | undefined
    let error = false
    const data: Record<string, unknown> = {}
    let summary: Record<string, unknown> | undefined
    let payloadRef: string | undefined

    for (const event of ordered) {
      if (event.status) status = event.status
      if (typeof event.durationMs === 'number') durationMs = event.durationMs
      if (isErrorEvent(event)) error = true
      if (event.data) Object.assign(data, event.data)
      if (event.summary) summary = { ...summary, ...event.summary }
      if (event.payloadRef) payloadRef = event.payloadRef
    }
    if (error) status = 'error'

    const startedAt = ordered[0].ts
    const endedAt = ordered[ordered.length - 1].ts

    spans.push({
      spanId,
      ...(opener.parentSpanId ? { parentSpanId: opener.parentSpanId } : {}),
      traceId: opener.traceId,
      kind: spanKindOf(opener),
      rawKind: opener.kind,
      actor: opener.actor,
      ...(status ? { status } : {}),
      error,
      startedAt,
      endedAt,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...firstDefined(ordered, 'tool'),
      ...firstDefined(ordered, 'effect'),
      ...firstDefined(ordered, 'model'),
      ...firstDefined(ordered, 'subject'),
      ...firstDefined(ordered, 'packageId'),
      ...firstDefined(ordered, 'packageVersion'),
      ...firstDefined(ordered, 'sessionId'),
      ...firstDefined(ordered, 'runId'),
      ...(payloadRef ? { payloadRef } : {}),
      data,
      ...(summary ? { summary } : {}),
      events: ordered,
    })
  }

  return spans.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}

// Reconstruct the parent/child tree for a set of folded spans. Roots are spans
// with no parent, or whose parent is not in the set (orphans, e.g. when a query
// window clips the opening span). Children sort ascending by start. Cycle-safe.
export function buildSpanTree(events: TraceEvent[]): SpanNode[] {
  const spans = foldSpans(events)
  const bySpanId = new Map<string, SpanNode>()
  for (const span of spans) {
    bySpanId.set(span.spanId, { ...span, depth: 0, children: [] })
  }

  const roots: SpanNode[] = []
  for (const node of bySpanId.values()) {
    const parent = node.parentSpanId ? bySpanId.get(node.parentSpanId) : undefined
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  const assignDepth = (node: SpanNode, depth: number, seen: Set<string>) => {
    if (seen.has(node.spanId)) return
    seen.add(node.spanId)
    node.depth = depth
    node.children.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    for (const child of node.children) assignDepth(child, depth + 1, seen)
  }
  const seen = new Set<string>()
  roots.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
  for (const root of roots) assignDepth(root, 0, seen)

  // Any node unreachable from a root (e.g. a parentSpanId cycle) is promoted to
  // a root so malformed input degrades gracefully instead of vanishing.
  for (const node of bySpanId.values()) {
    if (!seen.has(node.spanId)) {
      roots.push(node)
      assignDepth(node, 0, seen)
    }
  }

  return roots
}

// Flatten a tree to a depth-first ordered list — what the waterfall renders.
export function flattenTree(roots: SpanNode[]): SpanNode[] {
  const out: SpanNode[] = []
  const seen = new Set<string>()
  const walk = (node: SpanNode) => {
    if (seen.has(node.spanId)) return
    seen.add(node.spanId)
    out.push(node)
    for (const child of node.children) walk(child)
  }
  for (const root of roots) walk(root)
  return out
}

function firstDefined<K extends keyof TraceEvent>(
  events: TraceEvent[],
  key: K,
): Partial<Record<K, NonNullable<TraceEvent[K]>>> {
  for (const event of events) {
    const value = event[key]
    if (value !== undefined && value !== null && value !== '') {
      return { [key]: value } as Partial<Record<K, NonNullable<TraceEvent[K]>>>
    }
  }
  return {}
}
