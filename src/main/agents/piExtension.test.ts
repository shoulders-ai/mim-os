import { beforeAll, describe, expect, it, vi } from 'vitest'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { createAgentStatusTracker } from '@main/agents/agentStatus.js'

interface PiExtensionModule {
  createMimPiExtension: (deps?: Record<string, unknown>) => (pi: FakePi) => Promise<void>
}

interface FakePi {
  on: ReturnType<typeof vi.fn>
  registerTool: ReturnType<typeof vi.fn>
}

interface RpcRequest {
  id: number
  method: string
  params: Record<string, unknown>
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly requests: RpcRequest[] = []
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.emit('open', {}))
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  send(raw: string) {
    const request = JSON.parse(raw) as RpcRequest
    this.requests.push(request)
    let result: unknown
    if (request.method === 'identify') result = { type: 'mcp', sessionId: 'session-1' }
    else if (request.method === '__meta.client') result = { ok: true }
    else if (request.method === '__meta.tools') {
      result = {
        tools: [{
          name: 'workspace_info',
          mimName: 'workspace.info',
          description: 'Inspect the active Mim workspace.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }],
      }
    } else if (request.method === 'workspace.info') {
      result = { root: '/workspace', ready: true }
    } else {
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({ id: request.id, error: `Unexpected method: ${request.method}` }),
      }))
      return
    }
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: request.id, result }) }))
  }

  close() {
    this.emit('close', {})
  }

  private emit(type: string, event: { data?: string }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function fakePi() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const pi: FakePi = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => handlers.set(event, handler)),
    registerTool: vi.fn(),
  }
  return { pi, handlers }
}

let extensionModule: PiExtensionModule

beforeAll(async () => {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), 'resources/pi/mim-extension.mjs')).href
  extensionModule = await import(/* @vite-ignore */ moduleUrl) as PiExtensionModule
})

describe('bundled Pi extension', () => {
  it('authenticates directly with Mim, identifies as Pi, and registers the curated tool catalog', async () => {
    FakeWebSocket.instances = []
    const { pi } = fakePi()
    const factory = extensionModule.createMimPiExtension({
      WebSocketImpl: FakeWebSocket,
      env: { MIM_PORT: '54321', MIM_TOKEN: 'secret-session-token' },
    })

    await factory(pi)

    expect(FakeWebSocket.instances[0].url).toBe('ws://127.0.0.1:54321/ws')
    expect(FakeWebSocket.instances[0].requests.slice(0, 3)).toEqual([
      { id: 1, method: 'identify', params: { type: 'mcp', token: 'secret-session-token' } },
      { id: 2, method: '__meta.client', params: { name: 'pi' } },
      { id: 3, method: '__meta.tools', params: {} },
    ])
    expect(pi.registerTool).toHaveBeenCalledTimes(1)
    expect(pi.registerTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'workspace_info',
      label: 'Workspace info',
      description: 'Inspect the active Mim workspace.',
      promptSnippet: 'Inspect the active Mim workspace.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: expect.any(Function),
    }))
  })

  it('forwards tool calls with abort support and returns Pi-compatible text content', async () => {
    FakeWebSocket.instances = []
    const { pi } = fakePi()
    await extensionModule.createMimPiExtension({
      WebSocketImpl: FakeWebSocket,
      env: { MIM_PORT: '54321', MIM_TOKEN: 'token' },
    })(pi)

    const tool = pi.registerTool.mock.calls[0][0]
    const result = await tool.execute('call-1', {}, new AbortController().signal)

    expect(FakeWebSocket.instances[0].requests.at(-1)).toEqual({
      id: 4,
      method: 'workspace.info',
      params: {},
    })
    expect(result).toEqual({
      content: [{ type: 'text', text: '{\n  "root": "/workspace",\n  "ready": true\n}' }],
      details: { mimTool: 'workspace.info' },
    })
  })

  it('publishes connection status and title-spinner lifecycle signals that Mim can track', async () => {
    FakeWebSocket.instances = []
    const { pi, handlers } = fakePi()
    const clearIntervalFn = vi.fn()
    await extensionModule.createMimPiExtension({
      WebSocketImpl: FakeWebSocket,
      env: { MIM_PORT: '54321', MIM_TOKEN: 'token' },
      setIntervalFn: (callback: () => void) => {
        callback()
        return 17
      },
      clearIntervalFn,
    })(pi)

    const titles: string[] = []
    const ui = {
      setStatus: vi.fn(),
      setTitle: vi.fn((title: string) => titles.push(title)),
    }
    const ctx = { ui }
    await handlers.get('session_start')?.({ type: 'session_start' }, ctx)
    await handlers.get('before_agent_start')?.({ type: 'before_agent_start', prompt: 'Inspect the workspace\ncarefully.' }, ctx)
    await handlers.get('agent_start')?.({ type: 'agent_start' }, ctx)

    expect(ui.setStatus).toHaveBeenCalledWith('mim', 'Mim tools connected')
    expect(titles.at(-1)).toMatch(/^[\u2800-\u28ff] Inspect the workspace carefully\.$/)

    const tracker = createAgentStatusTracker()
    tracker.feed(`\x1b]0;${titles.at(-1)}\x07`)
    expect(tracker.status()).toBe('working')

    await handlers.get('agent_end')?.({ type: 'agent_end', messages: [] }, ctx)
    expect(clearIntervalFn).toHaveBeenCalledWith(17)
    expect(titles.at(-1)).toBe('Inspect the workspace carefully.')
    tracker.feed(`\x1b]0;${titles.at(-1)}\x07`)
    expect(tracker.status()).toBe('needs-input')
  })

  it('degrades without crashing Pi when Mim is unavailable', async () => {
    class UnavailableWebSocket {
      constructor() {
        throw new Error('desktop unavailable')
      }
    }
    const { pi, handlers } = fakePi()
    const factory = extensionModule.createMimPiExtension({
      WebSocketImpl: UnavailableWebSocket,
      env: { MIM_PORT: '54321', MIM_TOKEN: 'token' },
    })

    await expect(factory(pi)).resolves.toBeUndefined()
    expect(pi.registerTool).not.toHaveBeenCalled()

    const ui = { setStatus: vi.fn(), setTitle: vi.fn() }
    await handlers.get('session_start')?.({ type: 'session_start' }, { ui })
    expect(ui.setStatus).toHaveBeenCalledWith('mim', 'Mim tools unavailable')
  })
})
