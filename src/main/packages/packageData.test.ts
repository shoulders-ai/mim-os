import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createPackageDataApi } from '@main/packages/packageData.js'

describe('package data', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-data-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips package-scoped kv values', () => {
    const data = createPackageDataApi(dir, 'stats-checker')

    data.kv.set('settings', { enabled: true })

    expect(data.kv.get('settings')).toEqual({ enabled: true })
    expect(data.kv.keys()).toEqual(['settings'])
    data.kv.delete('settings')
    expect(data.kv.get('settings')).toBeNull()
  })

  it('round-trips package-scoped collection records in stable order', () => {
    const data = createPackageDataApi(dir, 'stats-checker')
    const reports = data.collection('reports')

    reports.put('b', { score: 2 })
    reports.put('a', { score: 1 })

    expect(reports.get('a')).toEqual({ score: 1 })
    expect(reports.list()).toEqual([
      { id: 'a', value: { score: 1 } },
      { id: 'b', value: { score: 2 } },
    ])
  })

  it('does not let callers escape data paths through keys', () => {
    const data = createPackageDataApi(dir, 'stats-checker')
    expect(() => data.kv.set('../other', true)).toThrow('Invalid package data key')
  })
})
