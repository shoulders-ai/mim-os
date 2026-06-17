// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import ArchiveBrowser from './ArchiveBrowser.vue'
import { useSessionStore, type Session } from '../../stores/sessions.js'
import { useRunsStore, type AgentSessionRuntime, type PackageRunRecord } from '../../stores/runs.js'
import { useAgentsStore } from '../../stores/agents.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('ArchiveBrowser smoke', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>
  let call: ReturnType<typeof vi.fn>
  let pinia: Pinia

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    pinia = createPinia()
    setActivePinia(pinia)

    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'archive.list') {
        return {
          sessions: [
            { id: 'arch1', label: 'Refactor the auth flow', updatedAt: '2026-05-28T12:00:00.000Z', messageCount: 4, preview: 'split the login handler' },
          ],
          packageRuns: [
            { id: 'run1', packageId: 'doc-review', label: 'Review document', updatedAt: '2026-05-29T12:00:00.000Z', eventCount: 3, status: 'completed', preview: 'Wrote report' },
          ],
          agentSessions: [
            { id: 'agent-sess-1', agentId: 'claude-code', label: 'Claude Code 2', updatedAt: '2026-05-29T14:00:00.000Z', status: 'done', preview: 'refactor auth' },
          ],
        }
      }
      if (tool === 'agent.sessions.archive') {
        return { session: makeAgentSession({ sessionId: params?.sessionId as string, title: 'Claude Code 2', status: 'done', archived: params?.archived !== false }) }
      }
      if (tool === 'agent.sessions.delete') return { deleted: params?.sessionId }
      if (tool === 'search.sessions') {
        return { results: [
          { sessionId: 'active1', label: 'Active planning', excerpt: 'split the <<login>> handler', messageIdx: 1 },
        ] }
      }
      if (tool === 'session.update') return { ok: true, params }
      if (tool === 'session.get') return { id: params?.id, label: 'Refactor the auth flow', messages: [] }
      if (tool === 'session.delete') return { deleted: params?.id }
      if (tool === 'package.jobs.restore') return { run: { runId: params?.runId, packageId: 'doc-review', archived: false } }
      if (tool === 'package.jobs.delete') return { deleted: params?.runId }
      return {}
    })
    Object.defineProperty(window, 'kernel', { configurable: true, value: { call } })

    useSessionStore().sessions = [makeSession({
      id: 'active1',
      label: 'Active planning',
      messages: [{ id: 'm1', role: 'user', content: 'review active material' }],
      updatedAt: '2026-05-30T12:00:00.000Z',
    })]
    useRunsStore().setPackageRuns([makePackageRun({
      runId: 'active-run',
      label: 'Active document review',
      archived: false,
      events: [{
        type: 'job.started',
        packageId: 'doc-review',
        jobId: 'review-document',
        runId: 'active-run',
        ts: '2026-05-30T13:00:00.000Z',
        sequence: 1,
        data: { message: 'Reading document' },
      }],
    })])
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function mount(onOpenSession?: (id: string) => void) {
    app = createApp(ArchiveBrowser, onOpenSession ? { onOpenSession } : {})
    app.use(pinia)
    app.mount(root)
  }

  it('lists active and archived history on mount', async () => {
    mount()
    await flushUi()

    expect(call).toHaveBeenCalledWith('archive.list')
    expect(root.textContent).toContain('Active planning')
    expect(root.textContent).toContain('Active chat')
    expect(root.textContent).toContain('Active document review')
    expect(root.textContent).toContain('Active run / 1 event / running')
    expect(root.textContent).toContain('Refactor the auth flow')
    expect(root.textContent).toContain('split the login handler')
    expect(root.textContent).toContain('Review document')
    expect(root.textContent).toContain('Archived run / 3 events / completed')
  })

  it('restores a conversation and emits openSession when opened', async () => {
    const onOpenSession = vi.fn()
    mount(onOpenSession)
    await flushUi()

    const cards = [...root.querySelectorAll('.archive-card')]
    const sessionCard = cards.find(card => card.textContent?.includes('Refactor the auth flow')) as HTMLElement
    const openButton = [...sessionCard.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Open')
    openButton?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('session.update', { id: 'arch1', archived: false })
    expect(call).toHaveBeenCalledWith('session.get', { id: 'arch1' })
    await vi.waitFor(() => expect(onOpenSession).toHaveBeenCalledWith('arch1'))
  })

  it('deletes a freshly listed archived conversation even when it is not in the session store', async () => {
    mount()
    await flushUi()

    const cards = [...root.querySelectorAll('.archive-card')]
    const sessionCard = cards.find(card => card.textContent?.includes('Refactor the auth flow')) as HTMLElement
    const deleteButton = [...sessionCard.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Delete')
    deleteButton?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('session.get', { id: 'arch1' })
    expect(call).toHaveBeenCalledWith('session.delete', { id: 'arch1' })
  })

  it('refreshes browse results whenever the mounted History Work view becomes active', async () => {
    const active = ref(false)
    app = createApp({
      setup() {
        return () => h(ArchiveBrowser, { active: active.value })
      },
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()
    expect(call).toHaveBeenCalledTimes(1)

    active.value = true
    await flushUi()

    expect(call).toHaveBeenCalledWith('archive.list')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('refreshes browse results when the active History row is selected again', async () => {
    const refreshKey = ref(0)
    app = createApp({
      setup() {
        return () => h(ArchiveBrowser, { active: true, refreshKey: refreshKey.value })
      },
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()
    expect(call).toHaveBeenCalledTimes(1)

    refreshKey.value += 1
    await flushUi()

    expect(call).toHaveBeenCalledTimes(2)
  })

  it('switches to content search and renders highlighted matches', async () => {
    vi.useFakeTimers()
    mount()
    await flushUi()

    const input = root.querySelector('input') as HTMLInputElement
    input.value = 'login'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await vi.advanceTimersByTimeAsync(260)
    await flushUi()

    expect(call).toHaveBeenCalledWith('search.sessions', { query: 'login' })
    expect(root.querySelector('mark')?.textContent).toBe('login')
  })

  it('lists active and archived agent sessions with agent name, time, and status', async () => {
    useAgentsStore().agents = [{ id: 'claude-code', name: 'Claude Code', bin: 'claude', args: [], installed: true, binPath: '/usr/local/bin/claude' }]
    useRunsStore().setAgentSessions([makeAgentSession({
      sessionId: 'live-1',
      title: 'Claude Code',
      status: 'running',
      startedAt: '2026-05-30T14:00:00.000Z',
    })])
    mount()
    await flushUi()

    expect(root.textContent).toContain('Claude Code 2')
    expect(root.textContent).toContain('Archived agent session / Claude Code / done')
    expect(root.textContent).toContain('refactor auth')
    expect(root.textContent).toContain('Active agent session / Claude Code / running')
  })

  it('restores archived agent sessions and emits openAgentSession', async () => {
    const onOpenAgentSession = vi.fn()
    app = createApp(ArchiveBrowser, { onOpenAgentSession })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const cards = [...root.querySelectorAll('.archive-card')]
    const card = cards.find(candidate => candidate.textContent?.includes('Claude Code 2')) as HTMLElement
    const openButton = [...card.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Open')
    openButton?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('agent.sessions.archive', { sessionId: 'agent-sess-1', archived: false })
    expect(onOpenAgentSession).toHaveBeenCalledWith('claude-code', 'agent-sess-1')
    // The restored record lands in the runs store so the Activity row appears.
    expect(useRunsStore().agentSessions.some(
      session => session.sessionId === 'agent-sess-1' && session.archived === false,
    )).toBe(true)
  })

  it('deletes archived agent sessions', async () => {
    mount()
    await flushUi()

    const cards = [...root.querySelectorAll('.archive-card')]
    const card = cards.find(candidate => candidate.textContent?.includes('Claude Code 2')) as HTMLElement
    const deleteButton = [...card.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Delete')
    deleteButton?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('agent.sessions.delete', { sessionId: 'agent-sess-1' })
  })

  it('restores and opens archived package runs', async () => {
    const onOpenPackageRun = vi.fn()
    app = createApp(ArchiveBrowser, { onOpenPackageRun })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const cards = [...root.querySelectorAll('.archive-card')]
    const runCard = cards.find(card => card.textContent?.includes('Review document')) as HTMLElement
    const openButton = [...runCard.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Open')
    openButton?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('package.jobs.restore', { runId: 'run1' })
    expect(onOpenPackageRun).toHaveBeenCalledWith('doc-review', 'run1')
  })
})

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    label: 'Session',
    modelId: '',
    controlId: '',
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    lastContextTokens: 0,
    lastInputTokens: 0,
    archived: false,
    createdAt: '2026-05-30T12:00:00.000Z',
    updatedAt: '2026-05-30T12:00:00.000Z',
    ...overrides,
  }
}

function makeAgentSession(overrides: Partial<AgentSessionRuntime> = {}): AgentSessionRuntime {
  return {
    sessionId: 'agent-sess-1',
    agentId: 'claude-code',
    title: 'Claude Code',
    command: '/usr/local/bin/claude',
    cwd: '/ws',
    status: 'done',
    startedAt: '2026-05-29T13:00:00.000Z',
    endedAt: '2026-05-29T14:00:00.000Z',
    ...overrides,
  }
}

function makePackageRun(overrides: Partial<PackageRunRecord> = {}): PackageRunRecord {
  return {
    runId: 'run',
    packageId: 'doc-review',
    jobId: 'review-document',
    status: 'running',
    inputs: {},
    startedAt: '2026-05-30T13:00:00.000Z',
    events: [],
    ...overrides,
  }
}
