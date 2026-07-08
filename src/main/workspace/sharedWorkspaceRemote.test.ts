import { describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry, type ToolDef } from '@main/tools/registry.js'
import {
  createSharedWorkspaceToolMount,
  mcpToolNameToMimName,
  RemoteWorkspaceMcpEventClient,
  RemoteWorkspaceMcpClient,
  type RemoteWorkspaceEventClient,
  type RemoteWorkspaceClient,
  type RemoteWorkspaceTool,
} from './sharedWorkspaceRemote.js'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('RemoteWorkspaceMcpClient', () => {
  it('initializes against a bearer-token protected MCP HTTP endpoint', async () => {
    const fetchUrl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          serverInfo: { name: 'mim', version: '0.1.2' },
          capabilities: { tools: {} },
        },
      }),
    )
    const client = new RemoteWorkspaceMcpClient({
      url: 'https://mim.example.com/mcp',
      token: 'tok_remote',
      fetchUrl,
    })

    await expect(client.initialize()).resolves.toEqual({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'mim', version: '0.1.2' },
      capabilities: { tools: {} },
    })

    expect(fetchUrl).toHaveBeenCalledWith('https://mim.example.com/mcp', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer tok_remote',
        'Content-Type': 'application/json',
      }),
    }))
    const body = JSON.parse((fetchUrl.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
      params: { clientInfo: { name: 'mim-desktop' } },
    })
  })

  it('lists remote tools and maps MCP names to Mim names', async () => {
    const fetchUrl = vi.fn(async () =>
      json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'issues_create',
              description: 'Create issue',
              inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
            },
            {
              name: 'remote_weird',
              description: 'Mapped by metadata',
              inputSchema: { type: 'object', properties: {} },
              _meta: { 'mim/name': 'knowledge.create' },
            },
          ],
        },
      }),
    )
    const client = new RemoteWorkspaceMcpClient({
      url: 'https://mim.example.com/mcp',
      token: 'tok_remote',
      fetchUrl,
    })

    await expect(client.listTools()).resolves.toEqual([
      {
        mcpName: 'issues_create',
        mimName: 'issues.create',
        description: 'Create issue',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      },
      {
        mcpName: 'remote_weird',
        mimName: 'knowledge.create',
        description: 'Mapped by metadata',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
  })

  it('calls a remote MCP tool and parses JSON text content', async () => {
    const fetchUrl = vi.fn(async () =>
      json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({ id: 'ISS-1', title: 'Fix auth' }, null, 2),
          }],
        },
      }),
    )
    const client = new RemoteWorkspaceMcpClient({
      url: 'https://mim.example.com/mcp',
      token: 'tok_remote',
      fetchUrl,
    })

    await expect(client.callTool('issues_create', { title: 'Fix auth' })).resolves.toEqual({
      id: 'ISS-1',
      title: 'Fix auth',
    })

    const body = JSON.parse((fetchUrl.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({
      method: 'tools/call',
      params: {
        name: 'issues_create',
        arguments: { title: 'Fix auth' },
      },
    })
  })

  it('throws JSON-RPC and HTTP errors with useful messages', async () => {
    const rpcError = new RemoteWorkspaceMcpClient({
      url: 'https://mim.example.com/mcp',
      token: 'tok_remote',
      fetchUrl: async () => json({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Permission denied' },
      }),
    })
    await expect(rpcError.listTools()).rejects.toThrow(/Permission denied/)

    const httpError = new RemoteWorkspaceMcpClient({
      url: 'https://mim.example.com/mcp',
      token: 'tok_remote',
      fetchUrl: async () => new Response('nope', { status: 503 }),
    })
    await expect(httpError.listTools()).rejects.toThrow(/503/)
  })
})

describe('RemoteWorkspaceMcpEventClient', () => {
  it('subscribes to tools/list_changed notifications from the MCP event stream', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    const fetchUrl = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )
    const client = new RemoteWorkspaceMcpEventClient({
      url: 'https://mim.example.com/mcp',
      token: 'tok_remote',
      fetchUrl,
    })
    const changed = vi.fn()
    const subscription = client.subscribe(changed)

    controller!.enqueue(new TextEncoder().encode('event: message\n'))
    controller!.enqueue(new TextEncoder().encode('data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n'))
    await waitFor(() => changed.mock.calls.length === 1)

    subscription.close()
    expect(fetchUrl).toHaveBeenCalledWith('https://mim.example.com/mcp/events', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer tok_remote' }),
      signal: expect.any(AbortSignal),
    }))
  })
})

describe('shared workspace remote tool mounting', () => {
  it('maps MCP tool names to Mim tool names with metadata first and underscore fallback', () => {
    expect(mcpToolNameToMimName({ name: 'issues_create' })).toBe('issues.create')
    expect(mcpToolNameToMimName({ name: 'remote_name', _meta: { 'mim/name': 'issues.create' } })).toBe('issues.create')
  })

  it('mounts selected remote namespaces and proxies calls through the MCP client', async () => {
    const tools = createToolRegistry(createTraceLog())
    const client = new FakeRemoteWorkspaceClient([
      {
        mcpName: 'issues_create',
        mimName: 'issues.create',
        description: 'Create issue',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      },
      {
        mcpName: 'slack_send',
        mimName: 'slack.send',
        description: 'Post Slack message',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    const mount = createSharedWorkspaceToolMount({
      config: {
        id: 'team-server',
        url: 'https://mim.example.com/mcp',
        namespaces: ['issues.*'],
      },
      token: 'tok_remote',
      tools,
      client,
    })

    await mount.sync()

    expect(mount.ownedNames()).toEqual(['issues.create'])
    expect(tools.get('issues.create')?.description).toBe('Create issue')
    expect(tools.get('slack.send')).toBeUndefined()
    expect(mount.getPolicy('issues.create')).toEqual({
      category: 'network',
      risk: 'medium',
      label: 'Shared workspace team-server: issues.create',
      source: { kind: 'sharedWorkspace', id: 'team-server' },
    })

    await expect(tools.call('issues.create', { title: 'Fix auth' }, { actor: 'ai' })).resolves.toEqual({
      remote: true,
      mcpName: 'issues_create',
      args: { title: 'Fix auth' },
    })
    expect(client.calls).toEqual([
      { mcpName: 'issues_create', args: { title: 'Fix auth' } },
    ])
  })

  it('shadows configured local named tools and restores them when the remote namespace disappears', async () => {
    const tools = createToolRegistry(createTraceLog())
    const localTool: ToolDef = {
      name: 'issues.create',
      description: 'Local create issue',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ local: true }),
    }
    tools.register(localTool)
    const client = new FakeRemoteWorkspaceClient([
      {
        mcpName: 'issues_create',
        mimName: 'issues.create',
        description: 'Remote create issue',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    const mount = createSharedWorkspaceToolMount({
      config: {
        id: 'team-server',
        url: 'https://mim.example.com/mcp',
        namespaces: ['issues.*'],
      },
      token: 'tok_remote',
      tools,
      client,
      canShadowTool: name => name === 'issues.create',
    })

    await mount.sync()
    expect(tools.get('issues.create')?.description).toBe('Remote create issue')

    client.setTools([])
    await mount.sync()

    expect(tools.get('issues.create')?.description).toBe('Local create issue')
    await expect(tools.call('issues.create', {}, { actor: 'ai' })).resolves.toEqual({ local: true })
  })

  it('does not shadow existing tools unless they are explicitly shadowable', async () => {
    const tools = createToolRegistry(createTraceLog())
    tools.register({
      name: 'fs.read',
      description: 'Local read',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ local: true }),
    })
    const client = new FakeRemoteWorkspaceClient([
      {
        mcpName: 'fs_read',
        mimName: 'fs.read',
        description: 'Remote read',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    const mount = createSharedWorkspaceToolMount({
      config: {
        id: 'team-server',
        url: 'https://mim.example.com/mcp',
        namespaces: ['fs.*'],
      },
      token: 'tok_remote',
      tools,
      client,
    })

    await mount.sync()

    expect(mount.ownedNames()).toEqual([])
    expect(mount.diagnostics()).toEqual([
      'Remote shared workspace tool "fs.read" collides with a local tool and is not shadowable',
    ])
    await expect(tools.call('fs.read', {}, { actor: 'ai' })).resolves.toEqual({ local: true })
  })

  it('refreshes mounted tools when the remote catalog change event arrives', async () => {
    const tools = createToolRegistry(createTraceLog())
    const client = new FakeRemoteWorkspaceClient([
      {
        mcpName: 'issues_create',
        mimName: 'issues.create',
        description: 'Create issue',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    const events = new FakeRemoteWorkspaceEvents()
    const mount = createSharedWorkspaceToolMount({
      config: {
        id: 'team-server',
        url: 'https://mim.example.com/mcp',
        namespaces: ['issues.*'],
      },
      token: 'tok_remote',
      tools,
      client,
      events,
    })

    await mount.sync()
    expect(mount.ownedNames()).toEqual(['issues.create'])

    client.setTools([
      {
        mcpName: 'issues_close',
        mimName: 'issues.close',
        description: 'Close issue',
        inputSchema: { type: 'object', properties: {} },
      },
    ])
    mount.startWatching()
    events.emitToolsChanged()
    await waitFor(() => mount.ownedNames().includes('issues.close'))

    expect(mount.ownedNames()).toEqual(['issues.close'])
    expect(tools.get('issues.create')).toBeUndefined()
    expect(tools.get('issues.close')?.description).toBe('Close issue')
    mount.unmount()
    expect(events.closed).toBe(true)
  })
})

class FakeRemoteWorkspaceClient implements RemoteWorkspaceClient {
  readonly calls: Array<{ mcpName: string; args: Record<string, unknown> }> = []

  constructor(private remoteTools: RemoteWorkspaceTool[]) {}

  setTools(tools: RemoteWorkspaceTool[]): void {
    this.remoteTools = tools
  }

  async initialize(): Promise<unknown> {
    return { serverInfo: { name: 'mim' } }
  }

  async listTools(): Promise<RemoteWorkspaceTool[]> {
    return this.remoteTools
  }

  async callTool(mcpName: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ mcpName, args })
    return { remote: true, mcpName, args }
  }
}

class FakeRemoteWorkspaceEvents implements RemoteWorkspaceEventClient {
  private handler: (() => void) | null = null
  closed = false

  subscribe(onToolsListChanged: () => void): { close(): void } {
    this.handler = onToolsListChanged
    return {
      close: () => {
        this.closed = true
        this.handler = null
      },
    }
  }

  emitToolsChanged(): void {
    this.handler?.()
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for condition')
}
