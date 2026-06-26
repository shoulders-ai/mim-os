import express from 'express'
import { createServer as createHttpServer } from 'http'
import { Readable } from 'stream'
import { WebSocketServer, WebSocket } from 'ws'
import { isAbsolute, join, relative, resolve } from 'path'
import { existsSync, statSync } from 'fs'
import { randomUUID } from 'crypto'
import { v4 as uuid } from 'uuid'
import type { ToolRegistry, ToolContext } from '@main/tools/registry.js'
import type { PackageLoader } from '@main/packages/packages.js'
import { createAiRuntime } from '@main/ai/aiRuntime.js'
import { resolveInsidePackage } from '@main/packages/packageManifest.js'

interface ServerHandle {
  port: number
  close(): void
  broadcast(event: string, data?: unknown): void
  createPackageLaunchUrl(packageId: string, viewId?: string): string
  createMcpToken(sessionId?: string): string
  revokeMcpToken(token: string): void
}

interface WsRequest {
  id: string
  method: string
  params?: Record<string, unknown>
}

// An unused launch token expires quickly; once an iframe identifies with it,
// the token stays valid for the iframe's lifetime so the SDK can re-identify
// after a dropped WebSocket reconnects.
const LAUNCH_TOKEN_TTL_MS = 60_000

interface LaunchToken {
  packageId: string
  viewId: string
  // Tokens must complete a first identify within this window. Cleared (null) on
  // first successful identify: the renderer keeps package iframe URLs alive
  // indefinitely (KeepAlive in the work pane), and browsers reload an iframe
  // from its existing src whenever it is reattached to the DOM, so the same
  // launch token must keep identifying for remounts and SDK reconnects.
  expiresAt: number | null
}

interface McpToken {
  sessionId: string
}

export interface McpToolSpec {
  name: string
  mimName: string
  description: string
}

export const MCP_TOOL_SPECS: McpToolSpec[] = [
  { name: 'editor_open', mimName: 'editor.open', description: 'Open a file in the editor' },
  { name: 'chat_send', mimName: 'chat.send', description: 'Send a message to chat' },
  { name: 'comments_list', mimName: 'comments.list', description: 'List inline comments on a file' },
  { name: 'comments_add', mimName: 'comments.add', description: 'Add an inline comment' },
  { name: 'comments_reply', mimName: 'comments.reply', description: 'Reply to a comment' },
  { name: 'comments_resolve', mimName: 'comments.resolve', description: 'Resolve a comment' },
  { name: 'history_list', mimName: 'history.list', description: 'List local file versions' },
  { name: 'history_restore', mimName: 'history.restore', description: 'Restore a file from local history' },
  { name: 'search_sessions', mimName: 'search.sessions', description: 'Search past sessions' },
  { name: 'pdf_extract', mimName: 'documents.pdf.extract', description: 'Extract text from a PDF' },
  { name: 'export_docx', mimName: 'export.docx', description: 'Export markdown to DOCX' },
  { name: 'export_pdf', mimName: 'export.pdf', description: 'Export markdown to PDF' },
  { name: 'workspace_orient', mimName: 'workspace.orient', description: 'Regenerate agent context' },
  { name: 'fs_read', mimName: 'fs.read', description: 'Read a file from the workspace' },
  { name: 'search_files', mimName: 'search.files', description: 'Search for files by name or content' },
  { name: 'skill_list', mimName: 'skill.list', description: 'List available workspace skills' },
  { name: 'skill_get', mimName: 'skill.get', description: 'Get a skill definition' },
  { name: 'log_append', mimName: 'log.append', description: 'Append a durable activity note to the workspace log' },
  { name: 'workspace_info', mimName: 'workspace.info', description: 'Get workspace metadata' },
  { name: 'system_prompt', mimName: 'system.prompt', description: 'Get the resolved AI system prompt' },
]

const MCP_ALLOWED_TOOLS = new Set(MCP_TOOL_SPECS.map(tool => tool.mimName))

export interface McpServerOptions {
  getNamedMcpTools?: () => McpToolSpec[]
}

export async function createServer(
  tools: ToolRegistry,
  packages: PackageLoader,
  options?: McpServerOptions
): Promise<ServerHandle> {
  const app = express()
  const server = createHttpServer(app)
  const wss = new WebSocketServer({ server })
  const launchTokens = new Map<string, LaunchToken>()
  const mcpTokens = new Map<string, McpToken>()
  const mcpConnections = new Map<string, Set<WebSocket>>()
  const aiRuntime = createAiRuntime({ tools })
  const getNamedMcpTools = options?.getNamedMcpTools ?? (() => [])

  function isMcpAllowed(method: string): boolean {
    if (MCP_ALLOWED_TOOLS.has(method)) return true
    return getNamedMcpTools().some(s => s.mimName === method)
  }

  const sdkDir = resolveSdkDir()
  // Populated after port assignment; checked at request time.
  const allowedOrigins = new Set<string>()

  // Event replay buffer: stores the last N job events per app so
  // reconnecting clients can catch up on missed events.
  const EVENT_BUFFER_MAX = 500
  const eventBuffer = new Map<string, Array<Record<string, unknown>>>()

  app.use((req, res, next) => {
    const origin = req.headers.origin
    // No Origin header (same-origin), 'null' (file:// in packaged Electron),
    // or a known local origin — all legitimate. Everything else is denied CORS
    // headers, so the browser blocks the response from foreign web pages.
    if (!origin || origin === 'null' || allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin || 'null')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
    next()
  })
  app.use(express.json({ limit: '25mb' }))

  // Serve SDK files
  app.use('/sdk', express.static(sdkDir))

  app.post('/api/ai/chat', async (req, res) => {
    const abort = abortSignalForRequest(req, res)
    try {
      const response = await aiRuntime.streamChatResponse({
        id: typeof req.body?.id === 'string' ? req.body.id : undefined,
        messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        modelId: typeof req.body?.modelId === 'string' ? req.body.modelId : undefined,
        controlId: typeof req.body?.controlId === 'string' ? req.body.controlId : undefined,
        skills: Array.isArray(req.body?.skills)
          ? req.body.skills.filter((name: unknown): name is string => typeof name === 'string')
          : undefined,
        abortSignal: abort.signal,
      })
      await sendWebResponse(res, response)
    } catch (err) {
      sendError(res, err)
    }
  })

  app.post('/api/ai/inline', async (req, res) => {
    const abort = abortSignalForRequest(req, res)
    try {
      const response = await aiRuntime.streamInlineResponse({
        id: typeof req.body?.id === 'string' ? req.body.id : undefined,
        messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        modelId: typeof req.body?.modelId === 'string' ? req.body.modelId : undefined,
        controlId: typeof req.body?.controlId === 'string' ? req.body.controlId : undefined,
        selection: typeof req.body?.selection === 'object' && req.body.selection != null
          ? req.body.selection
          : undefined,
        abortSignal: abort.signal,
      })
      await sendWebResponse(res, response)
    } catch (err) {
      sendError(res, err)
    }
  })

  app.post('/api/ai/ghost', async (req, res) => {
    try {
      const result = await aiRuntime.generateGhostSuggestions({
        before: typeof req.body?.before === 'string' ? req.body.before : '',
        after: typeof req.body?.after === 'string' ? req.body.after : '',
        fallback: Array.isArray(req.body?.fallback) ? req.body.fallback : [],
        modelId: typeof req.body?.modelId === 'string' ? req.body.modelId : undefined,
      })
      res.json(result)
    } catch (err) {
      sendError(res, err)
    }
  })

  app.post('/api/ai/task-label', async (req, res) => {
    try {
      const result = await aiRuntime.generateTaskLabel({
        userText: typeof req.body?.userText === 'string' ? req.body.userText : '',
        contextLabels: Array.isArray(req.body?.contextLabels)
          ? req.body.contextLabels.filter((label: unknown): label is string => typeof label === 'string')
          : [],
        modelId: typeof req.body?.modelId === 'string' ? req.body.modelId : undefined,
      })
      res.json(result)
    } catch (err) {
      sendError(res, err)
    }
  })

  app.post('/api/ai/summary', async (req, res) => {
    try {
      const result = await aiRuntime.generateSummary({
        messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        modelId: typeof req.body?.modelId === 'string' ? req.body.modelId : undefined,
      })
      res.json(result)
    } catch (err) {
      sendError(res, err)
    }
  })

  // Serve workspace files for renderer artifact viewers (e.g. the in-app PDF
  // viewer iframe). GET-only, workspace-scoped, traversal-guarded; same local
  // trust model as the other 127.0.0.1 endpoints.
  app.use('/workspace-files', (req, res) => {
    if (req.method !== 'GET') return res.status(405).end()
    const workspace = tools.getWorkspacePath()
    if (!workspace) return res.status(404).send('No workspace open')
    const fullPath = resolveWorkspaceFilePath(workspace, req.path)
    if (!fullPath || !existsSync(fullPath) || !statSync(fullPath).isFile()) {
      return res.status(404).send('File not found')
    }
    // Scope send's dotfile check to the requested file via `root`; an absolute
    // path would let a dot-directory anywhere in the workspace prefix trip
    // send's default dotfiles:'ignore' and 404 a file that exists.
    const root = resolve(workspace)
    res.sendFile(relative(root, fullPath), { root })
  })

  // Serve app UI files
  app.use('/packages/:id', (req, res, next) => {
    const pkg = packages.get(req.params.id)
    if (!pkg) return res.status(404).send('App not found')

    const fullPath = resolvePackageUiPath(pkg.dir, req.path)

    if (!fullPath || !existsSync(fullPath)) {
      return res.status(404).send('File not found')
    }

    // Serve relative to the app's ui/ root. Apps install under
    // ~/.mim/packages/<id>/<version>/, and that `.mim` segment is a dotfile;
    // sendFile with an absolute path applies send's default dotfiles:'ignore'
    // to the WHOLE path and 404s on the prefix. The `root` option scopes the
    // dotfile check to the requested file only (traversal is already blocked
    // by resolvePackageUiPath).
    const uiRoot = resolve(pkg.dir, 'ui')
    res.sendFile(relative(uiRoot, fullPath), { root: uiRoot })
  })

  // Log and drop server-level WebSocket errors so they never crash the
  // main process (Node emits 'error' as an uncaught exception when no
  // listener is attached).
  wss.on('error', (err) => {
    console.error('[server] WebSocket server error', err)
  })

  // WebSocket handler
  wss.on('connection', (ws) => {
    const clientId = uuid()
    let packageId: string | undefined
    let mcpSessionId: string | undefined
    let mcpToken: string | undefined
    let connectionType: 'package' | 'mcp' | undefined

    ws.on('error', (err) => {
      console.error('[server] WebSocket client error', err)
    })

    ws.on('message', async (raw) => {
      let msg: WsRequest
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        sendWs(ws, { error: 'Invalid JSON' })
        return
      }

      const { id, method, params = {} } = msg

      try {
        if (method === 'identify') {
          if (connectionType) {
            sendWs(ws, { id, error: 'Connection is already identified' })
            return
          }
          if (params.type === 'mcp') {
            const token = typeof params.token === 'string' ? params.token : ''
            const identified = mcpTokens.get(token)
            if (!identified) {
              sendWs(ws, { id, error: 'Invalid MCP token' })
              return
            }
            connectionType = 'mcp'
            mcpToken = token
            mcpSessionId = identified.sessionId
            let connections = mcpConnections.get(token)
            if (!connections) {
              connections = new Set()
              mcpConnections.set(token, connections)
            }
            connections.add(ws)
            sendWs(ws, { id, result: { clientId, type: 'mcp', sessionId: mcpSessionId } })
            return
          }

          const launch = typeof params.launch === 'string' ? params.launch : ''
          const identified = resolveLaunchToken(launchTokens, launch)
          if (!identified) {
            sendWs(ws, { id, error: 'Invalid app launch token' })
            return
          }
          // Establish the token: from now on the same launch URL re-identifies
          // cleanly when the iframe reloads or the SDK reconnects. The work
          // pane keeps iframes alive indefinitely (KeepAlive), so an
          // identified token never expires.
          identified.expiresAt = null
          packageId = identified.packageId
          connectionType = 'package'
          sendWs(ws, { id, result: { clientId, packageId } })
          // Replay buffered events the client missed (reconnect catch-up).
          const lastSeq = typeof params.lastSeq === 'number' ? params.lastSeq : 0
          if (lastSeq > 0) {
            const buffer = eventBuffer.get(packageId) ?? []
            for (const entry of buffer) {
              const seq = typeof entry.sequence === 'number' ? entry.sequence : 0
              if (seq > lastSeq) {
                sendWs(ws, { event: 'package:job:event', data: entry })
              }
            }
          }
          return
        }

        if (!connectionType) {
          sendWs(ws, { id, error: 'Connection is not identified' })
          return
        }

        if (method === 'packages.list') {
          if (connectionType !== 'package') {
            sendWs(ws, { id, error: 'Method is not available for MCP connections' })
            return
          }
          sendWs(ws, { id, result: packages.list() })
          return
        }

        if (method === '__meta.tools') {
          if (connectionType !== 'mcp') {
            sendWs(ws, { id, error: 'Method is only available for MCP connections' })
            return
          }
          sendWs(ws, { id, result: { tools: mcpToolMetadata(tools, getNamedMcpTools()) } })
          return
        }

        if (connectionType === 'mcp' && !isMcpAllowed(method)) {
          sendWs(ws, { id, error: `Tool is not exposed over MCP: ${method}` })
          return
        }

        // All other methods route through the tool registry.
        // MCP calls use actor 'user' — the MCP allowlist is the security
        // boundary, and CLI agents have their own permission gates.
        const ctx: ToolContext = connectionType === 'mcp'
          ? {
              actor: 'user',
              sessionId: mcpSessionId,
            }
          : {
              actor: 'package',
              package_id: packageId,
        }
        const result = await tools.call(method, params, ctx)
        sendWs(ws, { id, result })
      } catch (err) {
        sendWs(ws, { id, error: errorMessage(err) })
      }
    })

    ws.on('close', () => {
      if (!mcpToken) return
      const connections = mcpConnections.get(mcpToken)
      connections?.delete(ws)
      if (connections?.size === 0) mcpConnections.delete(mcpToken)
    })
  })

  // Broadcast to all connected WebSocket clients
  packages.onChange(() => {
    broadcast(wss, { event: 'packages:changed', data: packages.list() })
  })

  // Find available port
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })

  allowedOrigins.add(`http://127.0.0.1:${port}`)
  allowedOrigins.add(`http://localhost:${port}`)
  // In dev, electron-vite serves the renderer from a separate port.
  if (process.env.ELECTRON_RENDERER_URL) {
    try { allowedOrigins.add(new URL(process.env.ELECTRON_RENDERER_URL).origin) } catch {}
  }
  console.log(`[server] Listening on http://127.0.0.1:${port}`)

  return {
    port,
    close: () => server.close(),
    broadcast: (event: string, data?: unknown) => {
      // Buffer package job events for replay on reconnect.
      if (event === 'package:job:event' && data && typeof data === 'object') {
        const entry = data as Record<string, unknown>
        const pkgId = typeof entry.packageId === 'string' ? entry.packageId : undefined
        if (pkgId) {
          let buffer = eventBuffer.get(pkgId)
          if (!buffer) {
            buffer = []
            eventBuffer.set(pkgId, buffer)
          }
          buffer.push(entry)
          if (buffer.length > EVENT_BUFFER_MAX) {
            buffer.splice(0, buffer.length - EVENT_BUFFER_MAX)
          }
        }
      }
      broadcast(wss, { event, data })
    },
    createPackageLaunchUrl: (packageId: string, viewId?: string) => {
      pruneExpiredLaunchTokens(launchTokens)
      const pkg = packages.get(packageId)
      if (!pkg) throw new Error(`App not found: ${packageId}`)
      const view = viewId
        ? pkg.manifest.views.find(candidate => candidate.id === viewId)
        : pkg.manifest.views[0]
      if (!view) throw new Error(`App has no view: ${packageId}`)
      const token = randomUUID()
      launchTokens.set(token, {
        packageId,
        viewId: view.id,
        expiresAt: Date.now() + LAUNCH_TOKEN_TTL_MS,
      })
      const rel = viewSrcToUiRequestPath(pkg.dir, view.src)
      return `http://127.0.0.1:${port}/packages/${packageId}/${rel}?launch=${encodeURIComponent(token)}`
    },
    createMcpToken: (sessionId = 'mcp') => {
      const token = randomUUID()
      mcpTokens.set(token, { sessionId })
      return token
    },
    revokeMcpToken: (token: string) => {
      mcpTokens.delete(token)
      const connections = mcpConnections.get(token)
      if (!connections) return
      mcpConnections.delete(token)
      for (const socket of connections) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          try { socket.close(1008, 'MCP token revoked') } catch { /* already closing */ }
        }
      }
    },
  }
}

function abortSignalForRequest(req: express.Request, res: express.Response): AbortController {
  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted && !res.writableEnded) controller.abort()
  }
  req.on('aborted', abort)
  res.on('close', abort)
  return controller
}

async function sendWebResponse(res: express.Response, response: Response): Promise<void> {
  res.status(response.status)
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  if (!response.body) {
    res.end()
    return
  }
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    stream.on('error', reject)
    res.on('finish', resolve)
    stream.pipe(res)
  })
}

function sendError(res: express.Response, err: unknown): void {
  console.error('[server] AI request failed', err)
  if (res.headersSent) {
    res.end()
    return
  }
  res.status(500).json({
    error: err instanceof Error ? err.message : 'AI request failed',
  })
}

function broadcast(wss: WebSocketServer, msg: Record<string, unknown>): void {
  for (const client of wss.clients) {
    sendWs(client, msg)
  }
}

function sendWs(ws: WebSocket, msg: Record<string, unknown>): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false
  try {
    ws.send(JSON.stringify(msg))
    return true
  } catch {
    return false
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.length > 0) return err
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) {
    return err.message
  }
  return 'Unknown error'
}

function mcpToolMetadata(tools: ToolRegistry, namedSpecs: McpToolSpec[] = []): Array<McpToolSpec & { inputSchema: Record<string, unknown> }> {
  const result: Array<McpToolSpec & { inputSchema: Record<string, unknown> }> = []
  for (const spec of MCP_TOOL_SPECS) {
    const tool = tools.get(spec.mimName)
    if (!tool) throw new Error(`MCP tool is not registered: ${spec.mimName}`)
    if (!tool.inputSchema) throw new Error(`MCP tool is missing inputSchema: ${spec.mimName}`)
    result.push({ ...spec, inputSchema: tool.inputSchema })
  }
  for (const spec of namedSpecs) {
    const tool = tools.get(spec.mimName)
    if (!tool?.inputSchema) continue
    result.push({ ...spec, inputSchema: tool.inputSchema })
  }
  return result
}

export function resolveWorkspaceFilePath(workspace: string, requestPath: string): string | null {
  const root = resolve(workspace)
  const relPath = requestPath.replace(/^\/+/, '')
  if (!relPath) return null
  const fullPath = resolve(root, relPath)
  const rel = relative(root, fullPath)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return fullPath
}

export function resolvePackageUiPath(packageDir: string, requestPath: string): string | null {
  const uiRoot = resolve(packageDir, 'ui')
  const filePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '')
  const fullPath = resolve(uiRoot, filePath)
  const rel = relative(uiRoot, fullPath)

  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return fullPath
}

export function resolveSdkDir(): string {
  const roots = Array.from(new Set([
    process.cwd(),
    resolve(import.meta.dirname, '../..'),
    resolve(import.meta.dirname, '../../..'),
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    typeof process.resourcesPath === 'string' ? resolve(process.resourcesPath, '..') : '',
  ].filter(Boolean)))

  return resolveSdkDirFromRoots(roots)
}

export function resolveSdkDirFromRoots(roots: string[]): string {
  const candidates = roots.flatMap(root => [
    join(root, 'sdk'),
    join(root, 'app.asar', 'sdk'),
  ])
  const found = candidates.find(candidate =>
    existsSync(join(candidate, 'mim.js')) && existsSync(join(candidate, 'tokens.css')),
  )
  if (found) return found

  throw new Error(`App SDK assets not found. Checked: ${candidates.slice(0, 8).join(', ')}`)
}

function resolveLaunchToken(tokens: Map<string, LaunchToken>, token: string): LaunchToken | null {
  const launch = tokens.get(token)
  if (!launch) return null
  if (launch.expiresAt !== null && launch.expiresAt < Date.now()) {
    tokens.delete(token)
    return null
  }
  return launch
}

function pruneExpiredLaunchTokens(tokens: Map<string, LaunchToken>): void {
  const now = Date.now()
  for (const [token, launch] of tokens) {
    if (launch.expiresAt !== null && launch.expiresAt < now) tokens.delete(token)
  }
}

function viewSrcToUiRequestPath(packageDir: string, src: string): string {
  const resolved = resolveInsidePackage(packageDir, src)
  if (!resolved) throw new Error(`Invalid app view src: ${src}`)
  const uiRoot = resolve(packageDir, 'ui')
  const rel = relative(uiRoot, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`App view must be inside ui/: ${src}`)
  return rel.replace(/\\/g, '/')
}
