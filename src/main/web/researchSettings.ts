import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'

export interface ResearchBrowserSettings {
  enabled: boolean
  allowedDomains: string[]
}

export interface ResearchBrowserMatch {
  allowed: boolean
  host: string
  matchedDomain?: string
}

const DEFAULT_SETTINGS: ResearchBrowserSettings = {
  enabled: false,
  allowedDomains: [],
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
    return {
      enabled: record.enabled === true,
      allowedDomains: normalizeDomainList(record.allowedDomains),
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
    },
  })
}

export function addResearchBrowserDomain(workspacePath: string, domain: string): ResearchBrowserSettings {
  const settings = readResearchBrowserSettings(workspacePath)
  const normalized = normalizeResearchDomainPattern(domain)
  const allowedDomains = normalized
    ? Array.from(new Set([...settings.allowedDomains, normalized]))
    : settings.allowedDomains
  const next = { enabled: true, allowedDomains }
  writeResearchBrowserSettings(workspacePath, next)
  return next
}

export function removeResearchBrowserDomain(workspacePath: string, domain: string): ResearchBrowserSettings {
  const settings = readResearchBrowserSettings(workspacePath)
  const normalized = normalizeResearchDomainPattern(domain)
  const next = {
    enabled: settings.enabled,
    allowedDomains: settings.allowedDomains.filter(item => normalizeResearchDomainPattern(item) !== normalized),
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
