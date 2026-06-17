import { describe, expect, it } from 'vitest'
import { buildReviewItems, isImportantAuditEvent } from './reviewItems'
import type { TraceEvent } from './spans'

function event(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    ts: '2026-06-12T10:00:00.000Z',
    traceId: 'T',
    spanId: 'S',
    kind: 'tool.call',
    actor: 'ai',
    ...overrides,
  }
}

describe('reviewItems', () => {
  it('keeps read plumbing out of important audit by default', () => {
    expect(isImportantAuditEvent(event({ tool: 'fs.list', effect: 'read' }))).toBe(false)
    expect(isImportantAuditEvent(event({ tool: 'settings.get', effect: 'read' }))).toBe(false)
    expect(isImportantAuditEvent(event({ tool: 'fs.edit', effect: 'mutate' }))).toBe(true)
    expect(isImportantAuditEvent(event({ tool: 'gmail.send', effect: 'external' }))).toBe(true)
  })

  it('keeps only real approval decisions in important audit', () => {
    expect(isImportantAuditEvent(event({ kind: 'gate.decision', tool: 'fs.edit', data: { decision: 'allowed' } }))).toBe(false)
    expect(isImportantAuditEvent(event({ kind: 'gate.decision', tool: 'fs.edit', data: { decision: 'bypassed' } }))).toBe(false)
    expect(isImportantAuditEvent(event({ kind: 'gate.decision', tool: 'fs.edit', data: { decision: 'approved' } }))).toBe(true)
    expect(isImportantAuditEvent(event({ kind: 'gate.decision', tool: 'fs.edit', data: { decision: 'denied' } }))).toBe(true)
  })

  it('builds deterministic review items from attention-worthy events only', () => {
    const items = buildReviewItems([
      event({ traceId: 'read', spanId: 'read', tool: 'fs.list', effect: 'read' }),
      event({ traceId: 'deny', spanId: 'deny', kind: 'gate.decision', tool: 'gmail.send', data: { decision: 'denied' } }),
      event({ traceId: 'revert', spanId: 'revert', kind: 'outcome.edit', actor: 'system', subject: 'report.md', data: { reverted: true, diffRatio: 0.82 } }),
      event({ traceId: 'error', spanId: 'error', kind: 'tool.error', tool: 'fs.write', status: 'error', summary: { error: 'EACCES' } }),
      event({ traceId: 'ok', spanId: 'ok', kind: 'package.http.request', actor: 'package', packageId: 'slides', subject: 'api.example.com', status: 'ok' }),
    ])

    expect(items.map(item => item.traceId)).toEqual(['error', 'revert', 'deny'])
    expect(items.map(item => item.title)).toEqual([
      'fs.write failed',
      'You reverted report.md',
      'Denied gmail.send',
    ])
  })
})
