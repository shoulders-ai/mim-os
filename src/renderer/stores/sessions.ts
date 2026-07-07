import { defineStore } from 'pinia'
import { ref, computed, reactive } from 'vue'

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  parts?: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface Session {
  id: string
  label: string
  modelId: string
  controlId: string
  agentId?: string
  messages: SessionMessage[]
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number }
  lastContextTokens: number
  lastInputTokens: number
  archived: boolean
  sortOrder?: number
  taskLabelGenerated?: boolean
  lastError?: string
  lastViewedAt?: string
  createdAt: string
  updatedAt: string
}

export type SessionStatusKind = 'working' | 'error' | 'done' | 'ready' | 'unread' | 'needs-approval'

export const useSessionStore = defineStore('sessions', () => {
  const sessions = ref<Session[]>([])
  const activeSessionId = ref<string | null>(null)
  const loading = ref(false)

  // session.list strips messages, so a listed row's empty `messages` is ambiguous
  // (genuinely empty vs. not-yet-loaded). Track which sessions have had their full
  // history loaded so ensureMessages() fetches once and never re-fetches.
  const hydratedIds = new Set<string>()

  // Per-session status set by the chat layer (ChatView updates this as it streams)
  const sessionStatuses = reactive<Record<string, SessionStatusKind>>({})

  // Track "just finished" for the Done flash
  const justFinished = reactive(new Set<string>())
  const _prevStatuses = new Map<string, SessionStatusKind>()

  // Per-session draft text, persisted to localStorage across restarts.
  const DRAFTS_KEY = 'mim:chat-drafts'
  const drafts = reactive<Record<string, string>>(loadDrafts())

  function loadDrafts(): Record<string, string> {
    try {
      const raw = localStorage.getItem(DRAFTS_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return {}
      return parsed
    } catch {
      return {}
    }
  }

  function saveDrafts() {
    try {
      const nonEmpty = Object.fromEntries(
        Object.entries(drafts).filter(([, v]) => v),
      )
      if (Object.keys(nonEmpty).length) {
        localStorage.setItem(DRAFTS_KEY, JSON.stringify(nonEmpty))
      } else {
        localStorage.removeItem(DRAFTS_KEY)
      }
    } catch {
      // localStorage may be unavailable
    }
  }

  // Per-session response timers. These are runtime state while a turn is active;
  // finished durations are saved on the assistant message metadata.
  const turnStartedAt = reactive<Record<string, number>>({})

  // Undo state — sidebar reads this for the undo toast
  const undoToast = ref<{
    message: string
    snapshot: Session | null
    timer: number
  } | null>(null)

  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value) ?? null
  )

  const visibleSessions = computed(() =>
    (Array.isArray(sessions.value) ? sessions.value : [])
      .filter(s => !s.archived)
      .sort((a, b) => {
        // Respect manual order first, then place untouched sessions by creation time.
        if (a.sortOrder !== undefined && b.sortOrder !== undefined) {
          return a.sortOrder - b.sortOrder
        }
        if (a.sortOrder !== undefined) return -1
        if (b.sortOrder !== undefined) return 1
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
  )

  const archivedSessions = computed(() =>
    (Array.isArray(sessions.value) ? sessions.value : [])
      .filter(s => s.archived)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  )

  function sessionStatusKind(session: Session): SessionStatusKind {
    if (session.lastError) return 'error'
    // External status from the chat layer takes priority
    const ext = sessionStatuses[session.id]
    if (ext === 'working') return 'working'
    if (ext === 'error') return 'error'
    // A conversation you are not looking at can be waiting on an approval; the
    // Navigator surfaces this as the "Approve" tag so the request stays findable.
    if (ext === 'needs-approval') return 'needs-approval'

    // Check for unread: has messages, status is ready, and updatedAt > lastViewedAt
    if (session.messages?.length > 0 && session.lastViewedAt) {
      const updatedTime = new Date(session.updatedAt).getTime()
      const viewedTime = new Date(session.lastViewedAt).getTime()
      if (updatedTime > viewedTime) return 'unread'
    }

    if (ext === 'done' || session.messages?.length > 0) return 'done'
    return 'ready'
  }

  function setSessionStatus(id: string, status: SessionStatusKind) {
    const prev = _prevStatuses.get(id)
    _prevStatuses.set(id, status)

    // Flash "done" when transitioning from working to non-working/non-error
    if (prev === 'working' && status !== 'working' && status !== 'error') {
      justFinished.add(id)
      setTimeout(() => justFinished.delete(id), 2100)
    }

    sessionStatuses[id] = status
  }

  function isJustFinished(id: string): boolean {
    return justFinished.has(id)
  }

  // ---- Draft persistence ----

  function getDraft(sessionId: string): string {
    return drafts[sessionId] ?? ''
  }

  function setDraft(sessionId: string, text: string) {
    if (text) {
      drafts[sessionId] = text
    } else {
      delete drafts[sessionId]
    }
    saveDrafts()
  }

  function startTurnTimer(sessionId: string, now = Date.now()) {
    turnStartedAt[sessionId] = now
  }

  function finishTurnTimer(sessionId: string, now = Date.now()): number | null {
    const startedAt = turnStartedAt[sessionId]
    delete turnStartedAt[sessionId]
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null
    return Math.max(0, now - startedAt)
  }

  function clearTurnTimer(sessionId: string) {
    delete turnStartedAt[sessionId]
  }

  function findEmptySession(agentId?: string): Session | null {
    return visibleSessions.value.find(s =>
      (!s.messages || s.messages.length === 0) && s.agentId === agentId,
    ) ?? null
  }

  function promoteToTop(id: string) {
    const currentOrder = visibleSessions.value.map(s => s.id)
    if (currentOrder[0] === id) return
    reorder([id, ...currentOrder.filter(sessionId => sessionId !== id)])
  }

  // ---- Undo toast ----

  function showUndo(message: string, snapshot: Session | null) {
    if (undoToast.value?.timer) clearTimeout(undoToast.value.timer)
    const timer = window.setTimeout(() => { undoToast.value = null }, 5000)
    undoToast.value = { message, snapshot, timer }
  }

  function clearUndo() {
    if (undoToast.value?.timer) clearTimeout(undoToast.value.timer)
    undoToast.value = null
  }

  // ---- CRUD ----

  async function load() {
    loading.value = true
    try {
      const result = await window.kernel.call('session.list') as { sessions: Session[] }
      sessions.value = Array.isArray(result?.sessions) ? result.sessions : []
      // Fresh list (possibly a new workspace): the message-stripped rows are no
      // longer hydrated. select() below re-hydrates whichever session we land on.
      hydratedIds.clear()

      // session.list strips messages and the list may belong to a freshly opened
      // workspace. Drop an active id that no longer exists here, then hydrate the
      // session we land on via select() (session.get) so its history is present
      // immediately — without it the chat shows empty until you click or send.
      const activeStillPresent = activeSessionId.value
        && sessions.value.some(s => s.id === activeSessionId.value && !s.archived)
      if (!activeStillPresent) activeSessionId.value = null

      const target = activeSessionId.value ?? sessions.value.find(s => !s.archived)?.id ?? null
      if (target) {
        await select(target)
      }
    } finally {
      loading.value = false
    }
  }

  async function create(modelId = '', options: { reuseEmpty?: boolean; agentId?: string } = {}) {
    if (options.reuseEmpty !== false) {
      const empty = findEmptySession(options.agentId)
      if (empty) {
        activeSessionId.value = empty.id
        promoteToTop(empty.id)
        hydratedIds.add(empty.id)
        return empty
      }
    }

    const currentOrder = visibleSessions.value.map(s => s.id)
    const session = await window.kernel.call('session.create', {
      label: 'New task',
      modelId,
      ...(options.agentId ? { agentId: options.agentId } : {}),
    }) as Session
    sessions.value.unshift(session)
    activeSessionId.value = session.id
    reorder([session.id, ...currentOrder])
    hydratedIds.add(session.id)
    return session
  }

  // Load a session's full history exactly once, without touching activeSessionId
  // or view state. The chat layer calls this before constructing a Chat so the
  // engine is never born empty for a session that has persisted messages.
  async function ensureMessages(id: string): Promise<Session | null> {
    const existing = sessions.value.find(s => s.id === id) ?? null
    if (existing && hydratedIds.has(id)) return existing
    try {
      const full = await window.kernel.call('session.get', { id }) as Session
      const idx = sessions.value.findIndex(s => s.id === id)
      if (idx >= 0) sessions.value[idx] = { ...sessions.value[idx], ...full }
      else if (full?.id) sessions.value.unshift(full)
      hydratedIds.add(id)
      return sessions.value.find(s => s.id === id) ?? null
    } catch {
      // session.get can fail if the file is missing; return whatever we have.
      return existing
    }
  }

  async function select(id: string) {
    activeSessionId.value = id
    // Mark as viewed
    const idx = sessions.value.findIndex(s => s.id === id)
    if (idx >= 0) {
      sessions.value[idx].lastViewedAt = new Date().toISOString()
    }
    // Load full session with messages. Merge onto the existing row so a partial or
    // empty response can never wipe a known session's id/label/messages.
    try {
      const full = await window.kernel.call('session.get', { id }) as Session
      const viewedAt = new Date().toISOString()
      const idx2 = sessions.value.findIndex(s => s.id === id)
      if (idx2 >= 0) sessions.value[idx2] = { ...sessions.value[idx2], ...full, lastViewedAt: viewedAt }
      else if (full?.id) sessions.value.unshift({ ...full, lastViewedAt: viewedAt })
      hydratedIds.add(id)
    } catch {
      // session.get can fail if file is missing
    }
  }

  async function update(id: string, data: Partial<Session>) {
    const result = await window.kernel.call('session.update', { id, ...data })
    const idx = sessions.value.findIndex(s => s.id === id)
    if (idx >= 0) {
      if (isSessionResult(result, id)) {
        sessions.value[idx] = { ...sessions.value[idx], ...result }
      } else {
        Object.assign(sessions.value[idx], data, { updatedAt: new Date().toISOString() })
      }
    }
  }

  async function rename(id: string, label: string) {
    await update(id, { label })
  }

  async function archive(id: string) {
    const session = sessions.value.find(s => s.id === id)
    if (!session) return
    // Take snapshot before archiving for undo
    const snapshot = { ...session }
    await update(id, { archived: true })
    if (activeSessionId.value === id) {
      const next = visibleSessions.value.find(s => s.id !== id)
      activeSessionId.value = next?.id ?? null
    }
    showUndo(`Archived "${session.label}"`, snapshot)
  }

  async function remove(id: string) {
    const session = sessions.value.find(s => s.id === id)
    let snapshot: Session | null = session ? { ...session } : null
    if (!snapshot) {
      try {
        snapshot = await window.kernel.call('session.get', { id }) as Session
      } catch {
        snapshot = null
      }
    }
    await window.kernel.call('session.delete', { id })
    sessions.value = sessions.value.filter(s => s.id !== id)
    if (activeSessionId.value === id) {
      activeSessionId.value = visibleSessions.value[0]?.id ?? null
    }
    if (snapshot) showUndo(`Deleted "${snapshot.label}"`, snapshot)
  }

  async function restore(id: string) {
    await update(id, { archived: false })
  }

  async function undoLast() {
    if (!undoToast.value?.snapshot) {
      clearUndo()
      return
    }
    const snapshot = undoToast.value.snapshot
    // If it was archived, restore it
    const existing = sessions.value.find(s => s.id === snapshot.id)
    if (existing) {
      // Was archived — restore
      existing.archived = false
      existing.updatedAt = new Date().toISOString()
      await window.kernel.call('session.update', { id: snapshot.id, archived: false }).catch(() => {})
    } else {
      // Was deleted — re-create
      const recreated = await window.kernel.call('session.create', {
        label: snapshot.label,
        modelId: snapshot.modelId,
        messages: snapshot.messages,
      }) as Session
      sessions.value.unshift(recreated)
    }
    clearUndo()
  }

  function reorder(sessionIds: string[]) {
    // Apply sortOrder based on the given array order
    for (let i = 0; i < sessionIds.length; i++) {
      const idx = sessions.value.findIndex(s => s.id === sessionIds[i])
      if (idx >= 0) {
        sessions.value[idx].sortOrder = i
      }
    }
    // Persist the order
    window.kernel.call('session.reorder', { ids: sessionIds }).catch(() => {})
  }

  function setSessionError(id: string, error: string) {
    const idx = sessions.value.findIndex(s => s.id === id)
    if (idx >= 0) sessions.value[idx].lastError = error
  }

  function clearSessionError(id: string) {
    const idx = sessions.value.findIndex(s => s.id === id)
    if (idx >= 0) delete sessions.value[idx].lastError
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    visibleSessions,
    archivedSessions,
    loading,
    sessionStatuses,
    justFinished,
    drafts,
    turnStartedAt,
    undoToast,
    load,
    create,
    select,
    ensureMessages,
    update,
    rename,
    archive,
    remove,
    restore,
    undoLast,
    reorder,
    sessionStatusKind,
    setSessionStatus,
    isJustFinished,
    getDraft,
    setDraft,
    setSessionError,
    clearSessionError,
    startTurnTimer,
    finishTurnTimer,
    clearTurnTimer,
    findEmptySession,
    showUndo,
    clearUndo,
  }
})

function isSessionResult(value: unknown, id: string): value is Partial<Session> & { id: string } {
  return Boolean(value && typeof value === 'object' && (value as { id?: unknown }).id === id)
}
