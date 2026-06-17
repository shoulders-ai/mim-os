import { shallowRef } from 'vue'

/**
 * Owns the per-session chat engine lifecycle, factored out of ChatView so it is
 * testable without mounting the component or pulling in the AI SDK:
 *
 *  - a cache of built engines (one per session)
 *  - in-flight build deduplication (the session watcher and handleSend can both
 *    ask for the same engine across the async hydration hop)
 *  - hydrate-before-construct ordering, so an engine is never born empty for a
 *    session that has persisted messages (the navigation race that showed an
 *    empty chat until the first send)
 *  - a reactive `activeEngine` ref; @ai-sdk/vue engines hold their own state in
 *    Vue refs, so reading `activeEngine.value.messages` downstream is reactive
 *
 * The actual engine construction is injected as `buildEngine` to keep this pure.
 *
 * @param {object} deps
 * @param {(id: string) => Promise<{messages?: unknown[]}|null>} deps.ensureMessages
 *        Resolves a session with its history loaded, or null if it cannot be found.
 * @param {(id: string, messages: unknown[], session: object) => Promise<object>} deps.buildEngine
 *        Constructs the engine (e.g. a configured @ai-sdk/vue Chat) for a session.
 * @param {(id: string) => boolean} deps.isActive
 *        Whether the given session is the currently active one.
 */
export function useChatEngines({ ensureMessages, buildEngine, isActive }) {
  const engines = new Map()
  const builds = new Map()
  const activeEngine = shallowRef(null)

  async function getOrCreate(sessionId) {
    const cached = engines.get(sessionId)
    if (cached) {
      if (isActive(sessionId)) activeEngine.value = cached
      return cached
    }
    if (builds.has(sessionId)) return builds.get(sessionId)

    const build = (async () => {
      const session = await ensureMessages(sessionId)
      if (!session) throw new Error('Session not found')
      const engine = await buildEngine(sessionId, session.messages ?? [], session)
      engines.set(sessionId, engine)
      if (isActive(sessionId)) activeEngine.value = engine
      return engine
    })().finally(() => builds.delete(sessionId))

    builds.set(sessionId, build)
    return build
  }

  // Surface a cached engine immediately (no empty flash) when switching sessions;
  // getOrCreate then hydrates+builds and reassigns activeEngine if it was a miss.
  function setActiveFromCache(sessionId) {
    activeEngine.value = sessionId ? (engines.get(sessionId) ?? null) : null
  }

  // Drop a session's engine (e.g. when archiving), clearing the active slot if
  // it was the one displayed.
  function evict(sessionId) {
    engines.delete(sessionId)
    if (isActive(sessionId)) activeEngine.value = null
  }

  return { engines, activeEngine, getOrCreate, setActiveFromCache, evict }
}
