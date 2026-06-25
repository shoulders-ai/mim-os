import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'

export interface ResearchBrowserSettings {
  enabled: boolean
  allowedDomains: string[]
  sources: ResearchBrowserSource[]
}

export type ResearchBrowserSourceStatus = 'ready' | 'needs_attention' | 'not_configured'

export interface ResearchBrowserSource {
  domain: string
  allowed: boolean
  status: ResearchBrowserSourceStatus
  attentionRequired: boolean
  lastStatus?: string
  lastSource?: string
  lastUrl?: string
  lastReadAt?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  reason?: string
}

export interface RecordResearchBrowserSourceReadParams {
  domain: string
  url: string
  status: string
  attentionRequired: boolean
  source: string
  reason?: string
  at?: string
}

export interface ResearchBrowserMatch {
  allowed: boolean
  host: string
  matchedDomain?: string
}

const DEFAULT_SETTINGS: ResearchBrowserSettings = {
  enabled: false,
  allowedDomains: [],
  sources: [],
}

export function normalizeResearchDomainPattern(input: string): string {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return ''
  const wildcard = trimmed.startsWith('*.')
  const candidate = wildcard ? trimmed.slice(2) : trimmed
  let host = candidate
  try {
    host = new URL(candidate.includes('://') ? candidate : `https://${candidate}`).hostname
  } catch {
    host = candidate.split('/')[0] ?? ''
  }
  const normalized = host.replace(/^\.+|\.+$/g, '')
  return normalized ? `${wildcard ? '*.' : ''}${normalized}` : ''
}

export function isResearchBrowserAllowed(rawUrl: string, allowedDomains: string[]): ResearchBrowserMatch {
  const host = new URL(rawUrl).hostname.toLowerCase()
  for (const rawPattern of allowedDomains) {
    const pattern = normalizeResearchDomainPattern(rawPattern)
    if (!pattern) continue
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2)
      if (host === base || host.endsWith(`.${base}`)) return { allowed: true, host, matchedDomain: pattern }
      continue
    }
    if (host === pattern) return { allowed: true, host, matchedDomain: pattern }
  }
  return { allowed: false, host }
}

export function readResearchBrowserSettings(workspacePath: string | null | undefined): ResearchBrowserSettings {
  if (!workspacePath) return { ...DEFAULT_SETTINGS }
  try {
    const raw = readRawSettings(workspacePath)
    const nested = raw.researchBrowser
    if (!nested || typeof nested !== 'object') return { ...DEFAULT_SETTINGS }
    const record = nested as Record<string, unknown>
    const allowedDomains = normalizeDomainList(record.allowedDomains)
    return {
      enabled: record.enabled === true,
      allowedDomains,
      sources: normalizeSources(record.sources, allowedDomains),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeResearchBrowserSettings(workspacePath: string, settings: ResearchBrowserSettings): void {
  const raw = readRawSettings(workspacePath)
  atomicWriteJson(settingsPath(workspacePath), {
    ...raw,
    researchBrowser: {
      enabled: settings.enabled,
      allowedDomains: normalizeDomainList(settings.allowedDomains),
      sources: normalizeSources(settings.sources, settings.allowedDomains),
    },
  })
}

export function addResearchBrowserDomain(workspacePath: string, domain: string): ResearchBrowserSettings {
  const settings = readResearchBrowserSettings(workspacePath)
  const normalized = normalizeResearchDomainPattern(domain)
  const allowedDomains = normalized
    ? Array.from(new Set([...settings.allowedDomains, normalized]))
    : settings.allowedDomains
  const sources = upsertSource(settings.sources, {
    domain: normalized,
    allowed: true,
    status: 'ready',
    attentionRequired: false,
    consecutiveFailures: 0,
  })
  const next = { enabled: true, allowedDomains, sources: normalized ? sources : settings.sources }
  writeResearchBrowserSettings(workspacePath, next)
  return next
}

export function removeResearchBrowserDomain(workspacePath: string, domain: string): ResearchBrowserSettings {
  const settings = readResearchBrowserSettings(workspacePath)
  const normalized = normalizeResearchDomainPattern(domain)
  const next = {
    enabled: settings.enabled,
    allowedDomains: settings.allowedDomains.filter(item => normalizeResearchDomainPattern(item) !== normalized),
    sources: settings.sources.filter(item => normalizeResearchDomainPattern(item.domain) !== normalized),
  }
  writeResearchBrowserSettings(workspacePath, next)
  return next
}

export function recordResearchBrowserSourceRead(
  workspacePath: string | null | undefined,
  params: RecordResearchBrowserSourceReadParams,
): ResearchBrowserSettings {
  if (!workspacePath) return { ...DEFAULT_SETTINGS }
  const settings = readResearchBrowserSettings(workspacePath)
  const domain = normalizeResearchDomainPattern(params.domain)
  if (!domain) return settings
  const allowed = settings.allowedDomains.some(item => normalizeResearchDomainPattern(item) === domain)
  const at = params.at ?? new Date().toISOString()
  const current = settings.sources.find(item => normalizeResearchDomainPattern(item.domain) === domain)
  const isSuccess = params.attentionRequired === false && (params.status === 'ok' || params.status === 'partial')
  const nextSource: ResearchBrowserSource = {
    ...(current ?? {
      domain,
      allowed,
      status: allowed ? 'ready' : 'not_configured',
      attentionRequired: !allowed,
      consecutiveFailures: 0,
    }),
    domain,
    allowed,
    status: isSuccess ? 'ready' : (allowed ? 'needs_attention' : 'not_configured'),
    attentionRequired: params.attentionRequired,
    lastStatus: params.status,
    lastSource: params.source,
    lastUrl: params.url,
    lastReadAt: at,
    ...(isSuccess ? { lastSuccessAt: at } : {}),
    ...(!isSuccess ? { lastFailureAt: at } : {}),
    consecutiveFailures: isSuccess ? 0 : ((current?.consecutiveFailures ?? 0) + 1),
    ...(params.reason ? { reason: params.reason } : {}),
  }
  if (isSuccess && !params.reason) delete nextSource.reason
  const next = {
    ...settings,
    sources: upsertSource(settings.sources, nextSource),
  }
  writeResearchBrowserSettings(workspacePath, next)
  return next
}

function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeResearchDomainPattern)
      .filter(Boolean),
  ))
}

function normalizeSources(value: unknown, allowedDomains: string[]): ResearchBrowserSource[] {
  const allowed = new Set(normalizeDomainList(allowedDomains))
  const sources = new Map<string, ResearchBrowserSource>()
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const domain = normalizeResearchDomainPattern(typeof record.domain === 'string' ? record.domain : '')
      if (!domain) continue
      const isAllowed = allowed.has(domain)
      sources.set(domain, {
        domain,
        allowed: isAllowed,
        status: normalizeSourceStatus(record.status, isAllowed),
        attentionRequired: record.attentionRequired === true,
        ...(typeof record.lastStatus === 'string' ? { lastStatus: record.lastStatus } : {}),
        ...(typeof record.lastSource === 'string' ? { lastSource: record.lastSource } : {}),
        ...(typeof record.lastUrl === 'string' ? { lastUrl: record.lastUrl } : {}),
        ...(typeof record.lastReadAt === 'string' ? { lastReadAt: record.lastReadAt } : {}),
        ...(typeof record.lastSuccessAt === 'string' ? { lastSuccessAt: record.lastSuccessAt } : {}),
        ...(typeof record.lastFailureAt === 'string' ? { lastFailureAt: record.lastFailureAt } : {}),
        consecutiveFailures: normalizeFailureCount(record.consecutiveFailures),
        ...(typeof record.reason === 'string' && record.reason.trim() ? { reason: record.reason } : {}),
      })
    }
  }
  for (const domain of allowed) {
    if (!sources.has(domain)) {
      sources.set(domain, {
        domain,
        allowed: true,
        status: 'ready',
        attentionRequired: false,
        consecutiveFailures: 0,
      })
    }
  }
  return Array.from(sources.values())
}

function normalizeSourceStatus(value: unknown, allowed: boolean): ResearchBrowserSourceStatus {
  if (value === 'ready' || value === 'needs_attention' || value === 'not_configured') return value
  return allowed ? 'ready' : 'not_configured'
}

function normalizeFailureCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function upsertSource(sources: ResearchBrowserSource[], source: ResearchBrowserSource): ResearchBrowserSource[] {
  const normalized = normalizeResearchDomainPattern(source.domain)
  if (!normalized) return sources
  const next = [...sources]
  const index = next.findIndex(item => normalizeResearchDomainPattern(item.domain) === normalized)
  if (index >= 0) {
    next[index] = { ...source, domain: normalized }
    return next
  }
  next.push({ ...source, domain: normalized })
  return next
}

function settingsPath(workspacePath: string): string {
  return join(workspacePath, '.mim', 'settings.json')
}

function readRawSettings(workspacePath: string): Record<string, unknown> {
  const path = settingsPath(workspacePath)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}
