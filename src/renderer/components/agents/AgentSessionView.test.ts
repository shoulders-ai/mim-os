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
      props: ['ptyId', 'replay'],
      emits: ['exited', 'input'],
      setup(props) {
        return () => h('div', {
          'data-testid': 'terminal-surface',
          'data-pty-id': props.ptyId != null ? String(props.ptyId) : '',
          'data-replay': props.replay ?? '',
          'data-mode': props.replay != null ? 'replay' : 'live',
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
    expect(root.textContent).toContain('Claude Code')
    expect(call).not.toHaveBeenCalledWith('agent.sessions.get', expect.anything())
  })

  it('stops a running session without confirmation', async () => {
    useRunsStore().setAgentSessions([makeSession()])
    mountView()
    await flushUi()

    const stop = buttonByText('Stop')
    expect(stop).not.toBeNull()
    stop?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('agent.stop', { sessionId: 's1' })
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

  it('fetches scrollback once for an ended session and shows replay, banner, and Relaunch', async () => {
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
    expect(buttonByText('Relaunch')).not.toBeNull()
    expect(buttonByText('Stop')).toBeNull()
  })

  it('explains an interrupted session in plain language', async () => {
    useRunsStore().setAgentSessions([makeSession({
      status: 'interrupted',
      endedAt: '2026-06-12T10:05:00.000Z',
      ptyId: undefined,
      runtimeStatus: undefined,
    })])
    mountView()
    await flushUi()

    expect(root.textContent).toContain('Interrupted — Mim was closed while this session ran')
  })

  it('relaunches the agent, applies the new session to the store, and emits openAgentSession', async () => {
    useRunsStore().setAgentSessions([makeSession({
      status: 'stopped',
      endedAt: '2026-06-12T10:05:00.000Z',
      ptyId: undefined,
      runtimeStatus: undefined,
    })])
    const newSession = makeSession({ sessionId: 's2', status: 'running', ptyId: 12 })
    call.mockImplementation(async (tool: string) => {
      if (tool === 'agent.sessions.get') return { session: makeSession({ status: 'stopped', scrollback: '' }) }
      if (tool === 'agent.launch') return { session: newSession, ptyId: 12 }
      return {}
    })
    const onOpenAgentSession = vi.fn()
    mountView({}, { onOpenAgentSession })
    await flushUi()

    buttonByText('Relaunch')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('agent.launch', { agentId: 'claude-code' })
    expect(useRunsStore().agentSessions.some(item => item.sessionId === 's2')).toBe(true)
    expect(onOpenAgentSession).toHaveBeenCalledWith('claude-code', 's2')
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
})
