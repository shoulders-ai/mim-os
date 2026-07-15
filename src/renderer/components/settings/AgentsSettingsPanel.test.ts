// @vitest-environment happy-dom

// Coding agents section: detected CLI agents with opt-in launcher visibility,
// per-agent custom flags, compatibility state, and capability-aware Mim tool connection.

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
      {
        id: 'pi',
        name: 'Pi',
        bin: 'pi',
        args: [],
        installed: true,
        binPath: '/usr/local/bin/pi',
        version: '0.80.6',
        compatible: true,
        minimumVersion: '0.76.0',
        mimToolConnection: 'extension',
        extensionResource: 'pi/mim-extension.mjs',
      },
    ]

    call = vi.fn(async (tool: string) => {
      if (tool === 'agent.list') return { agents: detectedAgents }
      if (tool === 'agent.mcp.status') return { statuses: { 'claude-code': false } }
      if (tool === 'agent.mcp.connect') return { ok: true }
      if (tool === 'agent.mcp.disconnect') return { ok: true }
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

  it('shows Connect button for installed agents that are not MCP-connected', async () => {
    mount()
    await flushUi()

    const connectBtn = root.querySelector('[data-testid="agent-mcp-connect-claude-code"]')
    expect(connectBtn).toBeTruthy()
    expect(connectBtn!.textContent?.trim()).toBe('Connect')
  })

  it('shows Pi version and tool capability without offering MCP controls', async () => {
    mount()
    await flushUi()

    const row = root.querySelector('[data-testid="apps-row-agent-pi"]')
    expect(row?.textContent).toContain('0.80.6')
    expect(row?.querySelector('[data-testid="agent-tools-integrated-pi"]')?.textContent)
      .toContain('Mim tools built in')
    expect(root.querySelector('[data-testid="agent-mcp-connect-pi"]')).toBeNull()

    root.querySelector<HTMLButtonElement>('[data-testid="agent-advanced-pi"]')!.click()
    await flushUi()

    expect(root.querySelector('[data-testid="agent-mcp-disconnect-pi"]')).toBeNull()
    expect(root.querySelector('[data-testid="agent-tools-explanation-pi"]')?.textContent)
      .toContain('Mim tools load automatically in sessions launched from Mim.')
  })

  it('explains and disables an installed Pi version below the requirement', async () => {
    detectedAgents[2] = {
      ...detectedAgents[2],
      version: '0.75.5',
      compatible: false,
      compatibilityMessage: 'Pi 0.75.5 found; version 0.76.0 or newer is required',
    }
    mount()
    await flushUi()

    const row = root.querySelector('[data-testid="apps-row-agent-pi"]')
    expect(row?.textContent).toContain('Pi 0.75.5 found; version 0.76.0 or newer is required')
    expect(root.querySelector<HTMLButtonElement>('[data-testid="apps-toggle-agent-pi"]')?.disabled).toBe(true)
  })

  it('shows Connected status when MCP is configured', async () => {
    call = vi.fn(async (tool: string) => {
      if (tool === 'agent.list') return { agents: detectedAgents }
      if (tool === 'agent.mcp.status') return { statuses: { 'claude-code': true } }
      if (tool === 'settings.set') return { ok: true }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    mount()
    await flushUi()

    const status = root.querySelector('[data-testid="agent-mcp-status-claude-code"]')
    expect(status).toBeTruthy()
    expect(status!.textContent?.trim()).toBe('Connected')
    expect(root.querySelector('[data-testid="agent-mcp-connect-claude-code"]')).toBeNull()
  })

  it('clicking Connect calls agent.mcp.connect and updates status', async () => {
    mount()
    await flushUi()

    const connectBtn = root.querySelector<HTMLButtonElement>('[data-testid="agent-mcp-connect-claude-code"]')!
    connectBtn.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('agent.mcp.connect', { agentId: 'claude-code' })
    const status = root.querySelector('[data-testid="agent-mcp-status-claude-code"]')
    expect(status?.textContent?.trim()).toBe('Connected')
  })

  it('shows Disconnect button in the advanced section when connected', async () => {
    call = vi.fn(async (tool: string) => {
      if (tool === 'agent.list') return { agents: detectedAgents }
      if (tool === 'agent.mcp.status') return { statuses: { 'claude-code': true } }
      if (tool === 'agent.mcp.disconnect') return { ok: true }
      if (tool === 'settings.set') return { ok: true }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    mount()
    await flushUi()

    const disclosure = root.querySelector<HTMLButtonElement>('[data-testid="agent-advanced-claude-code"]')!
    disclosure.click()
    await flushUi()

    const disconnectBtn = root.querySelector<HTMLButtonElement>('[data-testid="agent-mcp-disconnect-claude-code"]')
    expect(disconnectBtn).toBeTruthy()
    disconnectBtn!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('agent.mcp.disconnect', { agentId: 'claude-code' })
  })

  it('does not show MCP JSON config section (replaced by per-agent Connect)', async () => {
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="mcp-config-section"]')).toBeNull()
    expect(root.querySelector('[data-testid="mcp-config-copy"]')).toBeNull()
  })

  it('shows a collapsed flags input that persists custom CLI flags', async () => {
    mount()
    await flushUi()

    const flagsInput = root.querySelector<HTMLInputElement>('[data-testid="agent-flags-claude-code"]')
    expect(flagsInput).toBeNull()

    const disclosure = root.querySelector<HTMLButtonElement>('[data-testid="agent-advanced-claude-code"]')
    expect(disclosure).toBeTruthy()
    disclosure!.click()
    await flushUi()

    const input = root.querySelector<HTMLInputElement>('[data-testid="agent-flags-claude-code"]')
    expect(input).toBeTruthy()

    input!.value = '--dangerously-skip-permissions'
    input!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushUi()

    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'agentFlags',
      value: { 'claude-code': '--dangerously-skip-permissions' },
    })
  })
})
