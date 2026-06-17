import type { TraceEvent } from './spans'

export type ReviewItemTone = 'error' | 'attention'

export interface ReviewItem {
  id: string
  traceId: string
  ts: string
  tone: ReviewItemTone
  title: string
  detail: string
  event: TraceEvent
}

export function buildReviewItems(events: TraceEvent[]): ReviewItem[] {
  return events
    .map(toReviewItem)
    .filter((item): item is ReviewItem => item !== null)
    .sort((a, b) => itemRank(a) - itemRank(b) || Date.parse(b.ts) - Date.parse(a.ts))
}

export function isImportantAuditEvent(event: TraceEvent): boolean {
  if (isErrorEvent(event)) return true

  if (event.kind === 'gate.decision') {
    const decision = stringValue(event.data?.decision)
    return decision === 'approved' || decision === 'denied'
  }

  if (event.kind === 'outcome.edit') return true
  if (event.kind === 'package.http.request') return true

  if (event.kind === 'tool.call') {
    return event.effect === 'mutate' || event.effect === 'external'
  }

  return false
}

function toReviewItem(event: TraceEvent): ReviewItem | null {
  const decision = stringValue(event.data?.decision)
  if (event.kind === 'gate.decision' && decision === 'denied') {
    return {
      id: eventId(event),
      traceId: event.traceId,
      ts: event.ts,
      tone: 'attention',
      title: `Denied ${event.tool ?? 'action'}`,
      detail: traceMeta(event),
      event,
    }
  }

  if (event.kind === 'outcome.edit' && event.data?.reverted === true) {
    return {
      id: eventId(event),
      traceId: event.traceId,
      ts: event.ts,
      tone: 'attention',
      title: `You reverted ${event.subject ?? 'the output'}`,
      detail: `${formatPercent(numberValue(event.data?.diffRatio))} changed / ${traceMeta(event)}`,
      event,
    }
  }

  if (isErrorEvent(event)) {
    return {
      id: eventId(event),
      traceId: event.traceId,
      ts: event.ts,
      tone: 'error',
      title: `${event.tool ?? event.subject ?? event.kind} failed`,
      detail: errorDetail(event),
      event,
    }
  }

  return null
}

function isErrorEvent(event: TraceEvent): boolean {
  return event.status === 'error' || event.kind === 'tool.error' || event.kind === 'job.failed'
}

function errorDetail(event: TraceEvent): string {
  const error = stringValue(event.summary?.error) || stringValue(event.data?.error)
  const parts = [
    error,
    event.packageId,
    traceMeta(event),
  ].filter(Boolean)
  return parts.join(' / ')
}

function eventId(event: TraceEvent): string {
  return `${event.traceId}:${event.spanId}:${event.kind}:${event.ts}`
}

function traceMeta(event: TraceEvent): string {
  return `run ${shortId(event.traceId)}`
}

function shortId(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function itemRank(item: ReviewItem): number {
  if (item.tone === 'error') return 0
  if (item.event.kind === 'outcome.edit' && item.event.data?.reverted === true) return 1
  return 2
}
