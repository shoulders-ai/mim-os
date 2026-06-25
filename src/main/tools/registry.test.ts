import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog, type TraceEvent } from '@main/trace/trace.js'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { PermissionDeniedError } from '@main/security/gate.js'

function readTraceLines(dir: string): TraceEvent[] {
  const tracesDir = join(dir, '.mim', 'traces')
  const files = readdirSync(tracesDir).filter(f => f.endsWith('.jsonl')).sort()
  return files.flatMap(file =>
    readFileSync(join(tracesDir, file), 'utf-8').trim().split('\n').map(l => JSON.parse(l) as TraceEvent),
  )
}

function makeTraceLog(dir: string) {
  const trace = createTraceLog({ devConsole: false })
  trace.setWorkspacePath(dir)
  return trace
}

describe('ToolRegistry', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-test-'))
    tools = createToolRegistry(makeTraceLog(dir))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers and calls a tool', async () => {
    tools.register({
      name: 'test.echo',
      description: 'Echo input',
      execute: async (params) => ({ echo: params.msg })
    })

    const result = await tools.call('test.echo', { msg: 'hello' }, { actor: 'user' })
    expect(result).toEqual({ echo: 'hello' })
  })

  it('throws on unknown tool', async () => {
    await expect(
      tools.call('nonexistent', {}, { actor: 'user' })
    ).rejects.toThrow('Unknown tool: nonexistent')
  })

  it('traces tool calls and results with a shared span', async () => {
    tools.register({
      name: 'test.add',
      description: 'Add numbers',
      execute: async (params) => ({ sum: (params.a as number) + (params.b as number) })
    })

    await tools.call('test.add', { a: 1, b: 2 }, { actor: 'ai', sessionId: 's1' })

    const lines = readTraceLines(dir)
    expect(lines).toHaveLength(2)
    expect(lines[0].kind).toBe('tool.call')
    expect(lines[0].tool).toBe('test.add')
    expect(lines[0].actor).toBe('ai')
    expect(lines[0].sessionId).toBe('s1')
    expect(lines[0].traceId).toBeTruthy()
    expect(lines[0].spanId).toBeTruthy()
    expect(lines[1].kind).toBe('tool.result')
    expect(lines[1].status).toBe('ok')
    expect(lines[1].traceId).toBe(lines[0].traceId)
    expect(lines[1].spanId).toBe(lines[0].spanId)
    expect(lines[1].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('stamps the resolved tool effect on every tool trace event', async () => {
    tools.register({
      name: 'fs.read',
      description: 'Read file',
      execute: async () => ({ content: 'ok' }),
    })
    tools.register({
      name: 'gmail.send',
      description: 'Send mail',
      execute: async () => ({ id: 'm1' }),
    })
    tools.register({
      name: 'custom.unknown',
      description: 'Unknown custom tool',
      execute: async () => { throw new Error('nope') },
    })

    await tools.call('fs.read', { path: 'a.md' }, { actor: 'ai' })
    await tools.call('gmail.send', { to: 'a@example.com' }, { actor: 'ai' })
    await expect(tools.call('custom.unknown', {}, { actor: 'ai' })).rejects.toThrow('nope')

    const lines = readTraceLines(dir)
    const readEvents = lines.filter(l => l.tool === 'fs.read')
    const sendEvents = lines.filter(l => l.tool === 'gmail.send')
    const errorEvents = lines.filter(l => l.tool === 'custom.unknown')

    expect(readEvents.map(l => l.effect)).toEqual(['read', 'read'])
    expect(sendEvents.map(l => l.effect)).toEqual(['external', 'external'])
    expect(errorEvents.map(l => l.effect)).toEqual(['mutate', 'mutate'])
  })

  it('parents the call span under the caller trace context', async () => {
    tools.register({
      name: 'test.child',
      description: 'Child call',
      execute: async () => ({ ok: true })
    })

    await tools.call('test.child', {}, { actor: 'ai', traceId: 'turn-1', spanId: 'root-span' })

    const [call] = readTraceLines(dir)
    expect(call.traceId).toBe('turn-1')
    expect(call.parentSpanId).toBe('root-span')
    expect(call.spanId).not.toBe('root-span')
  })

  it('threads trace context into the tool execution context for nested calls', async () => {
    let innerParent: string | undefined
    let innerTrace: string | undefined
    tools.register({
      name: 'test.inner',
      description: 'Inner',
      execute: async (_params, ctx) => {
        innerTrace = ctx.traceId
        innerParent = ctx.spanId
        return {}
      },
    })
    tools.register({
      name: 'test.outer',
      description: 'Outer',
      execute: async (_params, ctx) => tools.call('test.inner', {}, ctx),
    })

    await tools.call('test.outer', {}, { actor: 'ai', traceId: 'turn-2' })

    const lines = readTraceLines(dir)
    const outerCall = lines.find(l => l.tool === 'test.outer' && l.kind === 'tool.call')!
    const innerCall = lines.find(l => l.tool === 'test.inner' && l.kind === 'tool.call')!
    expect(innerCall.traceId).toBe('turn-2')
    expect(innerCall.parentSpanId).toBe(outerCall.spanId)
    expect(innerTrace).toBe('turn-2')
    expect(innerParent).toBe(innerCall.spanId)
  })

  it('captures full raw params as a payload blob for file-mutating tools', async () => {
    tools.register({
      name: 'fs.write',
      description: 'Write file',
      execute: async () => ({ ok: true })
    })

    await tools.call('fs.write', { path: 'a.md', content: 'full secret-free file body' }, { actor: 'ai' })

    const [call] = readTraceLines(dir)
    expect(call.summary?.content).toBe('[redacted]')
    expect(call.payloadRef).toBeTruthy()
    const blob = JSON.parse(readFileSync(join(dir, '.mim', 'traces', call.payloadRef!), 'utf-8'))
    expect(blob.content).toBe('full secret-free file body')
  })

  it('does not capture payload blobs for non-mutating tools', async () => {
    tools.register({
      name: 'fs.read',
      description: 'Read file',
      execute: async () => ({ content: 'data' })
    })

    await tools.call('fs.read', { path: 'a.md' }, { actor: 'ai' })

    const [call] = readTraceLines(dir)
    expect(call.payloadRef).toBeUndefined()
  })

  it('captures the tool result as a payload blob by default', async () => {
    tools.register({
      name: 'fs.read',
      description: 'Read file',
      execute: async () => ({ content: 'full returned file body' }),
    })

    await tools.call('fs.read', { path: 'a.md' }, { actor: 'ai' })

    const result = readTraceLines(dir).find(l => l.kind === 'tool.result')!
    expect(result.payloadRef).toBeTruthy()
    const blob = JSON.parse(readFileSync(join(dir, '.mim', 'traces', result.payloadRef!), 'utf-8'))
    expect(blob.content).toBe('full returned file body')
  })

  it('never captures results for secret-bearing tools', async () => {
    for (const name of [
      'ai.setKey',
      'package.secrets.set',
      'integrations.token.refresh',
      'slack.setToken',
      'google.setTokenBundle',
      'google.setOAuthClient',
      'google.exchangeCode',
    ]) {
      tools.register({ name, description: 'Secret', execute: async () => ({ value: 'sk-secret' }) })
      await tools.call(name, {}, { actor: 'user' })
    }

    const results = readTraceLines(dir).filter(l => l.kind === 'tool.result')
    expect(results).toHaveLength(7)
    for (const result of results) expect(result.payloadRef).toBeUndefined()
  })

  it('skips result capture when tool sets captureResult false', async () => {
    tools.register({
      name: 'slack.history',
      description: 'Slack history',
      captureResult: false,
      execute: async () => ({ messages: [{ text: 'private content' }] }),
    })

    await tools.call('slack.history', { channel: 'C1' }, { actor: 'ai' })

    const result = readTraceLines(dir).find(l => l.kind === 'tool.result' && l.tool === 'slack.history')!
    expect(result.payloadRef).toBeUndefined()
  })

  it('skips result blobs for payloads over the size cap', async () => {
    tools.register({
      name: 'fs.read',
      description: 'Read file',
      execute: async () => ({ content: 'x'.repeat(1_000_001) }),
    })

    await tools.call('fs.read', { path: 'big.md' }, { actor: 'ai' })

    const result = readTraceLines(dir).find(l => l.kind === 'tool.result')!
    expect(result.payloadRef).toBeUndefined()
  })

  it('does not capture result blobs when content capture is disabled', async () => {
    const noCapture = createToolRegistry(makeTraceLog(dir), undefined, { getCaptureContent: () => false })
    noCapture.register({
      name: 'fs.read',
      description: 'Read file',
      execute: async () => ({ content: 'data' }),
    })
    expect(noCapture.shouldCaptureContent()).toBe(false)

    await noCapture.call('fs.read', { path: 'a.md' }, { actor: 'ai' })

    const result = readTraceLines(dir).find(l => l.kind === 'tool.result')!
    expect(result.payloadRef).toBeUndefined()
  })

  it('redacts secrets and message bodies from event summaries', async () => {
    tools.register({
      name: 'test.secret',
      description: 'Secret input',
      execute: async () => ({
        ok: true,
        messages: [
          {
            id: 'm1',
            text: 'returned message body',
            subject: 'returned subject',
            snippet: 'returned snippet',
            nested: { body: 'nested body', safe: 'kept' },
          },
        ],
      }),
    })

    await tools.call('test.secret', {
      token: 'xoxb-secret',
      text: 'message body',
      query: 'safe search query',
    }, { actor: 'user' })

    const lines = readTraceLines(dir)
    expect(lines[0].summary).toMatchObject({
      token: '[redacted]',
      text: '[redacted]',
      query: 'safe search query',
    })
    expect(lines[1].summary).toMatchObject({
      ok: true,
      messages: [
        {
          id: 'm1',
          text: '[redacted]',
          subject: '[redacted]',
          snippet: '[redacted]',
          nested: { body: '[redacted]', safe: 'kept' },
        },
      ],
    })
  })

  it('traces errors with status and duration on the call span', async () => {
    tools.register({
      name: 'test.fail',
      description: 'Always fails',
      execute: async () => { throw new Error('boom') }
    })

    await expect(
      tools.call('test.fail', {}, { actor: 'user' })
    ).rejects.toThrow('boom')

    const lines = readTraceLines(dir)
    const errorEvent = lines.find(l => l.kind === 'tool.error')!
    expect(errorEvent).toBeDefined()
    expect(errorEvent.status).toBe('error')
    expect(errorEvent.summary?.error).toBe('boom')
    expect(errorEvent.spanId).toBe(lines[0].spanId)
    expect(errorEvent.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('exposes the trace log for other emitters', () => {
    expect(tools.trace).toBeDefined()
    const stamped = tools.trace.append({ kind: 'model.call', actor: 'ai' })
    expect(stamped.traceId).toBeTruthy()
  })

  it('lists registered tools', () => {
    tools.register({ name: 'a', description: 'A', execute: async () => null })
    tools.register({ name: 'b', description: 'B', execute: async () => null })
    expect(tools.list()).toHaveLength(2)
    expect(tools.list().map(t => t.name)).toEqual(['a', 'b'])
  })

  it('unregisters a tool by name', () => {
    tools.register({ name: 'a', description: 'A', execute: async () => null })
    tools.register({ name: 'b', description: 'B', execute: async () => null })
    expect(tools.list()).toHaveLength(2)

    tools.unregister('a')
    expect(tools.get('a')).toBeUndefined()
    expect(tools.list()).toHaveLength(1)
    expect(tools.list()[0].name).toBe('b')
  })

  it('unregister is a no-op for unknown names', () => {
    tools.unregister('nonexistent')
    expect(tools.list()).toHaveLength(0)
  })

  it('manages workspace path', () => {
    expect(tools.getWorkspacePath()).toBeNull()
    tools.setWorkspacePath('/tmp/ws')
    expect(tools.getWorkspacePath()).toBe('/tmp/ws')
  })

  it('checks the permission gate with trace context before executing a tool', async () => {
    const check = vi.fn(async () => undefined)
    const gatedTools = createToolRegistry(makeTraceLog(dir), { check })
    const execute = vi.fn(async () => ({ ok: true }))

    gatedTools.register({
      name: 'test.gated',
      description: 'Gated tool',
      execute,
    })

    await gatedTools.call('test.gated', { path: 'a.md' }, { actor: 'ai', sessionId: 's1' })

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test.gated' }),
      { path: 'a.md' },
      expect.objectContaining({
        actor: 'ai',
        sessionId: 's1',
        traceId: expect.any(String),
        spanId: expect.any(String),
      }),
    )
    expect(execute).toHaveBeenCalledOnce()
  })

  it('waits for a pending permission gate before executing the tool body', async () => {
    let allow!: () => void
    const check = vi.fn(() => new Promise<void>((resolve) => {
      allow = resolve
    }))
    const gatedTools = createToolRegistry(makeTraceLog(dir), { check })
    const execute = vi.fn(async () => ({ ok: true }))

    gatedTools.register({
      name: 'test.paused',
      description: 'Paused tool',
      execute,
    })

    const pending = gatedTools.call('test.paused', { path: 'a.md' }, { actor: 'ai', sessionId: 's1' })
    await Promise.resolve()

    expect(check).toHaveBeenCalledOnce()
    expect(execute).not.toHaveBeenCalled()

    allow()
    await expect(pending).resolves.toEqual({ ok: true })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('does not execute a tool when the permission gate denies it', async () => {
    const gatedTools = createToolRegistry(makeTraceLog(dir), {
      check: async () => {
        throw new PermissionDeniedError('Permission denied: test')
      },
    })
    const execute = vi.fn(async () => ({ ok: true }))

    gatedTools.register({
      name: 'test.denied',
      description: 'Denied tool',
      execute,
    })

    await expect(
      gatedTools.call('test.denied', { path: 'a.md' }, { actor: 'ai', sessionId: 's1' }),
    ).rejects.toThrow('Permission denied: test')
    expect(execute).not.toHaveBeenCalled()
  })
})
