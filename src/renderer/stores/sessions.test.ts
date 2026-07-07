import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore, type Session, type SessionMessage } from './sessions.js'

let sessionCounter = 0

function makeSession(overrides: Partial<Session> = {}): Session {
  sessionCounter += 1
  const now = new Date(2026, 0, 1, 12, sessionCounter).toISOString()
  return {
    id: `session_${sessionCounter}`,
    label: `Chat ${sessionCounter}`,
    modelId: '',
    controlId: '',
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    lastContextTokens: 0,
    lastInputTokens: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function stubKernel(responder?: (tool: string, params?: Record<string, unknown>) => unknown | Promise<unknown>) {
  const call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
    if (responder) return responder(tool, params)
    if (tool === 'session.list') return { sessions: [] }
    if (tool === 'session.create') return makeSession({
      label: String(params?.label ?? 'New chat'),
      modelId: String(params?.modelId ?? ''),
      messages: (params?.messages as SessionMessage[]) ?? [],
    })
    if (tool === 'session.get') return makeSession({ id: String(params?.id), label: 'Loaded session' })
    if (tool === 'session.update') return { ok: true }
    if (tool === 'session.delete') return { deleted: params?.id }
    throw new Error(`Unexpected tool: ${tool}`)
  })

  vi.stubGlobal('window', {
    kernel: { call },
    setTimeout,
    clearTimeout,
  })
  return call
}

describe('renderer session store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionCounter = 0
    setActivePinia(createPinia())
    stubKernel()
  })

  it('initializes with empty Electron session state', () => {
    const store = useSessionStore()

    expect(store.sessions).toEqual([])
    expect(store.activeSessionId).toBe(null)
    expect(store.loading).toBe(false)
    expect(store.visibleSessions).toEqual([])
    expect(store.archivedSessions).toEqual([])
  })

  it('load() auto-selects and hydrates the first non-archived session with its messages', async () => {
    // session.list intentionally strips messages; the store must hydrate via session.get
    // so the active chat shows its history on launch (no "send a message to see history").
    const archived = makeSession({ id: 'archived', archived: true, updatedAt: '2026-01-03T00:00:00.000Z' })
    const active = makeSession({ id: 'active', messages: [], updatedAt: '2026-01-02T00:00:00.000Z' })
    const persisted: SessionMessage[] = [{ id: 'm1', role: 'user', content: 'earlier question' }]
    const call = stubKernel((tool, params) => {
      if (tool === 'session.list') return { sessions: [archived, active] }
      if (tool === 'session.get') {
        expect(params?.id).toBe('active')
        return makeSession({ id: 'active', messages: persisted })
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()

    await store.load()

    expect(call).toHaveBeenCalledWith('session.list')
    expect(call).toHaveBeenCalledWith('session.get', { id: 'active' })
    expect(store.activeSessionId).toBe('active')
    expect(store.activeSession?.messages).toEqual(persisted)
    expect(store.loading).toBe(false)
  })

  it('load() drops a stale active id from a previous workspace and hydrates the new first session', async () => {
    const next = makeSession({ id: 'fresh', messages: [] })
    const call = stubKernel((tool) => {
      if (tool === 'session.list') return { sessions: [next] }
      if (tool === 'session.get') return makeSession({ id: 'fresh', messages: [{ id: 'm', role: 'user', content: 'hi' }] })
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.activeSessionId = 'belongs-to-old-workspace'

    await store.load()

    expect(store.activeSessionId).toBe('fresh')
    expect(call).toHaveBeenCalledWith('session.get', { id: 'fresh' })
  })

  it('load() clears the active id when the new workspace has no sessions', async () => {
    stubKernel((tool) => {
      if (tool === 'session.list') return { sessions: [] }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.activeSessionId = 'old'

    await store.load()

    expect(store.activeSessionId).toBe(null)
    expect(store.sessions).toEqual([])
  })

  it('visible and archived session lists filter and sort current sessions', () => {
    const store = useSessionStore()
    const older = makeSession({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' })
    const newer = makeSession({ id: 'new', createdAt: '2026-01-03T00:00:00.000Z' })
    const middle = makeSession({ id: 'middle', createdAt: '2026-01-02T00:00:00.000Z' })
    const archived = makeSession({ id: 'archived', archived: true, updatedAt: '2026-01-04T00:00:00.000Z' })
    store.sessions = [older, archived, middle, newer]

    expect(store.visibleSessions.map(s => s.id)).toEqual(['new', 'middle', 'old'])
    expect(store.archivedSessions.map(s => s.id)).toEqual(['archived'])
  })

  it('create() reuses an existing empty visible session', async () => {
    const call = stubKernel()
    const store = useSessionStore()
    const empty = makeSession({ id: 'empty', messages: [] })
    store.sessions = [empty]

    const result = await store.create('model-x')

    expect(result.id).toBe('empty')
    expect(store.activeSessionId).toBe('empty')
    expect(call).not.toHaveBeenCalled()
  })

  it('create() can force a fresh session instead of reusing an empty visible session', async () => {
    const call = stubKernel((tool, params) => {
      if (tool === 'session.create') {
        return makeSession({
          id: 'created',
          label: String(params?.label),
          modelId: String(params?.modelId),
        })
      }
      if (tool === 'session.reorder') return { ok: true }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 'empty', messages: [] })]

    const result = await store.create('model-x', { reuseEmpty: false })

    expect(call).toHaveBeenCalledWith('session.create', {
      label: 'New task',
      modelId: 'model-x',
    })
    expect(result.id).toBe('created')
    expect(store.activeSessionId).toBe('created')
    expect(store.visibleSessions.map(s => s.id)).toEqual(['created', 'empty'])
  })

  it('create() promotes a reused empty session to the top', async () => {
    const call = stubKernel()
    const store = useSessionStore()
    store.sessions = [
      makeSession({ id: 'filled', sortOrder: 0, messages: [{ id: 'm1', role: 'user', content: 'sent' }] }),
      makeSession({ id: 'empty', sortOrder: 1, messages: [] }),
    ]

    const result = await store.create()

    expect(result.id).toBe('empty')
    expect(store.visibleSessions.map(s => s.id)).toEqual(['empty', 'filled'])
    expect(call).toHaveBeenCalledWith('session.reorder', { ids: ['empty', 'filled'] })
  })

  it('create() asks the kernel for a new session when no empty draft exists', async () => {
    const call = stubKernel((tool, params) => {
      if (tool === 'session.create') {
        return makeSession({
          id: 'created',
          label: String(params?.label),
          modelId: String(params?.modelId),
        })
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 'existing', messages: [{ id: 'm1', role: 'user', content: 'hi' }] })]

    const result = await store.create('model-x')

    expect(call).toHaveBeenCalledWith('session.create', {
      label: 'New task',
      modelId: 'model-x',
    })
    expect(result.id).toBe('created')
    expect(store.visibleSessions.map(s => s.id)).toEqual(['created', 'existing'])
    expect(store.activeSessionId).toBe('created')
    expect(call).toHaveBeenCalledWith('session.reorder', { ids: ['created', 'existing'] })
  })

  it('create() reuses an empty session with a saved draft', async () => {
    const call = stubKernel()
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 'empty-with-draft', messages: [] })]
    store.setDraft('empty-with-draft', 'unsent')

    const result = await store.create()

    expect(result.id).toBe('empty-with-draft')
    expect(store.activeSessionId).toBe('empty-with-draft')
    expect(call).not.toHaveBeenCalled()
  })

  it('select() marks a session viewed and replaces it with the full kernel result', async () => {
    const full = makeSession({
      id: 's1',
      label: 'Full',
      messages: [{ id: 'm1', role: 'assistant', content: 'hello' }],
    })
    const call = stubKernel((tool, params) => {
      if (tool === 'session.get') return { ...full, id: params?.id as string }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 's1', label: 'List row' })]

    await store.select('s1')

    expect(call).toHaveBeenCalledWith('session.get', { id: 's1' })
    expect(store.activeSessionId).toBe('s1')
    expect(store.sessions[0].label).toBe('Full')
    expect(store.sessions[0].messages).toHaveLength(1)
    expect(store.sessions[0].lastViewedAt).toBeTruthy()
  })

  it('ensureMessages() hydrates a listed (message-stripped) session via session.get exactly once', async () => {
    const persisted: SessionMessage[] = [{ id: 'm1', role: 'user', content: 'earlier question' }]
    const call = stubKernel((tool, params) => {
      if (tool === 'session.get') {
        expect(params?.id).toBe('s1')
        return makeSession({ id: 's1', messages: persisted })
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    // session.list strips messages — the row exists but its history is not loaded yet.
    store.sessions = [makeSession({ id: 's1', messages: [] })]

    const first = await store.ensureMessages('s1')
    expect(call).toHaveBeenCalledWith('session.get', { id: 's1' })
    expect(first?.messages).toEqual(persisted)
    expect(store.sessions[0].messages).toEqual(persisted)

    // Second call must not re-fetch: the session is already hydrated.
    call.mockClear()
    const second = await store.ensureMessages('s1')
    expect(call).not.toHaveBeenCalledWith('session.get', { id: 's1' })
    expect(second?.messages).toEqual(persisted)
  })

  it('ensureMessages() does not fetch a freshly created session (born hydrated)', async () => {
    const call = stubKernel()
    const store = useSessionStore()

    const created = await store.create()
    call.mockClear()

    const result = await store.ensureMessages(created.id)
    expect(call).not.toHaveBeenCalledWith('session.get', { id: created.id })
    expect(result?.id).toBe(created.id)
  })

  it('update() and rename() persist through session.update', async () => {
    const call = stubKernel()
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 's1', label: 'Original' })]

    await store.rename('s1', 'Renamed')
    await store.update('s1', { modelId: 'model-a' })

    expect(call).toHaveBeenCalledWith('session.update', { id: 's1', label: 'Renamed' })
    expect(call).toHaveBeenCalledWith('session.update', { id: 's1', modelId: 'model-a' })
    expect(store.sessions[0]).toMatchObject({ label: 'Renamed', modelId: 'model-a' })
  })

  it('update() merges full backend session metadata when returned', async () => {
    const persistedMessages: SessionMessage[] = [{ id: 'm1', role: 'assistant', content: 'done' }]
    const call = stubKernel((tool, params) => {
      if (tool === 'session.update') {
        return makeSession({
          id: String(params?.id),
          messages: persistedMessages,
          usage: { inputTokens: 289000, outputTokens: 4200, estimatedCost: 1.53 },
          lastContextTokens: 101000,
          updatedAt: '2026-01-05T00:00:00.000Z',
        })
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.sessions = [makeSession({
      id: 's1',
      messages: [],
      usage: { inputTokens: 1000, outputTokens: 100, estimatedCost: 0.27 },
      lastContextTokens: 1000,
    })]

    await store.update('s1', { messages: persistedMessages })

    expect(call).toHaveBeenCalledWith('session.update', { id: 's1', messages: persistedMessages })
    expect(store.sessions[0].messages).toEqual(persistedMessages)
    expect(store.sessions[0].usage.estimatedCost).toBe(1.53)
    expect(store.sessions[0].lastContextTokens).toBe(101000)
    expect(store.sessions[0].updatedAt).toBe('2026-01-05T00:00:00.000Z')
  })

  it('archive() archives a session, selects the next visible session, and creates undo state', async () => {
    const store = useSessionStore()
    const first = makeSession({ id: 'first', label: 'First', createdAt: '2026-01-01T00:00:00.000Z' })
    const second = makeSession({ id: 'second', label: 'Second', createdAt: '2026-01-02T00:00:00.000Z' })
    store.sessions = [first, second]
    store.activeSessionId = 'first'

    await store.archive('first')

    expect(first.archived).toBe(true)
    expect(store.activeSessionId).toBe('second')
    expect(store.undoToast?.message).toBe('Archived "First"')
    expect(store.undoToast?.snapshot?.id).toBe('first')
  })

  it('remove() deletes a session, selects another visible session, and creates undo state', async () => {
    const call = stubKernel()
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 'first', label: 'First' }), makeSession({ id: 'second', label: 'Second' })]
    store.activeSessionId = 'first'

    await store.remove('first')

    expect(call).toHaveBeenCalledWith('session.delete', { id: 'first' })
    expect(store.sessions.map(s => s.id)).toEqual(['second'])
    expect(store.activeSessionId).toBe('second')
    expect(store.undoToast?.message).toBe('Deleted "First"')
  })

  it('remove() deletes a persisted archived session even when the local list is stale', async () => {
    const persisted = makeSession({
      id: 'archived-stale',
      label: 'Archived stale',
      archived: true,
      messages: [{ id: 'm1', role: 'user', content: 'old context' }],
    })
    const call = stubKernel((tool, params) => {
      if (tool === 'session.get') return persisted
      if (tool === 'session.delete') return { deleted: params?.id }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 'active', label: 'Active' })]

    await store.remove('archived-stale')

    expect(call).toHaveBeenCalledWith('session.get', { id: 'archived-stale' })
    expect(call).toHaveBeenCalledWith('session.delete', { id: 'archived-stale' })
    expect(store.sessions.map(s => s.id)).toEqual(['active'])
    expect(store.undoToast?.message).toBe('Deleted "Archived stale"')
    expect(store.undoToast?.snapshot?.messages).toEqual(persisted.messages)
  })

  it('restore() unarchives through update()', async () => {
    const call = stubKernel()
    const store = useSessionStore()

    await store.restore('archived')

    expect(call).toHaveBeenCalledWith('session.update', { id: 'archived', archived: false })
  })

  it('undoLast() restores an archived session snapshot', async () => {
    const call = stubKernel()
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 'archived', archived: true })]
    store.showUndo('Archived "Chat"', { ...store.sessions[0] })

    await store.undoLast()

    expect(store.sessions[0].archived).toBe(false)
    expect(call).toHaveBeenCalledWith('session.update', { id: 'archived', archived: false })
    expect(store.undoToast).toBe(null)
  })

  it('undoLast() recreates a deleted session snapshot', async () => {
    const call = stubKernel((tool, params) => {
      if (tool === 'session.create') {
        return makeSession({
          id: 'recreated',
          label: String(params?.label),
          modelId: String(params?.modelId),
          messages: (params?.messages as SessionMessage[]) ?? [],
        })
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    const snapshot = makeSession({ id: 'deleted', label: 'Deleted', messages: [{ id: 'm1', role: 'user', content: 'hi' }] })
    store.showUndo('Deleted "Deleted"', snapshot)

    await store.undoLast()

    expect(call).toHaveBeenCalledWith('session.create', {
      label: 'Deleted',
      modelId: '',
      messages: snapshot.messages,
    })
    expect(store.sessions[0]).toMatchObject({ id: 'recreated', label: 'Deleted' })
    expect(store.undoToast).toBe(null)
  })

  it('draft helpers store and clear per-session draft text', () => {
    const store = useSessionStore()

    store.setDraft('s1', 'hello')
    expect(store.getDraft('s1')).toBe('hello')
    store.setDraft('s1', '')
    expect(store.getDraft('s1')).toBe('')
  })

  it('turn timers survive in store state until the response finishes', () => {
    const store = useSessionStore()

    store.startTurnTimer('s1', 1000)
    expect(store.turnStartedAt.s1).toBe(1000)
    expect(store.finishTurnTimer('s1', 12_345)).toBe(11_345)
    expect(store.turnStartedAt.s1).toBeUndefined()

    store.startTurnTimer('s2', 5000)
    store.clearTurnTimer('s2')
    expect(store.finishTurnTimer('s2', 8000)).toBe(null)
  })

  it('sessionStatusKind prioritizes errors, external working status, unread, done, and ready', () => {
    const store = useSessionStore()
    const ready = makeSession({ id: 'ready' })
    const errored = makeSession({ id: 'error', lastError: 'boom' })
    const working = makeSession({ id: 'working' })
    const unread = makeSession({
      id: 'unread',
      messages: [{ id: 'm1', role: 'assistant', content: 'new' }],
      lastViewedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    const done = makeSession({ id: 'done', messages: [{ id: 'm2', role: 'user', content: 'sent' }] })
    store.setSessionStatus('working', 'working')

    expect(store.sessionStatusKind(errored)).toBe('error')
    expect(store.sessionStatusKind(working)).toBe('working')
    expect(store.sessionStatusKind(unread)).toBe('unread')
    expect(store.sessionStatusKind(done)).toBe('done')
    expect(store.sessionStatusKind(ready)).toBe('ready')
  })

  it('setSessionStatus marks a session as just finished after leaving working', () => {
    const store = useSessionStore()

    store.setSessionStatus('s1', 'working')
    store.setSessionStatus('s1', 'done')

    expect(store.isJustFinished('s1')).toBe(true)
  })

  it('reorder() stores sortOrder locally and persists the ordered ids', () => {
    const call = stubKernel()
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b' }), makeSession({ id: 'c' })]

    store.reorder(['c', 'a'])

    expect(store.sessions.find(s => s.id === 'c')?.sortOrder).toBe(0)
    expect(store.sessions.find(s => s.id === 'a')?.sortOrder).toBe(1)
    expect(store.sessions.find(s => s.id === 'b')?.sortOrder).toBeUndefined()
    expect(call).toHaveBeenCalledWith('session.reorder', { ids: ['c', 'a'] })
  })

  it('create() passes agentId to session.create when provided', async () => {
    const call = stubKernel((tool, params) => {
      if (tool === 'session.create') {
        return makeSession({
          id: 'agent-session',
          label: String(params?.label),
          modelId: String(params?.modelId),
          agentId: params?.agentId as string,
        })
      }
      if (tool === 'session.reorder') return { ok: true }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.sessions = [makeSession({ id: 'existing', messages: [{ id: 'm1', role: 'user', content: 'hi' }] })]

    const result = await store.create('model-x', { agentId: 'package:research/default' })

    expect(call).toHaveBeenCalledWith('session.create', {
      label: 'New task',
      modelId: 'model-x',
      agentId: 'package:research/default',
    })
    expect(result.agentId).toBe('package:research/default')
  })

  it('create() reuses an empty session only when agentId matches', async () => {
    const call = stubKernel((tool, params) => {
      if (tool === 'session.create') {
        return makeSession({
          id: 'created',
          label: String(params?.label),
          agentId: params?.agentId as string | undefined,
        })
      }
      if (tool === 'session.reorder') return { ok: true }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    const store = useSessionStore()
    store.sessions = [
      makeSession({ id: 'empty-plain', messages: [] }),
      makeSession({ id: 'empty-agent', messages: [], agentId: 'package:research/default' }),
    ]

    // Requesting an agent session must NOT reuse the plain empty session
    const agentResult = await store.create('', { agentId: 'package:research/default' })
    expect(agentResult.id).toBe('empty-agent')
    expect(call).not.toHaveBeenCalledWith('session.create', expect.anything())
  })

  it('create() does not reuse an agent session when no agentId requested', async () => {
    const call = stubKernel()
    const store = useSessionStore()
    store.sessions = [
      makeSession({ id: 'empty-agent', messages: [], agentId: 'package:research/default' }),
    ]

    // Plain create should not reuse an agent-bound empty session
    const result = await store.create('')
    // No plain empty session exists, so it creates a new one
    expect(result.id).not.toBe('empty-agent')
  })
})
