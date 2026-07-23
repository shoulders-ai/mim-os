import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from './settings.js'

function stubRendererGlobals(settings: Record<string, unknown> = {}) {
  const telemetry = { enabled: true, locked: false }
  const call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
    if (tool === 'settings.get') return { settings }
    if (tool === 'settings.set') return { ok: true, ...params }
    if (tool === 'telemetry.status') return telemetry
    if (tool === 'telemetry.setEnabled') {
      telemetry.enabled = params?.enabled !== false
      return telemetry
    }
    if (tool === 'telemetry.track') return { tracked: true }
    throw new Error(`Unexpected tool: ${tool}`)
  })

  vi.stubGlobal('window', { kernel: { call } })
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  return call
}

function stubLocalStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    clear: vi.fn(() => { values.clear() }),
  })
}

describe('renderer settings store', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    stubLocalStorage()
    setActivePinia(createPinia())
    stubRendererGlobals()
  })

  it('initializes current Electron settings defaults', () => {
    const store = useSettingsStore()

    expect(store.theme).toBe('white')
    expect(store.editorFontFamily).toBe('serif')
    expect(store.editorFontSize).toBe(16)
    expect(store.editorWordWrap).toBe(true)
    expect(store.editorLineNumbers).toBe(false)
    expect(store.editorSpellCheck).toBe(false)
    expect(store.lastChatModel).toBe('')
    expect(store.lastInlineModel).toBe('')
    expect(store.lastGhostModel).toBe('')
    expect(store.sidebarWidth).toBe(220)
    expect(store.rightPanelWidth).toBe(480)
    expect(store.terminalHeight).toBe(220)
    expect(store.automationApprovalMode).toBe('normal')
    expect(store.traceRetentionDays).toBe(90)
    expect(store.traceCaptureContent).toBe(true)
    expect(store.tracePayloadRetentionDays).toBe(7)
    expect(store.tracePayloadMaxBytes).toBe(250 * 1024 * 1024)
    expect(store.historyMaxBytes).toBe(512 * 1024 * 1024)
    expect(store.historyEnabled).toBe(true)
    expect(store.navigatorAppOrder).toEqual([])
    expect(store.navigatorActivityOrder).toEqual([])
    expect(store.enabledAgents).toEqual([])
    expect(store.agentFlags).toEqual({})
    expect(store.telemetryEnabled).toBe(true)
    expect(store.telemetryLocked).toBe(false)
    expect(store.loaded).toBe(false)
  })

  it('reports dark themes for slate, monokai, nord, and dracula', async () => {
    const store = useSettingsStore()

    expect(store.isDarkTheme).toBe(false)
    for (const dark of ['slate', 'monokai', 'nord', 'dracula'] as const) {
      await store.set('theme', dark)
      expect(store.isDarkTheme).toBe(true)
    }
    for (const light of ['glacier', 'parchment', 'white', 'sage'] as const) {
      await store.set('theme', light)
      expect(store.isDarkTheme).toBe(false)
    }
  })

  it('load() applies persisted values and marks the store loaded', async () => {
    const call = stubRendererGlobals({
      theme: 'glacier',
      editorFontSize: 18,
      editorLineNumbers: true,
      lastInlineModel: 'gemini-3.5-flash',
      lastGhostModel: 'gemini-3.1-flash-lite',
      automationApprovalMode: 'strict',
      traceRetentionDays: 30,
      traceCaptureContent: false,
      tracePayloadRetentionDays: 14,
      tracePayloadMaxBytes: 100 * 1024 * 1024,
      historyMaxBytes: 1024 * 1024 * 1024,
      historyEnabled: false,
      navigatorAppOrder: ['slides', 'docx-review'],
      navigatorActivityOrder: ['chat:s2', 'package:run-a'],
      unknownLegacyKey: 'ignored',
    })
    const store = useSettingsStore()

    await store.load()

    expect(call).toHaveBeenCalledWith('settings.get')
    expect(store.theme).toBe('glacier')
    expect(store.editorFontSize).toBe(18)
    expect(store.editorLineNumbers).toBe(true)
    expect(store.lastInlineModel).toBe('gemini-3.5-flash')
    expect(store.lastGhostModel).toBe('gemini-3.1-flash-lite')
    expect(store.automationApprovalMode).toBe('strict')
    expect(store.traceRetentionDays).toBe(30)
    expect(store.traceCaptureContent).toBe(false)
    expect(store.tracePayloadRetentionDays).toBe(14)
    expect(store.tracePayloadMaxBytes).toBe(100 * 1024 * 1024)
    expect(store.historyMaxBytes).toBe(1024 * 1024 * 1024)
    expect(store.historyEnabled).toBe(false)
    expect(store.navigatorAppOrder).toEqual(['slides', 'docx-review'])
    expect(store.navigatorActivityOrder).toEqual(['chat:s2', 'package:run-a'])
    expect(store.editorFontFamily).toBe('serif')
    expect(store.loaded).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('glacier')
    expect((store as unknown as Record<string, unknown>).unknownLegacyKey).toBeUndefined()
    expect(call).toHaveBeenCalledWith('telemetry.status')
  })

  it('load() tolerates kernel failures and keeps defaults', async () => {
    vi.stubGlobal('window', {
      kernel: { call: vi.fn(async () => { throw new Error('no workspace') }) },
    })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    const store = useSettingsStore()

    await store.load()

    expect(store.theme).toBe('white')
    expect(store.editorFontSize).toBe(16)
    expect(store.loaded).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('white')
  })

  it('set() updates known values and persists through the kernel', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('editorWordWrap', false)

    expect(store.editorWordWrap).toBe(false)
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'editorWordWrap',
      value: false,
    })
  })

  it('set() applies theme immediately', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('theme', 'slate')

    expect(store.theme).toBe('slate')
    expect(document.documentElement.dataset.theme).toBe('slate')
    expect(call).toHaveBeenCalledWith('telemetry.track', {
      event: 'theme_change',
      props: { theme: 'slate' },
    })
  })

  it('set() ignores unknown keys without persisting them', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('editorTheme', 'monokai')

    expect(call).not.toHaveBeenCalled()
    expect((store as unknown as Record<string, unknown>).editorTheme).toBeUndefined()
  })

  it('set() persists the automation approval mode', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('automationApprovalMode', 'developer')

    expect(store.automationApprovalMode).toBe('developer')
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'automationApprovalMode',
      value: 'developer',
    })
  })

  it('set() persists storage policy settings', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('historyMaxBytes', 256 * 1024 * 1024)
    await store.set('historyEnabled', false)
    await store.set('traceCaptureContent', false)
    await store.set('tracePayloadRetentionDays', 14)
    await store.set('tracePayloadMaxBytes', 100 * 1024 * 1024)

    expect(store.historyMaxBytes).toBe(256 * 1024 * 1024)
    expect(store.historyEnabled).toBe(false)
    expect(store.traceCaptureContent).toBe(false)
    expect(store.tracePayloadRetentionDays).toBe(14)
    expect(store.tracePayloadMaxBytes).toBe(100 * 1024 * 1024)
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'historyMaxBytes',
      value: 256 * 1024 * 1024,
    })
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'traceCaptureContent',
      value: false,
    })
  })

  it('set() persists Navigator manual order', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('navigatorAppOrder', ['docx-review', 'slides'])
    await store.set('navigatorActivityOrder', ['package:run-a', 'chat:s1'])

    expect(store.navigatorAppOrder).toEqual(['docx-review', 'slides'])
    expect(store.navigatorActivityOrder).toEqual(['package:run-a', 'chat:s1'])
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'navigatorAppOrder',
      value: ['docx-review', 'slides'],
    })
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'navigatorActivityOrder',
      value: ['package:run-a', 'chat:s1'],
    })
  })

  it('load() resets settings before applying a fresh kernel response', async () => {
    const store = useSettingsStore()
    await store.set('rightPanelWidth', 700)
    const call = stubRendererGlobals({ theme: 'sage' })

    await store.load()

    expect(call).toHaveBeenCalledWith('settings.get')
    expect(store.theme).toBe('sage')
    expect(store.rightPanelWidth).toBe(480)
    expect(store.navigatorAppOrder).toEqual([])
    expect(store.navigatorActivityOrder).toEqual([])
  })

  it('set() persists inline and ghost model preferences', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('lastInlineModel', 'claude-sonnet-4-6')
    await store.set('lastGhostModel', 'claude-haiku-4-5-20251001')

    expect(store.lastInlineModel).toBe('claude-sonnet-4-6')
    expect(store.lastGhostModel).toBe('claude-haiku-4-5-20251001')
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'lastInlineModel',
      value: 'claude-sonnet-4-6',
    })
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'lastGhostModel',
      value: 'claude-haiku-4-5-20251001',
    })
  })

  it('set() keeps local updates when persistence fails', async () => {
    vi.stubGlobal('window', {
      kernel: { call: vi.fn(async () => { throw new Error('write failed') }) },
    })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    const store = useSettingsStore()

    await store.set('lastChatModel', 'test-model')

    expect(store.lastChatModel).toBe('test-model')
  })

  it('initializes recentFiles as an empty list', () => {
    const store = useSettingsStore()
    expect(store.recentFiles).toEqual([])
  })

  it('addRecentFile() prepends, de-duplicates, and persists', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    store.addRecentFile('notes/a.md')
    store.addRecentFile('notes/b.md')
    store.addRecentFile('notes/a.md')
    await Promise.resolve()

    expect(store.recentFiles).toEqual(['notes/a.md', 'notes/b.md'])
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'recentFiles',
      value: ['notes/a.md', 'notes/b.md'],
    })
  })

  it('addRecentFile() caps the list at ten entries', () => {
    const store = useSettingsStore()
    for (let i = 0; i < 15; i++) store.addRecentFile(`file-${i}.md`)
    expect(store.recentFiles).toHaveLength(10)
    expect(store.recentFiles[0]).toBe('file-14.md')
  })

  it('addRecentFile() ignores empty paths', () => {
    const store = useSettingsStore()
    store.addRecentFile('')
    expect(store.recentFiles).toEqual([])
  })

  it('clearRecentFiles() empties and persists the list', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()
    store.addRecentFile('notes/a.md')

    store.clearRecentFiles()
    await Promise.resolve()

    expect(store.recentFiles).toEqual([])
    expect(call).toHaveBeenCalledWith('settings.set', { key: 'recentFiles', value: [] })
  })

  it('initializes recentWorkspaces from app local storage', () => {
    globalThis.localStorage?.setItem('mim:recentWorkspaces', JSON.stringify(['/Users/test/a']))
    const store = useSettingsStore()

    expect(store.recentWorkspaces).toEqual(['/Users/test/a'])
  })

  it('ignores malformed recentWorkspaces local storage', () => {
    globalThis.localStorage?.setItem('mim:recentWorkspaces', '{not json')
    const store = useSettingsStore()

    expect(store.recentWorkspaces).toEqual([])
  })

  it('filters invalid recentWorkspaces entries from local storage', () => {
    globalThis.localStorage?.setItem('mim:recentWorkspaces', JSON.stringify([
      '/Users/test/a',
      '',
      42,
      null,
      '/Users/test/b',
    ]))
    const store = useSettingsStore()

    expect(store.recentWorkspaces).toEqual(['/Users/test/a', '/Users/test/b'])
  })

  it('addRecentWorkspace() prepends, de-duplicates, caps, and persists locally', () => {
    const store = useSettingsStore()

    for (let i = 0; i < 10; i++) store.addRecentWorkspace(`/Users/test/workspace-${i}`)
    store.addRecentWorkspace('/Users/test/workspace-3')

    expect(store.recentWorkspaces).toHaveLength(8)
    expect(store.recentWorkspaces[0]).toBe('/Users/test/workspace-3')
    expect(store.recentWorkspaces.filter(path => path === '/Users/test/workspace-3')).toHaveLength(1)
    expect(JSON.parse(globalThis.localStorage?.getItem('mim:recentWorkspaces') ?? '[]')[0]).toBe('/Users/test/workspace-3')
  })

  it('addRecentWorkspace() ignores empty paths', () => {
    const store = useSettingsStore()

    store.addRecentWorkspace('')

    expect(store.recentWorkspaces).toEqual([])
    expect(globalThis.localStorage?.getItem('mim:recentWorkspaces')).toBeNull()
  })

  it('clearRecentWorkspaces() empties the app-level recent list', () => {
    const store = useSettingsStore()
    store.addRecentWorkspace('/Users/test/a')

    store.clearRecentWorkspaces()

    expect(store.recentWorkspaces).toEqual([])
    expect(globalThis.localStorage?.getItem('mim:recentWorkspaces')).toBe('[]')
  })

  it('removeRecentWorkspace() removes a single app-level recent path', () => {
    const store = useSettingsStore()
    store.addRecentWorkspace('/Users/test/a')
    store.addRecentWorkspace('/Users/test/b')

    store.removeRecentWorkspace('/Users/test/a')

    expect(store.recentWorkspaces).toEqual(['/Users/test/b'])
    expect(JSON.parse(globalThis.localStorage?.getItem('mim:recentWorkspaces') ?? '[]')).toEqual(['/Users/test/b'])
  })

  it('load() gets Personal model preferences from settings and identity from config.get', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'settings.get') {
        return { settings: { lastChatModel: 'gpt-5.4', lastGhostModel: 'gpt-5.4-nano' } }
      }
      if (tool === 'config.get') {
        return {
          user: { name: 'Paul' },
        }
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    const store = useSettingsStore()

    await store.load()

    expect(call).toHaveBeenCalledWith('config.get')
    expect(store.lastChatModel).toBe('gpt-5.4')
    expect(store.lastGhostModel).toBe('gpt-5.4-nano')
    expect(store.configUserName).toBe('Paul')
  })

  it('Personal identity refs default empty and stay empty when config.get fails', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'settings.get') return { settings: {} }
      if (tool === 'config.get') throw new Error('no config')
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    const store = useSettingsStore()

    expect(store.configUserName).toBe('')

    await store.load()

    expect(store.configUserName).toBe('')
    expect(store.loaded).toBe(true)
  })

  it('Personal identity refs are not written through settings.set', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('configUserName', 'Anna')

    expect(call).not.toHaveBeenCalled()
    expect(store.configUserName).toBe('')
  })

  it('refreshKeyStatuses() populates key status and drives providerConfigured/anyKeyConfigured', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'ai.keyStatus') {
        return { statuses: [
          { provider: 'anthropic', configured: true, source: 'file' },
          { provider: 'openai', configured: false, source: 'missing' },
        ] }
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    const store = useSettingsStore()

    expect(store.anyKeyConfigured).toBe(false)

    await store.refreshKeyStatuses()

    expect(call).toHaveBeenCalledWith('ai.keyStatus')
    expect(store.providerConfigured('anthropic')).toBe(true)
    expect(store.providerConfigured('openai')).toBe(false)
    expect(store.providerConfigured('google')).toBe(false)
    expect(store.providerConfigured('')).toBe(false)
    expect(store.anyKeyConfigured).toBe(true)
  })

  it('refreshKeyStatuses() keeps prior status when the fetch fails', async () => {
    let succeed = true
    const call = vi.fn(async (tool: string) => {
      if (tool === 'ai.keyStatus') {
        if (!succeed) throw new Error('transient')
        return { statuses: [{ provider: 'anthropic', configured: true }] }
      }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    const store = useSettingsStore()

    await store.refreshKeyStatuses()
    expect(store.providerConfigured('anthropic')).toBe(true)

    succeed = false
    await expect(store.refreshKeyStatuses()).resolves.toBeUndefined()
    expect(store.providerConfigured('anthropic')).toBe(true)
  })

  it('load() refreshes key statuses alongside settings and config', async () => {
    const call = vi.fn(async (tool: string) => {
      if (tool === 'settings.get') return { settings: {} }
      if (tool === 'config.get') return {}
      if (tool === 'ai.keyStatus') return { statuses: [{ provider: 'anthropic', configured: true }] }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    vi.stubGlobal('window', { kernel: { call } })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    const store = useSettingsStore()

    await store.load()

    expect(call).toHaveBeenCalledWith('ai.keyStatus')
    expect(store.anyKeyConfigured).toBe(true)
  })

  it('keyStatuses is not written back via set() / settings.set', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.set('keyStatuses', [{ provider: 'anthropic', configured: true }])

    expect(call).not.toHaveBeenCalled()
    expect(store.keyStatuses).toEqual([])
  })

  it('setTheme() delegates to the theme setting', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    store.setTheme('glacier')
    await Promise.resolve()

    expect(store.theme).toBe('glacier')
    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'theme',
      value: 'glacier',
    })
  })

  it('loads and updates machine-global telemetry state through telemetry tools', async () => {
    const call = stubRendererGlobals()
    const store = useSettingsStore()

    await store.load()
    await store.setTelemetryEnabled(false)

    expect(store.telemetryEnabled).toBe(false)
    expect(call).toHaveBeenCalledWith('telemetry.status')
    expect(call).toHaveBeenCalledWith('telemetry.setEnabled', { enabled: false })
  })
})
