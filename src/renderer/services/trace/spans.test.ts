import { describe, expect, it } from 'vitest'
import {
  buildSpanTree,
  flattenTree,
  foldSpans,
  spanKindOf,
  type TraceEvent,
} from './spans'

// Mirrors the real emit shapes: tool.call/result share a spanId; chat.turn /
// chat.turn.done share turnSpanId; model.call and gate.decision get their own
// auto spanId and parent to the turn / tool; jobs put the terminal status on a
// child of the runId root.
function chatTurnTrace(): TraceEvent[] {
  return [
    { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn', actor: 'ai', model: 'claude' },
    { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 't1', parentSpanId: 'turn', kind: 'tool.call', actor: 'ai', tool: 'fs.read', subject: 'report.md' },
    { ts: '2026-06-12T10:00:01.300Z', traceId: 'T', spanId: 't1', parentSpanId: 'turn', kind: 'tool.result', actor: 'ai', tool: 'fs.read', status: 'ok', durationMs: 300 },
    { ts: '2026-06-12T10:00:01.100Z', traceId: 'T', spanId: 'g1', parentSpanId: 't1', kind: 'gate.decision', actor: 'ai', tool: 'fs.read', data: { decision: 'approved' } },
    { ts: '2026-06-12T10:00:03.000Z', traceId: 'T', spanId: 'm1', parentSpanId: 'turn', kind: 'model.call', actor: 'ai', model: 'claude', data: { totalTokens: 1240, estimatedCost: 0.01 } },
    { ts: '2026-06-12T10:00:09.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn.done', actor: 'ai', status: 'ok', durationMs: 9000, data: { steps: 1 } },
  ]
}

describe('spanKindOf', () => {
  it('maps event kinds to the span taxonomy', () => {
    expect(spanKindOf({ kind: 'chat.turn' })).toBe('chat')
    expect(spanKindOf({ kind: 'chat.turn.done' })).toBe('chat')
    expect(spanKindOf({ kind: 'model.call' })).toBe('model')
    expect(spanKindOf({ kind: 'tool.call' })).toBe('tool')
    expect(spanKindOf({ kind: 'tool.error' })).toBe('tool')
    expect(spanKindOf({ kind: 'gate.decision' })).toBe('gate')
    expect(spanKindOf({ kind: 'job.started' })).toBe('job')
    expect(spanKindOf({ kind: 'package.http.request' })).toBe('http')
    expect(spanKindOf({ kind: 'package.tool.result' })).toBe('package')
    expect(spanKindOf({ kind: 'outcome.edit' })).toBe('outcome')
    expect(spanKindOf({ kind: 'something.new' })).toBe('other')
  })
})

describe('foldSpans', () => {
  it('folds a tool call + result into one span with status and duration', () => {
    const spans = foldSpans(chatTurnTrace())
    const tool = spans.find(s => s.spanId === 't1')!
    expect(tool.kind).toBe('tool')
    expect(tool.rawKind).toBe('tool.call')
    expect(tool.tool).toBe('fs.read')
    expect(tool.subject).toBe('report.md')
    expect(tool.status).toBe('ok')
    expect(tool.durationMs).toBe(300)
    expect(tool.error).toBe(false)
    expect(tool.events).toHaveLength(2)
  })

  it('folds chat.turn + chat.turn.done into the root span', () => {
    const spans = foldSpans(chatTurnTrace())
    const turn = spans.find(s => s.spanId === 'turn')!
    expect(turn.kind).toBe('chat')
    expect(turn.parentSpanId).toBeUndefined()
    expect(turn.status).toBe('ok')
    expect(turn.durationMs).toBe(9000)
  })

  it('keeps model.call and gate.decision as their own leaf spans', () => {
    const spans = foldSpans(chatTurnTrace())
    const model = spans.find(s => s.spanId === 'm1')!
    expect(model.kind).toBe('model')
    expect(model.parentSpanId).toBe('turn')
    expect(model.data.totalTokens).toBe(1240)
    const gate = spans.find(s => s.spanId === 'g1')!
    expect(gate.kind).toBe('gate')
    expect(gate.parentSpanId).toBe('t1')
    expect(gate.data.decision).toBe('approved')
  })

  it('marks a tool.error span as errored', () => {
    const spans = foldSpans([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'e1', kind: 'tool.call', actor: 'ai', tool: 'fs.read', subject: 'missing.md' },
      { ts: '2026-06-12T10:00:00.500Z', traceId: 'T', spanId: 'e1', kind: 'tool.error', actor: 'ai', tool: 'fs.read', durationMs: 500, summary: { error: 'ENOENT' } },
    ])
    expect(spans[0].error).toBe(true)
    expect(spans[0].status).toBe('error')
    expect(spans[0].summary?.error).toBe('ENOENT')
  })

  it('surfaces job terminal status from a child of the run root', () => {
    const spans = foldSpans([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'R', spanId: 'R', kind: 'job.started', actor: 'package', packageId: 'slides', subject: 'slides.render' },
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'R', spanId: 's1', parentSpanId: 'R', kind: 'job.step', actor: 'package', packageId: 'slides', data: { name: 'plan' } },
      { ts: '2026-06-12T10:00:05.000Z', traceId: 'R', spanId: 'd1', parentSpanId: 'R', kind: 'job.failed', actor: 'package', packageId: 'slides', status: 'error', durationMs: 5000 },
    ])
    const root = spans.find(s => s.spanId === 'R')!
    expect(root.kind).toBe('job')
    expect(root.parentSpanId).toBeUndefined()
    const terminal = spans.find(s => s.spanId === 'd1')!
    expect(terminal.error).toBe(true)
    expect(terminal.durationMs).toBe(5000)
  })
})

describe('buildSpanTree', () => {
  it('nests tools and model calls under the chat turn', () => {
    const roots = buildSpanTree(chatTurnTrace())
    expect(roots).toHaveLength(1)
    const turn = roots[0]
    expect(turn.spanId).toBe('turn')
    expect(turn.depth).toBe(0)
    // turn -> [t1, m1] sorted by start; t1 -> [g1]
    expect(turn.children.map(c => c.spanId)).toEqual(['t1', 'm1'])
    const tool = turn.children[0]
    expect(tool.depth).toBe(1)
    expect(tool.children.map(c => c.spanId)).toEqual(['g1'])
    expect(tool.children[0].depth).toBe(2)
  })

  it('treats spans whose parent is missing from the window as roots', () => {
    const roots = buildSpanTree([
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 'orphan', parentSpanId: 'gone', kind: 'tool.call', actor: 'ai', tool: 'fs.read' },
    ])
    expect(roots.map(r => r.spanId)).toEqual(['orphan'])
  })

  it('flattens depth-first in start order', () => {
    const flat = flattenTree(buildSpanTree(chatTurnTrace()))
    expect(flat.map(n => n.spanId)).toEqual(['turn', 't1', 'g1', 'm1'])
  })

  it('promotes cycle/island nodes to roots without dropping them or looping', () => {
    const roots = buildSpanTree([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'A', parentSpanId: 'B', kind: 'tool.call', actor: 'ai', tool: 'x' },
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 'B', parentSpanId: 'A', kind: 'tool.call', actor: 'ai', tool: 'y' },
    ])
    const ids = flattenTree(roots).map(n => n.spanId)
    expect(ids).toContain('A')
    expect(ids).toContain('B')
    expect(ids).toHaveLength(2)
  })
})
