// Contract tests for the package iframe runtime SDK (sdk/mim.js).
// The WebSocket is the system boundary; everything else is the real SDK.
// The module connects at import time, so each test stubs globals first and
// fresh-imports via vi.resetModules().

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MockWebSocket {
  static instances = []
  static OPEN = 1

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.listeners = new Map()
    this.sent = []
    MockWebSocket.instances.push(this)
  }

  addEventListener(event, listener) {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }

  send(payload) {
    this.sent.push(JSON.parse(payload))
  }

  emit(event, payload) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload)
  }

  open() {
    this.readyState = MockWebSocket.OPEN
    this.emit('open')
  }

  close() {
    this.readyState = 3
    this.emit('close')
  }

  message(msg) {
    this.emit('message', { data: JSON.stringify(msg) })
  }

  // Responds to the most recent request matching method.
  respondTo(method, result) {
    const request = [...this.sent].reverse().find((msg) => msg.method === method)
    if (!request) throw new Error(`no request sent for method ${method}`)
    this.message({ id: request.id, result })
  }
}

// Flush enough microtasks for runtime.call's await chain (works under fake timers,
// unlike a setTimeout-based flush).
async function tick(times = 10) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

function stubLocation(launch) {
  const query = launch ? `?launch=${launch}` : ''
  vi.stubGlobal('location', {
    href: `http://127.0.0.1:7777/packages/demo/index.html${query}`,
    search: query,
  })
}

async function boot({ launch = 'tok-1', packageId = 'pkg-demo' } = {}) {
  stubLocation(launch)
  const mod = await import('./mim.js')
  const socket = MockWebSocket.instances.at(-1)
  if (!socket) throw new Error('SDK did not create a WebSocket')
  socket.open()
  if (launch) socket.respondTo('identify', { clientId: 'client-1', packageId })
  await mod.runtime.ready
  return { runtime: mod.runtime, socket }
}

// Drives a single typed-helper call through the wire and back.
async function roundTrip(socket, invoke, { method, params, response = { ok: true }, expected = response }) {
  const before = socket.sent.length
  const promise = invoke()
  await tick()
  expect(socket.sent.length).toBe(before + 1)
  const request = socket.sent.at(-1)
  expect(request.method).toBe(method)
  expect(request.params).toEqual(params)
  socket.message({ id: request.id, result: response })
  await expect(promise).resolves.toEqual(expected)
}

describe('mim SDK runtime', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  describe('request/response correlation', () => {
    it('resolves concurrent calls by id even when responses arrive out of order', async () => {
      const { runtime, socket } = await boot()

      const first = runtime.call('demo.one', { a: 1 })
      const second = runtime.call('demo.two', { b: 2 })
      await tick()

      const [reqOne, reqTwo] = socket.sent.slice(-2)
      expect(reqOne.method).toBe('demo.one')
      expect(reqTwo.method).toBe('demo.two')
      expect(reqOne.id).not.toBe(reqTwo.id)

      socket.message({ id: reqTwo.id, result: 'second-result' })
      socket.message({ id: reqOne.id, result: 'first-result' })

      await expect(first).resolves.toBe('first-result')
      await expect(second).resolves.toBe('second-result')
    })

    it('rejects a call with the server error and only that call', async () => {
      const { runtime, socket } = await boot()

      const failing = runtime.call('demo.fail')
      const surviving = runtime.call('demo.ok')
      await tick()

      const [failReq, okReq] = socket.sent.slice(-2)
      socket.message({ id: failReq.id, error: 'tool exploded' })

      await expect(failing).rejects.toThrow('tool exploded')

      socket.message({ id: okReq.id, result: 42 })
      await expect(surviving).resolves.toBe(42)
    })

    it('ignores responses with unknown ids without breaking pending calls', async () => {
      const { runtime, socket } = await boot()

      const pending = runtime.call('demo.op')
      await tick()
      const request = socket.sent.at(-1)

      socket.message({ id: 'no-such-request', result: 'stray' })
      socket.message({ id: request.id, result: 'real' })

      await expect(pending).resolves.toBe('real')
    })
  })

  describe('event subscription', () => {
    it('delivers events to all subscribed listeners with the event data', async () => {
      const { runtime, socket } = await boot()

      const a = vi.fn()
      const b = vi.fn()
      runtime.on('package:state', a)
      runtime.on('package:state', b)

      socket.message({ event: 'package:state', data: { phase: 'ready' } })

      expect(a).toHaveBeenCalledWith({ phase: 'ready' })
      expect(b).toHaveBeenCalledWith({ phase: 'ready' })
    })

    it('does not replay events that arrived before subscription', async () => {
      const { runtime, socket } = await boot()

      socket.message({ event: 'package:state', data: { phase: 'early' } })

      const late = vi.fn()
      runtime.on('package:state', late)
      expect(late).not.toHaveBeenCalled()

      socket.message({ event: 'package:state', data: { phase: 'later' } })
      expect(late).toHaveBeenCalledTimes(1)
      expect(late).toHaveBeenCalledWith({ phase: 'later' })
    })

    it('off() removes only the given listener; events after off are not delivered', async () => {
      const { runtime, socket } = await boot()

      const removed = vi.fn()
      const kept = vi.fn()
      runtime.on('tick', removed)
      runtime.on('tick', kept)

      runtime.off('tick', removed)
      // off() for an event that was never subscribed must be a no-op.
      runtime.off('never-subscribed', removed)

      socket.message({ event: 'tick', data: 1 })

      expect(removed).not.toHaveBeenCalled()
      expect(kept).toHaveBeenCalledWith(1)
    })

    it('jobs.on filters job events by runId and the returned function unsubscribes', async () => {
      const { runtime, socket } = await boot()

      const seen = []
      const unsubscribe = runtime.jobs.on('run-7', (event) => seen.push(event))

      socket.message({ event: 'package:job:event', data: { runId: 'run-7', status: 'running' } })
      socket.message({ event: 'package:job:event', data: { runId: 'run-other', status: 'running' } })
      expect(seen).toEqual([{ runId: 'run-7', status: 'running' }])

      unsubscribe()
      socket.message({ event: 'package:job:event', data: { runId: 'run-7', status: 'done' } })
      expect(seen).toHaveLength(1)
    })
  })

  describe('queued calls before identify completes', () => {
    it('holds runtime calls until identify resolves, then sends them', async () => {
      stubLocation('tok-queue')
      const mod = await import('./mim.js')
      const socket = MockWebSocket.instances.at(-1)
      socket.open()

      const queued = mod.runtime.call('demo.afterIdentify', { x: 1 })
      await tick()

      // Only identify is on the wire while identification is in flight.
      expect(socket.sent.map((msg) => msg.method)).toEqual(['identify'])
      expect(socket.sent[0].params).toEqual({ launch: 'tok-queue' })

      socket.respondTo('identify', { packageId: 'pkg-demo' })
      await tick()

      expect(socket.sent.map((msg) => msg.method)).toEqual(['identify', 'demo.afterIdentify'])
      socket.respondTo('demo.afterIdentify', 'done')
      await expect(queued).resolves.toBe('done')
    })
  })

  describe('reconnect after socket close', () => {
    it('rejects in-flight calls on close and reconnects after a 1s backoff', async () => {
      const { runtime, socket } = await boot()
      vi.useFakeTimers()

      const inFlight = runtime.call('demo.slow')
      await tick()
      expect(socket.sent.at(-1).method).toBe('demo.slow')

      socket.close()
      await expect(inFlight).rejects.toThrow('Runtime connection closed')

      expect(MockWebSocket.instances).toHaveLength(1)
      vi.advanceTimersByTime(999)
      expect(MockWebSocket.instances).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('keeps retrying with the same backoff if the new socket also dies', async () => {
      const { socket } = await boot()
      vi.useFakeTimers()

      socket.close()
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)

      MockWebSocket.instances.at(-1).close()
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(3)
    })

    it('queues calls made while disconnected and sends them on the re-identified socket', async () => {
      const { runtime, socket } = await boot({ packageId: 'pkg-demo' })
      vi.useFakeTimers()

      socket.close()
      const queued = runtime.call('demo.afterReconnect', { y: 2 })
      await tick()
      // Nothing sent anywhere while the connection is down.
      expect(socket.sent.filter((msg) => msg.method === 'demo.afterReconnect')).toHaveLength(0)

      vi.advanceTimersByTime(1000)
      const socket2 = MockWebSocket.instances.at(-1)
      expect(socket2).not.toBe(socket)

      socket2.open()
      expect(socket2.sent.map((msg) => msg.method)).toEqual(['identify'])
      socket2.respondTo('identify', { packageId: 'pkg-demo-v2' })
      await tick()

      const request = socket2.sent.at(-1)
      expect(request.method).toBe('demo.afterReconnect')
      expect(request.params).toEqual({ y: 2 })
      socket2.message({ id: request.id, result: 'reconnected' })
      await expect(queued).resolves.toBe('reconnected')

      // Identity follows the latest identify response.
      expect(runtime.package.id).toBe('pkg-demo-v2')
    })
  })

  describe('package identity', () => {
    it('exposes the packageId returned by identify', async () => {
      const { runtime } = await boot({ packageId: 'pkg-reviewer' })
      expect(runtime.package.id).toBe('pkg-reviewer')
    })

    it('skips identify and reports null identity when no launch token is present', async () => {
      const { runtime, socket } = await boot({ launch: null })
      expect(socket.sent).toEqual([])
      expect(runtime.package.id).toBe(null)

      // Calls still work unidentified.
      await roundTrip(socket, () => runtime.call('demo.anon'), {
        method: 'demo.anon',
        params: {},
        response: 'ok',
        expected: 'ok',
      })
    })
  })

  describe('typed helpers', () => {
    it('maps data.kv helpers to package.data.kv.* calls', async () => {
      const { runtime, socket } = await boot()

      await roundTrip(socket, () => runtime.data.kv.get('color'), {
        method: 'package.data.kv.get',
        params: { key: 'color' },
        response: { value: 'blue' },
      })
      await roundTrip(socket, () => runtime.data.kv.set('color', { hex: '#00f' }), {
        method: 'package.data.kv.set',
        params: { key: 'color', value: { hex: '#00f' } },
      })
      await roundTrip(socket, () => runtime.data.kv.delete('color'), {
        method: 'package.data.kv.delete',
        params: { key: 'color' },
      })
      await roundTrip(socket, () => runtime.data.kv.keys(), {
        method: 'package.data.kv.keys',
        params: {},
        response: { keys: ['a', 'b'] },
        expected: ['a', 'b'],
      })
      // keys() defaults to [] when the kernel omits the field.
      await roundTrip(socket, () => runtime.data.kv.keys(), {
        method: 'package.data.kv.keys',
        params: {},
        response: {},
        expected: [],
      })
    })

    it('maps collection helpers and carries the collection name on every call', async () => {
      const { runtime, socket } = await boot()
      const notes = runtime.data.collection('notes')

      await roundTrip(socket, () => notes.list(), {
        method: 'package.data.collection.list',
        params: { collection: 'notes' },
        response: { records: [{ id: 'n1' }] },
        expected: [{ id: 'n1' }],
      })
      await roundTrip(socket, () => notes.list(), {
        method: 'package.data.collection.list',
        params: { collection: 'notes' },
        response: {},
        expected: [],
      })
      await roundTrip(socket, () => notes.get('n1'), {
        method: 'package.data.collection.get',
        params: { collection: 'notes', id: 'n1' },
        response: { id: 'n1', text: 'hi' },
      })
      await roundTrip(socket, () => notes.put('n1', { text: 'hi' }), {
        method: 'package.data.collection.put',
        params: { collection: 'notes', id: 'n1', value: { text: 'hi' } },
      })
      await roundTrip(socket, () => notes.delete('n1'), {
        method: 'package.data.collection.delete',
        params: { collection: 'notes', id: 'n1' },
      })
    })

    it('maps tools, secrets, and ai helpers with their list defaults', async () => {
      const { runtime, socket } = await boot()

      await roundTrip(socket, () => runtime.tools.list(), {
        method: 'package.tools.list',
        params: {},
        response: { tools: [{ name: 'extract' }] },
        expected: [{ name: 'extract' }],
      })
      await roundTrip(socket, () => runtime.tools.list(), {
        method: 'package.tools.list',
        params: {},
        response: {},
        expected: [],
      })
      await roundTrip(socket, () => runtime.secrets.set('API_KEY', 's3cret'), {
        method: 'package.secrets.set',
        params: { name: 'API_KEY', secret: 's3cret' },
      })
      await roundTrip(socket, () => runtime.secrets.delete('API_KEY'), {
        method: 'package.secrets.delete',
        params: { name: 'API_KEY' },
      })
      await roundTrip(socket, () => runtime.secrets.status(), {
        method: 'package.secrets.status',
        params: {},
        response: { secrets: [{ name: 'API_KEY', set: true }] },
        expected: [{ name: 'API_KEY', set: true }],
      })
      await roundTrip(socket, () => runtime.ai.registry(), {
        method: 'ai.registry',
        params: {},
      })
      await roundTrip(socket, () => runtime.ai.keyStatus(), {
        method: 'ai.keyStatus',
        params: {},
      })
    })

    it('maps jobs.cancel/get/list to package.jobs.* calls', async () => {
      const { runtime, socket } = await boot()

      await roundTrip(socket, () => runtime.jobs.cancel('run-9'), {
        method: 'package.jobs.cancel',
        params: { runId: 'run-9' },
      })
      await roundTrip(socket, () => runtime.jobs.get('run-9'), {
        method: 'package.jobs.get',
        params: { runId: 'run-9' },
        response: { runId: 'run-9', status: 'done' },
      })
      await roundTrip(socket, () => runtime.jobs.list(), {
        method: 'package.jobs.list',
        params: {},
        response: { runs: [] },
      })
    })

    it('normalizes workbench view params from strings, objects, and junk', async () => {
      const { runtime, socket } = await boot()

      await roundTrip(socket, () => runtime.workbench.openWork('view-1'), {
        method: 'workbench.openWork',
        params: { viewId: 'view-1' },
      })
      await roundTrip(socket, () => runtime.workbench.openWork({ viewId: 'view-2' }), {
        method: 'workbench.openWork',
        params: { viewId: 'view-2' },
      })
      await roundTrip(socket, () => runtime.workbench.openWork({ viewId: '' }), {
        method: 'workbench.openWork',
        params: {},
      })
      await roundTrip(socket, () => runtime.workbench.openWork(undefined), {
        method: 'workbench.openWork',
        params: {},
      })
      await roundTrip(socket, () => runtime.workbench.openArtifact('art-1'), {
        method: 'workbench.openArtifact',
        params: { viewId: 'art-1' },
      })
    })
  })

  describe('jobs.start edge behavior', () => {
    it('does not open Work for ephemeral runs', async () => {
      const { runtime, socket } = await boot()

      const promise = runtime.jobs.start('quickTask', { q: 1 })
      await tick()
      socket.respondTo('package.jobs.start', { runId: 'run-eph', ephemeral: true })
      await expect(promise).resolves.toEqual({ runId: 'run-eph', ephemeral: true })
      await tick()

      expect(socket.sent.map((msg) => msg.method)).toEqual(['identify', 'package.jobs.start'])
    })

    it('still resolves with the run when opening Work fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { runtime, socket } = await boot()

      const promise = runtime.jobs.start('reviewDocx', {})
      await tick()
      socket.respondTo('package.jobs.start', { runId: 'run-3', status: 'running' })
      await tick()

      const openReq = socket.sent.at(-1)
      expect(openReq.method).toBe('workbench.openWork')
      socket.message({ id: openReq.id, error: 'no window' })

      await expect(promise).resolves.toEqual({ runId: 'run-3', status: 'running' })
      expect(warn).toHaveBeenCalled()
    })
  })
})
