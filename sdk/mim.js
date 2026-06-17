// Mim Runtime SDK
// Loaded by package iframes. Connects via WebSocket to the kernel.

const _pending = new Map()
const _listeners = new Map()
let _ws = null
let _resolveReady = null
let _rejectReady = null
let _ready = null
let _packageId = null

// _ready is pending whenever the socket is down, so calls made during a
// reconnect wait for the new identified connection instead of being silently
// dropped on a closed socket (browser send() on CLOSED is a no-op).
function resetReady() {
  _ready = new Promise((resolve, reject) => { _resolveReady = resolve; _rejectReady = reject })
  // Avoid an unhandled rejection when no runtime call is awaiting ready.
  _ready.catch(() => {})
  return _ready
}

resetReady()

function connect() {
  const port = new URL(location.href).port
  _ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)

  _ws.addEventListener('open', () => {
    const params = new URLSearchParams(location.search)
    const launch = params.get('launch')
    if (launch) {
      _call('identify', { launch }, { raw: true }).then((result) => {
        _packageId = result?.packageId || null
        _resolveReady()
      }).catch((err) => {
        // Reject so runtime calls fail with the real cause instead of being
        // sent unidentified (which surfaces as the misleading
        // "Package connection is not identified").
        console.error('[mim] package identify failed:', err)
        _rejectReady(new Error(`Package identify failed: ${err.message}`))
      })
    } else {
      _resolveReady()
    }
  })

  _ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)

    // Event (no id)
    if (msg.event) {
      const cbs = _listeners.get(msg.event) || []
      cbs.forEach(cb => cb(msg.data))
      return
    }

    // Response to a request
    if (msg.id && _pending.has(msg.id)) {
      const { resolve, reject } = _pending.get(msg.id)
      _pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error))
      else resolve(msg.result)
    }
  })

  _ws.addEventListener('close', () => {
    for (const { reject } of _pending.values()) {
      reject(new Error('Runtime connection closed'))
    }
    _pending.clear()
    resetReady()
    setTimeout(connect, 1000)
  })
}

async function _call(method, params = {}, options = {}) {
  // identify runs inside the open handler, before _ready resolves.
  if (!options.raw) await _ready
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Runtime connection is not open'))
      return
    }
    _pending.set(id, { resolve, reject })
    try {
      _ws.send(JSON.stringify({ id, method, params }))
    } catch (err) {
      _pending.delete(id)
      reject(err)
    }
  })
}

connect()

export const runtime = {
  async call(tool, params = {}) {
    await _ready
    return _call(tool, params)
  },

  jobs: {
    async start(jobId, inputs = {}, options = {}) {
      await _ready
      const run = await _call('package.jobs.start', { jobId, inputs })
      // Ephemeral jobs have no run record to open; their feedback lives in the package UI.
      if (run?.ephemeral !== true && options?.openWork !== false && typeof run?.runId === 'string' && run.runId.length > 0) {
        try {
          await _call('workbench.openWork', { kind: 'package-run', runId: run.runId })
        } catch (err) {
          console.warn('[mim] failed to open package run:', err)
        }
      }
      return run
    },
    async cancel(runId) {
      await _ready
      return _call('package.jobs.cancel', { runId })
    },
    async get(runId) {
      await _ready
      return _call('package.jobs.get', { runId })
    },
    async list() {
      await _ready
      return _call('package.jobs.list', {})
    },
    on(runId, cb) {
      const handler = (event) => {
        if (event?.runId === runId) cb(event)
      }
      runtime.on('package:job:event', handler)
      return () => runtime.off('package:job:event', handler)
    },
  },

  data: {
    kv: {
      async get(key) {
        await _ready
        return _call('package.data.kv.get', { key })
      },
      async set(key, value) {
        await _ready
        return _call('package.data.kv.set', { key, value })
      },
      async delete(key) {
        await _ready
        return _call('package.data.kv.delete', { key })
      },
      async keys() {
        await _ready
        const result = await _call('package.data.kv.keys', {})
        return result.keys || []
      },
    },
    collection(name) {
      return {
        async list() {
          await _ready
          const result = await _call('package.data.collection.list', { collection: name })
          return result.records || []
        },
        async get(id) {
          await _ready
          return _call('package.data.collection.get', { collection: name, id })
        },
        async put(id, value) {
          await _ready
          return _call('package.data.collection.put', { collection: name, id, value })
        },
        async delete(id) {
          await _ready
          return _call('package.data.collection.delete', { collection: name, id })
        },
      }
    },
  },

  tools: {
    async list() {
      await _ready
      const result = await _call('package.tools.list', {})
      return result.tools || []
    },
  },

  // Manifest-declared secrets, stored in the OS keychain. UI code can store,
  // delete, and check existence; secret values are never returned to the iframe.
  // Backend jobs and tools read values through ctx.secrets.
  secrets: {
    async set(name, secret) {
      await _ready
      return _call('package.secrets.set', { name, secret })
    },
    async delete(name) {
      await _ready
      return _call('package.secrets.delete', { name })
    },
    async status() {
      await _ready
      const result = await _call('package.secrets.status', {})
      return result.secrets || []
    },
  },

  workbench: {
    async openWork(viewId) {
      await _ready
      return _call('workbench.openWork', _viewParams(viewId))
    },
    async openRun(runId) {
      await _ready
      return _call('workbench.openWork', { kind: 'package-run', runId })
    },
    async openArtifact(viewId) {
      await _ready
      return _call('workbench.openArtifact', _viewParams(viewId))
    },
  },

  ai: {
    async registry() {
      await _ready
      return _call('ai.registry', {})
    },
    async keyStatus() {
      await _ready
      return _call('ai.keyStatus', {})
    },
  },

  on(event, cb) {
    if (!_listeners.has(event)) _listeners.set(event, [])
    _listeners.get(event).push(cb)
  },

  off(event, cb) {
    const cbs = _listeners.get(event)
    if (cbs) _listeners.set(event, cbs.filter(fn => fn !== cb))
  },

  get package() {
    return { id: _packageId }
  },

  get ready() {
    return _ready
  },
}

function _viewParams(viewId) {
  if (typeof viewId === 'string' && viewId.length > 0) return { viewId }
  if (viewId && typeof viewId === 'object') {
    return typeof viewId.viewId === 'string' && viewId.viewId.length > 0
      ? { viewId: viewId.viewId }
      : {}
  }
  return {}
}
