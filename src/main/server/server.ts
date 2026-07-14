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
import { handleMcpRequest, type McpDesktopClient } from '@main/mcp/stdio.js'
import { resolveInsidePackage } from '@main/packages/packageManifest.js'
import {
  isToolPolicySettingWrite,
  mcpToolNameEnabled,
  readToolsPolicy,
} from '@main/tools/toolPolicy.js'

export type ServerMode = 'desktop' | 'serve'

interface ServerHandle {
  port: number
  shellToken: string
  close(): void
  broadcast(event: string, data?: unknown): void
  createPackageLaunchUrl(packageId: string, viewId?: string): string
  createMcpToken(sessionId?: string): string
  revokeMcpToken(token: string): void
  generateTaskLabel(userText: string): Promise<string | null>
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
  { name: 'editor_state', mimName: 'editor.state', description: 'See open editor tabs and the active document, including unsaved (dirty) status' },
  { name: 'chat_send', mimName: 'chat.send', description: 'Send a message to chat' },
  { name: 'comments_list', mimName: 'comments.list', description: 'List inline review comment threads in a file (markdown or code)' },
  { name: 'comments_add', mimName: 'comments.add', description: 'Add an inline review comment anchored to a short exact passage of visible text; never hand-edit <comment> tags or @mim marker lines with file tools' },
  { name: 'comments_reply', mimName: 'comments.reply', description: 'Append a reply note to an existing inline review comment thread' },
  { name: 'comments_resolve', mimName: 'comments.resolve', description: 'Resolve inline review comments, keeping the anchored text: pass id for one thread, or all=true for every thread in the file' },
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
  { name: 'web_read', mimName: 'web.read', description: 'Read a URL (web page or PDF)' },
  { name: 'web_search', mimName: 'web.search', description: 'Search the web via Exa' },
  { name: 'browser_open', mimName: 'web.live.open', description: 'Open Mim\'s live browser for interactive websites or localhost development servers' },
  { name: 'browser_act', mimName: 'web.live.act', description: 'Observe or act in the live browser session' },
  { name: 'settings_get', mimName: 'settings.get', description: 'Read a workspace setting' },
  { name: 'settings_set', mimName: 'settings.set', description: 'Write a workspace setting' },
  { name: 'slack_status', mimName: 'slack.status', description: 'Check Slack connection status' },
  { name: 'slack_connect', mimName: 'slack.connect', description: 'Store and verify a Slack user token' },
  { name: 'slack_disconnect', mimName: 'slack.disconnect', description: 'Remove a Slack user token from the OS keychain' },
  { name: 'slack_bot_status', mimName: 'slack.bot.status', description: 'Check Slack bot listener connection status' },
  { name: 'slack_bot_connect', mimName: 'slack.bot.connect', description: 'Store and verify Slack bot and Socket Mode tokens' },
  { name: 'slack_bot_disconnect', mimName: 'slack.bot.disconnect', description: 'Remove Slack bot and Socket Mode tokens from the OS keychain' },
  { name: 'slack_bot_setup', mimName: 'slack.bot.setup', description: 'Set up the workspace Slack bot routine and credentials' },
  { name: 'slack_bot_check', mimName: 'slack.bot.check', description: 'Check workspace Slack bot readiness' },
  { name: 'slack_listener_status', mimName: 'slack.listener.status', description: 'Check the local Slack Socket Mode listener runtime' },
  { name: 'google_status', mimName: 'google.status', description: 'Check Google connection status' },
  { name: 'google_set_oauth_client', mimName: 'google.setOAuthClient', description: 'Store a Google OAuth client in the OS keychain' },
  { name: 'google_connect', mimName: 'google.connect', description: 'Connect Google through browser OAuth or token bundle' },
  { name: 'google_disconnect', mimName: 'google.disconnect', description: 'Remove Google tokens from the OS keychain' },
]

export const SLACK_MCP_TOOL_SPECS: McpToolSpec[] = [
  { name: 'slack_channels', mimName: 'slack.channels', description: 'List Slack channels' },
  { name: 'slack_users', mimName: 'slack.users', description: 'List Slack users' },
  { name: 'slack_dms', mimName: 'slack.dms', description: 'List Slack direct message conversations' },
  { name: 'slack_history', mimName: 'slack.history', description: 'Read Slack conversation history' },
  { name: 'slack_replies', mimName: 'slack.replies', description: 'Read threaded Slack replies' },
  { name: 'slack_search', mimName: 'slack.search', description: 'Search Slack messages' },
  { name: 'slack_send', mimName: 'slack.send', description: 'Post a message to a Slack channel' },
]

export const GOOGLE_MCP_TOOL_SPECS: McpToolSpec[] = [
  { name: 'gmail_search', mimName: 'gmail.search', description: 'Search Gmail messages' },
  { name: 'gmail_read', mimName: 'gmail.read', description: 'Read a Gmail message or thread' },
  { name: 'gmail_send', mimName: 'gmail.send', description: 'Send a Gmail message' },
  { name: 'calendar_events', mimName: 'calendar.events', description: 'Read Google Calendar events' },
  { name: 'calendar_create', mimName: 'calendar.create', description: 'Create a Google Calendar event' },
  { name: 'drive_search', mimName: 'drive.search', description: 'Search Google Drive files' },
  { name: 'drive_meta', mimName: 'drive.meta', description: 'Read Google Drive file metadata' },
  { name: 'docs_read', mimName: 'docs.read', description: 'Export a Google Doc as plain text' },
  { name: 'sheets_meta', mimName: 'sheets.meta', description: 'Read Google Sheets spreadsheet metadata' },
  { name: 'sheets_read', mimName: 'sheets.read', description: 'Read values from a Google Sheet range' },
  { name: 'sheets_write', mimName: 'sheets.write', description: 'Write values into a Google Sheet range' },
  { name: 'sheets_append', mimName: 'sheets.append', description: 'Append values to a Google Sheet range' },
]

const MCP_ALLOWED_TOOLS = new Set(MCP_TOOL_SPECS.map(tool => tool.mimName))

export interface McpServerOptions {
  mode?: ServerMode
  host?: string
  port?: number
  getNamedMcpTools?: () => McpToolSpec[]
  agentMounts?: { resolveProfile(agentId: string): Promise<import('@main/ai/aiRuntime.js').AgentProfile> }
  authenticateMcpHttpToken?: (token: string) => McpHttpCaller | null | Promise<McpHttpCaller | null>
  redeemSharedWorkspaceInvite?: (invite: string) => Promise<unknown> | unknown
  handleRoutineWebhook?: (
    name: string,
    delivery: {
      rawBody: Buffer
      body: unknown
      headers: Record<string, string | string[] | undefined>
    },
  ) => Promise<{ status: number; ok: boolean; duplicate?: boolean; error?: string }>
}

export interface McpHttpCaller {
  principal: string
  callerName: string
  sessionId?: string
}

export async function createServer(
  tools: ToolRegistry,
  packages: PackageLoader,
  options?: McpServerOptions
): Promise<ServerHandle> {
  const mode = options?.mode ?? 'desktop'
  const listenHost = options?.host ?? '127.0.0.1'
  const listenPort = options?.port ?? 0
  const app = express()
  const server = createHttpServer(app)
  const wss = new WebSocketServer({ server })
  const launchTokens = new Map<string, LaunchToken>()
  const mcpTokens = new Map<string, McpToken>()
  const mcpConnections = new Map<string, Set<WebSocket>>()
  const mcpHttpEventStreams = new Set<express.Response>()
  const joinRateLimit = new Map<string, { count: number; resetAt: number }>()
  const aiRuntime = createAiRuntime({ tools, agentMounts: options?.agentMounts })
  const getNamedMcpTools = options?.getNamedMcpTools ?? (() => [])
  const shellToken = randomUUID()

  for (const spec of MCP_TOOL_SPECS) {
    const tool = tools.get(spec.mimName)
    if (tool && !tool.inputSchema) console.error(`[server] MCP tool is missing inputSchema: ${spec.mimName}`)
  }

  function isMcpAllowed(method: string): boolean {
    const spec = mcpSpecForMethod(method, getNamedMcpTools())
    if (!spec) return false
    const tool = tools.get(spec.mimName)
    if (!tool?.inputSchema) return false
    const policy = readToolsPolicy(tools.getWorkspacePath(), {
      knownToolIds: tools.list().map(tool => tool.name),
    })
    return mcpToolNameEnabled(policy, spec.name, spec.mimName)
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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-mim-shell-token, Authorization, x-mim-timestamp, x-mim-signature, x-mim-delivery')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    }
    if (req.method === 'OPTIONS') {
      if (mode === 'serve') {
        next()
        return
      }
      res.status(204).end()
      return
    }
    next()
  })
  app.use(express.json({
    limit: '25mb',
    verify: (req, _res, buf) => {
      ;(req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf)
    },
  }))

  if (mode === 'serve') {
    app.post('/join', async (req, res) => {
      if (!checkJoinRateLimit(joinRateLimit, req.ip || req.socket.remoteAddress || 'unknown')) {
        res.status(429).json({ error: 'Too many join attempts' })
        return
      }
      if (!options?.redeemSharedWorkspaceInvite) {
        res.status(404).json({ error: 'Shared workspace invites are not available' })
        return
      }
      const invite = typeof req.body?.invite === 'string' ? req.body.invite : ''
      if (!invite.trim()) {
        res.status(400).json({ error: 'Missing invite' })
        return
      }
      try {
        res.json(await options.redeemSharedWorkspaceInvite(invite))
      } catch (err) {
        res.status(400).json({ error: errorMessage(err) })
      }
    })

    app.get('/mcp/events', async (req, res) => {
      const caller = await authenticateMcpHttpRequest(req, res, options?.authenticateMcpHttpToken)
      if (!caller) return

      res.status(200)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.write(`: connected ${caller.principal}\n\n`)
      mcpHttpEventStreams.add(res)
      req.on('close', () => {
        mcpHttpEventStreams.delete(res)
      })
    })

    app.post('/mcp', async (req, res) => {
      try {
        const caller = await authenticateMcpHttpRequest(req, res, options?.authenticateMcpHttpToken)
        if (!caller) return

        const sessionId = caller.sessionId ?? `mcp-http-${randomUUID()}`
        const client: McpDesktopClient = {
          tools: () => mcpToolMetadata(tools, getNamedMcpTools()),
          async callTool(mimName, args) {
            if (mimName === 'settings.set' && isToolPolicySettingWrite(args)) {
              throw new Error('Tool policy cannot be changed over MCP')
            }
            if (!isMcpAllowed(mimName)) {
              throw new Error(`Tool is not exposed over MCP: ${mimName}`)
            }
            return tools.call(mimName, args, {
              actor: 'remote',
              principal: caller.principal,
              callerName: caller.callerName,
              transport: 'mcp-http',
              sessionId,
            })
          },
          setClientName: () => {},
          onClose: () => {},
          close: () => {},
        }

        if (Array.isArray(req.body)) {
          const responses = (await Promise.all(req.body.map(entry => handleMcpRequest(entry, client))))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
          if (responses.length === 0) {
            res.status(202).end()
            return
          }
          res.json(responses)
          return
        }

        const response = await handleMcpRequest(req.body, client)
        if (!response) {
          res.status(202).end()
          return
        }
        res.json(response)
      } catch (err) {
        sendError(res, err)
      }
    })
  }

  // Shell token guard: every /api/ai/* request must carry the per-boot
  // token that only the trusted renderer shell (via preload bridge) can
  // obtain. Sandboxed app iframes cannot reach preload, so they are
  // blocked. OPTIONS preflight is handled by the CORS middleware above
  // (returns 204 before this middleware runs).
  app.use('/api/ai', (req, res, next) => {
    if (mode === 'serve') {
      sendServeModeNotFound(res)
      return
    }
    if (req.headers['x-mim-shell-token'] !== shellToken) {
      res.status(401).json({ error: 'Missing or invalid shell token' })
      return
    }
    next()
  })

  // Serve SDK files
  if (mode === 'serve') {
    app.use('/sdk', (_req, res) => sendServeModeNotFound(res))
  } else {
    app.use('/sdk', express.static(sdkDir))
  }

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
        agentId: typeof req.body?.agentId === 'string' ? req.body.agentId : undefined,
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

  app.post('/api/hooks/:routine', async (req, res) => {
    if (!options?.handleRoutineWebhook) {
      res.status(404).json({ ok: false, error: 'Routine webhooks are not available' })
      return
    }
    try {
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0)
      const result = await options.handleRoutineWebhook(req.params.routine, {
        rawBody,
        body: req.body,
        headers: req.headers as Record<string, string | string[] | undefined>,
      })
      res.status(result.status).json({
        ok: result.ok,
        ...(result.duplicate ? { duplicate: true } : {}),
        ...(result.error ? { error: result.error } : {}),
      })
    } catch (err) {
      sendError(res, err)
    }
  })

  // Serve workspace files for renderer artifact viewers (e.g. the in-app PDF
  // viewer iframe). GET-only, workspace-scoped, traversal-guarded; same local
  // trust model as the other 127.0.0.1 endpoints.
  app.use('/workspace-files', (req, res) => {
    if (mode === 'serve') return sendServeModeNotFound(res)
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
    if (mode === 'serve') return sendServeModeNotFound(res)
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
    if (mode === 'serve') {
      setImmediate(() => {
        if (ws.readyState === WebSocket.OPEN) ws.close(1008, 'WebSocket API disabled in serve mode')
      })
      return
    }

    const clientId = uuid()
    let packageId: string | undefined
    let mcpSessionId: string | undefined
    let mcpToken: string | undefined
    let mcpClientName: string | undefined
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

        if (method === '__meta.client') {
          if (connectionType !== 'mcp') {
            sendWs(ws, { id, error: 'Method is only available for MCP connections' })
            return
          }
          const name = typeof params.name === 'string' ? params.name.trim().slice(0, 64) : ''
          if (name) mcpClientName = name
          sendWs(ws, { id, result: { ok: true } })
          return
        }

        if (connectionType === 'mcp') {
          if (method === 'settings.set' && isToolPolicySettingWrite(params)) {
            sendWs(ws, { id, error: 'Tool policy cannot be changed over MCP' })
            return
          }
          if (!isMcpAllowed(method)) {
            sendWs(ws, { id, error: `Tool is not exposed over MCP: ${method}` })
            return
          }
        }

        // All other methods route through the tool registry.
        // MCP calls use actor 'user' — the MCP allowlist is the security
        // boundary, and CLI agents have their own permission gates.
        const ctx: ToolContext = connectionType === 'mcp'
          ? {
              actor: 'user',
              sessionId: mcpSessionId,
              ...(mcpClientName ? { agent: mcpClientName } : {}),
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
    sendMcpHttpNotification(mcpHttpEventStreams, 'notifications/tools/list_changed')
  })

  // Find available port
  const port = await new Promise<number>((resolve) => {
    server.listen(listenPort, listenHost, () => {
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
    })
  })

  allowedOrigins.add(`http://127.0.0.1:${port}`)
  allowedOrigins.add(`http://localhost:${port}`)
  if (listenHost !== '127.0.0.1' && listenHost !== '0.0.0.0' && listenHost !== '::') {
    allowedOrigins.add(`http://${listenHost}:${port}`)
  }
  // In dev, electron-vite serves the renderer from a separate port.
  if (process.env.ELECTRON_RENDERER_URL) {
    try { allowedOrigins.add(new URL(process.env.ELECTRON_RENDERER_URL).origin) } catch {}
  }
  console.log(`[server] Listening on http://${listenHost}:${port}`)

  return {
    port,
    shellToken,
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
      if (mode === 'serve') throw new Error('App iframe routes are disabled in serve mode')
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
    generateTaskLabel: async (userText: string) => {
      try {
        const result = await aiRuntime.generateTaskLabel({ userText })
        return result.label || null
      } catch {
        return null
      }
    },
  }
}

function checkJoinRateLimit(
  buckets: Map<string, { count: number; resetAt: number }>,
  key: string,
): boolean {
  const now = Date.now()
  const current = buckets.get(key)
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 })
    return true
  }
  current.count += 1
  return current.count <= 30
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

function sendServeModeNotFound(res: express.Response): void {
  res.status(404).send('Not found')
}

function bearerToken(req: express.Request): string | null {
  const header = req.headers.authorization
  if (typeof header !== 'string') return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

async function authenticateMcpHttpRequest(
  req: express.Request,
  res: express.Response,
  authenticate: McpServerOptions['authenticateMcpHttpToken'],
): Promise<McpHttpCaller | null> {
  const token = bearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' })
    return null
  }
  if (!authenticate) {
    res.status(503).json({ error: 'MCP HTTP auth is not configured' })
    return null
  }
  const caller = await authenticate(token)
  if (!caller) {
    res.status(401).json({ error: 'Invalid bearer token' })
    return null
  }
  return caller
}

function sendMcpHttpNotification(streams: Set<express.Response>, method: string): void {
  const data = JSON.stringify({ jsonrpc: '2.0', method })
  for (const stream of [...streams]) {
    try {
      stream.write(`event: message\ndata: ${data}\n\n`)
    } catch {
      streams.delete(stream)
    }
  }
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
  const policy = readToolsPolicy(tools.getWorkspacePath(), {
    knownToolIds: tools.list().map(tool => tool.name),
  })
  for (const spec of MCP_TOOL_SPECS) {
    if (!mcpToolNameEnabled(policy, spec.name, spec.mimName)) continue
    const tool = tools.get(spec.mimName)
    if (!tool) continue
    if (!tool.inputSchema) throw new Error(`MCP tool is missing inputSchema: ${spec.mimName}`)
    result.push({ ...spec, inputSchema: tool.inputSchema })
  }
  for (const spec of namedSpecs) {
    if (!mcpToolNameEnabled(policy, spec.name, spec.mimName)) continue
    const tool = tools.get(spec.mimName)
    if (!tool?.inputSchema) continue
    result.push({ ...spec, inputSchema: tool.inputSchema })
  }
  return result
}

function mcpSpecForMethod(method: string, namedSpecs: McpToolSpec[]): McpToolSpec | undefined {
  const staticSpec = MCP_ALLOWED_TOOLS.has(method)
    ? MCP_TOOL_SPECS.find(spec => spec.mimName === method)
    : undefined
  return staticSpec ?? namedSpecs.find(spec => spec.mimName === method)
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
