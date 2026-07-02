import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough } from 'stream'
import { WebSocket, WebSocketServer } from 'ws'
import {
  DesktopRpc,
  handleMcpRequest,
  MCP_PROTOCOL_VERSION,
  resolveMcpConnection,
  runMcpStdio,
  type McpDesktopClient,
  type McpToolMetadata,
} from '@main/mcp/stdio.js'
import { readMcpDiscoveryFile, writeMcpDiscoveryFile } from '@main/mcp/discovery.js'

const tools: McpToolMetadata[] = [
  {
    name: 'editor_open',
    mimName: 'editor.open',
    description: 'Open a file in the editor',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'workspace_orient',
    mimName: 'workspace.orient',
    description: 'Regenerate agent context',
    inputSchema: { type: 'object', properties: {} },
  },
]

class FakeClient implements McpDesktopClient {
  readonly calls: Array<{ mimName: string; args: Record<string, unknown> }> = []
  readonly closeHandlers = new Set<() => void>()
  closed = false
  clientName: string | undefined

  constructor(
    private readonly result: unknown = { ok: true },
    private readonly failure?: unknown,
  ) {}

  tools(): McpToolMetadata[] {
    return tools
  }

  async callTool(mimName: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ mimName, args })
    if (this.failure !== undefined) throw this.failure
    if (mimName === 'workspace.orient') throw new Error('orient failed')
    return this.result
  }

  onClose(callback: () => void): void {
    this.closeHandlers.add(callback)
  }

  setClientName(name: string): void {
    this.clientName = name
  }

  close(): void {
    this.closed = true
  }

  emitClose(): void {
    for (const handler of this.closeHandlers) handler()
  }
}

describe('MCP stdio server', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-mcp-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('responds to initialize with the server supported protocol version', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2099-01-01' },
    }, new FakeClient())

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'mim', version: '0.1.0' },
      },
    })
  })

  it('forwards the MCP client name from initialize to the desktop client', async () => {
    const client = new FakeClient()
    await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2099-01-01', clientInfo: { name: 'claude-code', version: '2.1' } },
    }, client)

    expect(client.clientName).toBe('claude-code')
  })

  it('ignores initialize without clientInfo', async () => {
    const client = new FakeClient()
    await handleMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2099-01-01' },
    }, client)

    expect(client.clientName).toBeUndefined()
  })

  it('lists MCP tools without leaking Mim dotted names to the MCP client', async () => {
    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 'tools',
      method: 'tools/list',
    }, new FakeClient())

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'tools',
      result: {
        tools: [
          {
            name: 'editor_open',
            description: 'Open a file in the editor',
            inputSchema: tools[0].inputSchema,
          },
          {
            name: 'workspace_orient',
            description: 'Regenerate agent context',
            inputSchema: tools[1].inputSchema,
          },
        ],
      },
    })
  })

  it('maps tools/call names to Mim tools and returns text content', async () => {
    const client = new FakeClient({ opened: 'README.md' })

    const response = await handleMcpRequest({
      jsonrpc: '2.0',
      id: 'call',
      method: 'tools/call',
      params: {
        name: 'editor_open',
        arguments: { path: 'README.md' },
      },
    }, client)

    expect(client.calls).toEqual([{ mimName: 'editor.open', args: { path: 'README.md' } }])
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'call',
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({ opened: 'README.md' }, null, 2),
        }],
      },
    })
  })

  it('returns JSON-RPC errors for unknown tools and tool failures', async () => {
    await expect(handleMcpRequest({
      jsonrpc: '2.0',
      id: 'missing',
      method: 'tools/call',
      params: { name: 'fs_read', arguments: { path: 'README.md' } },
    }, new FakeClient())).resolves.toMatchObject({
      id: 'missing',
      error: { code: -32602, message: 'Unknown tool: fs_read' },
    })

    await expect(handleMcpRequest({
      jsonrpc: '2.0',
      id: 'failed',
      method: 'tools/call',
      params: { name: 'workspace_orient' },
    }, new FakeClient())).resolves.toMatchObject({
      id: 'failed',
      error: { code: -32000, message: 'orient failed' },
    })
  })

  it('always includes a JSON-RPC error message for non-Error throws', async () => {
    await expect(handleMcpRequest({
      jsonrpc: '2.0',
      id: 'failed',
      method: 'tools/call',
      params: { name: 'editor_open' },
    }, new FakeClient({ ok: true }, 'string failure'))).resolves.toMatchObject({
      id: 'failed',
      error: { code: -32000, message: 'string failure' },
    })
  })

  it('does not respond to initialized notifications', async () => {
    await expect(handleMcpRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, new FakeClient())).resolves.toBeNull()
  })

  it('processes newline-delimited JSON and reports malformed input', async () => {
    const client = new FakeClient({ ok: true })
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let out = ''
    let err = ''
    stdout.on('data', chunk => { out += chunk.toString() })
    stderr.on('data', chunk => { err += chunk.toString() })

    const run = runMcpStdio({ stdin, stdout, stderr, client })
    stdin.write('not json\n')
    stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }) + '\n')
    stdin.end()

    await expect(run).resolves.toBe(0)
    const messages = out.trim().split('\n').map(line => JSON.parse(line))
    expect(messages[0]).toMatchObject({ id: null, error: { code: -32700, message: 'Parse error' } })
    expect(messages[1]).toMatchObject({ id: 'list', result: { tools: expect.any(Array) } })
    expect(err).toContain('invalid JSON')
    expect(client.closed).toBe(true)
  })

  it('returns exit code 1 when the desktop connection closes', async () => {
    const client = new FakeClient()
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let err = ''
    stderr.on('data', chunk => { err += chunk.toString() })

    const run = runMcpStdio({ stdin, stdout, stderr, client })
    client.emitClose()

    await expect(run).resolves.toBe(1)
    expect(err).toContain('connection closed')
  })

  it('resolves connection details from env or the discovery file', () => {
    expect(resolveMcpConnection({ MIM_PORT: '54321', MIM_TOKEN: 'token' })).toEqual({
      port: 54321,
      token: 'token',
    })

    writeMcpDiscoveryFile({ port: 12345, token: '1234567890123456' }, dir)
    expect(resolveMcpConnection({}, dir)).toEqual({
      port: 12345,
      token: '1234567890123456',
    })
  })

  it('writes discovery files with owner-only permissions where supported', () => {
    writeMcpDiscoveryFile({ port: 23456, token: '1234567890123456' }, dir)

    expect(readMcpDiscoveryFile(dir)).toEqual({ port: 23456, token: '1234567890123456' })
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, '.mim', 'server.json')).mode & 0o777).toBe(0o600)
    }
  })

  it('rejects partial MCP environment configuration', () => {
    expect(() => resolveMcpConnection({ MIM_PORT: '54321' }, dir)).toThrow(/together/)
    expect(() => resolveMcpConnection({ MIM_TOKEN: 'token' }, dir)).toThrow(/together/)
  })

  it('rejects pending desktop RPC calls when closed explicitly', async () => {
    const { rpc, ws, server } = await createDesktopRpcHarness()
    try {
      const pending = rpc.call('slow.tool', {})
      rpc.close()

      await expect(pending).rejects.toThrow('Mim desktop connection closed')
    } finally {
      ws.close()
      await closeServer(server)
    }
  })

  it('times out desktop RPC calls that never receive a response', async () => {
    const { rpc, ws, server } = await createDesktopRpcHarness(25)
    try {
      await expect(rpc.call('slow.tool', {})).rejects.toThrow(
        'Mim desktop did not respond to slow.tool within 25ms',
      )
    } finally {
      ws.close()
      await closeServer(server)
    }
  })
})

async function createDesktopRpcHarness(timeoutMs = 1000): Promise<{
  rpc: DesktopRpc
  ws: WebSocket
  server: WebSocketServer
}> {
  const server = await new Promise<WebSocketServer>((resolveListen) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 }, () => resolveListen(wss))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected TCP test server')
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`)
  await new Promise<void>((resolveOpen, rejectOpen) => {
    ws.once('open', resolveOpen)
    ws.once('error', rejectOpen)
  })
  return { rpc: new DesktopRpc(ws, timeoutMs), ws, server }
}

async function closeServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.close()
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((err) => err ? rejectClose(err) : resolveClose())
  })
}
