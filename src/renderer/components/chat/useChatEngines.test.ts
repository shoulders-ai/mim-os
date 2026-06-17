import { describe, expect, it, vi } from 'vitest'
import { useChatEngines } from './useChatEngines.js'

// A controllable deferred so tests can interleave concurrent builds deterministically.
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('useChatEngines', () => {
  it('hydrates before constructing, and the engine is built from the hydrated messages', async () => {
    const order: string[] = []
    const ensureMessages = vi.fn(async (id: string) => {
      order.push('ensure')
      return { id, messages: [{ id: 'm1', role: 'user' }] }
    })
    const buildEngine = vi.fn(async (_id: string, messages: unknown[]) => {
      order.push('build')
      return { messages }
    })
    const { getOrCreate } = useChatEngines({ ensureMessages, buildEngine, isActive: () => false })

    const engine = await getOrCreate('s1')

    expect(order).toEqual(['ensure', 'build'])           // hydrate-before-construct
    expect(buildEngine).toHaveBeenCalledWith('s1', [{ id: 'm1', role: 'user' }], expect.anything())
    expect(engine).toEqual({ messages: [{ id: 'm1', role: 'user' }] })
  })

  it('dedupes concurrent getOrCreate calls into a single build', async () => {
    const gate = deferred<void>()
    const ensureMessages = vi.fn(async (id: string) => ({ id, messages: [] }))
    const buildEngine = vi.fn(async () => { await gate.promise; return { built: true } })
    const { getOrCreate } = useChatEngines({ ensureMessages, buildEngine, isActive: () => false })

    const a = getOrCreate('s1')
    const b = getOrCreate('s1')
    gate.resolve()
    const [ra, rb] = await Promise.all([a, b])

    expect(buildEngine).toHaveBeenCalledTimes(1)          // one build, not two
    expect(ra).toBe(rb)                                   // same instance handed to both callers
  })

  it('returns the cached engine without rebuilding', async () => {
    const ensureMessages = vi.fn(async (id: string) => ({ id, messages: [] }))
    const buildEngine = vi.fn(async () => ({ id: 'e' }))
    const { getOrCreate } = useChatEngines({ ensureMessages, buildEngine, isActive: () => false })

    const first = await getOrCreate('s1')
    const second = await getOrCreate('s1')

    expect(first).toBe(second)
    expect(buildEngine).toHaveBeenCalledTimes(1)
    expect(ensureMessages).toHaveBeenCalledTimes(1)        // no re-hydrate on cache hit
  })

  it('assigns activeEngine only when the session is active at build time', async () => {
    const ensureMessages = async (id: string) => ({ id, messages: [] })
    const buildEngine = async (id: string) => ({ id })
    const inactive = useChatEngines({ ensureMessages, buildEngine, isActive: () => false })
    await inactive.getOrCreate('bg')
    expect(inactive.activeEngine.value).toBe(null)         // background session does not steal the active slot

    const active = useChatEngines({ ensureMessages, buildEngine, isActive: () => true })
    const engine = await active.getOrCreate('fg')
    expect(active.activeEngine.value).toBe(engine)
  })

  it('setActiveFromCache surfaces a cached engine instantly and clears on null', async () => {
    const ensureMessages = async (id: string) => ({ id, messages: [] })
    const buildEngine = async (id: string) => ({ id })
    const engines = useChatEngines({ ensureMessages, buildEngine, isActive: () => false })

    const built = await engines.getOrCreate('s1')
    engines.setActiveFromCache('s1')
    expect(engines.activeEngine.value).toBe(built)         // no flash: cached engine shown immediately

    engines.setActiveFromCache('uncached')
    expect(engines.activeEngine.value).toBe(null)

    engines.setActiveFromCache(null)
    expect(engines.activeEngine.value).toBe(null)
  })

  it('evict drops the cached engine and clears the active slot when it was active', async () => {
    const ensureMessages = async (id: string) => ({ id, messages: [] })
    const buildEngine = vi.fn(async (id: string) => ({ id }))
    let activeId = 's1'
    const engines = useChatEngines({ ensureMessages, buildEngine, isActive: (id: string) => id === activeId })

    await engines.getOrCreate('s1')
    engines.setActiveFromCache('s1')
    expect(engines.activeEngine.value).not.toBe(null)

    engines.evict('s1')
    expect(engines.activeEngine.value).toBe(null)

    // A subsequent request rebuilds (cache was dropped).
    activeId = 's1'
    await engines.getOrCreate('s1')
    expect(buildEngine).toHaveBeenCalledTimes(2)
  })

  it('throws when the session cannot be resolved', async () => {
    const ensureMessages = async () => null
    const buildEngine = vi.fn(async () => ({}))
    const { getOrCreate } = useChatEngines({ ensureMessages, buildEngine, isActive: () => false })

    await expect(getOrCreate('missing')).rejects.toThrow('Session not found')
    expect(buildEngine).not.toHaveBeenCalled()
  })
})
