import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog, type TraceEvent } from '@main/trace/trace.js'
import { createTraceOutcomeTracker, textSnapshot } from '@main/trace/outcomes.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerFileTools } from '@main/tools/fs.js'

function readTraceLines(dir: string): TraceEvent[] {
  const tracesDir = join(dir, '.mim', 'traces')
  if (!existsSync(tracesDir)) return []
  const files = readdirSync(tracesDir).filter(f => f.endsWith('.jsonl')).sort()
  return files.flatMap(file =>
    readFileSync(join(tracesDir, file), 'utf-8').trim().split('\n').map(l => JSON.parse(l) as TraceEvent),
  )
}

describe('trace outcomes', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-trace-outcome-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function tracker(clock = () => Date.parse('2026-06-12T10:00:00.000Z')) {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(dir)
    return {
      trace,
      outcomes: createTraceOutcomeTracker({
        trace,
        getWorkspacePath: () => dir,
        clock,
      }),
    }
  }

  it('emits outcome.edit when a user changes a file after an AI mutation', () => {
    const { outcomes } = tracker()
    outcomes.recordAiMutation({
      path: 'docs/a.md',
      actor: 'ai',
      tool: 'fs.write',
      traceId: 'ai-trace',
      spanId: 'ai-span',
      before: textSnapshot('original text'),
      after: textSnapshot('ai text'),
      at: Date.parse('2026-06-12T09:59:00.000Z'),
    })

    outcomes.observeUserMutation({
      path: 'docs/a.md',
      after: textSnapshot('user edited text'),
      at: Date.parse('2026-06-12T10:00:00.000Z'),
    })

    const outcome = readTraceLines(dir).find(e => e.kind === 'outcome.edit')!
    expect(outcome).toMatchObject({
      actor: 'system',
      subject: 'docs/a.md',
      data: {
        aiTraceId: 'ai-trace',
        aiSpanId: 'ai-span',
        aiTool: 'fs.write',
        sinceMs: 60_000,
        reverted: false,
      },
    })
    expect(outcome.data?.diffBytes).toBeGreaterThan(0)
    expect(outcome.data?.diffRatio).toBeGreaterThan(0)
  })

  it('flags a user edit that reverts the file to its pre-AI content', () => {
    const { outcomes } = tracker()
    outcomes.recordAiMutation({
      path: 'docs/a.md',
      actor: 'ai',
      tool: 'fs.write',
      traceId: 'ai-trace',
      spanId: 'ai-span',
      before: textSnapshot('original text'),
      after: textSnapshot('ai text'),
      at: Date.parse('2026-06-12T09:00:00.000Z'),
    })

    outcomes.observeUserMutation({
      path: 'docs/a.md',
      after: textSnapshot('original text'),
      at: Date.parse('2026-06-12T09:05:00.000Z'),
    })

    const outcome = readTraceLines(dir).find(e => e.kind === 'outcome.edit')!
    expect(outcome.data?.reverted).toBe(true)
  })

  it('ignores the watcher echo of the AI write itself', () => {
    const { outcomes } = tracker()
    mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'a.md'), 'ai text')
    outcomes.recordAiMutation({
      path: 'docs/a.md',
      actor: 'ai',
      tool: 'fs.write',
      traceId: 'ai-trace',
      spanId: 'ai-span',
      before: textSnapshot('original text'),
      after: textSnapshot('ai text'),
    })

    outcomes.observeFileChange({ path: 'docs/a.md', kind: 'change' })

    expect(readTraceLines(dir).filter(e => e.kind === 'outcome.edit')).toHaveLength(0)
  })

  it('lazily rebuilds recent AI write mutations from trace blobs once', () => {
    const { trace, outcomes } = tracker()
    mkdirSync(join(dir, 'docs'), { recursive: true })
    const payloadRef = trace.writePayload('ai-trace', 'ai-span', 'params', {
      path: 'docs/a.md',
      content: 'ai text',
    })
    trace.append({
      kind: 'tool.call',
      actor: 'ai',
      traceId: 'ai-trace',
      spanId: 'ai-span',
      tool: 'fs.write',
      subject: 'docs/a.md',
      ...(payloadRef ? { payloadRef } : {}),
    })
    trace.append({
      kind: 'tool.result',
      actor: 'ai',
      traceId: 'ai-trace',
      spanId: 'ai-span',
      tool: 'fs.write',
      status: 'ok',
    })

    writeFileSync(join(dir, 'docs', 'a.md'), 'user changed after restart')
    outcomes.observeFileChange({ path: 'docs/a.md', kind: 'change' })

    const outcome = readTraceLines(dir).find(e => e.kind === 'outcome.edit')!
    expect(outcome.data).toMatchObject({
      aiTraceId: 'ai-trace',
      aiSpanId: 'ai-span',
      aiTool: 'fs.write',
    })
  })

  it('integrates with the tool registry for AI and user fs mutations', async () => {
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(dir)
    const outcomes = createTraceOutcomeTracker({
      trace,
      getWorkspacePath: () => dir,
      clock: () => Date.parse('2026-06-12T10:00:00.000Z'),
    })
    const tools = createToolRegistry(trace, undefined, { outcomes })
    tools.setWorkspacePath(dir)
    registerFileTools(tools)

    await tools.call('fs.write', { path: 'docs/a.md', content: 'ai draft' }, { actor: 'ai', sessionId: 's1' })
    await tools.call('fs.write', { path: 'docs/a.md', content: 'human revision' }, { actor: 'user' })

    const outcome = readTraceLines(dir).find(e => e.kind === 'outcome.edit')!
    expect(outcome.subject).toBe('docs/a.md')
    expect(outcome.data).toMatchObject({
      aiActor: 'ai',
      aiSessionId: 's1',
      aiTool: 'fs.write',
    })
  })
})
