// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import ShellSidebar from './ShellSidebar.vue'
import { useSessionStore, type Session } from '../../stores/sessions.js'
import { useRunsStore, type AgentSessionRuntime, type PackageRunRecord } from '../../stores/runs.js'
import { useSettingsStore } from '../../stores/settings.js'
import { useAgentsStore, type DetectedAgent } from '../../stores/agents.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    label: 'Session 1',
    modelId: '',
    controlId: '',
    messages: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    lastContextTokens: 0,
    lastInputTokens: 0,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function menuButton(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll('.ctx-menu button')]
    .find(candidate => candidate.textContent?.includes(text))
  if (!button) throw new Error(`Menu button not found: ${text}`)
  return button as HTMLButtonElement
}

describe('ShellSidebar smoke', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>
  let call: ReturnType<typeof vi.fn>
  let pinia: Pinia
  let testSessions: Session[]

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    pinia = createPinia()
    setActivePinia(pinia)
    const store = useSessionStore()
    testSessions = [
      makeSession({ id: 's1', label: 'First' }),
      makeSession({ id: 's2', label: 'Second' }),
    ]
    store.sessions = testSessions
    store.activeSessionId = 's1'
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'session.list') return { sessions: testSessions }
      if (tool === 'session.update') return { ok: true, params }
      if (tool === 'session.delete') return { deleted: params?.id }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call,
        on: vi.fn(),
        off: vi.fn(),
      },
    })
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      port: 43211,
      onArchiveSession: (id: string) => useSessionStore().archive(id),
      onDeleteSession: (id: string) => useSessionStore().remove(id),
    })
    app.use(pinia)
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    document.body.querySelectorAll('.ctx-overlay').forEach(node => node.remove())
    vi.restoreAllMocks()
  })

  it('archives the session selected by the context menu', async () => {
    app.mount(root)
    await flushUi()

    root.querySelector('[data-session-id="s1"]')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 80,
      clientY: 120,
    }))
    await flushUi()
    menuButton('Archive').click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('session.update', { id: 's1', archived: true })
  })

  it('does not expose pin actions in the session context menu', async () => {
    app.mount(root)
    await flushUi()

    root.querySelector('[data-session-id="s1"]')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 80,
      clientY: 120,
    }))
    await flushUi()

    expect(document.body.querySelector('.ctx-menu')?.textContent).not.toMatch(/\b(?:Pin|Unpin)\b/i)
  })

  it('uses the whole session row as the drag target without a visible handle', async () => {
    app.mount(root)
    await flushUi()

    expect(root.querySelectorAll('.session-drag-handle')).toHaveLength(0)
    const rows = [...root.querySelectorAll('.session-row')]
    expect(rows).toHaveLength(2)
    expect(rows.some(row => row.className.includes('cursor-grab'))).toBe(false)
  })

  it('deletes the session selected by the context menu', async () => {
    app.mount(root)
    await flushUi()

    root.querySelector('[data-session-id="s2"]')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 80,
      clientY: 120,
    }))
    await flushUi()
    menuButton('Delete').click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('session.delete', { id: 's2' })
  })

  it('does not show a recent section when there are no recent workspaces', async () => {
    app.mount(root)
    await flushUi()

    ;[...root.querySelectorAll('button')]
      .find(button => button.getAttribute('title') === 'Switch workspace')
      ?.click()
    await flushUi()

    expect(document.body.textContent).toContain('Open Folder...')
    expect(document.body.textContent).not.toContain('Recent')
  })

  it('renders recent workspace names with full-path titles', async () => {
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [{ path: '/Users/test/research', name: 'research' }],
    })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    ;[...root.querySelectorAll('button')]
      .find(button => button.getAttribute('title') === 'Switch workspace')
      ?.click()
    await flushUi()

    expect(document.body.textContent).toContain('Recent')
    expect(document.body.textContent).toContain('research')
    expect(document.body.textContent).toContain('/Users/test/research')
    expect(document.body.querySelector('button[title="/Users/test/research"]')).toBeTruthy()
  })

  it('emits recent workspace selections from the workspace popover', async () => {
    const onOpenRecentWorkspace = vi.fn()
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [{ path: '/Users/test/research', name: 'research' }],
      onOpenRecentWorkspace,
    })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    ;[...root.querySelectorAll('button')]
      .find(button => button.getAttribute('title') === 'Switch workspace')
      ?.click()
    await flushUi()

    const recent = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('research')) as HTMLButtonElement | undefined
    recent?.click()

    expect(onOpenRecentWorkspace).toHaveBeenCalledWith('/Users/test/research')
  })

  it('renders core surfaces, Apps, and Activity in order', async () => {
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Project Alpha',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const text = root.textContent ?? ''
    expect(text).toContain('Apps')
    expect(text).not.toContain('Work')
    expect(text).not.toContain('Workspace')
    // Core surfaces are a fixed unlabeled cluster above the Apps section.
    expect(text.indexOf('Chat')).toBeGreaterThan(-1)
    expect(text.indexOf('Files')).toBeGreaterThan(text.indexOf('Chat'))
    expect(text).not.toContain('Editor')
    expect(text.indexOf('Terminal')).toBeGreaterThan(text.indexOf('Files'))
    expect(text.indexOf('Monitor')).toBeGreaterThan(text.indexOf('Terminal'))
    expect(text.indexOf('Apps')).toBeGreaterThan(text.indexOf('Monitor'))
    expect(text.indexOf('Activity')).toBeGreaterThan(text.indexOf('Apps'))
    // History is an Activity-header icon now, not a labeled row.
    expect(text).not.toContain('History')
    expect(text).not.toContain('Runs')
  })

  it('routes the Chat launcher through Work selection without creating a session row', async () => {
    const onSelectWork = vi.fn()
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:chat:new',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectWork,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-work-key="chat"]')?.click()
    await flushUi()

    expect(onSelectWork).toHaveBeenCalledWith('__chat__')
    expect(call.mock.calls.some(([tool]) => tool === 'session.create')).toBe(false)
  })

  it('routes the Monitor launcher to Monitor work', async () => {
    const onSelectWork = vi.fn()
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:activity-trust',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectWork,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-work-key="trust"]')?.click()
    await flushUi()

    expect(onSelectWork).toHaveBeenCalledWith('__activity_trust__')
  })

  it('marks the active core surface row so the tray confirms the live surface', async () => {
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:files',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const files = root.querySelector<HTMLElement>('[data-work-key="files"]')
    const chat = root.querySelector<HTMLElement>('[data-work-key="chat"]')

    // The active surface reads as "you are here": accent-tint row, ink label,
    // accent token. Every other core surface stays in its default state.
    expect(files?.className).toContain('bg-accent-tint')
    expect(files?.getAttribute('data-active')).toBe('true')
    expect(files?.querySelector<HTMLElement>('.nav-token')?.className).toContain('text-accent')
    expect(chat?.className).not.toContain('bg-accent-tint')
    expect(chat?.getAttribute('data-active')).toBeNull()
    expect(root.querySelector('[data-testid="editor-row"]')).toBeNull()
  })

  it('collapses Apps and Activity independently without triggering header actions', async () => {
    const onSelectWork = vi.fn()
    const onManageApps = vi.fn()
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [{
        manifest: { id: 'docx-review', name: 'DOCX Review', icon: 'D', views: [{ id: 'main', label: 'DOCX Review', src: './ui/index.html', role: 'work' }] },
        dir: '/packages/docx-review',
        source: 'mim',
      }],
      activeWorkId: '',
      workspaceName: 'Project',
      recentWorkspaces: [],
      onSelectWork,
      onManageApps,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="section-toggle-apps"]')?.click()
    await flushUi()

    // Collapsing Apps hides app rows only; core surfaces are fixed rows.
    expect(root.textContent).not.toContain('DOCX Review')
    expect(root.textContent).toContain('Files')
    expect(root.textContent).toContain('Chat')
    expect(root.textContent).toContain('First')
    expect(onSelectWork).not.toHaveBeenCalled()

    root.querySelector<HTMLButtonElement>('[data-testid="section-toggle-apps"]')?.click()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="section-toggle-activity"]')?.click()
    await flushUi()

    expect(root.textContent).toContain('Files')
    expect(root.textContent).toContain('DOCX Review')
    expect(root.textContent).toContain('Chat')
    expect(root.textContent).not.toContain('First')
    expect(onSelectWork).not.toHaveBeenCalled()

    root.querySelector<HTMLButtonElement>('[data-testid="manage-apps"]')?.click()
    expect(onManageApps).toHaveBeenCalledOnce()

    root.querySelector<HTMLButtonElement>('[data-testid="activity-history"]')?.click()
    expect(onSelectWork).toHaveBeenCalledWith('__archive__')
  })

  it('routes Navigator section clicks through Work selection', async () => {
    const onSelectWork = vi.fn()
    const onManageApps = vi.fn()
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [
        {
          manifest: {
            id: 'docx-review',
            name: 'DOCX Review',
            icon: 'D',
            views: [{ id: 'main', label: 'DOCX Review', src: './ui/index.html', role: 'work' }],
          },
          dir: '/home/test/.mim/packages/docx-review/0.1.0',
          source: 'mim',
        },
        {
          manifest: {
            id: 'runtime-demo',
            name: 'Runtime Demo',
            icon: 'R',
            views: [{ id: 'main', label: 'Runtime', src: './ui/index.html', role: 'work' }],
          },
          dir: '/home/test/.mim/packages/runtime-demo/0.1.0',
          source: 'mim',
        },
      ],
      activeWorkId: 'work:files',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectWork,
      onManageApps,
    })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    ;[...root.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Terminal'))
      ?.click()
    ;[...root.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Files'))
      ?.click()
    ;[...root.querySelectorAll('button')]
      .find(button => button.textContent?.includes('DOCX Review'))
      ?.click()
    root.querySelector<HTMLButtonElement>('[data-testid="manage-apps"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-testid="activity-history"]')?.click()

    expect(onSelectWork).toHaveBeenCalledWith('__terminal__')
    expect(onSelectWork).toHaveBeenCalledWith('__files__')
    expect(onSelectWork).toHaveBeenCalledWith('docx-review')
    expect(onManageApps).toHaveBeenCalledOnce()
    expect(onSelectWork).toHaveBeenCalledWith('__archive__')
    expect(onSelectWork).not.toHaveBeenCalledWith('runtime-demo')
  })

  it('puts new unordered activity rows above manually ordered rows', async () => {
    useSettingsStore().navigatorActivityOrder = ['chat:s1']
    testSessions = [
      makeSession({ id: 's1', label: 'Ordered old', updatedAt: '2026-01-01T00:00:00.000Z' }),
      makeSession({ id: 's2', label: 'Newer unordered', updatedAt: '2026-01-02T00:00:00.000Z' }),
    ]
    useSessionStore().sessions = testSessions

    app.mount(root)
    await flushUi()

    const labels = [...root.querySelectorAll('.activity-list [data-activity-key]')]
      .map(row => row.textContent ?? '')
    expect(labels[0]).toContain('Newer unordered')
    expect(labels[1]).toContain('Ordered old')
  })

  it('orders app rows manually and hides demo apps from the Navigator', async () => {
    useSettingsStore().navigatorAppOrder = ['slack-digest', 'docx-review']
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [
        {
          manifest: { id: 'docx-review', name: 'DOCX Review', icon: 'D', views: [{ id: 'main', label: 'DOCX Review', src: './ui/index.html', role: 'work' }] },
          dir: '/home/test/.mim/packages/docx-review/0.1.0',
          source: 'mim',
        },
        {
          manifest: { id: 'slack-digest', name: 'Slack Digest', icon: 'S', views: [{ id: 'main', label: 'Slack Digest', src: './ui/index.html', role: 'work' }] },
          dir: '/workspace/packages/slack-digest',
          source: 'project',
        },
        {
          manifest: { id: 'runtime-demo', name: 'Runtime Demo', icon: 'R', views: [{ id: 'main', label: 'Runtime', src: './ui/index.html', role: 'work' }] },
          dir: '/home/test/.mim/packages/runtime-demo/0.1.0',
          source: 'mim',
        },
      ],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const rows = [...root.querySelectorAll('.app-list [data-app-key]')]
      .map(row => (row as HTMLElement).dataset.appKey)
    expect(rows).toEqual(['slack-digest', 'docx-review'])
    expect(root.textContent).not.toContain('Runtime Demo')
    // Core surfaces are not part of the app order.
    expect(root.querySelector('.app-list [data-work-key]')).toBeNull()
  })

  it('routes app runs through app-run Work selection', async () => {
    const onSelectPackageRun = vi.fn()
    const runsStore = useRunsStore()
    const packageRun: PackageRunRecord = {
      runId: 'run-review-1',
      packageId: 'doc-review',
      jobId: 'review-document',
      status: 'running',
      inputs: {},
      startedAt: '2026-01-01T00:10:00.000Z',
      events: [],
    }
    runsStore.setPackageRuns([packageRun])

    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:files',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectPackageRun,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const row = root.querySelector('[data-run-id="package:run-review-1"]') as HTMLButtonElement | null
    expect(row?.textContent).toContain('doc-review / review-document')
    row?.click()

    expect(onSelectPackageRun).toHaveBeenCalledWith('doc-review', 'run-review-1')
  })

  it('routes routine runs through their chat transcript without duplicating them as chat rows', async () => {
    const onSelectSession = vi.fn()
    testSessions = [
      makeSession({
        id: 'routine-session',
        label: 'Routine: pulse',
        routineId: 'pulse',
        routineRunId: 'routine-run-1',
        routineStatus: 'working',
      }),
    ]
    useSessionStore().sessions = testSessions

    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:chat:routine-session',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectSession,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const row = root.querySelector('[data-run-id="routine:routine-run-1"]') as HTMLButtonElement | null
    expect(row?.textContent).toContain('Routine: pulse')
    expect(row?.className).toContain('bg-accent-tint')
    expect(root.querySelector('[data-session-id="routine-session"]')).toBeNull()
    row?.click()

    expect(onSelectSession).toHaveBeenCalledWith('routine-session')
  })

  it('opens History and new chats from the Activity header', async () => {
    const onSelectWork = vi.fn()
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectWork,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    // History lives on the Activity header, not as a navigation row.
    expect(root.querySelector('[data-testid="history-row"]')).toBeNull()

    const history = root.querySelector<HTMLButtonElement>('[data-testid="activity-history"]')
    expect(history?.getAttribute('title')).toBe('History')
    history?.click()
    expect(onSelectWork).toHaveBeenCalledWith('__archive__')

    const newChat = root.querySelector<HTMLButtonElement>('[data-testid="activity-new-chat"]')
    expect(newChat?.getAttribute('title')).toBe('New chat')
    newChat?.click()
    expect(onSelectWork).toHaveBeenCalledWith('__chat__')
    // The header affordance opens the draft composer; no session is created.
    expect(call.mock.calls.some(([tool]) => tool === 'session.create')).toBe(false)
  })

  it('opens an Activity create menu when a CLI agent is available', async () => {
    const onSelectWork = vi.fn()
    const onLaunchAgent = vi.fn()
    useAgentsStore().agents = [makeAgent()]
    useSettingsStore().enabledAgents = ['claude-code']
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:agent-session:sess-1',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectWork,
      onLaunchAgent,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const create = root.querySelector<HTMLButtonElement>('[data-testid="activity-new-chat"]')
    expect(create?.getAttribute('title')).toBe('New activity')
    create?.click()
    await flushUi()

    expect(onSelectWork).not.toHaveBeenCalled()
    const menu = document.body.querySelector('[data-testid="activity-create-menu"]')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('New chat')
    expect(menu?.textContent).toContain('Claude Code')
    expect(menu?.textContent).not.toContain('New Claude Code session')
    expect(menu?.textContent).not.toContain('CLI tools')
    expect(menu?.textContent).not.toContain('Apps')
    expect(menu?.querySelector('[data-testid="activity-create-divider"]')).toBeNull()

    document.body.querySelector<HTMLButtonElement>('[data-testid="activity-create-agent-claude-code"]')?.click()
    expect(onLaunchAgent).toHaveBeenCalledWith('claude-code')

    create?.click()
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="activity-create-chat"]')?.click()
    expect(onSelectWork).toHaveBeenCalledWith('__chat__')
  })

  it('offers active app activity targets from the Activity create menu without visible section labels', async () => {
    const onSelectWork = vi.fn()
    useRunsStore().setPackageRuns([{
      runId: 'run-review-1',
      packageId: 'doc-review',
      jobId: 'review-document',
      status: 'running',
      inputs: {},
      startedAt: '2026-01-01T00:10:00.000Z',
      events: [],
    }])
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [{
        manifest: { id: 'doc-review', name: 'DOCX Review', icon: 'D', views: [{ id: 'main', label: 'DOCX Review', src: './ui/index.html', role: 'work' }] },
        dir: '/packages/doc-review',
        source: 'mim',
      }],
      activeWorkId: 'work:package-run:doc-review:run-review-1',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectWork,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="activity-new-chat"]')?.click()
    await flushUi()

    const menu = document.body.querySelector('[data-testid="activity-create-menu"]')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('DOCX Review')
    expect(menu?.textContent).not.toContain('Open DOCX Review')
    expect(menu?.textContent).not.toContain('CLI tools')
    expect(menu?.textContent).not.toContain('Apps')
    expect(menu?.querySelector('[data-testid="activity-create-divider"]')).toBeNull()

    document.body.querySelector<HTMLButtonElement>('[data-testid="activity-create-package-doc-review"]')?.click()
    expect(onSelectWork).toHaveBeenCalledWith('doc-review')
  })

  it('uses a thin divider when the Activity create menu has CLI and app targets', async () => {
    useAgentsStore().agents = [makeAgent()]
    useSettingsStore().enabledAgents = ['claude-code']
    useRunsStore().setPackageRuns([{
      runId: 'run-review-1',
      packageId: 'doc-review',
      jobId: 'review-document',
      status: 'running',
      inputs: {},
      startedAt: '2026-01-01T00:10:00.000Z',
      events: [],
    }])
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [{
        manifest: { id: 'doc-review', name: 'DOCX Review', icon: 'D', views: [{ id: 'main', label: 'DOCX Review', src: './ui/index.html', role: 'work' }] },
        dir: '/packages/doc-review',
        source: 'mim',
      }],
      activeWorkId: 'work:package-run:doc-review:run-review-1',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="activity-new-chat"]')?.click()
    await flushUi()

    const menu = document.body.querySelector('[data-testid="activity-create-menu"]')
    expect(menu?.textContent).toContain('Claude Code')
    expect(menu?.textContent).toContain('DOCX Review')
    expect(menu?.querySelector('[data-testid="activity-create-divider"]')).not.toBeNull()
  })

  it('offers archive and delete commands for app run rows', async () => {
    const onArchivePackageRun = vi.fn()
    const onDeletePackageRun = vi.fn()
    const runsStore = useRunsStore()
    runsStore.setPackageRuns([{
      runId: 'run-review-1',
      packageId: 'doc-review',
      jobId: 'review-document',
      status: 'completed',
      inputs: {},
      startedAt: '2026-01-01T00:10:00.000Z',
      events: [],
    }])

    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:files',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onArchivePackageRun,
      onDeletePackageRun,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const row = root.querySelector('[data-run-id="package:run-review-1"]') as HTMLButtonElement | null
    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await flushUi()

    document.body.querySelector<HTMLButtonElement>('[data-testid="run-context-archive"]')?.click()
    expect(onArchivePackageRun).toHaveBeenCalledWith('doc-review', 'run-review-1')

    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="run-context-delete"]')?.click()
    expect(onDeletePackageRun).toHaveBeenCalledWith('doc-review', 'run-review-1')
  })

  function clickRow(selector: string, init: MouseEventInit = {}) {
    root.querySelector(selector)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  }

  function selectedKeys(): string[] {
    return [...root.querySelectorAll('[data-selected="true"]')]
      .map(el => (el as HTMLElement).dataset.sessionId ?? (el as HTMLElement).dataset.runId ?? '')
  }

  it('multi-selects activity rows with cmd-click without navigating', async () => {
    const onSelectSession = vi.fn()
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectSession,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    clickRow('[data-session-id="s1"]', { metaKey: true })
    await flushUi()
    expect(selectedKeys()).toEqual(['s1'])
    expect(onSelectSession).not.toHaveBeenCalled()

    clickRow('[data-session-id="s2"]', { metaKey: true })
    await flushUi()
    expect(selectedKeys()).toEqual(['s1', 's2'])

    // Cmd-click toggles a selected row back off.
    clickRow('[data-session-id="s1"]', { metaKey: true })
    await flushUi()
    expect(selectedKeys()).toEqual(['s2'])

    // A plain click clears the selection and navigates as usual.
    clickRow('[data-session-id="s1"]')
    await flushUi()
    expect(selectedKeys()).toEqual([])
    expect(onSelectSession).toHaveBeenCalledWith('s1')
  })

  it('selects an activity range with shift-click', async () => {
    testSessions = [
      makeSession({ id: 's1', label: 'First' }),
      makeSession({ id: 's2', label: 'Second' }),
      makeSession({ id: 's3', label: 'Third' }),
    ]
    useSessionStore().sessions = testSessions
    app.mount(root)
    await flushUi()

    clickRow('[data-session-id="s1"]', { metaKey: true })
    clickRow('[data-session-id="s3"]', { shiftKey: true })
    await flushUi()

    expect(selectedKeys()).toEqual(['s1', 's2', 's3'])
  })

  it('batch-archives a mixed selection from the context menu', async () => {
    const onArchivePackageRun = vi.fn()
    useRunsStore().setPackageRuns([{
      runId: 'run-review-1',
      packageId: 'doc-review',
      jobId: 'review-document',
      status: 'completed',
      inputs: {},
      startedAt: '2026-01-01T00:10:00.000Z',
      events: [],
    }])
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onArchiveSession: (id: string) => useSessionStore().archive(id),
      onArchivePackageRun,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    clickRow('[data-session-id="s1"]', { metaKey: true })
    clickRow('[data-session-id="s2"]', { metaKey: true })
    clickRow('[data-run-id="package:run-review-1"]', { metaKey: true })
    await flushUi()
    expect(selectedKeys()).toHaveLength(3)

    root.querySelector('[data-session-id="s1"]')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 80,
      clientY: 120,
    }))
    await flushUi()

    // Batch menu replaces the single-row menu for a multi-selection.
    expect(document.body.querySelector('.ctx-menu')?.textContent).not.toContain('Rename')
    document.body.querySelector<HTMLButtonElement>('[data-testid="batch-archive"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('session.update', { id: 's1', archived: true })
    expect(call).toHaveBeenCalledWith('session.update', { id: 's2', archived: true })
    expect(onArchivePackageRun).toHaveBeenCalledWith('doc-review', 'run-review-1')
    expect(selectedKeys()).toEqual([])
  })

  it('keeps the single-row menu when right-clicking outside the selection', async () => {
    app.mount(root)
    await flushUi()

    clickRow('[data-session-id="s1"]', { metaKey: true })
    await flushUi()

    root.querySelector('[data-session-id="s2"]')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 80,
      clientY: 120,
    }))
    await flushUi()

    expect(document.body.querySelector('.ctx-menu')?.textContent).toContain('Rename')
    // Right-clicking outside the selection drops it, like Finder.
    expect(selectedKeys()).toEqual([])
  })

  it('clears the activity selection with Escape', async () => {
    app.mount(root)
    await flushUi()

    clickRow('[data-session-id="s1"]', { metaKey: true })
    await flushUi()
    expect(selectedKeys()).toEqual(['s1'])

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushUi()
    expect(selectedKeys()).toEqual([])
  })

  function makeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
    return {
      id: 'claude-code',
      name: 'Claude Code',
      bin: 'claude',
      args: [],
      installed: true,
      binPath: '/usr/local/bin/claude',
      ...overrides,
    }
  }

  function makeAgentSession(overrides: Partial<AgentSessionRuntime> = {}): AgentSessionRuntime {
    return {
      sessionId: 'sess-1',
      agentId: 'claude-code',
      title: 'Claude Code',
      command: '/usr/local/bin/claude',
      cwd: '/ws',
      status: 'running',
      startedAt: '2026-01-01T00:10:00.000Z',
      ...overrides,
    }
  }

  it('renders enabled installed agents as launcher rows after app launchers', async () => {
    const onLaunchAgent = vi.fn()
    useAgentsStore().agents = [
      makeAgent(),
      makeAgent({ id: 'codex', name: 'Codex', bin: 'codex', installed: false, binPath: undefined }),
      makeAgent({ id: 'gemini-cli', name: 'Gemini CLI', bin: 'gemini', binPath: '/usr/local/bin/gemini' }),
    ]
    // Agents are opt-in (Settings → Apps): installed-but-not-enabled stays hidden.
    useSettingsStore().enabledAgents = ['claude-code']
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [{
        manifest: { id: 'docx-review', name: 'DOCX Review', icon: 'D', views: [{ id: 'main', label: 'DOCX Review', src: './ui/index.html', role: 'work' }] },
        dir: '/packages/docx-review',
        source: 'mim',
      }],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onLaunchAgent,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const rows = [...root.querySelectorAll('.app-list [data-app-key]')]
      .map(row => (row as HTMLElement).dataset.appKey)
    expect(rows).toEqual(['docx-review', 'claude-code'])
    // Not installed on this machine → no launcher row.
    expect(root.textContent).not.toContain('Codex')
    // Installed but not enabled in settings → no launcher row either.
    expect(root.textContent).not.toContain('Gemini CLI')

    // Launcher semantics: every click is a new session, never a toggle.
    const row = root.querySelector<HTMLButtonElement>('[data-app-key="claude-code"]')
    expect(row?.textContent).toContain('Claude Code')
    row?.click()
    row?.click()
    expect(onLaunchAgent).toHaveBeenNthCalledWith(1, 'claude-code')
    expect(onLaunchAgent).toHaveBeenNthCalledWith(2, 'claude-code')
  })

  it('routes agent session rows through agent-session Work selection with a status tag', async () => {
    const onSelectAgentSession = vi.fn()
    useRunsStore().setAgentSessions([makeAgentSession()])
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:files',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onSelectAgentSession,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const row = root.querySelector('[data-run-id="agent:sess-1"]') as HTMLButtonElement | null
    expect(row?.textContent).toContain('Claude Code')
    expect(row?.querySelector('[aria-label="Working"]')).toBeTruthy()
    row?.click()

    expect(onSelectAgentSession).toHaveBeenCalledWith('claude-code', 'sess-1')
  })

  it('highlights the agent session Activity row when its Work entry is active', async () => {
    useRunsStore().setAgentSessions([makeAgentSession()])
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:agent-session:sess-1',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const row = root.querySelector('[data-run-id="agent:sess-1"]') as HTMLElement | null
    expect(row?.className).toContain('bg-accent-tint')
  })

  it('highlights the app run Activity row when its Work entry is active', async () => {
    useRunsStore().setPackageRuns([{
      runId: 'run-1',
      packageId: 'doc-review',
      jobId: 'review',
      status: 'running',
      inputs: {},
      startedAt: '2026-01-01T00:10:00.000Z',
      events: [],
    }])
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:package-run:doc-review:run-1',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const row = root.querySelector('[data-run-id="package:run-1"]') as HTMLElement | null
    expect(row?.className).toContain('bg-accent-tint')
  })

  it('shows a plus icon on agent launcher rows but not app launcher rows', async () => {
    useAgentsStore().agents = [makeAgent()]
    useSettingsStore().enabledAgents = ['claude-code']
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [{
        manifest: { id: 'docx-review', name: 'DOCX Review', icon: 'D', views: [{ id: 'main', label: 'DOCX Review', src: './ui/index.html', role: 'work' }] },
        dir: '/packages/docx-review',
        source: 'mim',
      }],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const agentRow = root.querySelector('[data-agent-id="claude-code"]')
    const packageRow = root.querySelector('[data-package-id="docx-review"]')
    expect(agentRow?.querySelector('svg')).not.toBeNull()
    expect(packageRow?.querySelector('svg')).toBeNull()
  })

  it('offers stop while an agent session runs and archive/delete once it ended', async () => {
    const onStopAgentSession = vi.fn()
    const onArchiveAgentSession = vi.fn()
    const onDeleteAgentSession = vi.fn()
    useRunsStore().setAgentSessions([
      makeAgentSession(),
      makeAgentSession({ sessionId: 'sess-2', title: 'Claude Code 2', status: 'done', endedAt: '2026-01-01T00:20:00.000Z' }),
    ])
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:files',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onStopAgentSession,
      onArchiveAgentSession,
      onDeleteAgentSession,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    // Running: Stop is offered, Delete is not (running sessions must be stopped first).
    const running = root.querySelector('[data-run-id="agent:sess-1"]') as HTMLButtonElement | null
    running?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await flushUi()
    expect(document.body.querySelector('[data-testid="run-context-delete"]')).toBeNull()
    document.body.querySelector<HTMLButtonElement>('[data-testid="run-context-stop"]')?.click()
    expect(onStopAgentSession).toHaveBeenCalledWith('sess-1')
    await flushUi()

    // Ended: Stop is gone; Archive and Delete carry the session id.
    const ended = root.querySelector('[data-run-id="agent:sess-2"]') as HTMLButtonElement | null
    ended?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await flushUi()
    expect(document.body.querySelector('[data-testid="run-context-stop"]')).toBeNull()
    document.body.querySelector<HTMLButtonElement>('[data-testid="run-context-archive"]')?.click()
    expect(onArchiveAgentSession).toHaveBeenCalledWith('sess-2')
    await flushUi()

    ended?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="run-context-delete"]')?.click()
    expect(onDeleteAgentSession).toHaveBeenCalledWith('sess-2')
  })

  it('renames agent session rows from the context menu', async () => {
    const session = makeAgentSession({ status: 'done', endedAt: '2026-01-01T00:20:00.000Z' })
    useRunsStore().setAgentSessions([session])
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'session.list') return { sessions: testSessions }
      if (tool === 'agent.sessions.rename') {
        return { session: { ...session, title: params?.title } }
      }
      return {}
    })

    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:files',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const row = root.querySelector('[data-run-id="agent:sess-1"]') as HTMLButtonElement | null
    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="run-context-rename"]')?.click()
    await flushUi()

    const input = root.querySelector<HTMLInputElement>('[data-testid="run-rename-input"]')
    expect(input).not.toBeNull()
    input!.value = 'Auth refactor agent'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()

    expect(call).toHaveBeenCalledWith('agent.sessions.rename', { sessionId: 'sess-1', title: 'Auth refactor agent' })
    expect(root.textContent).toContain('Auth refactor agent')
  })

  it('batch-archives selections that include agent session rows', async () => {
    const onArchiveAgentSession = vi.fn()
    useRunsStore().setAgentSessions([makeAgentSession({ status: 'done', endedAt: '2026-01-01T00:20:00.000Z' })])
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      onArchiveSession: (id: string) => useSessionStore().archive(id),
      onArchiveAgentSession,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    clickRow('[data-session-id="s1"]', { metaKey: true })
    clickRow('[data-run-id="agent:sess-1"]', { metaKey: true })
    await flushUi()
    expect(selectedKeys()).toHaveLength(2)

    root.querySelector('[data-session-id="s1"]')?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 80,
      clientY: 120,
    }))
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="batch-archive"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('session.update', { id: 's1', archived: true })
    expect(onArchiveAgentSession).toHaveBeenCalledWith('sess-1')
  })

  it('renames app run rows from the context menu', async () => {
    const packageRun: PackageRunRecord = {
      runId: 'run-review-1',
      packageId: 'doc-review',
      jobId: 'review-document',
      status: 'completed',
      inputs: {},
      startedAt: '2026-01-01T00:10:00.000Z',
      events: [],
    }
    useRunsStore().setPackageRuns([packageRun])
    call.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'session.list') return { sessions: testSessions }
      if (tool === 'package.jobs.rename') {
        return { run: { ...packageRun, label: params?.label } }
      }
      return {}
    })

    app = createApp(ShellSidebar, {
      width: 220,
      packages: [],
      activeWorkId: 'work:files',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    const row = root.querySelector('[data-run-id="package:run-review-1"]') as HTMLButtonElement | null
    row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="run-context-rename"]')?.click()
    await flushUi()

    const input = root.querySelector<HTMLInputElement>('[data-testid="run-rename-input"]')
    expect(input).not.toBeNull()
    input!.value = 'Contract review'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushUi()

    expect(call).toHaveBeenCalledWith('package.jobs.rename', { runId: 'run-review-1', label: 'Contract review' })
    expect(root.textContent).toContain('Contract review')
  })

  it('renders an image-icon app as a masked mark and a text-icon app as its token', async () => {
    app = createApp(ShellSidebar, {
      width: 220,
      packages: [
        {
          manifest: { id: 'github-monitor', name: 'GitHub Monitor', icon: './ui/icon.svg', views: [{ id: 'main', label: 'GitHub', src: './ui/index.html', role: 'work' }] },
          dir: '/packages/github-monitor',
          source: 'mim',
        },
        {
          manifest: { id: 'board', name: 'Board', icon: 'B', views: [{ id: 'main', label: 'Board', src: './ui/index.html', role: 'work' }] },
          dir: '/packages/board',
          source: 'mim',
        },
      ],
      activeWorkId: '',
      workspaceName: 'Workspace',
      recentWorkspaces: [],
      port: 43211,
    })
    app.use(pinia)
    app.mount(root)
    await flushUi()

    // Image icon: a masked span carrying the served asset URL, no v-html text.
    const ghToken = root.querySelector('[data-package-id="github-monitor"] .nav-token')
    const ghImg = ghToken?.querySelector<HTMLElement>('.package-icon-img')
    expect(ghImg).not.toBeNull()
    expect(ghImg!.style.getPropertyValue('--icon-url')).toContain('url(')
    expect(ghImg!.style.getPropertyValue('--icon-url')).toContain('/packages/github-monitor/icon.svg')
    expect(ghToken!.textContent).not.toContain('icon.svg')

    // Text icon: the letter token still renders as before.
    const boardToken = root.querySelector('[data-package-id="board"] .nav-token')
    expect(boardToken?.querySelector('.package-icon-img')).toBeNull()
    expect(boardToken?.textContent?.trim()).toBe('B')
  })
})
