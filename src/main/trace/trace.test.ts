import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { gzipSync, gunzipSync } from 'zlib'
import { createTraceLog, newTraceId, newSpanId, type TraceEvent } from '@main/trace/trace.js'

function readTraceLines(dir: string): TraceEvent[] {
  const tracesDir = join(dir, '.mim', 'traces')
  const files = readdirSync(tracesDir).filter(f => f.endsWith('.jsonl')).sort()
  return files.flatMap(file =>
    readFileSync(join(tracesDir, file), 'utf-8').trim().split('\n').map(l => JSON.parse(l) as TraceEvent),
  )
}

describe('TraceLog', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-trace-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends events to a day-named JSONL file under .mim/traces', () => {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(dir)

    trace.append({ kind: 'tool.call', actor: 'ai', tool: 'fs.read' })

    const tracesDir = join(dir, '.mim', 'traces')
    const files = readdirSync(tracesDir).filter(f => f.endsWith('.jsonl'))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/)
    const [event] = readTraceLines(dir)
    expect(event.kind).toBe('tool.call')
    expect(event.actor).toBe('ai')
    expect(event.tool).toBe('fs.read')
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(files[0].slice(0, 10)).toBe(event.ts.slice(0, 10))
  })

  it('auto-generates traceId and spanId when absent and returns the stamped event', () => {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(dir)

    const event = trace.append({ kind: 'tool.call', actor: 'user' })

    expect(event.traceId).toBeTruthy()
    expect(event.spanId).toBeTruthy()
    const [written] = readTraceLines(dir)
    expect(written.traceId).toBe(event.traceId)
    expect(written.spanId).toBe(event.spanId)
  })

  it('preserves caller-provided span hierarchy ids', () => {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(dir)
    const traceId = newTraceId()
    const parent = newSpanId()
    const span = newSpanId()

    trace.append({ kind: 'gate.decision', actor: 'ai', traceId, spanId: span, parentSpanId: parent })

    const [event] = readTraceLines(dir)
    expect(event.traceId).toBe(traceId)
    expect(event.spanId).toBe(span)
    expect(event.parentSpanId).toBe(parent)
  })

  it('stamps the principal on every event', () => {
    const trace = createTraceLog({ devConsole: false, getPrincipal: () => 'user@example.com' })
    trace.setWorkspacePath(dir)

    trace.append({ kind: 'tool.call', actor: 'ai' })

    const [event] = readTraceLines(dir)
    expect(event.principal).toBe('user@example.com')
  })

  it('lets an explicit principal override the process principal', () => {
    const trace = createTraceLog({ devConsole: false, getPrincipal: () => 'local-user' })
    trace.setWorkspacePath(dir)

    trace.append({
      kind: 'tool.call',
      actor: 'user',
      principal: 'user@example.com',
    })

    const [event] = readTraceLines(dir)
    expect(event.principal).toBe('user@example.com')
  })

  it('delivers every event to extra sinks, even with no workspace open', () => {
    const seen: TraceEvent[] = []
    const trace = createTraceLog({ devConsole: false, sinks: [{ write: (e) => seen.push(e) }] })

    trace.append({ kind: 'model.call', actor: 'ai', model: 'claude-sonnet-4-6' })

    expect(seen).toHaveLength(1)
    expect(seen[0].kind).toBe('model.call')
    expect(seen[0].ts).toBeTruthy()
  })

  it('writePayload stores compressed content-addressed payloads and returns a ref', () => {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(dir)
    const traceId = newTraceId()
    const spanId = newSpanId()

    const ref = trace.writePayload(traceId, spanId, 'params', { content: 'full raw text' })

    expect(ref).toMatch(/^objects\/[a-f0-9]{2}\/[a-f0-9]{64}\.json\.gz$/)
    const blobPath = join(dir, '.mim', 'traces', ref!)
    expect(JSON.parse(gunzipSync(readFileSync(blobPath)).toString('utf-8'))).toEqual({ content: 'full raw text' })
  })

  it('deduplicates identical payload content across traces and spans', () => {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(dir)

    const first = trace.writePayload('trace-a', 'span-a', 'result', { repeated: 'same value' })
    const second = trace.writePayload('trace-b', 'span-b', 'messages', { repeated: 'same value' })

    expect(second).toBe(first)
    expect(trace.storageStats().payloadCount).toBe(1)
  })

  it('writePayload returns null with no workspace and never throws', () => {
    const trace = createTraceLog({ devConsole: false })
    expect(trace.writePayload(newTraceId(), newSpanId(), 'params', { a: 1 })).toBeNull()
  })

  it('writePayload skips payloads over maxBytes and writes those under it', () => {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(dir)
    const big = trace.writePayload(newTraceId(), newSpanId(), 'result', { content: 'x'.repeat(2000) }, 1000)
    expect(big).toBeNull()
    const small = trace.writePayload(newTraceId(), newSpanId(), 'result', { content: 'ok' }, 1000)
    expect(small).toBeTruthy()
  })

  it('never throws when the workspace directory disappears', () => {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(join(dir, 'gone'))

    expect(() => trace.append({ kind: 'tool.call', actor: 'user' })).not.toThrow()
    expect(existsSync(join(dir, 'gone'))).toBe(false)
  })

  it('a throwing sink never blocks the append or other sinks', () => {
    const seen: TraceEvent[] = []
    const trace = createTraceLog({
      devConsole: false,
      sinks: [
        { write: () => { throw new Error('sink down') } },
        { write: (e) => seen.push(e) },
      ],
    })
    trace.setWorkspacePath(dir)

    expect(() => trace.append({ kind: 'tool.call', actor: 'ai' })).not.toThrow()
    expect(seen).toHaveLength(1)
    expect(readTraceLines(dir)).toHaveLength(1)
  })

  it('prunes day files outside retention and removes payload objects referenced only by expired events', () => {
    const tracesDir = join(dir, '.mim', 'traces')
    const oldRef = 'objects/aa/' + 'a'.repeat(64) + '.json.gz'
    const sharedRef = 'objects/bb/' + 'b'.repeat(64) + '.json.gz'
    const keptRef = 'objects/cc/' + 'c'.repeat(64) + '.json.gz'
    for (const [ref, payload] of [[oldRef, { old: true }], [sharedRef, { shared: true }], [keptRef, { kept: true }]] as const) {
      mkdirSync(join(tracesDir, ref, '..'), { recursive: true })
      writeFileSync(join(tracesDir, ref), gzipSync(JSON.stringify(payload)))
    }
    writeFileSync(join(tracesDir, '2026-06-10.jsonl'), [
      JSON.stringify({ ts: '2026-06-10T10:00:00.000Z', traceId: 'old-trace', spanId: 'old-span', kind: 'tool.call', actor: 'ai', payloadRef: oldRef }),
      JSON.stringify({ ts: '2026-06-10T10:01:00.000Z', traceId: 'shared-trace', spanId: 'old-shared', kind: 'tool.call', actor: 'ai', payloadRef: sharedRef }),
    ].join('\n') + '\n')
    writeFileSync(join(tracesDir, '2026-06-12.jsonl'), [
      JSON.stringify({ ts: '2026-06-12T10:00:00.000Z', traceId: 'kept-trace', spanId: 'kept-span', kind: 'tool.call', actor: 'ai', payloadRef: keptRef }),
      JSON.stringify({ ts: '2026-06-12T10:01:00.000Z', traceId: 'shared-trace', spanId: 'kept-shared', kind: 'tool.call', actor: 'ai', payloadRef: sharedRef }),
    ].join('\n') + '\n')

    const trace = createTraceLog({
      devConsole: false,
      getRetentionDays: () => 2,
      retentionCheckIntervalMs: 0,
      now: () => new Date('2026-06-13T12:00:00.000Z'),
    })
    trace.setWorkspacePath(dir)

    trace.append({ kind: 'tool.call', actor: 'ai', traceId: 'today-trace', spanId: 'today-span' })

    expect(existsSync(join(tracesDir, '2026-06-10.jsonl'))).toBe(false)
    expect(existsSync(join(tracesDir, '2026-06-12.jsonl'))).toBe(true)
    expect(existsSync(join(tracesDir, '2026-06-13.jsonl'))).toBe(true)
    expect(existsSync(join(tracesDir, oldRef))).toBe(false)
    expect(existsSync(join(tracesDir, sharedRef))).toBe(true)
    expect(existsSync(join(tracesDir, keptRef))).toBe(true)
  })

  it('expires payload content independently of longer digest retention', () => {
    let now = new Date('2026-06-01T12:00:00.000Z')
    const trace = createTraceLog({
      devConsole: false,
      getRetentionDays: () => 90,
      getPayloadRetentionDays: () => 7,
      retentionCheckIntervalMs: 0,
      now: () => now,
    })
    trace.setWorkspacePath(dir)
    const ref = trace.writePayload('trace-old', 'span-old', 'result', { content: 'diagnostic' })!
    trace.append({ kind: 'tool.result', actor: 'ai', traceId: 'trace-old', spanId: 'span-old', payloadRef: ref })

    now = new Date('2026-06-09T12:00:00.000Z')
    trace.append({ kind: 'tool.call', actor: 'ai' })

    expect(readTraceLines(dir).some(event => event.traceId === 'trace-old')).toBe(true)
    expect(existsSync(join(dir, '.mim', 'traces', ref))).toBe(false)
  })

  it('keeps recent mutation params when the payload budget evicts diagnostics', () => {
    const trace = createTraceLog({
      devConsole: false,
      getPayloadRetentionDays: () => 7,
      getPayloadMaxBytes: () => 1,
      retentionCheckIntervalMs: 0,
      now: () => new Date('2026-06-09T12:00:00.000Z'),
    })
    trace.setWorkspacePath(dir)
    const mutationRef = trace.writePayload('mutation', 'span-m', 'params', { path: 'a.md', content: 'm'.repeat(300) })!
    trace.append({
      kind: 'tool.call', actor: 'ai', traceId: 'mutation', spanId: 'span-m', tool: 'fs.write', payloadRef: mutationRef,
    })
    const diagnosticRef = trace.writePayload('diagnostic', 'span-d', 'result', { content: 'd'.repeat(300) })!
    trace.append({
      kind: 'tool.result', actor: 'ai', traceId: 'diagnostic', spanId: 'span-d', tool: 'fs.read', payloadRef: diagnosticRef,
    })

    trace.prune()

    expect(existsSync(join(dir, '.mim', 'traces', mutationRef))).toBe(true)
    expect(existsSync(join(dir, '.mim', 'traces', diagnosticRef))).toBe(false)
  })

  it('zero retention purges local audit data and suppresses future local writes', () => {
    const tracesDir = join(dir, '.mim', 'traces')
    mkdirSync(tracesDir, { recursive: true })
    writeFileSync(join(tracesDir, '2026-06-10.jsonl'), JSON.stringify({
      ts: '2026-06-10T10:00:00.000Z',
      traceId: 'old-trace',
      spanId: 'old-span',
      kind: 'tool.call',
      actor: 'ai',
    }) + '\n')
    const objectRef = `objects/aa/${'a'.repeat(64)}.json.gz`
    mkdirSync(join(tracesDir, 'objects', 'aa'), { recursive: true })
    writeFileSync(join(tracesDir, objectRef), gzipSync(JSON.stringify({ content: 'old audit content' })))
    const seen: TraceEvent[] = []
    const trace = createTraceLog({
      devConsole: false,
      sinks: [{ write: event => seen.push(event) }],
      getRetentionDays: () => 0,
      retentionCheckIntervalMs: 0,
      now: () => new Date('2026-06-13T12:00:00.000Z'),
    })
    trace.setWorkspacePath(dir)

    expect(trace.writePayload('disabled', 'span', 'result', { content: 'new content' })).toBeNull()
    const pruned = trace.prune()
    trace.append({ kind: 'tool.call', actor: 'ai' })

    expect(pruned.removedDigestFiles).toBe(1)
    expect(pruned.removedPayloads).toBe(1)
    expect(readdirSync(tracesDir).filter(file => file.endsWith('.jsonl'))).toHaveLength(0)
    expect(trace.storageStats()).toEqual({ digestBytes: 0, payloadBytes: 0, payloadCount: 0, totalBytes: 0 })
    expect(seen).toHaveLength(1)
  })
})
