import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { registryMirrorDir, urlIndexCacheFile } from '@main/packages/cacheLayout.js'
import { DEFAULT_REGISTRY_URL, DEFAULT_REGISTRY_INDEX_URL } from '@main/userConfig.js'
import { dirname } from 'path'
import type { RegistrySource } from '@main/packages/registrySources.js'

// Mock git operations — updateCheck never does network.
vi.mock('@main/git.js', () => ({
  cloneRepo: vi.fn(),
  pullRepo: vi.fn(),
  hasSystemGit: vi.fn().mockResolvedValue(false),
  isSshUrl: vi.fn().mockReturnValue(false),
  buildAuthedUrl: vi.fn((url: string) => url),
  checkoutRef: vi.fn(),
  resolveHead: vi.fn(),
}))

import { checkForUpdates } from '@main/packages/updateCheck.js'

function validEntry(overrides?: Record<string, unknown>) {
  return {
    id: 'github-monitor',
    name: 'GitHub Monitor',
    version: '1.2.0',
    repo: 'https://github.com/shoulders-ai/mim-github-monitor',
    ref: 'v1.2.0',
    commit: 'a'.repeat(40),
    permissions: {},
    ...overrides,
  }
}

function validIndex(packages?: unknown[]) {
  return { manifestVersion: 1, packages: packages ?? [validEntry()] }
}

describe('checkForUpdates', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-update-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    mkdirSync(globalDir, { recursive: true })
    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\n')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function seedMirror(url: string, index: unknown): void {
    const mirrorDir = registryMirrorDir(url, cacheRoot)
    mkdirSync(mirrorDir, { recursive: true })
    writeFileSync(join(mirrorDir, 'index.json'), JSON.stringify(index))
  }

  function seedUrlCache(url: string, index: unknown): void {
    const cacheFile = urlIndexCacheFile(url, cacheRoot)
    mkdirSync(dirname(cacheFile), { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(index))
  }

  function seedInstalled(id: string, version: string): void {
    const pkgDir = join(globalDir, id, version)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{}')
  }

  function opts(overrides?: Partial<Parameters<typeof checkForUpdates>[0]>) {
    return {
      workspacePath: dir,
      cacheRoot,
      globalDir,
      isSourceTrusted: () => true,
      ...overrides,
    }
  }

  it('detects an update from a seeded mirror', async () => {
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([validEntry({ version: '2.0.0' })]))
    seedInstalled('github-monitor', '1.2.0')

    const result = await checkForUpdates(opts())

    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]).toEqual({
      id: 'github-monitor',
      installed: '1.2.0',
      latest: '2.0.0',
      registryId: 'default',
    })
    expect(result.checkedAt).toBeGreaterThan(0)
  })

  it('reports no update when installed version equals registry version', async () => {
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([validEntry({ version: '1.2.0' })]))
    seedInstalled('github-monitor', '1.2.0')

    const result = await checkForUpdates(opts())
    expect(result.updates).toHaveLength(0)
  })

  it('reports no update when installed version exceeds registry version', async () => {
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([validEntry({ version: '1.0.0' })]))
    seedInstalled('github-monitor', '1.2.0')

    const result = await checkForUpdates(opts())
    expect(result.updates).toHaveLength(0)
  })

  it('ignores untrusted workspace sources', async () => {
    const wsUrl = 'https://github.com/acme/registry.git'
    writeFileSync(join(dir, 'mim.yaml'), [
      'name: test-workspace',
      'registries:',
      '  acme:',
      `    git: ${wsUrl}`,
    ].join('\n') + '\n')

    seedMirror(wsUrl, validIndex([validEntry({ id: 'acme-tool', version: '2.0.0' })]))
    seedInstalled('acme-tool', '1.0.0')
    // Default has nothing.
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([]))

    const result = await checkForUpdates(opts({
      isSourceTrusted: (s: RegistrySource) => s.origin !== 'workspace',
    }))

    // acme-tool update not reported because the source is untrusted.
    expect(result.updates).toHaveLength(0)
  })

  it('ownership: workspace registry version wins over default (no update from shadowed source)', async () => {
    const wsUrl = 'https://github.com/acme/registry.git'
    writeFileSync(join(dir, 'mim.yaml'), [
      'name: test-workspace',
      'registries:',
      '  acme:',
      `    git: ${wsUrl}`,
    ].join('\n') + '\n')

    // Workspace registry owns github-monitor at 1.5.0.
    seedMirror(wsUrl, validIndex([validEntry({ version: '1.5.0' })]))
    // Default registry has a higher version (3.0.0), but it is shadowed.
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([validEntry({ version: '3.0.0' })]))
    seedInstalled('github-monitor', '1.5.0')

    const result = await checkForUpdates(opts())

    // No update: the owner (acme, version 1.5.0) matches installed.
    // The default's 3.0.0 is shadowed and must NOT produce an update.
    expect(result.updates).toHaveLength(0)
  })

  it('writes a throttle file with checkedAt', async () => {
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([]))

    const result = await checkForUpdates(opts())

    const throttlePath = join(cacheRoot, 'registry', 'last-update-check.json')
    expect(existsSync(throttlePath)).toBe(true)
    const raw = JSON.parse(readFileSync(throttlePath, 'utf-8')) as { checkedAt: number }
    expect(raw.checkedAt).toBe(result.checkedAt)
  })

  it('picks the highest installed version for comparison', async () => {
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([validEntry({ version: '2.0.0' })]))
    seedInstalled('github-monitor', '1.0.0')
    seedInstalled('github-monitor', '1.5.0')

    const result = await checkForUpdates(opts())

    expect(result.updates).toHaveLength(1)
    expect(result.updates[0].installed).toBe('1.5.0')
  })

  it('picks the highest registry version across multiple entries in the same source', async () => {
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([
      validEntry({ version: '1.0.0' }),
      validEntry({ version: '3.0.0' }),
      validEntry({ version: '2.0.0' }),
    ]))
    seedInstalled('github-monitor', '1.0.0')

    const result = await checkForUpdates(opts())

    expect(result.updates).toHaveLength(1)
    expect(result.updates[0].latest).toBe('3.0.0')
  })

  it('skips packages not installed locally', async () => {
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([validEntry({ version: '2.0.0' })]))
    // No installed version.

    const result = await checkForUpdates(opts())
    expect(result.updates).toHaveLength(0)
  })
})
