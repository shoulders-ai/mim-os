import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  computeTraceStats,
  queryTraceEvents,
  readTracePayload,
  renderTraceHealth,
  type TraceStats,
} from '@main/trace/query.js'
import type { TraceEvent } from '@main/trace/trace.js'

function event(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    ts: '2026-06-12T10:00:00.000Z',
    traceId: 'trace-1',
    spanId: 'span-1',
    kind: 'tool.call',
    actor: 'ai',
    ...overrides,
  }
}

function writeTraceFile(workspace: string, day: string, events: TraceEvent[]): void {
  const dir = join(workspace, '.mim', 'traces')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${day}.jsonl`), events.map(e => JSON.stringify(e)).join('\n') + '\n')
}

describe('trace query', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-trace-query-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('filters JSONL trace events and never expands payload blobs', async () => {
    writeTraceFile(dir, '2026-06-12', [
      event({
        ts: '2026-06-12T09:00:00.000Z',
        traceId: 't-old',
        spanId: 's-old',
        actor: 'user',
        tool: 'fs.read',
      }),
      event({
        ts: '2026-06-12T10:00:00.000Z',
        traceId: 't-hit',
        spanId: 's-hit',
        actor: 'ai',
        tool: 'fs.write',
        subject: 'docs/a.md',
        payloadRef: 'blobs/t-hit/s-hit.params.json',
        summary: { path: 'docs/a.md', content: '[redacted]' },
      }),
      event({
        ts: '2026-06-12T11:00:00.000Z',
        traceId: 't-other',
        spanId: 's-other',
        actor: 'ai',
        tool: 'search',
      }),
    ])
    mkdirSync(join(dir, '.mim', 'traces', 'blobs', 't-hit'), { recursive: true })
    writeFileSync(join(dir, '.mim', 'traces', 'blobs', 't-hit', 's-hit.params.json'), '{"content":"raw"}')

    const result = await queryTraceEvents(dir, {
      actor: 'ai',
      tool: 'fs.write',
      from: '2026-06-12T09:30:00.000Z',
      limit: 10,
    })

    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      traceId: 't-hit',
      spanId: 's-hit',
      tool: 'fs.write',
      payloadRef: 'blobs/t-hit/s-hit.params.json',
      summary: { path: 'docs/a.md', content: '[redacted]' },
    })
    expect(JSON.stringify(result.events[0])).not.toContain('"raw"')
    expect(result.truncated).toBe(false)
  })

  it('caps query results while preserving chronological file order', async () => {
    writeTraceFile(dir, '2026-06-12', [
      event({ ts: '2026-06-12T10:00:00.000Z', traceId: 't1', spanId: 's1' }),
      event({ ts: '2026-06-12T10:01:00.000Z', traceId: 't2', spanId: 's2' }),
      event({ ts: '2026-06-12T10:02:00.000Z', traceId: 't3', spanId: 's3' }),
    ])

    const result = await queryTraceEvents(dir, { limit: 2 })

    expect(result.events.map(e => e.traceId)).toEqual(['t1', 't2'])
    expect(result.truncated).toBe(true)
  })

  it('raises the result cap above the feed limit when scoped to one trace', async () => {
    const big = Array.from({ length: 520 }, (_, i) =>
      event({ ts: `2026-06-12T10:00:${String(i % 60).padStart(2, '0')}.000Z`, traceId: 'big', spanId: `s${i}` }),
    )
    writeTraceFile(dir, '2026-06-12', big)

    const scoped = await queryTraceEvents(dir, { traceId: 'big', limit: 5000 })
    expect(scoped.events).toHaveLength(520)
    expect(scoped.truncated).toBe(false)

    // The unscoped feed query stays capped at 500 so the day view never streams unbounded.
    const unscoped = await queryTraceEvents(dir, { limit: 5000 })
    expect(unscoped.events).toHaveLength(500)
    expect(unscoped.truncated).toBe(true)
  })

  it('can return newest events first for timeline views', async () => {
    writeTraceFile(dir, '2026-06-11', [
      event({ ts: '2026-06-11T10:00:00.000Z', traceId: 'older', spanId: 's1' }),
    ])
    writeTraceFile(dir, '2026-06-12', [
      event({ ts: '2026-06-12T10:00:00.000Z', traceId: 'middle', spanId: 's2' }),
      event({ ts: '2026-06-12T10:01:00.000Z', traceId: 'newer', spanId: 's3' }),
    ])

    const result = await queryTraceEvents(dir, { order: 'desc', limit: 2 })

    expect(result.events.map(e => e.traceId)).toEqual(['newer', 'middle'])
    expect(result.truncated).toBe(true)
  })

  it('filters by identity and status dimensions used by agents', async () => {
    writeTraceFile(dir, '2026-06-12', [
      event({
        traceId: 'target-trace',
        spanId: 'target-span',
        kind: 'tool.error',
        actor: 'package',
        packageId: 'slides',
        sessionId: 's1',
        runId: 'run-1',
        status: 'error',
      }),
      event({
        traceId: 'other-trace',
        spanId: 'other-span',
        kind: 'tool.error',
        actor: 'package',
        packageId: 'slides',
        sessionId: 's2',
        runId: 'run-2',
        status: 'error',
      }),
      event({
        traceId: 'ok-trace',
        spanId: 'ok-span',
        kind: 'tool.result',
        actor: 'package',
        packageId: 'slides',
        sessionId: 's1',
        runId: 'run-1',
        status: 'ok',
      }),
    ])

    const result = await queryTraceEvents(dir, {
      actor: 'package',
      packageId: 'slides',
      sessionId: 's1',
      runId: 'run-1',
      traceId: 'target-trace',
      status: 'error',
      limit: 10,
    })

    expect(result.events.map(e => e.spanId)).toEqual(['target-span'])
  })

  it('treats error-shaped events as errors even without an explicit status', async () => {
    writeTraceFile(dir, '2026-06-12', [
      event({ kind: 'tool.error', traceId: 'tool-fail', spanId: 's1', tool: 'fs.read' }),
      event({ kind: 'job.failed', traceId: 'job-fail', spanId: 's2', subject: 'slides.render' }),
      event({ kind: 'tool.result', traceId: 'ok', spanId: 's3', status: 'ok' }),
      event({ kind: 'tool.call', traceId: 'unknown', spanId: 's4' }),
    ])

    const result = await queryTraceEvents(dir, { status: 'error', limit: 10 })

    expect(result.events.map(e => e.traceId)).toEqual(['tool-fail', 'job-fail'])
  })

  it('aggregates tool, model, gate, job, package, day, and outcome stats', async () => {
    writeTraceFile(dir, '2026-06-12', [
      event({ kind: 'tool.result', tool: 'fs.write', status: 'ok', durationMs: 20 }),
      event({ kind: 'tool.error', traceId: 't2', spanId: 's2', tool: 'fs.read', status: 'error', durationMs: 10 }),
      event({
        kind: 'model.call',
        traceId: 't3',
        spanId: 's3',
        model: 'claude-sonnet-4-6',
        durationMs: 100,
        data: { totalTokens: 300, estimatedCost: 0.012 },
      }),
      event({
        kind: 'gate.decision',
        traceId: 't4',
        spanId: 's4',
        tool: 'fs.write',
        data: { decision: 'approved', mode: 'normal' },
      }),
      event({
        kind: 'gate.decision',
        traceId: 't5',
        spanId: 's5',
        tool: 'gmail.send',
        data: { decision: 'denied', mode: 'normal' },
      }),
      event({
        kind: 'job.done',
        traceId: 'run-1',
        spanId: 's6',
        actor: 'package',
        packageId: 'deck',
        subject: 'deck.render',
        status: 'ok',
        durationMs: 50,
      }),
      event({
        kind: 'job.failed',
        traceId: 'run-2',
        spanId: 's7',
        actor: 'package',
        packageId: 'deck',
        subject: 'deck.render',
        status: 'error',
        durationMs: 70,
      }),
      event({
        kind: 'outcome.edit',
        traceId: 't8',
        spanId: 's8',
        actor: 'system',
        subject: 'docs/a.md',
        data: { diffRatio: 0.5, reverted: true },
      }),
    ])

    const stats = await computeTraceStats(dir, {})

    expect(stats.events.total).toBe(8)
    expect(stats.events.errors).toBe(2)
    expect(stats.byTool.find(t => t.tool === 'fs.read')).toMatchObject({
      errors: 1,
      errorRate: 1,
      avgDurationMs: 10,
    })
    expect(stats.byModel.find(m => m.model === 'claude-sonnet-4-6')).toMatchObject({
      calls: 1,
      totalTokens: 300,
      estimatedCost: 0.012,
    })
    expect(stats.gates.find(g => g.tool === 'gmail.send')).toMatchObject({
      denied: 1,
      denialRate: 1,
    })
    expect(stats.jobs.find(j => j.subject === 'deck.render')).toMatchObject({
      completed: 1,
      failed: 1,
      avgDurationMs: 60,
    })
    expect(stats.byPackage.find(p => p.packageId === 'deck')).toMatchObject({
      events: 2,
      errors: 1,
      errorRate: 0.5,
    })
    expect(stats.byDay).toEqual([{ day: '2026-06-12', events: 8, errors: 2, estimatedCost: 0.012 }])
    expect(stats.outcomes).toMatchObject({
      edits: 1,
      reverted: 1,
      avgDiffRatio: 0.5,
    })
  })

  it('renders a compact health digest and omits empty sections', () => {
    const stats: TraceStats = {
      events: { total: 5, errors: 2 },
      byTool: [
        { tool: 'fs.read', calls: 3, successes: 1, errors: 2, errorRate: 2 / 3, avgDurationMs: 20, totalDurationMs: 60 },
      ],
      byPackage: [],
      byModel: [{ model: 'claude-sonnet-4-6', calls: 1, totalTokens: 1000, estimatedCost: 0.02, avgDurationMs: 100 }],
      byDay: [
        { day: '2026-06-11', events: 2, errors: 0, estimatedCost: 0.005 },
        { day: '2026-06-12', events: 3, errors: 2, estimatedCost: 0.015 },
      ],
      gates: [{ tool: 'gmail.send', allowed: 0, requested: 0, approved: 0, denied: 2, bypassed: 0, denialRate: 1, approvalRate: 0 }],
      jobs: [],
      outcomes: { edits: 0, reverted: 0, avgDiffRatio: 0 },
    }

    const lines = renderTraceHealth(stats)

    expect(lines).toContain('Top failing tools: fs.read 2/3 errors')
    expect(lines).toContain('Denial hotspots: gmail.send 2 denied')
    expect(lines).toContain('Model cost: $0.0200 estimated across 1 calls')
    expect(lines).toContain('Cost trend: 2026-06-11 $0.0050 -> 2026-06-12 $0.0150')
  })
})

describe('readTracePayload', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-payload-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeBlob(ref: string, payload: unknown): void {
    const full = join(dir, '.mim', 'traces', ref)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, JSON.stringify(payload))
  }

  it('reads a valid blob by ref', () => {
    writeBlob('blobs/trace-1/span-1.result.json', { content: 'hello' })
    const result = readTracePayload(dir, 'blobs/trace-1/span-1.result.json')
    expect(result).toEqual({ ref: 'blobs/trace-1/span-1.result.json', found: true, payload: { content: 'hello' } })
  })

  it('reports not-found for a well-formed ref with no blob', () => {
    const result = readTracePayload(dir, 'blobs/trace-x/span-x.messages.json')
    expect(result).toEqual({ ref: 'blobs/trace-x/span-x.messages.json', found: false })
  })

  it('rejects traversal and malformed refs', () => {
    expect(readTracePayload(dir, 'blobs/../../etc/passwd')).toBeNull()
    expect(readTracePayload(dir, '../secrets.json')).toBeNull()
    expect(readTracePayload(dir, 'blobs/trace-1/span-1.result.txt')).toBeNull()
    expect(readTracePayload(dir, 'not-a-blob.json')).toBeNull()
    expect(readTracePayload(dir, 42 as unknown as string)).toBeNull()
  })
})
