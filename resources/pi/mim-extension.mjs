// Mim's first-party Pi adapter. It is loaded only for Pi sessions launched by
// Mim and talks directly to the desktop's authenticated WebSocket tool surface.
// No MCP subprocess or user-level Pi configuration is involved.

const DEFAULT_CONNECT_TIMEOUT_MS = 4_000
const DEFAULT_CALL_TIMEOUT_MS = 5 * 60_000
const TITLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MAX_TITLE_CHARS = 72

function addSocketListener(socket, type, listener) {
  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener(type, listener)
    return () => socket.removeEventListener?.(type, listener)
  }
  socket.on?.(type, listener)
  return () => socket.off?.(type, listener)
}

function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message
  return String(error || 'Unknown Mim connection error')
}

export class MimRpcClient {
  constructor(options) {
    this.url = options.url
    this.token = options.token
    this.WebSocketImpl = options.WebSocketImpl
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.onDisconnect = options.onDisconnect
    this.socket = null
    this.connected = false
    this.nextId = 1
    this.pending = new Map()
  }

  async connect() {
    if (this.connected) return
    if (typeof this.WebSocketImpl !== 'function') throw new Error('WebSocket is unavailable in this Pi runtime')

    const socket = new this.WebSocketImpl(this.url)
    this.socket = socket
    await new Promise((resolve, reject) => {
      let settled = false
      const cleanupOpen = addSocketListener(socket, 'open', () => finish(resolve))
      const cleanupError = addSocketListener(socket, 'error', () => finish(() => reject(new Error('Could not connect to Mim'))))
      const timer = setTimeout(() => finish(() => reject(new Error('Timed out connecting to Mim'))), this.connectTimeoutMs)
      timer.unref?.()

      const finish = (complete) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanupOpen()
        cleanupError()
        typeof complete === 'function' ? complete() : resolve()
      }
    })

    addSocketListener(socket, 'message', event => this.handleMessage(event))
    addSocketListener(socket, 'close', () => this.handleDisconnect(new Error('Mim connection closed')))
    addSocketListener(socket, 'error', () => {
      // A close event normally follows. Keeping this listener prevents an
      // unhandled socket error without rejecting a request twice.
    })

    try {
      await this.call('identify', { type: 'mcp', token: this.token })
      await this.call('__meta.client', { name: 'pi' })
      this.connected = true
    } catch (error) {
      this.close()
      throw error
    }
  }

  call(method, params = {}, options = {}) {
    const socket = this.socket
    if (!socket) return Promise.reject(new Error('Mim is not connected'))
    if (options.signal?.aborted) return Promise.reject(new Error('Mim tool call aborted'))

    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const fail = (error) => {
        if (!this.pending.delete(id)) return
        cleanup()
        reject(error)
      }
      const onAbort = () => fail(new Error('Mim tool call aborted'))
      const timer = setTimeout(
        () => fail(new Error(`Mim tool call timed out: ${method}`)),
        options.timeoutMs ?? this.callTimeoutMs,
      )
      timer.unref?.()

      this.pending.set(id, {
        resolve: (value) => {
          cleanup()
          resolve(value)
        },
        reject: (error) => {
          cleanup()
          reject(error)
        },
      })
      options.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        fail(new Error(errorMessage(error)))
      }
    })
  }

  close() {
    const socket = this.socket
    this.socket = null
    this.connected = false
    try {
      socket?.close()
    } catch {
      // Best-effort shutdown; Pi itself must remain usable.
    }
    this.rejectPending(new Error('Mim connection closed'))
  }

  handleMessage(event) {
    const raw = typeof event?.data === 'string' ? event.data : String(event?.data ?? '')
    let message
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (typeof message?.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (typeof message.error === 'string' && message.error) {
      pending.reject(new Error(message.error))
    } else {
      pending.resolve(message.result)
    }
  }

  handleDisconnect(error) {
    const wasActive = this.connected || this.socket !== null
    this.socket = null
    this.connected = false
    this.rejectPending(error)
    if (wasActive) this.onDisconnect?.(error)
  }

  rejectPending(error) {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const request of pending) request.reject(error)
  }
}

function toolLabel(name) {
  const text = name.replace(/[_-]+/g, ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : name
}

function promptSnippet(description) {
  return String(description || '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

function toolResultText(result) {
  if (typeof result === 'string') return result
  if (result === undefined) return 'null'
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}

export function summarizePrompt(prompt) {
  const cleaned = String(prompt || '')
    .replace(/\x1b\[[0-9;?<>=]*[A-Za-z]/g, '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Pi'
  if (cleaned.length <= MAX_TITLE_CHARS) return cleaned
  const sliced = cleaned.slice(0, MAX_TITLE_CHARS)
  const lastSpace = sliced.lastIndexOf(' ')
  return `${lastSpace > MAX_TITLE_CHARS / 2 ? sliced.slice(0, lastSpace) : sliced}…`
}

export function createMimPiExtension(deps = {}) {
  const WebSocketImpl = deps.WebSocketImpl ?? globalThis.WebSocket
  const env = deps.env ?? process.env
  const setIntervalFn = deps.setIntervalFn ?? globalThis.setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? globalThis.clearInterval
  const connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  const callTimeoutMs = deps.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS

  return async function mimPiExtension(pi) {
    const port = String(env.MIM_PORT ?? '').trim()
    const token = String(env.MIM_TOKEN ?? '').trim()
    let rpc = null
    let connectPromise = null
    let connectionState = port && token ? 'connecting' : 'unavailable'
    let activeContext = null
    let currentTitle = 'Pi'
    let titleTimer = null
    let frameIndex = 0
    const registeredTools = new Set()

    const updateConnectionStatus = () => {
      if (!activeContext?.ui) return
      const text = connectionState === 'connected'
        ? 'Mim tools connected'
        : connectionState === 'connecting'
          ? 'Mim tools connecting…'
          : 'Mim tools unavailable'
      activeContext.ui.setStatus('mim', text)
    }

    const registerCatalog = (catalog) => {
      const tools = Array.isArray(catalog?.tools) ? catalog.tools : []
      for (const spec of tools) {
        if (!spec || typeof spec.name !== 'string' || typeof spec.mimName !== 'string') continue
        if (!spec.inputSchema || typeof spec.inputSchema !== 'object') continue
        if (registeredTools.has(spec.name)) continue
        try {
          pi.registerTool({
            name: spec.name,
            label: toolLabel(spec.name),
            description: String(spec.description || `Call Mim tool ${spec.mimName}.`),
            promptSnippet: promptSnippet(spec.description || `Call Mim tool ${spec.mimName}.`),
            parameters: spec.inputSchema,
            async execute(_toolCallId, params, signal) {
              const client = await ensureConnected()
              const result = await client.call(spec.mimName, params ?? {}, { signal })
              return {
                content: [{ type: 'text', text: toolResultText(result) }],
                details: { mimTool: spec.mimName },
              }
            },
          })
          registeredTools.add(spec.name)
        } catch {
          // A malformed or conflicting catalog entry must not break Pi startup.
        }
      }
    }

    const connect = async () => {
      if (!port || !token) return false
      if (rpc?.connected) return true
      connectionState = 'connecting'
      updateConnectionStatus()
      const client = new MimRpcClient({
        url: `ws://127.0.0.1:${port}/ws`,
        token,
        WebSocketImpl,
        connectTimeoutMs,
        callTimeoutMs,
        onDisconnect: () => {
          if (rpc === client) rpc = null
          connectionState = 'unavailable'
          updateConnectionStatus()
        },
      })
      try {
        await client.connect()
        const catalog = await client.call('__meta.tools', {})
        rpc = client
        registerCatalog(catalog)
        connectionState = 'connected'
        updateConnectionStatus()
        return true
      } catch {
        client.close()
        connectionState = 'unavailable'
        updateConnectionStatus()
        return false
      }
    }

    const ensureConnected = async () => {
      if (rpc?.connected) return rpc
      if (!connectPromise) {
        connectPromise = connect().finally(() => {
          connectPromise = null
        })
      }
      const connected = await connectPromise
      if (!connected || !rpc) throw new Error('Mim tools are unavailable')
      return rpc
    }

    const stopTitleSpinner = (ctx, restoreTitle = true) => {
      if (titleTimer !== null) clearIntervalFn(titleTimer)
      titleTimer = null
      if (restoreTitle) ctx?.ui?.setTitle(currentTitle)
    }

    const startTitleSpinner = (ctx) => {
      stopTitleSpinner(ctx, false)
      frameIndex = 0
      const tick = () => {
        ctx.ui.setTitle(`${TITLE_FRAMES[frameIndex % TITLE_FRAMES.length]} ${currentTitle}`)
        frameIndex += 1
      }
      tick()
      titleTimer = setIntervalFn(tick, 120)
      titleTimer?.unref?.()
    }

    pi.on('session_start', async (_event, ctx) => {
      activeContext = ctx
      ctx.ui.setTitle('Pi')
      updateConnectionStatus()
    })
    pi.on('before_agent_start', (event, ctx) => {
      activeContext = ctx
      currentTitle = summarizePrompt(event.prompt)
    })
    pi.on('agent_start', (_event, ctx) => {
      activeContext = ctx
      startTitleSpinner(ctx)
    })
    pi.on('agent_end', (_event, ctx) => {
      activeContext = ctx
      stopTitleSpinner(ctx)
    })
    pi.on('session_shutdown', (_event, ctx) => {
      stopTitleSpinner(ctx, false)
      rpc?.close()
      rpc = null
      ctx.ui.setStatus('mim', undefined)
    })

    pi.registerCommand?.('mim-reconnect', {
      description: 'Reconnect Pi to Mim tools',
      async handler(_args, ctx) {
        activeContext = ctx
        const connected = await ensureConnected().then(() => true, () => false)
        ctx.ui.notify(
          connected ? 'Mim tools connected' : 'Mim tools are unavailable',
          connected ? 'info' : 'warning',
        )
      },
    })

    // Await the first loopback connection so tools are in Pi's initial system
    // prompt. Failure is deliberately swallowed: the CLI remains fully usable.
    await ensureConnected().catch(() => undefined)
  }
}

export default createMimPiExtension()
