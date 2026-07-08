import { MCP_PROTOCOL_VERSION } from '@main/mcp/stdio.js'
import type { ToolPolicy } from '@main/security/gate.js'
import type { ToolDef, ToolRegistry } from '@main/tools/registry.js'
import type { MimSharedWorkspaceConfig } from './workspaceContract.js'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface JsonRpcResponse {
  jsonrpc?: '2.0'
  id?: string | number | null
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

export interface RemoteWorkspaceInitializeResult {
  protocolVersion?: string
  serverInfo?: {
    name?: string
    version?: string
  }
  capabilities?: Record<string, unknown>
}

export interface RemoteWorkspaceRawTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  mimName?: string
  _meta?: Record<string, unknown>
}

export interface RemoteWorkspaceTool {
  mcpName: string
  mimName: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface RemoteWorkspaceClient {
  initialize(): Promise<RemoteWorkspaceInitializeResult>
  listTools(): Promise<RemoteWorkspaceTool[]>
  callTool(mcpName: string, args: Record<string, unknown>): Promise<unknown>
}

export interface RemoteWorkspaceEventClient {
  subscribe(
    onToolsListChanged: () => void,
    onError?: (error: Error) => void,
  ): { close(): void }
}

export interface RemoteWorkspaceMcpClientOptions {
  url: string
  token: string
  fetchUrl?: FetchLike
}

const TOOL_NAME_PATTERN = /^[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/

export class RemoteWorkspaceMcpClient implements RemoteWorkspaceClient {
  private nextId = 1
  private readonly fetchUrl: FetchLike

  constructor(private readonly options: RemoteWorkspaceMcpClientOptions) {
    this.fetchUrl = options.fetchUrl ?? globalThis.fetch.bind(globalThis)
  }

  async initialize(): Promise<RemoteWorkspaceInitializeResult> {
    const result = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'mim-desktop',
      },
    })
    return isObject(result) ? result as RemoteWorkspaceInitializeResult : {}
  }

  async listTools(): Promise<RemoteWorkspaceTool[]> {
    const result = await this.request('tools/list', {})
    const tools = isObject(result) && Array.isArray(result.tools) ? result.tools : []
    return tools.flatMap((entry): RemoteWorkspaceTool[] => {
      if (!isObject(entry) || typeof entry.name !== 'string') return []
      const mimName = mcpToolNameToMimName(entry as RemoteWorkspaceRawTool)
      if (!TOOL_NAME_PATTERN.test(mimName)) return []
      const inputSchema = isObject(entry.inputSchema)
        ? entry.inputSchema as Record<string, unknown>
        : { type: 'object', properties: {} }
      return [{
        mcpName: entry.name,
        mimName,
        description: typeof entry.description === 'string' ? entry.description : entry.name,
        inputSchema,
      }]
    })
  }

  async callTool(mcpName: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.request('tools/call', {
      name: mcpName,
      arguments: args,
    })
    return parseMcpToolCallResult(result)
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    const res = await this.fetchUrl(this.options.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Remote workspace MCP request failed (${res.status}): ${body}`)
    }

    const parsed = await parseJsonResponse(res)
    if (Array.isArray(parsed)) throw new Error('Remote workspace MCP returned a batch response')
    if (parsed.error) {
      throw new Error(parsed.error.message || `Remote workspace MCP error ${parsed.error.code ?? ''}`.trim())
    }
    return parsed.result
  }
}

export class RemoteWorkspaceMcpEventClient implements RemoteWorkspaceEventClient {
  private readonly fetchUrl: FetchLike

  constructor(private readonly options: RemoteWorkspaceMcpClientOptions) {
    this.fetchUrl = options.fetchUrl ?? globalThis.fetch.bind(globalThis)
  }

  subscribe(
    onToolsListChanged: () => void,
    onError?: (error: Error) => void,
  ): { close(): void } {
    const abort = new AbortController()
    void this.run(abort.signal, onToolsListChanged).catch((err) => {
      if (abort.signal.aborted) return
      onError?.(err instanceof Error ? err : new Error(String(err)))
    })
    return {
      close: () => abort.abort(),
    }
  }

  private async run(signal: AbortSignal, onToolsListChanged: () => void): Promise<void> {
    const res = await this.fetchUrl(eventsUrlForMcpUrl(this.options.url), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Accept: 'text/event-stream',
      },
      signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Remote workspace event stream failed (${res.status}): ${body}`)
    }
    if (!res.body) throw new Error('Remote workspace event stream has no body')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = splitCompleteSseEvents(buffer)
      buffer = events.remainder
      for (const event of events.complete) {
        if (sseEventIsToolListChanged(event)) onToolsListChanged()
      }
    }
  }
}

export interface SharedWorkspaceToolMount {
  sync(): Promise<void>
  startWatching(onWarning?: (message: string) => void): void
  unmount(): void
  getPolicy(name: string): ToolPolicy | undefined
  ownedNames(): string[]
  diagnostics(): string[]
  serverInfo(): RemoteWorkspaceInitializeResult | null
}

export interface SharedWorkspaceToolMountOptions {
  config: MimSharedWorkspaceConfig
  token: string
  tools: ToolRegistry
  client?: RemoteWorkspaceClient
  events?: RemoteWorkspaceEventClient
  canShadowTool?: (name: string, existing: ToolDef) => boolean
}

export function createSharedWorkspaceToolMount(options: SharedWorkspaceToolMountOptions): SharedWorkspaceToolMount {
  const client = options.client ?? new RemoteWorkspaceMcpClient({
    url: options.config.url,
    token: options.token,
  })
  const owned = new Set<string>()
  const shadowed = new Map<string, ToolDef>()
  const policyMap = new Map<string, ToolPolicy>()
  const events = options.events ?? new RemoteWorkspaceMcpEventClient({
    url: options.config.url,
    token: options.token,
  })
  let eventSubscription: { close(): void } | null = null
  let pendingSync = Promise.resolve()
  let lastDiagnostics: string[] = []
  let initialized = false
  let lastServerInfo: RemoteWorkspaceInitializeResult | null = null

  async function ensureInitialized(): Promise<void> {
    if (initialized) return
    lastServerInfo = await client.initialize()
    initialized = true
  }

  return {
    async sync() {
      await ensureInitialized()
      const remoteTools = await client.listTools()
      const nextOwned = new Set<string>()
      const nextPolicies = new Map<string, ToolPolicy>()
      const diags: string[] = []

      for (const remoteTool of remoteTools) {
        if (!matchesAnyNamespace(remoteTool.mimName, options.config.namespaces)) continue
        if (nextOwned.has(remoteTool.mimName)) {
          diags.push(`Remote shared workspace tool "${remoteTool.mimName}" appears more than once`)
          continue
        }

        const existing = options.tools.get(remoteTool.mimName)
        if (existing && !owned.has(remoteTool.mimName)) {
          if (!options.canShadowTool?.(remoteTool.mimName, existing)) {
            diags.push(`Remote shared workspace tool "${remoteTool.mimName}" collides with a local tool and is not shadowable`)
            continue
          }
          if (!shadowed.has(remoteTool.mimName)) shadowed.set(remoteTool.mimName, existing)
        }

        options.tools.register({
          name: remoteTool.mimName,
          description: remoteTool.description,
          inputSchema: remoteTool.inputSchema,
          execute: async (params) => client.callTool(remoteTool.mcpName, params),
        })
        nextOwned.add(remoteTool.mimName)
        nextPolicies.set(remoteTool.mimName, {
          category: 'network',
          risk: 'medium',
          label: `Shared workspace ${options.config.id}: ${remoteTool.mimName}`,
          source: {
            kind: 'sharedWorkspace',
            id: options.config.id,
            ...(options.config.name ? { name: options.config.name } : {}),
          },
        })
      }

      for (const name of owned) {
        if (nextOwned.has(name)) continue
        restoreOrUnregister(options.tools, shadowed, name)
      }

      owned.clear()
      for (const name of nextOwned) owned.add(name)
      policyMap.clear()
      for (const [name, policy] of nextPolicies) policyMap.set(name, policy)
      lastDiagnostics = diags
    },

    startWatching(onWarning) {
      if (eventSubscription) return
      eventSubscription = events.subscribe(
        () => {
          pendingSync = pendingSync
            .then(() => this.sync())
            .catch((err) => {
              onWarning?.(`Shared workspace catalog refresh failed: ${errorMessage(err)}`)
            })
        },
        (err) => {
          onWarning?.(`Shared workspace event stream failed: ${err.message}`)
        },
      )
    },

    unmount() {
      eventSubscription?.close()
      eventSubscription = null
      for (const name of owned) restoreOrUnregister(options.tools, shadowed, name)
      owned.clear()
      policyMap.clear()
      lastDiagnostics = []
    },

    getPolicy(name) {
      return policyMap.get(name)
    },

    ownedNames() {
      return [...owned].sort()
    },

    diagnostics() {
      return lastDiagnostics
    },

    serverInfo() {
      return lastServerInfo
    },
  }
}

function eventsUrlForMcpUrl(url: string): string {
  const parsed = new URL(url)
  parsed.pathname = parsed.pathname.replace(/\/$/, '')
  if (parsed.pathname.endsWith('/mcp')) parsed.pathname = `${parsed.pathname}/events`
  else parsed.pathname = '/mcp/events'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function splitCompleteSseEvents(buffer: string): { complete: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  return {
    complete: parts.slice(0, -1),
    remainder: parts.at(-1) ?? '',
  }
}

function sseEventIsToolListChanged(event: string): boolean {
  const dataLines = event.split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trimStart())
  if (dataLines.length === 0) return false
  try {
    const parsed = JSON.parse(dataLines.join('\n'))
    return isObject(parsed) && parsed.method === 'notifications/tools/list_changed'
  } catch {
    return false
  }
}

function restoreOrUnregister(
  tools: ToolRegistry,
  shadowed: Map<string, ToolDef>,
  name: string,
): void {
  const previous = shadowed.get(name)
  if (previous) {
    tools.register(previous)
    shadowed.delete(name)
  } else {
    tools.unregister(name)
  }
}

export function mcpToolNameToMimName(tool: Pick<RemoteWorkspaceRawTool, 'name' | 'mimName' | '_meta'>): string {
  if (typeof tool.mimName === 'string' && TOOL_NAME_PATTERN.test(tool.mimName)) return tool.mimName
  if (isObject(tool._meta)) {
    const metaName = tool._meta['mim/name']
    if (typeof metaName === 'string' && TOOL_NAME_PATTERN.test(metaName)) return metaName
  }
  return tool.name.replace(/_/g, '.')
}

function matchesAnyNamespace(name: string, namespaces: string[]): boolean {
  return namespaces.some(namespace => matchesNamespace(name, namespace))
}

function matchesNamespace(name: string, namespace: string): boolean {
  if (namespace.endsWith('.*')) {
    const prefix = namespace.slice(0, -2)
    return name.startsWith(`${prefix}.`)
  }
  return name === namespace
}

function parseMcpToolCallResult(result: unknown): unknown {
  if (!isObject(result) || !Array.isArray(result.content)) return result
  const text = result.content.find((entry): entry is { type: string; text: string } =>
    isObject(entry) && entry.type === 'text' && typeof entry.text === 'string',
  )?.text
  if (text === undefined) return result
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function parseJsonResponse(res: Response): Promise<JsonRpcResponse> {
  try {
    const parsed = await res.json()
    if (isObject(parsed)) return parsed as JsonRpcResponse
  } catch {
    // handled below
  }
  throw new Error('Remote workspace MCP returned invalid JSON')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
