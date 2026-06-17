// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event?: any) => void

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static identifyError: string | null = null

  listeners = new Map<string, Listener[]>()
  sent: Array<{ id: string; method: string; params: Record<string, unknown> }> = []

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  addEventListener(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }

  send(payload: string) {
    const message = JSON.parse(payload) as {
      id: string
      method: string
      params: Record<string, unknown>
    }
    this.sent.push(message)

    if (message.method === 'identify') {
      if (MockWebSocket.identifyError) {
        this.respondError(message.id, MockWebSocket.identifyError)
        return
      }
      this.respond(message.id, { clientId: 'client-1', packageId: 'reviewer' })
      return
    }

    if (message.method === 'package.jobs.start') {
      this.respond(message.id, { runId: 'run-1', status: 'running' })
      return
    }

    this.respond(message.id, { ok: true })
  }

  emit(event: string, payload?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }

  private respond(id: string, result: unknown) {
    queueMicrotask(() => {
      this.emit('message', { data: JSON.stringify({ id, result }) })
    })
  }

  private respondError(id: string, error: string) {
    queueMicrotask(() => {
      this.emit('message', { data: JSON.stringify({ id, error }) })
    })
  }
}

async function loadRuntime() {
  const module = await import('../../sdk/mim.js')
  const socket = MockWebSocket.instances.at(-1)
  if (!socket) throw new Error('SDK did not create a WebSocket')
  socket.emit('open')
  await module.runtime.ready
  return { runtime: module.runtime, socket }
}

describe('Mim runtime SDK workbench navigation', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    MockWebSocket.identifyError = null
    vi.stubGlobal('WebSocket', MockWebSocket)
    window.history.replaceState({}, '', '/packages/reviewer/index.html?launch=token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('opens a persistent package-run Work entry after starting a package job', async () => {
    const { runtime, socket } = await loadRuntime()

    const run = await runtime.jobs.start('reviewDocx', { path: 'docs/input.docx' })

    expect(run).toEqual({ runId: 'run-1', status: 'running' })
    expect(socket.sent.map(message => [message.method, message.params])).toEqual([
      ['identify', { launch: 'token' }],
      ['package.jobs.start', { jobId: 'reviewDocx', inputs: { path: 'docs/input.docx' } }],
      ['workbench.openWork', { kind: 'package-run', runId: 'run-1' }],
    ])
  })

  it('allows deliberately background package jobs without opening Work', async () => {
    const { runtime, socket } = await loadRuntime()

    await runtime.jobs.start('buildIndex', {}, { openWork: false })

    expect(socket.sent.map(message => message.method)).toEqual([
      'identify',
      'package.jobs.start',
    ])
  })

  it('rejects runtime calls when identify fails instead of calling unidentified', async () => {
    MockWebSocket.identifyError = 'Invalid package launch token'
    const module = await import('../../sdk/mim.js')
    const socket = MockWebSocket.instances.at(-1)
    if (!socket) throw new Error('SDK did not create a WebSocket')
    socket.emit('open')

    await expect(module.runtime.jobs.start('reviewDocx', {}))
      .rejects.toThrow('Invalid package launch token')
    expect(socket.sent.map(message => message.method)).toEqual(['identify'])
  })

  it('exposes an explicit openRun helper for persisted package runs', async () => {
    const { runtime, socket } = await loadRuntime()

    await runtime.workbench.openRun('run-2')

    expect(socket.sent.at(-1)).toEqual({
      id: expect.any(String),
      method: 'workbench.openWork',
      params: { kind: 'package-run', runId: 'run-2' },
    })
  })
})
