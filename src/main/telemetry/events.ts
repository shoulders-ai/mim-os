import type { TraceEvent } from '@main/trace/trace.js'

export type TelemetryEventType =
  | 'app_open'
  | 'workspace_open'
  | 'chat_send'
  | 'model_call'
  | 'tool_use'
  | 'tool_error'
  | 'package_run'
  | 'gate_decision'
  | 'export'
  | 'file_open'
  | 'theme_change'
  | 'ghost_accept'

export interface TelemetryEvent {
  eventType: TelemetryEventType
  props: Record<string, string | number | boolean>
}

export interface TelemetryEventOptions {
  knownModels?: Set<string>
}

const TELEMETRY_EVENTS = new Set<TelemetryEventType>([
  'app_open',
  'workspace_open',
  'chat_send',
  'model_call',
  'tool_use',
  'tool_error',
  'package_run',
  'gate_decision',
  'export',
  'file_open',
  'theme_change',
  'ghost_accept',
])

const ACTORS = new Set(['user', 'ai', 'package', 'system'])
const PROFILES = new Set(['chat', 'inline', 'ghost', 'extract', 'summary', 'object'])
const PLATFORMS = new Set(['macos', 'windows', 'linux'])
const RUNTIMES = new Set(['electron', 'headless'])
const DECISIONS = new Set(['allowed', 'requested', 'approved', 'denied', 'bypassed'])
const FORMATS = new Set(['pdf', 'docx'])
const SURFACES = new Set(['editor', 'pdf', 'card', 'native', 'other'])
const THEMES = new Set(['parchment', 'glacier', 'sage', 'white', 'slate', 'monokai', 'nord', 'dracula'])
const GHOST_MODES = new Set(['full', 'word', 'other'])

const SAFE_ID_RE = /^[A-Za-z0-9._:-]{1,100}$/
const SAFE_TOOL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const SAFE_PACKAGE_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/
const SAFE_EXT_RE = /^[a-z0-9]{1,8}$/
const MAX_COUNT = 10_000_000
const MAX_COST = 10_000

export function sanitizeTelemetryEvent(
  event: unknown,
  props: unknown = {},
  options: TelemetryEventOptions = {},
): TelemetryEvent | null {
  if (typeof event !== 'string' || !TELEMETRY_EVENTS.has(event as TelemetryEventType)) return null
  const input = objectValue(props)
  const eventType = event as TelemetryEventType
  const out: TelemetryEvent['props'] = {}

  switch (eventType) {
    case 'app_open': {
      addString(out, 'appVersion', safeString(input.appVersion, 40))
      addEnum(out, 'platform', input.platform, PLATFORMS)
      addEnum(out, 'runtime', input.runtime, RUNTIMES)
      break
    }
    case 'workspace_open':
      break
    case 'chat_send':
      addString(out, 'model', normalizeModel(input.model, options.knownModels))
      break
    case 'model_call':
      addString(out, 'model', normalizeModel(input.model, options.knownModels))
      if (Object.prototype.hasOwnProperty.call(input, 'profile')) {
        addString(out, 'profile', normalizeProfile(input.profile))
      }
      addNumber(out, 'inputTokens', count(input.inputTokens))
      addNumber(out, 'outputTokens', count(input.outputTokens))
      addNumber(out, 'totalTokens', count(input.totalTokens))
      addNumber(out, 'estimatedCost', cost(input.estimatedCost))
      break
    case 'tool_use':
    case 'tool_error':
      addString(out, 'tool', normalizeTool(input.tool))
      addEnum(out, 'actor', input.actor, ACTORS)
      addString(out, 'durationBucket', durationBucket(input.durationMs))
      break
    case 'package_run':
      addString(out, 'packageId', normalizePackageId(input.packageId))
      addEnum(out, 'status', input.status, new Set(['completed', 'failed', 'cancelled']))
      addString(out, 'durationBucket', durationBucket(input.durationMs))
      break
    case 'gate_decision':
      addString(out, 'tool', normalizeTool(input.tool))
      addEnum(out, 'decision', input.decision, DECISIONS)
      break
    case 'export':
      addEnum(out, 'format', input.format, FORMATS)
      break
    case 'file_open':
      addString(out, 'ext', normalizeExt(input.ext))
      addEnum(out, 'surface', input.surface, SURFACES)
      break
    case 'theme_change':
      addEnum(out, 'theme', input.theme, THEMES)
      break
    case 'ghost_accept':
      addEnum(out, 'mode', input.mode, GHOST_MODES)
      break
  }

  return { eventType, props: out }
}

export function mapTraceToTelemetryEvent(
  event: TraceEvent,
  options: TelemetryEventOptions = {},
): TelemetryEvent | null {
  if (event.tool?.startsWith('telemetry.')) return null

  if (event.kind === 'chat.turn') {
    if (event.data?.profile !== 'chat') return null
    return sanitizeTelemetryEvent('chat_send', { model: event.model }, options)
  }

  if (event.kind === 'model.call') {
    return sanitizeTelemetryEvent('model_call', {
      model: event.model,
      profile: event.data?.profile,
      inputTokens: event.data?.inputTokens,
      outputTokens: event.data?.outputTokens,
      totalTokens: event.data?.totalTokens,
      estimatedCost: event.data?.estimatedCost,
    }, options)
  }

  if (event.kind === 'tool.result') {
    if (event.tool === 'export.pdf' || event.tool === 'export.docx') {
      return sanitizeTelemetryEvent('export', {
        format: event.tool === 'export.pdf' ? 'pdf' : 'docx',
      }, options)
    }
    return sanitizeTelemetryEvent('tool_use', {
      tool: event.tool,
      actor: event.actor,
      durationMs: event.durationMs,
    }, options)
  }

  if (event.kind === 'tool.error') {
    return sanitizeTelemetryEvent('tool_error', {
      tool: event.tool,
      actor: event.actor,
      durationMs: event.durationMs,
    }, options)
  }

  if (event.kind === 'job.done' || event.kind === 'job.failed' || event.kind === 'job.cancelled') {
    const status = event.kind === 'job.done'
      ? 'completed'
      : event.kind === 'job.failed'
        ? 'failed'
        : 'cancelled'
    return sanitizeTelemetryEvent('package_run', {
      packageId: event.packageId,
      status,
      durationMs: event.durationMs,
    }, options)
  }

  if (event.kind === 'gate.decision') {
    return sanitizeTelemetryEvent('gate_decision', {
      tool: event.tool,
      decision: event.data?.decision,
    }, options)
  }

  return null
}

export function durationBucket(value: unknown): string {
  const duration = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (duration < 1000) return '<1s'
  if (duration < 5000) return '1-5s'
  if (duration < 30000) return '5-30s'
  return '>30s'
}

export function normalizePlatform(value: NodeJS.Platform | string): 'macos' | 'windows' | 'linux' {
  if (value === 'darwin' || value === 'macos') return 'macos'
  if (value === 'win32' || value === 'windows') return 'windows'
  return 'linux'
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeModel(value: unknown, knownModels?: Set<string>): string | undefined {
  const safe = safeString(value, 100)
  if (!safe || !SAFE_ID_RE.test(safe)) return 'custom'
  if (knownModels && !knownModels.has(safe)) return 'custom'
  return safe
}

function normalizeProfile(value: unknown): string {
  const raw = typeof value === 'string' ? value : ''
  return PROFILES.has(raw) ? raw : 'other'
}

function normalizeTool(value: unknown): string | undefined {
  const safe = safeString(value, 100)
  return safe && SAFE_TOOL_RE.test(safe) ? safe : undefined
}

function normalizePackageId(value: unknown): string | undefined {
  const safe = safeString(value, 80)
  return safe && SAFE_PACKAGE_RE.test(safe) ? safe : undefined
}

function normalizeExt(value: unknown): string {
  const raw = typeof value === 'string' ? value.toLowerCase().replace(/^\./, '') : ''
  if (!raw) return 'none'
  return SAFE_EXT_RE.test(raw) ? raw : 'other'
}

function count(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.min(MAX_COUNT, Math.floor(value))
}

function cost(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  const rounded = Math.round(Math.min(MAX_COST, value) * 1_000_000) / 1_000_000
  return rounded
}

function safeString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return undefined
  return trimmed
}

function addString(target: TelemetryEvent['props'], key: string, value: string | undefined): void {
  if (value !== undefined) target[key] = value
}

function addNumber(target: TelemetryEvent['props'], key: string, value: number | undefined): void {
  if (value !== undefined) target[key] = value
}

function addEnum(target: TelemetryEvent['props'], key: string, value: unknown, allowed: Set<string>): void {
  if (typeof value === 'string' && allowed.has(value)) target[key] = value
}
