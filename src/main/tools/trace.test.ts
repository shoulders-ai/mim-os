import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog, type TraceEvent } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerTraceTools } from '@main/tools/trace.js'

function writeTraceFile(workspace: string, events: TraceEvent[]): void {
  const dir = join(workspace, '.mim', 'traces')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '2026-06-12.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n')
}

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

describe('trace tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-trace-tools-'))
    tools = createToolRegistry(createTraceLog({ devConsole: false }))
    tools.setWorkspacePath(dir)
    registerTraceTools(tools)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('trace.query reads filtered trace digests for the current workspace', async () => {
    writeTraceFile(dir, [
      event({ traceId: 't1', spanId: 's1', tool: 'fs.write', actor: 'ai' }),
      event({ traceId: 't2', spanId: 's2', tool: 'fs.read', actor: 'user' }),
    ])

    const result = await tools.call('trace.query', { actor: 'ai', limit: 10 }, ctx) as {
      events: Array<{ traceId: string }>
      truncated: boolean
    }

    expect(result.events.map(e => e.traceId)).toEqual(['t1'])
    expect(result.truncated).toBe(false)
  })

  it('trace.stats returns aggregate stats', async () => {
    writeTraceFile(dir, [
      event({ kind: 'tool.result', traceId: 't1', spanId: 's1', tool: 'fs.write', status: 'ok' }),
      event({ kind: 'tool.error', traceId: 't2', spanId: 's2', tool: 'fs.write', status: 'error' }),
    ])

    const result = await tools.call('trace.stats', {}, ctx) as {
      byTool: Array<{ tool: string; calls: number; errors: number }>
    }

    expect(result.byTool.find(t => t.tool === 'fs.write')).toMatchObject({
      calls: 2,
      errors: 1,
    })
  })

  it('trace tools require an open workspace', async () => {
    const fresh = createToolRegistry(createTraceLog({ devConsole: false }))
    registerTraceTools(fresh)

    await expect(fresh.call('trace.query', {}, ctx)).rejects.toThrow('No workspace open')
    await expect(fresh.call('trace.stats', {}, ctx)).rejects.toThrow('No workspace open')
  })

  it('trace.payload reads a captured blob by ref', async () => {
    const ref = tools.trace.writePayload('trace-1', 'span-1', 'result', { content: 'captured body' })
    const result = await tools.call('trace.payload', { ref }, ctx) as {
      ref: string
      found: boolean
      payload: { content: string }
    }
    expect(result.found).toBe(true)
    expect(result.payload.content).toBe('captured body')
  })

  it('trace.payload rejects malformed and traversal refs', async () => {
    await expect(tools.call('trace.payload', { ref: '../secrets.json' }, ctx)).rejects.toThrow('Invalid payload ref')
    await expect(tools.call('trace.payload', { ref: 'blobs/../../etc/passwd' }, ctx)).rejects.toThrow('Invalid payload ref')
  })
})
