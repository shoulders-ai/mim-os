import { createInterface } from 'readline'
import type { Readable, Writable } from 'stream'
import { WebSocket } from 'ws'
import { readMcpDiscoveryFile, type McpDiscovery } from '@main/mcp/discovery.js'

export const MCP_PROTOCOL_VERSION = '2025-06-18'
export const DESKTOP_RPC_TIMEOUT_MS = 5 * 60_000
const SERVER_VERSION = '0.1.0'

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: '2.0'
  id?: JsonRpcId
  method?: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface McpToolMetadata {
  name: string
  mimName: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpDesktopClient {
  tools(): McpToolMetadata[]
  callTool(mimName: string, args: Record<string, unknown>): Promise<unknown>
  // Reports the MCP client identity (initialize clientInfo.name) to the
  // desktop so tool calls can be attributed to the connected agent.
  setClientName?(name: string): void
  onClose(callback: () => void): void
  close(): void
}

export interface RunMcpStdioOptions {
  stdin?: Readable
  stdout?: Writable
  stderr?: Writable
  env?: NodeJS.ProcessEnv
  home?: string
  client?: McpDesktopClient
}

export async function runMcpStdio(options: RunMcpStdioOptions = {}): Promise<number> {
  const stdin = options.stdin ?? process.stdin
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  let client: McpDesktopClient

  try {
    client = options.client ?? await connectMcpDesktop({
      env: options.env ?? process.env,
      home: options.home,
    })
  } catch (err) {
    stderr.write(`mim mcp: ${errorMessage(err)}\n`)
    return 1
  }

  const reader = createInterface({ input: stdin, crlfDelay: Infinity, terminal: false })
  let stopping = false
  const disconnected = new Promise<number>((resolveDisconnect) => {
    client.onClose(() => {
      if (stopping) return
      stderr.write('mim mcp: Mim desktop connection closed\n')
      reader.close()
      resolveDisconnect(1)
    })
  })

  const input = (async () => {
    for await (const line of reader) {
      await handleMcpLine(line, client, stdout, stderr)
    }
    return 0
  })()

  const code = await Promise.race([input, disconnected])
  stopping = true
  client.close()
  return code
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  client: McpDesktopClient,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null
  const method = request.method

  if (typeof method !== 'string') {
    return errorResponse(id, -32600, 'Invalid Request')
  }

  // Notifications do not receive responses. Keep this broad so future MCP
  // notifications do not break older clients.
  if (request.id === undefined && method.startsWith('notifications/')) {
    return null
  }

  if (method === 'initialize') {
    const params = isObject(request.params) ? request.params : null
    const clientInfo = params && isObject(params.clientInfo) ? params.clientInfo : null
    if (clientInfo && typeof clientInfo.name === 'string' && clientInfo.name.length > 0) {
      client.setClientName?.(clientInfo.name)
    }
    return okResponse(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: {
        name: 'mim',
        version: SERVER_VERSION,
      },
    })
  }

  if (method === 'tools/list') {
    return okResponse(id, {
      tools: client.tools().map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    })
  }

  if (method === 'tools/call') {
    const params = isObject(request.params) ? request.params : null
    if (!params || typeof params.name !== 'string') {
      return errorResponse(id, -32602, 'Invalid params: tools/call requires params.name')
    }
    const tool = client.tools().find(candidate => candidate.name === params.name)
    if (!tool) {
      return errorResponse(id, -32602, `Unknown tool: ${params.name}`)
    }
    const args = isObject(params.arguments) ? params.arguments : {}
    try {
      const result = await client.callTool(tool.mimName, args)
      return okResponse(id, {
        content: [{
          type: 'text',
          text: JSON.stringify(result ?? null, null, 2),
        }],
      })
    } catch (err) {
      return errorResponse(id, -32000, errorMessage(err))
    }
  }

  return errorResponse(id, -32601, `Method not found: ${method}`)
}

export function resolveMcpConnection(env: NodeJS.ProcessEnv = process.env, home?: string): McpDiscovery {
  const hasPort = typeof env.MIM_PORT === 'string' && env.MIM_PORT.length > 0
  const hasToken = typeof env.MIM_TOKEN === 'string' && env.MIM_TOKEN.length > 0

  if (hasPort || hasToken) {
    if (!hasPort || !hasToken) throw new Error('MIM_PORT and MIM_TOKEN must be set together')
    const port = Number(env.MIM_PORT)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('MIM_PORT must be a valid TCP port')
    }
    return { port, token: env.MIM_TOKEN! }
  }

  return readMcpDiscoveryFile(home)
}

async function handleMcpLine(
  line: string,
  client: McpDesktopClient,
  stdout: Writable,
  stderr: Writable,
): Promise<void> {
  if (!line.trim()) return
  let parsed: JsonRpcRequest
  try {
    parsed = JSON.parse(line) as JsonRpcRequest
  } catch (err) {
    stderr.write(`mim mcp: invalid JSON: ${errorMessage(err)}\n`)
    writeJsonLine(stdout, errorResponse(null, -32700, 'Parse error'))
    return
  }

  const response = await handleMcpRequest(parsed, client)
  if (response) writeJsonLine(stdout, response)
}

async function connectMcpDesktop(options: { env: NodeJS.ProcessEnv; home?: string }): Promise<McpDesktopClient> {
  const { port, token } = resolveMcpConnection(options.env, options.home)
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
  await waitForOpen(ws)
  const rpc = new DesktopRpc(ws)
  await rpc.call('identify', { type: 'mcp', token })
  const meta = await rpc.call('__meta.tools', {}) as { tools?: McpToolMetadata[] }
  if (!Array.isArray(meta.tools)) throw new Error('Mim desktop returned an invalid MCP tool catalog')
  return new WebSocketMcpClient(rpc, meta.tools)
}

class WebSocketMcpClient implements McpDesktopClient {
  constructor(
    private readonly rpc: DesktopRpc,
    private readonly catalog: McpToolMetadata[],
  ) {}

  tools(): McpToolMetadata[] {
    return this.catalog
  }

  callTool(mimName: string, args: Record<string, unknown>): Promise<unknown> {
    return this.rpc.call(mimName, args)
  }

  setClientName(name: string): void {
    // Best-effort attribution metadata; never let it break the session.
    this.rpc.call('__meta.client', { name }).catch(() => {})
  }

  onClose(callback: () => void): void {
    this.rpc.onClose(callback)
  }

  close(): void {
    this.rpc.close()
  }
}

export class DesktopRpc {
  private nextId = 1
  private closed = false
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (err: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private readonly closeHandlers = new Set<() => void>()

  constructor(
    private readonly ws: WebSocket,
    private readonly timeoutMs = DESKTOP_RPC_TIMEOUT_MS,
  ) {
    ws.on('message', (raw) => {
      let msg: { id?: string; result?: unknown; error?: unknown }
      try {
        msg = JSON.parse(raw.toString()) as { id?: string; result?: unknown; error?: unknown }
      } catch {
        return
      }
      if (!msg.id) return
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      clearTimeout(pending.timeout)
      if (msg.error) pending.reject(new Error(errorMessage(msg.error)))
      else pending.resolve(msg.result)
    })
    ws.on('close', () => this.markClosed())
    ws.on('error', (err) => {
      this.markClosed(err instanceof Error ? err : new Error(String(err)))
    })
  }

  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Mim desktop connection is not open'))
    }
    const id = `mcp-${this.nextId++}`
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        pending.reject(new Error(`Mim desktop did not respond to ${method} within ${this.timeoutMs}ms`))
      }, this.timeoutMs)
      timeout.unref?.()
      this.pending.set(id, { resolve, reject, timeout })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timeout)
        reject(err)
      }
    })
  }

  onClose(callback: () => void): void {
    this.closeHandlers.add(callback)
  }

  close(): void {
    if (this.closed) return
    this.markClosed()
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close()
    }
  }

  private markClosed(err?: Error): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(err ?? new Error('Mim desktop connection closed'))
    }
    this.pending.clear()
    for (const handler of this.closeHandlers) handler()
  }
}

function waitForOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise((resolveOpen, rejectOpen) => {
    const cleanup = () => {
      ws.off('open', onOpen)
      ws.off('error', onError)
    }
    const onOpen = () => {
      cleanup()
      resolveOpen()
    }
    const onError = (err: Error) => {
      cleanup()
      rejectOpen(err)
    }
    ws.once('open', onOpen)
    ws.once('error', onError)
  })
}

function okResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  }
}

function writeJsonLine(stdout: Writable, value: unknown): void {
  stdout.write(`${JSON.stringify(value)}\n`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  if (isObject(err) && typeof err.message === 'string' && err.message.length > 0) return err.message
  try {
    const serialized = JSON.stringify(err)
    if (serialized && serialized !== 'null') return serialized
  } catch {
    // Fall through to the generic message.
  }
  return 'Unknown error'
}
