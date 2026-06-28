import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'

export interface BrowserSessionSettings {
  enabled: boolean
  allowedDomains: string[]
}

export interface BrowserSessionMatch {
  allowed: boolean
  host: string
  matchedDomain?: string
}

const DEFAULT_SETTINGS: BrowserSessionSettings = {
  enabled: false,
  allowedDomains: [],
}

export function normalizeBrowserSessionDomainPattern(input: string): string {
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

export function isBrowserSessionAllowed(rawUrl: string, allowedDomains: string[]): BrowserSessionMatch {
  const host = new URL(rawUrl).hostname.toLowerCase()
  for (const rawPattern of allowedDomains) {
    const pattern = normalizeBrowserSessionDomainPattern(rawPattern)
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

export function readBrowserSessionSettings(workspacePath: string | null | undefined): BrowserSessionSettings {
  if (!workspacePath) return { ...DEFAULT_SETTINGS }
  try {
    const raw = readRawSettings(workspacePath)
    const nested = raw.browserSession
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

export function writeBrowserSessionSettings(workspacePath: string, settings: BrowserSessionSettings): void {
  const raw = readRawSettings(workspacePath)
  atomicWriteJson(settingsPath(workspacePath), {
    ...raw,
    browserSession: {
      enabled: settings.enabled,
      allowedDomains: normalizeDomainList(settings.allowedDomains),
    },
  })
}

export function addBrowserSessionDomain(workspacePath: string, domain: string): BrowserSessionSettings {
  const settings = readBrowserSessionSettings(workspacePath)
  const normalized = normalizeBrowserSessionDomainPattern(domain)
  const allowedDomains = normalized
    ? Array.from(new Set([...settings.allowedDomains, normalized]))
    : settings.allowedDomains
  const next = { enabled: true, allowedDomains }
  writeBrowserSessionSettings(workspacePath, next)
  return next
}

export function removeBrowserSessionDomain(workspacePath: string, domain: string): BrowserSessionSettings {
  const settings = readBrowserSessionSettings(workspacePath)
  const normalized = normalizeBrowserSessionDomainPattern(domain)
  const next = {
    enabled: settings.enabled,
    allowedDomains: settings.allowedDomains.filter(item => normalizeBrowserSessionDomainPattern(item) !== normalized),
  }
  writeBrowserSessionSettings(workspacePath, next)
  return next
}

function normalizeDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeBrowserSessionDomainPattern)
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
