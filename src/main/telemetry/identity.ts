import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, chmodSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes, randomUUID as nodeRandomUUID } from 'crypto'
import { userHomeDir } from '@main/platform.js'

export interface TelemetryIdentity {
  anonId: string
  enabled: boolean
  firstSeen: string
}

export interface TelemetryIdentityOptions {
  home?: string
  now?: () => Date
  randomUUID?: () => string
}

const SAFE_UUID_RE = /^[A-Za-z0-9._:-]{1,128}$/

export function telemetryIdentityPath(home?: string): string {
  return join(home ?? userHomeDir(), '.mim', 'telemetry.json')
}

export function readTelemetryIdentity(options: TelemetryIdentityOptions = {}): TelemetryIdentity {
  const path = telemetryIdentityPath(options.home)
  const existing = readExistingIdentity(path)
  if (existing) return existing

  const identity: TelemetryIdentity = {
    anonId: (options.randomUUID ?? nodeRandomUUID)(),
    enabled: true,
    firstSeen: currentDate(options.now).toISOString(),
  }
  writeTelemetryIdentity(identity, options)
  return identity
}

export function writeTelemetryIdentity(
  identity: TelemetryIdentity,
  options: Pick<TelemetryIdentityOptions, 'home'> = {},
): void {
  if (!SAFE_UUID_RE.test(identity.anonId)) throw new Error('Invalid telemetry anonId')
  const firstSeen = new Date(identity.firstSeen)
  if (!Number.isFinite(firstSeen.getTime())) throw new Error('Invalid telemetry firstSeen')

  const path = telemetryIdentityPath(options.home)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`
  try {
    writeFileSync(tmp, JSON.stringify({
      anonId: identity.anonId,
      enabled: identity.enabled === true,
      firstSeen: firstSeen.toISOString(),
    }, null, 2), { encoding: 'utf-8', mode: 0o600 })
    try { chmodSync(tmp, 0o600) } catch { /* chmod can fail on some filesystems */ }
    renameSync(tmp, path)
    try { chmodSync(path, 0o600) } catch { /* best-effort permissions */ }
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* temp may not exist */ }
    throw err
  }
}

export function setTelemetryIdentityEnabled(
  enabled: boolean,
  options: TelemetryIdentityOptions = {},
): TelemetryIdentity {
  const identity = readTelemetryIdentity(options)
  const next = { ...identity, enabled }
  writeTelemetryIdentity(next, options)
  return next
}

function readExistingIdentity(path: string): TelemetryIdentity | null {
  try {
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    if (!raw || typeof raw !== 'object') return null
    if (typeof raw.anonId !== 'string' || !SAFE_UUID_RE.test(raw.anonId)) return null
    const firstSeen = typeof raw.firstSeen === 'string' ? new Date(raw.firstSeen) : null
    if (!firstSeen || !Number.isFinite(firstSeen.getTime())) return null
    return {
      anonId: raw.anonId,
      enabled: raw.enabled !== false,
      firstSeen: firstSeen.toISOString(),
    }
  } catch {
    return null
  }
}

function currentDate(now?: () => Date): Date {
  try {
    const value = now?.()
    return value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date()
  } catch {
    return new Date()
  }
}
