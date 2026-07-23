import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ToolRegistry } from '@main/tools/registry.js'
import { atomicWriteJson } from '@main/atomicJson.js'
import {
  loadUserConfig,
  setPersonalSetting,
  type PersonalSettingKey,
} from '@main/userConfig.js'
import { userHomeDir } from '@main/platform.js'

export const DEFAULT_TRACE_RETENTION_DAYS = 90
export const DEFAULT_TRACE_PAYLOAD_RETENTION_DAYS = 7
export const DEFAULT_TRACE_PAYLOAD_MAX_BYTES = 250 * 1024 * 1024
export const DEFAULT_HISTORY_MAX_BYTES = 512 * 1024 * 1024
export const DEFAULT_REFERENCES_BIB_PATH = 'references/references.bib'

const PERSONAL_DEFAULTS = {
  theme: 'white',
  editorFontFamily: 'serif',
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
  automationApprovalMode: 'normal',
} as const

const PROJECT_DEFAULTS = {
  // Positive day count prunes old trace day files; 0 disables local storage.
  traceRetentionDays: DEFAULT_TRACE_RETENTION_DAYS,
  // Capture redacted model I/O and tool results as trace payload blobs so the
  // Activity surface can show what the AI said and what tools returned. Costs
  // disk, not tokens; governed by independent content retention and budget.
  // Secret-bearing tools never capture regardless of this flag.
  traceCaptureContent: true,
  tracePayloadRetentionDays: DEFAULT_TRACE_PAYLOAD_RETENTION_DAYS,
  tracePayloadMaxBytes: DEFAULT_TRACE_PAYLOAD_MAX_BYTES,
  historyEnabled: true,
  historyMaxBytes: DEFAULT_HISTORY_MAX_BYTES,
  recentFiles: [] as string[],
  navigatorAppOrder: [] as string[],
  navigatorActivityOrder: [] as string[],
  // CLI coding agents the user has opted into showing as Navigator launchers.
  // Detection alone never surfaces an agent (docs/agent-sessions.md).
  enabledAgents: [],
  agentFlags: {},
  'references.bibPath': DEFAULT_REFERENCES_BIB_PATH,
  codeInterpreters: ['rscript', 'r', 'quarto'],
}

const PERSONAL_SETTING_KEYS = new Set(Object.keys(PERSONAL_DEFAULTS))
const PROJECT_SETTING_KEYS = new Set(Object.keys(PROJECT_DEFAULTS))

function personalSettings(home: string): Record<string, unknown> {
  const config = loadUserConfig(home)
  return {
    ...PERSONAL_DEFAULTS,
    ...config.preferences,
    lastChatModel: config.defaults.models.chat ?? PERSONAL_DEFAULTS.lastChatModel,
    lastInlineModel: config.defaults.models.inline ?? PERSONAL_DEFAULTS.lastInlineModel,
    lastGhostModel: config.defaults.models.ghost ?? PERSONAL_DEFAULTS.lastGhostModel,
  }
}

function readSettings(tools: ToolRegistry, home: string): Record<string, unknown> {
  return {
    ...personalSettings(home),
    ...PROJECT_DEFAULTS,
    ...readProjectSettings(tools),
  }
}

function readProjectSettings(tools: ToolRegistry): Record<string, unknown> {
  const ws = tools.getWorkspacePath()
  if (!ws) return {}
  const path = join(ws, '.mim', 'settings.json')
  if (!existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    for (const key of PERSONAL_SETTING_KEYS) delete raw[key]
    return raw
  } catch {
    return {}
  }
}

function settingsPath(tools: ToolRegistry): string {
  const ws = tools.getWorkspacePath()
  if (!ws) throw new Error('No workspace open')
  return join(ws, '.mim', 'settings.json')
}

export function readTraceRetentionDays(workspacePath: string | null | undefined): number | undefined {
  if (!workspacePath) return undefined
  try {
    const path = join(workspacePath, '.mim', 'settings.json')
    if (!existsSync(path)) return DEFAULT_TRACE_RETENTION_DAYS
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { traceRetentionDays?: unknown }
    return normalizeTraceRetentionDays(raw.traceRetentionDays)
  } catch {
    return DEFAULT_TRACE_RETENTION_DAYS
  }
}

export function readTraceCaptureContent(workspacePath: string | null | undefined): boolean {
  if (!workspacePath) return true
  try {
    const path = join(workspacePath, '.mim', 'settings.json')
    if (!existsSync(path)) return true
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { traceCaptureContent?: unknown }
    return raw.traceCaptureContent !== false
  } catch {
    return true
  }
}

export function readHistoryEnabled(workspacePath: string | null | undefined): boolean {
  if (!workspacePath) return true
  try {
    const path = join(workspacePath, '.mim', 'settings.json')
    if (!existsSync(path)) return true
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { historyEnabled?: unknown }
    return raw.historyEnabled !== false
  } catch {
    return true
  }
}

export function readTracePayloadRetentionDays(workspacePath: string | null | undefined): number {
  return readNumericWorkspaceSetting(
    workspacePath,
    'tracePayloadRetentionDays',
    DEFAULT_TRACE_PAYLOAD_RETENTION_DAYS,
    value => Math.max(1, Math.min(365, Math.floor(value))),
  )
}

export function readTracePayloadMaxBytes(workspacePath: string | null | undefined): number {
  return readNumericWorkspaceSetting(
    workspacePath,
    'tracePayloadMaxBytes',
    DEFAULT_TRACE_PAYLOAD_MAX_BYTES,
    value => normalizeStorageBytes(value, DEFAULT_TRACE_PAYLOAD_MAX_BYTES),
  )
}

export function readHistoryMaxBytes(workspacePath: string | null | undefined): number {
  return readNumericWorkspaceSetting(
    workspacePath,
    'historyMaxBytes',
    DEFAULT_HISTORY_MAX_BYTES,
    value => normalizeStorageBytes(value, DEFAULT_HISTORY_MAX_BYTES),
  )
}

function readNumericWorkspaceSetting(
  workspacePath: string | null | undefined,
  key: string,
  fallback: number,
  normalize: (value: number) => number,
): number {
  if (!workspacePath) return fallback
  try {
    const path = join(workspacePath, '.mim', 'settings.json')
    if (!existsSync(path)) return fallback
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const value = raw[key]
    return typeof value === 'number' && Number.isFinite(value) ? normalize(value) : fallback
  } catch {
    return fallback
  }
}

function normalizeStorageBytes(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1024 * 1024, Math.min(100 * 1024 * 1024 * 1024, Math.floor(value)))
}

export function readReferencesBibPath(workspacePath: string | null | undefined): string {
  return readReferencesBibPathSetting(workspacePath).path
}

export function readReferencesBibPathSetting(workspacePath: string | null | undefined): { path: string; explicit: boolean } {
  if (!workspacePath) return { path: DEFAULT_REFERENCES_BIB_PATH, explicit: false }
  try {
    const path = join(workspacePath, '.mim', 'settings.json')
    if (!existsSync(path)) return { path: DEFAULT_REFERENCES_BIB_PATH, explicit: false }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { 'references.bibPath'?: unknown }
    return {
      path: normalizeReferencesBibPath(raw['references.bibPath']),
      explicit: typeof raw['references.bibPath'] === 'string' && raw['references.bibPath'].trim().length > 0,
    }
  } catch {
    return { path: DEFAULT_REFERENCES_BIB_PATH, explicit: false }
  }
}

export function writeReferencesBibPath(workspacePath: string, bibPath: string): void {
  const path = join(workspacePath, '.mim', 'settings.json')
  let raw: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    } catch {
      raw = {}
    }
  }
  atomicWriteJson(path, {
    ...raw,
    'references.bibPath': normalizeReferencesBibPath(bibPath),
  })
}

function normalizeReferencesBibPath(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_REFERENCES_BIB_PATH
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_REFERENCES_BIB_PATH
}

function normalizeTraceRetentionDays(value: unknown): number | undefined {
  if (value === 0) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_TRACE_RETENTION_DAYS
  }
  return Math.max(1, Math.min(3650, Math.floor(value)))
}

function writeProjectSetting(tools: ToolRegistry, key: string, value: unknown): void {
  const settings = readProjectSettings(tools)
  settings[key] = value
  atomicWriteJson(settingsPath(tools), settings)
}

export function readPersonalApprovalMode(home = userHomeDir()): 'normal' | 'strict' | 'developer' {
  const value = loadUserConfig(home).preferences.automationApprovalMode
  return value ?? 'normal'
}

export function registerSettingsTools(
  tools: ToolRegistry,
  options?: { onChange?: () => void; homeDir?: string },
): void {
  const home = options?.homeDir ?? userHomeDir()

  tools.register({
    name: 'settings.get',
    description: 'Read all settings or a specific key',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Setting key to read, or omit for all settings' },
      },
    },
    execute: async (params) => {
      const settings = readSettings(tools, home)
      const key = params.key as string | undefined
      if (key) return { value: (settings as Record<string, unknown>)[key] ?? null }
      return { settings }
    }
  })

  tools.register({
    name: 'settings.set',
    description: 'Write a setting',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Setting key' },
        value: { description: 'Setting value' },
      },
      required: ['key', 'value'],
    },
    execute: async (params) => {
      const key = params.key as string
      const value = params.value
      if (PERSONAL_SETTING_KEYS.has(key)) {
        setPersonalSetting(key as PersonalSettingKey, value, home)
      } else if (PROJECT_SETTING_KEYS.has(key) || key in readProjectSettings(tools)) {
        writeProjectSetting(tools, key, value)
      } else {
        throw new Error(`Unknown setting: ${key}`)
      }
      options?.onChange?.()
      if (key === 'traceRetentionDays') tools.trace.prune()
      return { ok: true, key, value }
    }
  })
}
