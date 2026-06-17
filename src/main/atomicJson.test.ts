import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { atomicWriteJson } from '@main/atomicJson.js'

describe('atomicWriteJson', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-atomic-json-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes JSON content that round-trips correctly', () => {
    const target = join(dir, 'data.json')
    const payload = { name: 'test', items: [1, 2, 3], nested: { ok: true } }
    atomicWriteJson(target, payload)
    const read = JSON.parse(readFileSync(target, 'utf-8'))
    expect(read).toEqual(payload)
  })

  it('overwrites an existing file atomically', () => {
    const target = join(dir, 'data.json')
    atomicWriteJson(target, { version: 1 })
    atomicWriteJson(target, { version: 2 })
    const read = JSON.parse(readFileSync(target, 'utf-8'))
    expect(read).toEqual({ version: 2 })
  })

  it('does not leave a tmp file on success', () => {
    const target = join(dir, 'clean.json')
    atomicWriteJson(target, { ok: true })
    const files = readdirSync(dir)
    expect(files).toEqual(['clean.json'])
  })

  it('preserves the existing file when write fails', async () => {
    const target = join(dir, 'precious.json')
    writeFileSync(target, JSON.stringify({ original: true }, null, 2))

    // Simulate a write failure by passing an object with a toJSON that throws
    const poison = {
      toJSON() {
        throw new Error('serialization bomb')
      },
    }

    expect(() => atomicWriteJson(target, poison)).toThrow('serialization bomb')

    // Original file must survive
    const read = JSON.parse(readFileSync(target, 'utf-8'))
    expect(read).toEqual({ original: true })

    // No leftover tmp file
    const files = readdirSync(dir)
    expect(files).toEqual(['precious.json'])
  })

  it('creates parent directories if needed', () => {
    const target = join(dir, 'sub', 'deep', 'file.json')
    atomicWriteJson(target, { deep: true })
    expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ deep: true })
  })

  it('pretty-prints with 2-space indent', () => {
    const target = join(dir, 'pretty.json')
    atomicWriteJson(target, { a: 1 })
    const raw = readFileSync(target, 'utf-8')
    expect(raw).toBe('{\n  "a": 1\n}')
  })
})
