// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import AgentSessionView from './AgentSessionView.vue'
import { useRunsStore, type AgentSessionRuntime } from '../../stores/runs.js'
import { useAgentsStore } from '../../stores/agents.js'

vi.mock('../terminal/TerminalSurface.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'TerminalSurfaceStub',
      props: ['ptyId', 'replay', 'keybindingProfile'],
      emits: ['exited', 'input'],
      setup(props) {
        return () => h('div', {
          'data-testid': 'terminal-surface',
          'data-pty-id': props.ptyId != null ? String(props.ptyId) : '',
          'data-replay': props.replay ?? '',
          'data-mode': props.replay != null ? 'replay' : 'live',
          'data-keybinding-profile': props.keybindingProfile ?? '',
        })
      },
    }),
  }
})

function makeSession(overrides: Partial<AgentSessionRuntime> = {}): AgentSessionRuntime {
  return {
    sessionId: 's1',
    agentId: 'claude-code',
    title: 'Claude Code',
    command: '/usr/local/bin/claude',
    cwd: '/workspace',
    status: 'running',
    startedAt: '2026-06-12T10:00:00.000Z',
    ptyId: 11,
    runtimeStatus: 'working',
    ...overrides,
  }
}

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('AgentSessionView', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let pinia: Pinia
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    pinia = createPinia()
    setActivePinia(pinia)
    call = vi.fn(async () => ({}))
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })
    useAgentsStore().agents = [{
      id: 'claude-code',
      name: 'Claude Code',
      bin: 'claude',
      args: [],
      installed: true,
      binPath: '/usr/local/bin/claude',
    }, {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      bin: 'gemini',
      args: [],
      installed: true,
      binPath: '/usr/local/bin/gemini',
    }, {
      id: 'pi',
      name: 'Pi',
      bin: 'pi',
      args: [],
      installed: true,
      binPath: '/usr/local/bin/pi',
    }]
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.restoreAllMocks()
  })

  function mountView(
    props: { agentId?: string; sessionId?: string } = {},
    listeners: Record<string, unknown> = {},
  ) {
    app = createApp({
      setup() {
        return () => h(AgentSessionView, {
          agentId: 'claude-code',
          sessionId: 's1',
          ...props,
          ...listeners,
        })
      },
    })
    app.use(pinia)
    app.mount(root)
  }

  function surfaceEl() {
    return root.querySelector<HTMLElement>('[data-testid="terminal-surface"]')
  }

  function buttonByText(text: string): HTMLButtonElement | null {
    return Array.from(root.querySelectorAll('button'))
      .find(btn => btn.textContent?.includes(text)) ?? null
  }

  it('renders a running session with a live terminal surface and the agent name', async () => {
    useRunsStore().setAgentSessions([makeSession()])
    mountView()
    await flushUi()

    const surface = surfaceEl()
    expect(surface?.dataset.mode).toBe('live')
    expect(surface?.dataset.ptyId).toBe('11')
    expect(surface?.dataset.keybindingProfile).toBe('claude-code')
    expect(root.textContent).toContain('Claude Code')
    expect(call).not.toHaveBeenCalledWith('agent.sessions.get', expect.anything())
  })

  it('uses the persisted session agent id for live keybindings when the Work entry prop is stale', async () => {
    useRunsStore().setAgentSessions([makeSession({
      agentId: 'gemini-cli',
      title: 'Gemini CLI',
    })])
    mountView({ agentId: 'claude-code' })
    await flushUi()

    expect(surfaceEl()?.dataset.keybindingProfile).toBe('gemini-cli')
    expect(root.textContent).toContain('Gemini CLI')
  })

  it('passes the Pi keybinding profile to the live terminal', async () => {
    useRunsStore().setAgentSessions([makeSession({ agentId: 'pi', title: 'Pi' })])
    mountView({ agentId: 'pi' })
    await flushUi()

    expect(surfaceEl()?.dataset.keybindingProfile).toBe('pi')
  })

  it('archives a running session from the header', async () => {
    const archive = vi.fn()
    useRunsStore().setAgentSessions([makeSession()])
    mountView({}, { onArchiveAgentSession: archive })
    await flushUi()

    expect(buttonByText('Stop')).toBeNull()
    const archiveButton = buttonByText('Archive')
    expect(archiveButton).not.toBeNull()
    archiveButton?.click()
    await flushUi()

    expect(archive).toHaveBeenCalledWith('s1')
    expect(call).not.toHaveBeenCalledWith('agent.stop', expect.anything())
  })

  it('surfaces the needs-input runtime state and the title hint', async () => {
    useRunsStore().setAgentSessions([makeSession({
      runtimeStatus: 'needs-input',
      titleHint: 'claude — awaiting approval',
    })])
    mountView()
    await flushUi()

    expect(root.textContent).toContain('Needs input')
    expect(root.textContent).toContain('claude — awaiting approval')
  })

  it('surfaces the done runtime state with a green badge', async () => {
    useRunsStore().setAgentSessions([makeSession({
      runtimeStatus: 'done',
    })])
    mountView()
    await flushUi()

    expect(root.textContent).toContain('Done')
    const badge = root.querySelector('span[class*="border-add"]')
    expect(badge).not.toBeNull()
  })

  it('fetches scrollback once for an ended session and shows replay, banner, and Resume', async () => {
    useRunsStore().setAgentSessions([makeSession({
      status: 'error',
      exitCode: 1,
      endedAt: '2026-06-12T10:05:00.000Z',
      ptyId: undefined,
      runtimeStatus: undefined,
    })])
    call.mockImplementation(async (tool: string) => {
      if (tool === 'agent.sessions.get') {
        return { session: makeSession({ status: 'error', exitCode: 1, scrollback: 'goodbye world' }) }
      }
      return {}
    })
    mountView()
    await flushUi()
    await flushUi()

    const getCalls = call.mock.calls.filter(([tool]) => tool === 'agent.sessions.get')
    expect(getCalls).toEqual([['agent.sessions.get', { sessionId: 's1', scrollback: true }]])

    const surface = surfaceEl()
    expect(surface?.dataset.mode).toBe('replay')
    expect(surface?.dataset.replay).toBe('goodbye world')
    expect(root.textContent).toContain('Failed (exit 1)')
    expect(buttonByText('Resume')).not.toBeNull()
    expect(buttonByText('Stop')).toBeNull()
  })

  it('explains an interrupted session as a stopped restart casualty', async () => {
    useRunsStore().setAgentSessions([makeSession({
      status: 'interrupted',
      endedAt: '2026-06-12T10:05:00.000Z',
      ptyId: undefined,
      runtimeStatus: undefined,
    })])
    mountView()
    await flushUi()

    expect(root.textContent).toContain('Stopped because Mim was closed while this session ran')
  })

  it('offers archive next to resume for a stopped session', async () => {
    const archive = vi.fn()
    useRunsStore().setAgentSessions([makeSession({
      status: 'stopped',
      endedAt: '2026-06-12T10:05:00.000Z',
      ptyId: undefined,
      runtimeStatus: undefined,
    })])
    mountView({}, { onArchiveAgentSession: archive })
    await flushUi()

    expect(buttonByText('Resume')).not.toBeNull()
    const archiveButton = buttonByText('Archive')
    expect(archiveButton).not.toBeNull()
    archiveButton?.click()
    await flushUi()

    expect(archive).toHaveBeenCalledWith('s1')
    expect(call).not.toHaveBeenCalledWith('agent.stop', expect.anything())
  })

  it('resumes the session in place and applies the updated record to the store', async () => {
    useRunsStore().setAgentSessions([makeSession({
      agentId: 'gemini-cli',
      title: 'Gemini CLI',
      status: 'stopped',
      endedAt: '2026-06-12T10:05:00.000Z',
      ptyId: undefined,
      runtimeStatus: undefined,
    })])
    const resumedSession = makeSession({ sessionId: 's1', agentId: 'gemini-cli', status: 'running', ptyId: 12 })
    call.mockImplementation(async (tool: string) => {
      if (tool === 'agent.sessions.get') return { session: makeSession({ status: 'stopped', scrollback: '' }) }
      if (tool === 'agent.resume') return { session: resumedSession, ptyId: 12 }
      return {}
    })
    mountView({ agentId: 'claude-code' })
    await flushUi()

    buttonByText('Resume')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('agent.resume', { sessionId: 's1' })
    const store = useRunsStore()
    const session = store.agentSessions.find(item => item.sessionId === 's1')
    expect(session?.status).toBe('running')
    expect(session?.ptyId).toBe(12)
  })

  it('shows a plain-language recovery state when the session record is missing', async () => {
    useRunsStore().setAgentSessions([])
    mountView({ sessionId: 'ghost' })
    await flushUi()

    expect(surfaceEl()).toBeNull()
    expect(root.textContent?.toLowerCase()).toContain('session')
    expect(root.textContent?.toLowerCase()).toContain('not')
    expect(call).not.toHaveBeenCalled()
  })

  it('prunes a stale ended session when scrollback fetch reports the record is missing', async () => {
    useRunsStore().setAgentSessions([makeSession({
      sessionId: 'ghost',
      status: 'done',
      endedAt: '2026-06-12T10:05:00.000Z',
      ptyId: undefined,
      runtimeStatus: undefined,
    })])
    call.mockImplementation(async (tool: string) => {
      if (tool === 'agent.sessions.get') throw new Error('Agent session not found: ghost')
      return {}
    })
    mountView({ sessionId: 'ghost' })
    await flushUi()
    await flushUi()

    expect(useRunsStore().agentSessions.some(item => item.sessionId === 'ghost')).toBe(false)
    expect(surfaceEl()).toBeNull()
    expect(root.textContent).toContain('Session not found')
  })
})
