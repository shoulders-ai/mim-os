import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { applyThemeToDocument } from '../services/themeSync.js'

export type ThemeName =
  | 'parchment' | 'glacier' | 'sage' | 'white'
  | 'slate' | 'monokai' | 'nord' | 'dracula'
export type FontFamily = 'sans' | 'serif' | 'mono' | 'slab'
export type AutomationApprovalMode = 'normal' | 'strict' | 'developer'

export interface KeyStatus { provider: string; configured: boolean; source?: string; masked?: string | null }

const DARK_THEMES: ThemeName[] = ['slate', 'monokai', 'nord', 'dracula']

const DEFAULTS = {
  theme: 'white' as ThemeName,
  editorFontFamily: 'serif' as FontFamily,
  editorFontSize: 16,
  editorWordWrap: true,
  editorLineNumbers: false,
  editorSpellCheck: false,
  editorLivePreview: true,
  lastChatModel: '',
  lastInlineModel: '',
  lastGhostModel: '',
  sidebarWidth: 220,
  rightPanelWidth: 480,
  terminalHeight: 220,
  automationApprovalMode: 'normal' as AutomationApprovalMode,
  traceRetentionDays: 90,
  traceCaptureContent: true,
  tracePayloadRetentionDays: 7,
  tracePayloadMaxBytes: 250 * 1024 * 1024,
  historyEnabled: true,
  historyMaxBytes: 512 * 1024 * 1024,
  recentFiles: [] as string[],
  navigatorAppOrder: [] as string[],
  navigatorActivityOrder: [] as string[],
  enabledAgents: [] as string[],
  agentFlags: {} as Record<string, string>,
  'references.bibPath': 'references/references.bib',
}

const MAX_RECENT_FILES = 10
const MAX_RECENT_WORKSPACES = 8
const RECENT_WORKSPACES_KEY = 'mim:recentWorkspaces'

function readRecentWorkspaces(): string[] {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function') return []
    const raw = storage.getItem(RECENT_WORKSPACES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string' && path.length > 0) : []
  } catch {
    return []
  }
}

function writeRecentWorkspaces(paths: string[]): void {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.setItem !== 'function') return
    storage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(paths))
  } catch {
    // App-level workspace recents are a convenience, not a critical setting.
  }
}

function resetWorkspaceSettingsToDefaults(refs: Record<string, { value: unknown }>): void {
  const defaults = DEFAULTS as Record<string, unknown>
  for (const [key, target] of Object.entries(refs)) {
    const value = defaults[key]
    target.value = Array.isArray(value) ? [...value] : value
  }
}

function trackTelemetry(event: string, props: Record<string, unknown> = {}): void {
  try {
    void window.kernel.call('telemetry.track', { event, props }).catch(() => {})
  } catch {
    // Telemetry is best-effort and must never affect settings.
  }
}

export const useSettingsStore = defineStore('settings', () => {
  // ── Refs ──
  const theme = ref<ThemeName>(DEFAULTS.theme)
  const editorFontFamily = ref<FontFamily>(DEFAULTS.editorFontFamily)
  const editorFontSize = ref(DEFAULTS.editorFontSize)
  const editorWordWrap = ref(DEFAULTS.editorWordWrap)
  const editorLineNumbers = ref(DEFAULTS.editorLineNumbers)
  const editorSpellCheck = ref(DEFAULTS.editorSpellCheck)
  const editorLivePreview = ref(DEFAULTS.editorLivePreview)
  const lastChatModel = ref(DEFAULTS.lastChatModel)
  const lastInlineModel = ref(DEFAULTS.lastInlineModel)
  const lastGhostModel = ref(DEFAULTS.lastGhostModel)
  const sidebarWidth = ref(DEFAULTS.sidebarWidth)
  const rightPanelWidth = ref(DEFAULTS.rightPanelWidth)
  const terminalHeight = ref(DEFAULTS.terminalHeight)
  const automationApprovalMode = ref<AutomationApprovalMode>(DEFAULTS.automationApprovalMode)
  const traceRetentionDays = ref(DEFAULTS.traceRetentionDays)
  const traceCaptureContent = ref(DEFAULTS.traceCaptureContent)
  const tracePayloadRetentionDays = ref(DEFAULTS.tracePayloadRetentionDays)
  const tracePayloadMaxBytes = ref(DEFAULTS.tracePayloadMaxBytes)
  const historyEnabled = ref(DEFAULTS.historyEnabled)
  const historyMaxBytes = ref(DEFAULTS.historyMaxBytes)
  const recentFiles = ref<string[]>([...DEFAULTS.recentFiles])
  const navigatorAppOrder = ref<string[]>([...DEFAULTS.navigatorAppOrder])
  const navigatorActivityOrder = ref<string[]>([...DEFAULTS.navigatorActivityOrder])
  // Opt-in launcher visibility for detected CLI coding agents (workspace-level).
  const enabledAgents = ref<string[]>([...DEFAULTS.enabledAgents])
  const agentFlags = ref<Record<string, string>>({ ...DEFAULTS.agentFlags })
  const referencesBibPath = ref(DEFAULTS['references.bibPath'])
  const recentWorkspaces = ref<string[]>(readRecentWorkspaces())
  const loaded = ref(false)
  const telemetryEnabled = ref(true)
  const telemetryLocked = ref(false)

  // ── User-global config layer (~/.mim/config.yaml via config.get) ──
  // Read-only mirror of the config layer. Never persisted via set()/settings.set;
  // intentionally excluded from `refs`.
  const configChatModel = ref('')
  const configGhostModel = ref('')
  const configUserName = ref('')
  const configUserEmail = ref('')
  const configTimezone = ref('')

  // ── AI key status (ai.keyStatus) ──
  // Single reactive source of truth for "which providers have a key", shared by
  // every AI surface (chat, inline rewrite, settings). Only the configured flag
  // crosses into the renderer — the actual key stays in main / ~/.mim/keys.env.
  // Refreshed on boot, on the main-process `ai:keys-changed` event, and on save,
  // so key changes take effect without an app restart. Excluded from `refs`.
  const keyStatuses = ref<KeyStatus[]>([])

  const refs: Record<string, { value: unknown }> = {
    theme, editorFontFamily, editorFontSize,
    editorWordWrap, editorLineNumbers, editorSpellCheck, editorLivePreview,
    lastChatModel, lastInlineModel, lastGhostModel, sidebarWidth, rightPanelWidth, terminalHeight,
    automationApprovalMode, traceRetentionDays, traceCaptureContent, tracePayloadRetentionDays, tracePayloadMaxBytes, historyEnabled, historyMaxBytes,
    recentFiles, navigatorAppOrder, navigatorActivityOrder, enabledAgents, agentFlags,
    'references.bibPath': referencesBibPath,
  }

  const isDarkTheme = computed(() => DARK_THEMES.includes(theme.value))

  // ── Theme ──
  watch(theme, (val) => applyThemeToDocument(val))

  // ── Load ──
  async function load() {
    loaded.value = false
    resetWorkspaceSettingsToDefaults(refs)
    try {
      const result = await window.kernel.call('settings.get') as {
        settings: Record<string, unknown>
      }
      const s = result.settings
      for (const [key, ref] of Object.entries(refs)) {
        if (s[key] !== undefined) ref.value = s[key]
      }
    } catch {
      // No workspace yet or settings don't exist — use defaults
    }

    // User-global config layer is independent of workspace settings and may be
    // present before any workspace is open. Failure leaves the config refs empty.
    configChatModel.value = ''
    configGhostModel.value = ''
    configUserName.value = ''
    configUserEmail.value = ''
    configTimezone.value = ''
    try {
      const config = await window.kernel.call('config.get') as {
        user?: { name?: string; email?: string; timezone?: string }
        defaults?: { models?: { chat?: string; ghost?: string } }
      }
      configChatModel.value = config?.defaults?.models?.chat ?? ''
      configGhostModel.value = config?.defaults?.models?.ghost ?? ''
      configUserName.value = config?.user?.name ?? ''
      configUserEmail.value = config?.user?.email ?? ''
      configTimezone.value = config?.user?.timezone ?? ''
    } catch {
      // No config or kernel failure — leave config refs empty.
    }

    await refreshKeyStatuses()
    await refreshTelemetryStatus()

    applyThemeToDocument(theme.value)
    loaded.value = true
  }

  // ── AI key status ──
  // Idempotent and fault-tolerant: a failed fetch leaves the prior state intact.
  async function refreshKeyStatuses() {
    try {
      const result = await window.kernel.call('ai.keyStatus') as { statuses?: KeyStatus[] }
      if (Array.isArray(result?.statuses)) keyStatuses.value = result.statuses
    } catch {
      // No kernel / transient failure — keep the last known statuses.
    }
  }

  function providerConfigured(provider: string): boolean {
    if (!provider) return false
    const status = keyStatuses.value.find(item => item.provider === provider)
    return Boolean(status?.configured)
  }

  const anyKeyConfigured = computed(() => keyStatuses.value.some(item => item.configured))

  async function refreshTelemetryStatus() {
    try {
      const result = await window.kernel.call('telemetry.status') as { enabled?: boolean; locked?: boolean }
      telemetryEnabled.value = result?.enabled !== false
      telemetryLocked.value = result?.locked === true
    } catch {
      telemetryEnabled.value = true
      telemetryLocked.value = false
    }
  }

  async function setTelemetryEnabled(value: boolean) {
    if (telemetryLocked.value) return
    telemetryEnabled.value = value
    try {
      const result = await window.kernel.call('telemetry.setEnabled', { enabled: value }) as { enabled?: boolean; locked?: boolean }
      telemetryEnabled.value = result?.enabled !== false
      telemetryLocked.value = result?.locked === true
    } catch {
      telemetryEnabled.value = !value
    }
  }

  // ── Set ──
  async function set(key: string, value: unknown) {
    if (!(key in refs)) return
    refs[key].value = value
    if (key === 'theme') applyThemeToDocument(value as ThemeName)
    try {
      await window.kernel.call('settings.set', { key, value })
    } catch {
      // Persist silently fails if no workspace
    }
    if (key === 'theme') {
      trackTelemetry('theme_change', { theme: value })
    }
  }

  // Convenience setTheme
  function setTheme(name: ThemeName) {
    set('theme', name)
  }

  // ── Recent files ──
  // Most-recent-first, de-duplicated, capped. Persisted per workspace.
  function addRecentFile(path: string) {
    if (typeof path !== 'string' || path.length === 0) return
    const next = [path, ...recentFiles.value.filter(p => p !== path)].slice(0, MAX_RECENT_FILES)
    set('recentFiles', next)
  }

  function clearRecentFiles() {
    set('recentFiles', [])
  }

  // ── Recent workspaces ──
  // Most-recent-first app-level state. This cannot live in workspace settings,
  // because the list must be available before or while switching workspaces.
  function addRecentWorkspace(path: string) {
    if (typeof path !== 'string' || path.length === 0) return
    const next = [path, ...recentWorkspaces.value.filter(p => p !== path)].slice(0, MAX_RECENT_WORKSPACES)
    recentWorkspaces.value = next
    writeRecentWorkspaces(next)
  }

  function removeRecentWorkspace(path: string) {
    if (typeof path !== 'string' || path.length === 0) return
    const next = recentWorkspaces.value.filter(p => p !== path)
    recentWorkspaces.value = next
    writeRecentWorkspaces(next)
  }

  function clearRecentWorkspaces() {
    recentWorkspaces.value = []
    writeRecentWorkspaces([])
  }

  return {
    theme,
    editorFontFamily,
    editorFontSize,
    editorWordWrap,
    editorLineNumbers,
    editorSpellCheck,
    editorLivePreview,
    lastChatModel,
    lastInlineModel,
    lastGhostModel,
    sidebarWidth,
    rightPanelWidth,
    terminalHeight,
    automationApprovalMode,
    traceRetentionDays,
    traceCaptureContent,
    tracePayloadRetentionDays,
    tracePayloadMaxBytes,
    historyEnabled,
    historyMaxBytes,
    recentFiles,
    navigatorAppOrder,
    navigatorActivityOrder,
    enabledAgents,
    agentFlags,
    referencesBibPath,
    recentWorkspaces,
    loaded,
    telemetryEnabled,
    telemetryLocked,
    configChatModel,
    configGhostModel,
    configUserName,
    configUserEmail,
    configTimezone,
    keyStatuses,
    anyKeyConfigured,
    isDarkTheme,
    load,
    refreshKeyStatuses,
    refreshTelemetryStatus,
    setTelemetryEnabled,
    providerConfigured,
    set,
    setTheme,
    addRecentFile,
    clearRecentFiles,
    addRecentWorkspace,
    removeRecentWorkspace,
    clearRecentWorkspaces,
  }
})
