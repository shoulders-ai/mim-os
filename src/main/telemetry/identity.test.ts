import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  readTelemetryIdentity,
  setTelemetryIdentityEnabled,
  telemetryIdentityPath,
  writeTelemetryIdentity,
} from './identity.js'

describe('telemetry identity', () => {
  let home: string
  let index = 0

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-telemetry-home-'))
    index = 0
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('generates and persists an anon id once', () => {
    const first = readTelemetryIdentity({
      home,
      now: () => new Date('2026-06-14T12:00:00.000Z'),
      randomUUID: () => `id-${++index}`,
    })
    const second = readTelemetryIdentity({
      home,
      randomUUID: () => `id-${++index}`,
    })

    expect(first).toEqual({
      anonId: 'id-1',
      enabled: true,
      firstSeen: '2026-06-14T12:00:00.000Z',
    })
    expect(second.anonId).toBe('id-1')
    expect(index).toBe(1)
  })

  it('round-trips the enabled flag without rotating anon id', () => {
    const initial = readTelemetryIdentity({ home, randomUUID: () => 'stable-id' })
    const disabled = setTelemetryIdentityEnabled(false, { home })
    const enabled = setTelemetryIdentityEnabled(true, { home })

    expect(disabled).toMatchObject({ anonId: initial.anonId, enabled: false })
    expect(enabled).toMatchObject({ anonId: initial.anonId, enabled: true })
  })

  it('regenerates malformed identity files', () => {
    mkdirSync(join(home, '.mim'), { recursive: true })
    writeFileSync(telemetryIdentityPath(home), '{ nope')

    const identity = readTelemetryIdentity({
      home,
      randomUUID: () => 'replacement-id',
      now: () => new Date('2026-06-15T00:00:00.000Z'),
    })

    expect(identity).toEqual({
      anonId: 'replacement-id',
      enabled: true,
      firstSeen: '2026-06-15T00:00:00.000Z',
    })
  })

  it('writes identity with restrictive permissions where supported', () => {
    const identity = readTelemetryIdentity({ home, randomUUID: () => 'mode-id' })
    const mode = statSync(telemetryIdentityPath(home)).mode & 0o777

    expect(identity.anonId).toBe('mode-id')
    expect(mode & 0o077).toBe(0)
  })

  it('atomically replaces existing identity content', () => {
    readTelemetryIdentity({ home, randomUUID: () => 'original-id' })
    writeTelemetryIdentity({
      anonId: 'next-id',
      enabled: false,
      firstSeen: '2026-06-14T12:00:00.000Z',
    }, { home })

    const raw = JSON.parse(readFileSync(telemetryIdentityPath(home), 'utf-8'))
    expect(raw).toEqual({
      anonId: 'next-id',
      enabled: false,
      firstSeen: '2026-06-14T12:00:00.000Z',
    })
    expect(existsSync(`${telemetryIdentityPath(home)}.tmp`)).toBe(false)
  })
})
