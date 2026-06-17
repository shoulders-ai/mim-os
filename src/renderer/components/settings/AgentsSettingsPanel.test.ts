// @vitest-environment happy-dom

// Coding agents section: detected CLI agents with opt-in launcher visibility
// and per-agent custom flags.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AgentsSettingsPanel from './AgentsSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('AgentsSettingsPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let call: ReturnType<typeof vi.fn>
  let detectedAgents: Array<Record<string, unknown>>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())

    detectedAgents = [
      { id: 'claude-code', name: 'Claude Code', bin: 'claude', args: [], installed: true, binPath: '/usr/local/bin/claude' },
      { id: 'codex', name: 'Codex', bin: 'codex', args: [], installed: false },
    ]

    call = vi.fn(async (tool: string) => {
      if (tool === 'agent.list') return { agents: detectedAgents }
      if (tool === 'settings.set') return { ok: true }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })
    app = null
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.restoreAllMocks()
  })

  function mount() {
    const pinia = createPinia()
    setActivePinia(pinia)
    app = createApp(AgentsSettingsPanel)
    app.use(pinia)
    app.mount(root)
  }

  it('renders the Coding agents settings panel', async () => {
    mount()
    await flushUi()

    expect(root.textContent).toContain('Coding agents')
    const agentRow = root.querySelector('[data-testid="apps-row-agent-claude-code"]')
    expect(agentRow?.textContent).toContain('Claude Code')
    expect(call).toHaveBeenCalledWith('agent.list')
  })

  it('disables the toggle for agents that are not installed', async () => {
    mount()
    await flushUi()

    const row = root.querySelector('[data-testid="apps-row-agent-codex"]')
    expect(row?.textContent).toContain('Not installed')
    const toggle = root.querySelector<HTMLButtonElement>('[data-testid="apps-toggle-agent-codex"]')
    expect(toggle?.disabled).toBe(true)
  })

  it('toggling an installed agent persists the opt-in list', async () => {
    mount()
    await flushUi()

    const toggle = root.querySelector<HTMLButtonElement>('[data-testid="apps-toggle-agent-claude-code"]')
    expect(toggle).toBeTruthy()
    toggle!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('settings.set', { key: 'enabledAgents', value: ['claude-code'] })

    toggle!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('settings.set', { key: 'enabledAgents', value: [] })
  })

  it('shows a collapsed flags input that persists custom CLI flags', async () => {
    mount()
    await flushUi()

    // Advanced flags section collapsed by default.
    const flagsInput = root.querySelector<HTMLInputElement>('[data-testid="agent-flags-claude-code"]')
    expect(flagsInput).toBeNull()

    // Expand via the disclosure toggle.
    const disclosure = root.querySelector<HTMLButtonElement>('[data-testid="agent-advanced-claude-code"]')
    expect(disclosure).toBeTruthy()
    disclosure!.click()
    await flushUi()

    const input = root.querySelector<HTMLInputElement>('[data-testid="agent-flags-claude-code"]')
    expect(input).toBeTruthy()

    // Type flags and blur to save.
    input!.value = '--dangerously-skip-permissions'
    input!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushUi()

    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'agentFlags',
      value: { 'claude-code': '--dangerously-skip-permissions' },
    })
  })
})
