import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ToolRegistry } from '@main/tools/registry.js'
import { atomicWriteJson } from '@main/atomicJson.js'

export const DEFAULT_TRACE_RETENTION_DAYS = 90
export const DEFAULT_REFERENCES_BIB_PATH = 'references/references.bib'

interface Settings {
  theme: string
  editorFontFamily: string
  editorFontSize: number
  editorWordWrap: boolean
  editorLineNumbers: boolean
  editorSpellCheck: boolean
  lastChatModel: string
  lastInlineModel: string
  sidebarWidth: number
  rightPanelWidth: number
  terminalHeight: number
  automationApprovalMode: 'normal' | 'strict' | 'developer'
  // Positive day count prunes old trace day files; 0 disables local pruning.
  traceRetentionDays: number
  // Capture redacted model I/O and tool results as trace payload blobs so the
  // Activity surface can show what the AI said and what tools returned. Costs
  // disk, not tokens; governed by the same retention as the trace stream.
  // Secret-bearing tools never capture regardless of this flag.
  traceCaptureContent: boolean
  // CLI coding agents the user has opted into showing as Navigator launchers.
  // Detection alone never surfaces an agent (docs/agent-sessions.md).
  enabledAgents: string[]
  agentFlags: Record<string, string>
  'references.bibPath': string
}

const DEFAULTS: Settings = {
  theme: 'white',
  editorFontFamily: 'serif',
  editorFontSize: 16,
  editorWordWrap: true,
  editorLineNumbers: false,
  editorSpellCheck: false,
  lastChatModel: '',
  lastInlineModel: '',
  sidebarWidth: 220,
  rightPanelWidth: 480,
  terminalHeight: 220,
  automationApprovalMode: 'normal',
  traceRetentionDays: DEFAULT_TRACE_RETENTION_DAYS,
  traceCaptureContent: true,
  enabledAgents: [],
  agentFlags: {},
  'references.bibPath': DEFAULT_REFERENCES_BIB_PATH,
}

function settingsPath(tools: ToolRegistry): string {
  const ws = tools.getWorkspacePath()
  if (!ws) throw new Error('No workspace open')
  return join(ws, '.mim', 'settings.json')
}

function readSettings(tools: ToolRegistry): Settings {
  const path = settingsPath(tools)
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
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
  if (value === 0) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_TRACE_RETENTION_DAYS
  }
  return Math.max(1, Math.min(3650, Math.floor(value)))
}

function writeSettings(tools: ToolRegistry, settings: Settings): void {
  atomicWriteJson(settingsPath(tools), settings)
}

export function registerSettingsTools(tools: ToolRegistry): void {

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
      const settings = readSettings(tools)
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
      const settings = readSettings(tools)
      ;(settings as Record<string, unknown>)[key] = value
      writeSettings(tools, settings)
      return { ok: true, key, value }
    }
  })
}
