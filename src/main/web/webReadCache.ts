import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'

export interface WebReadCacheEntry {
  url: string
  finalUrl: string
  title: string
  content: string
  length: number
  sourceDomain?: string
  createdAt: string
}

export interface WebReadCache {
  entries: WebReadCacheEntry[]
}

const DEFAULT_MAX_ENTRIES = 100

export function readWebReadCache(workspacePath: string | null | undefined): WebReadCache {
  if (!workspacePath) return { entries: [] }
  try {
    const path = cachePath(workspacePath)
    if (!existsSync(path)) return { entries: [] }
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    return { entries: normalizeEntries(raw.entries) }
  } catch {
    return { entries: [] }
  }
}

export function putWebReadCacheEntry(
  workspacePath: string | null | undefined,
  entry: WebReadCacheEntry,
  options: { maxEntries?: number } = {},
): WebReadCache {
  if (!workspacePath) return { entries: [] }
  const normalized = normalizeEntry(entry)
  if (!normalized) return readWebReadCache(workspacePath)
  const current = readWebReadCache(workspacePath)
  const key = cacheKey(normalized.url)
  const entries = [
    normalized,
    ...current.entries.filter(item => cacheKey(item.url) !== key),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const next = {
    entries: entries.slice(0, normalizeMaxEntries(options.maxEntries)),
  }
  atomicWriteJson(cachePath(workspacePath), next)
  return next
}

export function getWebReadCacheEntry(
  workspacePath: string | null | undefined,
  rawUrl: string,
  options: { now?: Date, maxAgeMs?: number } = {},
): WebReadCacheEntry | null {
  const key = cacheKey(rawUrl)
  if (!key) return null
  const now = options.now ?? new Date()
  const maxAgeMs = typeof options.maxAgeMs === 'number' && Number.isFinite(options.maxAgeMs)
    ? Math.max(0, options.maxAgeMs)
    : Infinity
  const entry = readWebReadCache(workspacePath).entries.find(item => cacheKey(item.url) === key)
  if (!entry) return null
  const age = now.getTime() - new Date(entry.createdAt).getTime()
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null
  return entry
}

function normalizeEntries(value: unknown): WebReadCacheEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeEntry)
    .filter((entry): entry is WebReadCacheEntry => Boolean(entry))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function normalizeEntry(value: unknown): WebReadCacheEntry | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.url !== 'string' || typeof record.content !== 'string') return null
  const url = cacheKey(record.url)
  if (!url) return null
  const createdAt = typeof record.createdAt === 'string' && !Number.isNaN(new Date(record.createdAt).getTime())
    ? record.createdAt
    : new Date().toISOString()
  return {
    url,
    finalUrl: typeof record.finalUrl === 'string' && record.finalUrl ? record.finalUrl : url,
    title: typeof record.title === 'string' ? record.title : '',
    content: record.content,
    length: typeof record.length === 'number' && Number.isFinite(record.length)
      ? Math.max(0, Math.floor(record.length))
      : record.content.length,
    ...(typeof record.sourceDomain === 'string' && record.sourceDomain ? { sourceDomain: record.sourceDomain } : {}),
    createdAt,
  }
}

function cacheKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    parsed.hash = ''
    return parsed.href
  } catch {
    return ''
  }
}

function normalizeMaxEntries(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_MAX_ENTRIES
  return Math.min(DEFAULT_MAX_ENTRIES, Math.floor(value))
}

function cachePath(workspacePath: string): string {
  return join(workspacePath, '.mim', 'web-read-cache.json')
}
