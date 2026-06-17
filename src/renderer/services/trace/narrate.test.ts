import { describe, expect, it } from 'vitest'
import { formatDuration, narrateStep, storySteps, summarizeRun } from './narrate'
import { foldSpans, type TraceEvent } from './spans'

function chatEditTrace(): TraceEvent[] {
  return [
    { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn', actor: 'ai', model: 'claude' },
    { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 'r1', parentSpanId: 'turn', kind: 'tool.call', actor: 'ai', tool: 'fs.read', subject: 'report.md' },
    { ts: '2026-06-12T10:00:01.200Z', traceId: 'T', spanId: 'r1', parentSpanId: 'turn', kind: 'tool.result', actor: 'ai', tool: 'fs.read', status: 'ok', durationMs: 200 },
    { ts: '2026-06-12T10:00:02.000Z', traceId: 'T', spanId: 'g1', parentSpanId: 'e1', kind: 'gate.decision', actor: 'ai', tool: 'fs.edit', data: { decision: 'approved' } },
    { ts: '2026-06-12T10:00:02.000Z', traceId: 'T', spanId: 'e1', parentSpanId: 'turn', kind: 'tool.call', actor: 'ai', tool: 'fs.edit', subject: 'report.md' },
    { ts: '2026-06-12T10:00:02.600Z', traceId: 'T', spanId: 'e1', parentSpanId: 'turn', kind: 'tool.result', actor: 'ai', tool: 'fs.edit', status: 'ok', durationMs: 600 },
    { ts: '2026-06-12T10:00:03.000Z', traceId: 'T', spanId: 'm1', parentSpanId: 'turn', kind: 'model.call', actor: 'ai', model: 'claude', data: { totalTokens: 1240, estimatedCost: 0.012 } },
    { ts: '2026-06-12T10:00:09.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn.done', actor: 'ai', status: 'ok', durationMs: 9000 },
  ]
}

describe('summarizeRun', () => {
  it('leads with the dominant file action and mirrors the §6.9 detail grammar', () => {
    const run = summarizeRun(chatEditTrace())
    expect(run.title).toBe('Edited report.md')
    expect(run.detail).toBe('report.md · 2 actions · 9s')
    expect(run.actor).toBe('ai')
    expect(run.status).toBe('ok')
    expect(run.durationMs).toBe(9000)
    expect(run.cost).toBeCloseTo(0.012)
    expect(run.totalTokens).toBe(1240)
    expect(run.actionCount).toBe(2)
    expect(run.files).toEqual(['report.md'])
    expect(run.approvalCount).toBe(1)
  })

  it('tags the run with its root span kind', () => {
    expect(summarizeRun(chatEditTrace()).kind).toBe('chat')
  })

  it('tags a standalone single-shot model call as a bare model run', () => {
    // Task-label / summary / ghost calls trace as one orphan model.call with no
    // chat.turn parent. The feed keys off kind === 'model' to hide these.
    const run = summarizeRun([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'L', spanId: 'm', kind: 'model.call', actor: 'ai', model: 'claude-haiku', data: { profile: 'task-label', totalTokens: 40, estimatedCost: 0.0001 } },
    ])
    expect(run.kind).toBe('model')
    expect(run.actor).toBe('ai')
  })

  it('pluralizes multiple changed files', () => {
    const run = summarizeRun([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn', actor: 'ai' },
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 'a', parentSpanId: 'turn', kind: 'tool.call', actor: 'ai', tool: 'fs.edit', subject: 'a.md' },
      { ts: '2026-06-12T10:00:01.100Z', traceId: 'T', spanId: 'a', parentSpanId: 'turn', kind: 'tool.result', actor: 'ai', tool: 'fs.edit', status: 'ok' },
      { ts: '2026-06-12T10:00:02.000Z', traceId: 'T', spanId: 'b', parentSpanId: 'turn', kind: 'tool.call', actor: 'ai', tool: 'fs.edit', subject: 'b.md' },
      { ts: '2026-06-12T10:00:02.100Z', traceId: 'T', spanId: 'b', parentSpanId: 'turn', kind: 'tool.result', actor: 'ai', tool: 'fs.edit', status: 'ok' },
      { ts: '2026-06-12T10:00:03.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn.done', actor: 'ai', status: 'ok', durationMs: 3000 },
    ])
    expect(run.title).toBe('Edited a.md and 1 more')
  })

  it('titles a package job run', () => {
    const run = summarizeRun([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'R', spanId: 'R', kind: 'job.started', actor: 'package', packageId: 'slides', subject: 'slides.render' },
      { ts: '2026-06-12T10:00:05.000Z', traceId: 'R', spanId: 'd', parentSpanId: 'R', kind: 'job.done', actor: 'package', packageId: 'slides', status: 'ok', durationMs: 5000 },
    ])
    expect(run.title).toBe('slides ran render')
    expect(run.durationMs).toBe(5000)
    expect(run.status).toBe('ok')
  })

  it('falls back to an answered-in-chat title when nothing was touched', () => {
    const run = summarizeRun([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn', actor: 'ai' },
      { ts: '2026-06-12T10:00:02.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn.done', actor: 'ai', status: 'ok', durationMs: 2000 },
    ])
    expect(run.title).toBe('Answered in chat')
  })

  it('counts cost and tokens from model spans only, ignoring a turn rollup', () => {
    const run = summarizeRun([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn', actor: 'ai' },
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 'm1', parentSpanId: 'turn', kind: 'model.call', actor: 'ai', data: { totalTokens: 1000, estimatedCost: 0.01 } },
      // A close event that also carries usage must NOT be double-counted.
      { ts: '2026-06-12T10:00:09.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn.done', actor: 'ai', status: 'ok', durationMs: 9000, data: { totalTokens: 1000, estimatedCost: 0.01 } },
    ])
    expect(run.cost).toBeCloseTo(0.01)
    expect(run.totalTokens).toBe(1000)
  })

  it('pairs the dominant verb with the file it acted on across mixed ops', () => {
    const run = summarizeRun([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn', actor: 'ai' },
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 'c', parentSpanId: 'turn', kind: 'tool.call', actor: 'ai', tool: 'fs.create', subject: 'a.md' },
      { ts: '2026-06-12T10:00:01.100Z', traceId: 'T', spanId: 'c', parentSpanId: 'turn', kind: 'tool.result', actor: 'ai', tool: 'fs.create', status: 'ok' },
      { ts: '2026-06-12T10:00:02.000Z', traceId: 'T', spanId: 'e', parentSpanId: 'turn', kind: 'tool.call', actor: 'ai', tool: 'fs.edit', subject: 'b.md' },
      { ts: '2026-06-12T10:00:02.100Z', traceId: 'T', spanId: 'e', parentSpanId: 'turn', kind: 'tool.result', actor: 'ai', tool: 'fs.edit', status: 'ok' },
      { ts: '2026-06-12T10:00:03.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn.done', actor: 'ai', status: 'ok', durationMs: 3000 },
    ])
    expect(run.title).toBe('Edited b.md and 1 more')
  })

  it('reads job duration from the terminal event, not an earlier step', () => {
    const run = summarizeRun([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'R', spanId: 'R', kind: 'job.started', actor: 'package', packageId: 'slides', subject: 'slides.render' },
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'R', spanId: 's', parentSpanId: 'R', kind: 'job.step', actor: 'package', durationMs: 100, data: { name: 'plan' } },
      { ts: '2026-06-12T10:00:05.000Z', traceId: 'R', spanId: 'd', parentSpanId: 'R', kind: 'job.done', actor: 'package', status: 'ok', durationMs: 5000 },
    ])
    expect(run.durationMs).toBe(5000)
  })

  it('derives a title from a real step when the chat turn is clipped from the window', () => {
    const run = summarizeRun([
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 'e', parentSpanId: 'gone', kind: 'tool.call', actor: 'ai', tool: 'fs.edit', subject: 'a.md' },
      { ts: '2026-06-12T10:00:01.100Z', traceId: 'T', spanId: 'e', parentSpanId: 'gone', kind: 'tool.result', actor: 'ai', tool: 'fs.edit', status: 'ok', durationMs: 100 },
    ])
    expect(run.title).toBe('Edited a.md')
  })
})

describe('narrateStep edges', () => {
  it('shows a cancelled job as an attention step', () => {
    const labels = storySteps([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'R', spanId: 'R', kind: 'job.started', actor: 'package', subject: 'slides.render' },
      { ts: '2026-06-12T10:00:02.000Z', traceId: 'R', spanId: 'c', parentSpanId: 'R', kind: 'job.cancelled', actor: 'package', status: 'ok', durationMs: 2000 },
    ]).map(s => s.label)
    expect(labels).toContain('Cancelled')
  })

  it('narrates external requests and non-reverted edits', () => {
    const [http] = foldSpans([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'h', kind: 'package.http.request', actor: 'package', subject: 'api.example.com', data: { method: 'GET' } },
    ])
    expect(narrateStep(http)?.label).toBe('Contacted api.example.com')
    const [edit] = foldSpans([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'o', kind: 'outcome.edit', actor: 'system', subject: 'report.md', data: { reverted: false, diffRatio: 0.3 } },
    ])
    expect(narrateStep(edit)?.label).toBe('You edited report.md')
  })
})

describe('storySteps', () => {
  it('shows meaningful steps and hides model/chat spans', () => {
    const steps = storySteps(chatEditTrace())
    const labels = steps.map(s => s.label)
    expect(labels).toEqual(['Read report.md', 'Approved fs.edit', 'Edited report.md'])
    expect(labels.some(l => l.includes('Model') || l.includes('Chat'))).toBe(false)
  })

  it('hides auto-allowed and bypassed gate decisions as noise', () => {
    const steps = storySteps([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn', actor: 'ai' },
      { ts: '2026-06-12T10:00:01.000Z', traceId: 'T', spanId: 'g', parentSpanId: 'turn', kind: 'gate.decision', actor: 'ai', tool: 'fs.read', data: { decision: 'allowed' } },
      { ts: '2026-06-12T10:00:02.000Z', traceId: 'T', spanId: 'turn', kind: 'chat.turn.done', actor: 'ai', status: 'ok' },
    ])
    expect(steps).toHaveLength(0)
  })
})

describe('narrateStep', () => {
  it('flags a reverted outcome as attention', () => {
    const [span] = foldSpans([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'o', kind: 'outcome.edit', actor: 'system', subject: 'report.md', data: { reverted: true, diffRatio: 0.8 } },
    ])
    const step = narrateStep(span)!
    expect(step.label).toBe('You reverted report.md')
    expect(step.tone).toBe('attention')
    expect(step.meta).toBe('80% changed')
  })

  it('flags a tool error', () => {
    const [span] = foldSpans([
      { ts: '2026-06-12T10:00:00.000Z', traceId: 'T', spanId: 'e', kind: 'tool.call', actor: 'ai', tool: 'fs.read', subject: 'missing.md' },
      { ts: '2026-06-12T10:00:00.500Z', traceId: 'T', spanId: 'e', kind: 'tool.error', actor: 'ai', tool: 'fs.read', durationMs: 500 },
    ])
    const step = narrateStep(span)!
    expect(step.label).toBe('Read missing.md')
    expect(step.tone).toBe('error')
  })
})

describe('formatDuration', () => {
  it('humanizes across magnitudes', () => {
    expect(formatDuration(450)).toBe('450ms')
    expect(formatDuration(2800)).toBe('2.8s')
    expect(formatDuration(24500)).toBe('25s')
    expect(formatDuration(63000)).toBe('1m 3s')
  })

  it('returns empty for non-finite or negative input', () => {
    expect(formatDuration(NaN)).toBe('')
    expect(formatDuration(-5)).toBe('')
  })
})
