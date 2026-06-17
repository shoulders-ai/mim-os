import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAgentsStore, type DetectedAgent } from './agents.js'
import { useSettingsStore } from './settings.js'

// DetectedAgent shape mirrors src/main/agents/agentCatalog.ts — the renderer
// never imports main-process types, so the store defines them locally.
function agent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
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

describe('agents store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('starts with no detected agents before any refresh', () => {
    const store = useAgentsStore()
    expect(store.agents).toEqual([])
    expect(store.installedAgents).toEqual([])
  })

  it('refreshes the catalog from agent.list', async () => {
    const detected = [
      agent({ id: 'claude-code', name: 'Claude Code' }),
      agent({ id: 'codex', name: 'Codex', bin: 'codex', installed: false, binPath: undefined }),
    ]
    const call = vi.fn(async (tool: string) => {
      if (tool === 'agent.list') return { agents: detected }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    const store = useAgentsStore()

    await store.refresh()

    expect(call).toHaveBeenCalledWith('agent.list')
    expect(store.agents).toEqual(detected)
  })

  it('exposes only installed agents for launcher rows', async () => {
    vi.stubGlobal('window', {
      kernel: {
        call: vi.fn(async () => ({
          agents: [
            agent({ id: 'claude-code', installed: true }),
            agent({ id: 'codex', installed: false, binPath: undefined }),
            agent({ id: 'gemini-cli', installed: true, bin: 'gemini', binPath: '/usr/local/bin/gemini' }),
          ],
        })),
      },
    })
    const store = useAgentsStore()

    await store.refresh()

    expect(store.installedAgents.map(item => item.id)).toEqual(['claude-code', 'gemini-cli'])
  })

  it('exposes no launcher agents until the user enables them (opt-in)', async () => {
    vi.stubGlobal('window', {
      kernel: { call: vi.fn(async () => ({ agents: [agent({ id: 'claude-code', installed: true })] })) },
    })
    const store = useAgentsStore()

    await store.refresh()

    expect(store.installedAgents.map(item => item.id)).toEqual(['claude-code'])
    expect(store.enabledAgents).toEqual([])
    expect(store.isEnabled('claude-code')).toBe(false)
  })

  it('exposes only agents that are both installed and enabled', async () => {
    vi.stubGlobal('window', {
      kernel: {
        call: vi.fn(async () => ({
          agents: [
            agent({ id: 'claude-code', installed: true }),
            agent({ id: 'codex', installed: false, binPath: undefined }),
            agent({ id: 'gemini-cli', installed: true, bin: 'gemini', binPath: '/usr/local/bin/gemini' }),
          ],
        })),
      },
    })
    const settings = useSettingsStore()
    // Enabled-but-not-installed never reaches the launcher.
    settings.enabledAgents = ['claude-code', 'codex']
    const store = useAgentsStore()

    await store.refresh()

    expect(store.enabledAgents.map(item => item.id)).toEqual(['claude-code'])
    expect(store.isEnabled('claude-code')).toBe(true)
    expect(store.isEnabled('gemini-cli')).toBe(false)
  })

  it('persists enable/disable through the settings store', async () => {
    const call = vi.fn(async () => ({}))
    vi.stubGlobal('window', { kernel: { call } })
    const settings = useSettingsStore()
    const store = useAgentsStore()

    await store.setEnabled('claude-code', true)
    expect(settings.enabledAgents).toEqual(['claude-code'])
    expect(call).toHaveBeenCalledWith('settings.set', { key: 'enabledAgents', value: ['claude-code'] })

    // Idempotent: enabling twice does not duplicate the id.
    await store.setEnabled('claude-code', true)
    expect(settings.enabledAgents).toEqual(['claude-code'])

    await store.setEnabled('claude-code', false)
    expect(settings.enabledAgents).toEqual([])
  })

  it('getExtraArgs returns parsed flags from the agentFlags setting', () => {
    vi.stubGlobal('window', { kernel: { call: vi.fn(async () => ({})) } })
    const settings = useSettingsStore()
    settings.agentFlags = { 'claude-code': '--dangerously-skip-permissions --verbose' }
    const store = useAgentsStore()

    expect(store.getExtraArgs('claude-code')).toEqual(['--dangerously-skip-permissions', '--verbose'])
    expect(store.getExtraArgs('codex')).toEqual([])
    // Empty string → empty array, no spurious empty-string arg.
    settings.agentFlags = { 'claude-code': '   ' }
    expect(store.getExtraArgs('claude-code')).toEqual([])
  })

  it('setFlags persists through settings.set', async () => {
    const call = vi.fn(async () => ({}))
    vi.stubGlobal('window', { kernel: { call } })
    const settings = useSettingsStore()
    const store = useAgentsStore()

    await store.setFlags('claude-code', '--dangerously-skip-permissions')
    expect(settings.agentFlags).toEqual({ 'claude-code': '--dangerously-skip-permissions' })

    // Clearing removes the key entirely.
    await store.setFlags('claude-code', '')
    expect(settings.agentFlags).toEqual({})
  })

  it('keeps the current list when refresh fails', async () => {
    const good = [agent()]
    const call = vi.fn(async () => ({ agents: good }))
    vi.stubGlobal('window', { kernel: { call } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useAgentsStore()
    await store.refresh()

    call.mockRejectedValueOnce(new Error('kernel down'))
    await store.refresh()

    expect(store.agents).toEqual(good)
    expect(errorSpy).toHaveBeenCalled()
  })
})
