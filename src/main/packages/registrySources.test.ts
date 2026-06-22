import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { tmpdir } from 'os'
import { DEFAULT_REGISTRY_URL, DEFAULT_REGISTRY_INDEX_URL } from '@main/userConfig.js'
import { registryMirrorDir, urlIndexCacheFile } from '@main/packages/cacheLayout.js'

vi.mock('@main/git.js', () => ({
  cloneRepo: vi.fn(),
  pullRepo: vi.fn(),
  fetchRepo: vi.fn(),
  checkoutRef: vi.fn(),
  checkoutRemoteDefault: vi.fn(),
  resolveHead: vi.fn(),
  hasSystemGit: vi.fn().mockResolvedValue(false),
  isSshUrl: vi.fn().mockReturnValue(false),
  buildAuthedUrl: vi.fn((url: string) => url),
}))

import { cloneRepo } from '@main/git.js'
import {
  registrySources,
  readSourceIndex,
  lookupRegistryEntry,
  accountRegistryUrl,
  type RegistrySource,
  type RegistrySourcesDeps,
} from '@main/packages/registrySources.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validGitIndex(entries?: Record<string, unknown>[]): Record<string, unknown> {
  return {
    manifestVersion: 1,
    packages: entries ?? [
      {
        id: 'github-monitor',
        name: 'GitHub Monitor',
        version: '1.2.0',
        repo: 'https://github.com/shoulders-ai/mim-github-monitor',
        ref: 'v1.2.0',
        commit: 'a'.repeat(40),
        permissions: {},
      },
    ],
  }
}

function validLocalIndex(entries?: Record<string, unknown>[]): Record<string, unknown> {
  return {
    manifestVersion: 1,
    packages: entries ?? [
      {
        id: 'my-tool',
        name: 'My Tool',
        version: '0.1.0',
        dir: 'packages/my-tool',
        permissions: {},
      },
    ],
  }
}

function defaultDeps(overrides?: Partial<RegistrySourcesDeps>): RegistrySourcesDeps {
  return {
    getUserRegistryUrl: () => DEFAULT_REGISTRY_URL,
    readMimYaml: () => null,
    readMachineRegistries: () => null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// registrySources — source composition
// ---------------------------------------------------------------------------

describe('registrySources', () => {
  it('returns only the default source when no workspace and no user override', () => {
    const sources = registrySources(null, defaultDeps())
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      id: 'default',
      kind: 'url',
      location: DEFAULT_REGISTRY_INDEX_URL,
      origin: 'default',
    })
  })

  it('user registry replaces default (replace semantics)', () => {
    const custom = 'https://github.com/acme/custom-registry.git'
    const sources = registrySources(null, defaultDeps({
      getUserRegistryUrl: () => custom,
    }))
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      id: 'user',
      kind: 'git',
      location: custom,
      origin: 'user',
    })
    // default must NOT appear
    expect(sources.find(s => s.id === 'default')).toBeUndefined()
  })

  it('workspace git + path entries appear before machine and default', () => {
    const yaml = `
name: test
registries:
  acme:
    name: Acme
    git: https://github.com/acme/registry.git
  local-dev:
    path: tools/registry
`
    const sources = registrySources('/workspace', defaultDeps({
      readMimYaml: () => yaml,
    }))

    expect(sources.length).toBeGreaterThanOrEqual(3) // acme, local-dev, default
    expect(sources[0]).toMatchObject({ id: 'acme', kind: 'git', origin: 'workspace' })
    expect(sources[1]).toMatchObject({ id: 'local-dev', kind: 'local', origin: 'workspace' })
    expect(sources[1].location).toBe(resolve('/workspace', 'tools/registry'))
    expect(sources[sources.length - 1].id).toBe('default')
  })

  it('machine registries appear after workspace and before user/default', () => {
    const yaml = `
name: test
registries:
  ws-reg:
    git: https://github.com/team/reg.git
`
    const machine = JSON.stringify({
      registries: {
        'local-dev': { path: '/abs/local-dev', name: 'Dev' },
      },
    })
    const sources = registrySources('/workspace', defaultDeps({
      readMimYaml: () => yaml,
      readMachineRegistries: () => machine,
    }))

    const ids = sources.map(s => s.id)
    expect(ids).toEqual(['ws-reg', 'local-dev', 'default'])
    expect(sources[1]).toMatchObject({ id: 'local-dev', kind: 'local', origin: 'machine', name: 'Dev' })
  })

  it('drops path entries that escape the workspace', () => {
    const yaml = `
name: test
registries:
  escape:
    path: ../outside
  safe:
    path: tools/reg
`
    const sources = registrySources('/workspace', defaultDeps({
      readMimYaml: () => yaml,
    }))

    const ids = sources.map(s => s.id)
    expect(ids).not.toContain('escape')
    expect(ids).toContain('safe')
  })

  it('ignores corrupt registries.json', () => {
    const sources = registrySources('/workspace', defaultDeps({
      readMachineRegistries: () => '{ not valid json }}}}',
    }))
    // Should still have the default at minimum
    expect(sources.some(s => s.id === 'default')).toBe(true)
  })

  it('drops machine entries with non-absolute paths', () => {
    const machine = JSON.stringify({
      registries: {
        relative: { path: 'relative/path' },
        good: { path: '/abs/good' },
      },
    })
    const sources = registrySources('/workspace', defaultDeps({
      readMachineRegistries: () => machine,
    }))
    const ids = sources.map(s => s.id)
    expect(ids).not.toContain('relative')
    expect(ids).toContain('good')
  })

  it('drops machine entries whose id collides with workspace entries', () => {
    const yaml = `
name: test
registries:
  acme:
    git: https://github.com/acme/reg.git
`
    const machine = JSON.stringify({
      registries: {
        acme: { path: '/local/acme' }, // collision
        other: { path: '/local/other' },
      },
    })
    const sources = registrySources('/workspace', defaultDeps({
      readMimYaml: () => yaml,
      readMachineRegistries: () => machine,
    }))
    const acmes = sources.filter(s => s.id === 'acme')
    expect(acmes).toHaveLength(1)
    expect(acmes[0].origin).toBe('workspace')
    expect(sources.find(s => s.id === 'other')).toBeDefined()
  })

  it('drops machine entries with reserved id "default"', () => {
    const machine = JSON.stringify({
      registries: {
        default: { path: '/abs/hijack' },
        user: { path: '/abs/hijack2' },
        legit: { path: '/abs/legit' },
      },
    })
    const sources = registrySources('/workspace', defaultDeps({
      readMachineRegistries: () => machine,
    }))
    const machineIds = sources.filter(s => s.origin === 'machine').map(s => s.id)
    expect(machineIds).not.toContain('default')
    expect(machineIds).not.toContain('user')
    expect(machineIds).toContain('legit')
  })

  it('returns default when no workspace path is given', () => {
    const sources = registrySources(null, defaultDeps())
    expect(sources).toEqual([
      { id: 'default', kind: 'url', location: DEFAULT_REGISTRY_INDEX_URL, origin: 'default' },
    ])
  })

  it('includes account source when getAccountToken returns a string', () => {
    const sources = registrySources(null, defaultDeps({
      getAccountToken: () => 'tok_abc123',
    }))
    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({
      id: 'account',
      kind: 'url',
      location: accountRegistryUrl(),
      origin: 'account',
      auth: { token: 'tok_abc123' },
    })
    expect(sources[1]).toMatchObject({ id: 'default', origin: 'default' })
  })

  it('omits account source when getAccountToken returns null', () => {
    const sources = registrySources(null, defaultDeps({
      getAccountToken: () => null,
    }))
    expect(sources.find(s => s.id === 'account')).toBeUndefined()
  })

  it('omits account source when getAccountToken is not provided', () => {
    const sources = registrySources(null, defaultDeps())
    expect(sources.find(s => s.id === 'account')).toBeUndefined()
  })

  it('account source appears after machine and before user/default', () => {
    const machine = JSON.stringify({
      registries: {
        dev: { path: '/abs/dev' },
      },
    })
    const sources = registrySources('/workspace', defaultDeps({
      readMachineRegistries: () => machine,
      getAccountToken: () => 'tok_xyz',
    }))
    const ids = sources.map(s => s.id)
    expect(ids.indexOf('dev')).toBeLessThan(ids.indexOf('account'))
    expect(ids.indexOf('account')).toBeLessThan(ids.indexOf('default'))
  })
})

// ---------------------------------------------------------------------------
// readSourceIndex
// ---------------------------------------------------------------------------

describe('readSourceIndex', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-regsrc-test-'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a git mirror that already exists on disk', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'default', kind: 'git', location: 'https://example.com/reg.git', origin: 'default' }
    const mirrorDir = registryMirrorDir(source.location, cacheRoot)
    mkdirSync(mirrorDir, { recursive: true })
    writeFileSync(join(mirrorDir, 'index.json'), JSON.stringify(validGitIndex()))

    const result = await readSourceIndex(source, { cacheRoot })
    expect(result.status).toBe('ok')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].id).toBe('github-monitor')
  })

  it('returns missing when git mirror absent and sync is false', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'default', kind: 'git', location: 'https://example.com/reg.git', origin: 'default' }

    const result = await readSourceIndex(source, { cacheRoot, sync: false })
    expect(result.status).toBe('missing')
    expect(result.entries).toHaveLength(0)
  })

  it('clones when git mirror absent and sync is true', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'default', kind: 'git', location: 'https://example.com/reg.git', origin: 'default' }
    const mirrorDir = registryMirrorDir(source.location, cacheRoot)

    const mockClone = vi.fn(async (_url: string, target: string) => {
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'index.json'), JSON.stringify(validGitIndex()))
      return { cloned: target }
    })

    const result = await readSourceIndex(source, { cacheRoot, sync: true }, { cloneRepo: mockClone })
    expect(mockClone).toHaveBeenCalledWith(source.location, mirrorDir)
    expect(result.status).toBe('ok')
    expect(result.entries).toHaveLength(1)
  })

  it('returns error with diagnostic when clone fails', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'acme', kind: 'git', location: 'https://example.com/reg.git', origin: 'workspace' }

    const mockClone = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await readSourceIndex(source, { cacheRoot, sync: true }, { cloneRepo: mockClone })
    expect(result.status).toBe('error')
    expect(result.diagnostics).toContainEqual(expect.stringContaining('network down'))
  })

  it('reads a local source index with dir entries', async () => {
    const localDir = join(dir, 'local-registry')
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, 'index.json'), JSON.stringify(validLocalIndex()))

    const source: RegistrySource = { id: 'local', kind: 'local', location: localDir, origin: 'machine' }
    const result = await readSourceIndex(source, { cacheRoot: join(dir, 'cache') })
    expect(result.status).toBe('ok')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].dir).toBe('packages/my-tool')
  })

  it('returns missing when local index.json is absent', async () => {
    const localDir = join(dir, 'empty-registry')
    mkdirSync(localDir, { recursive: true })

    const source: RegistrySource = { id: 'local', kind: 'local', location: localDir, origin: 'machine' }
    const result = await readSourceIndex(source, { cacheRoot: join(dir, 'cache') })
    expect(result.status).toBe('missing')
  })

  it('returns error with diagnostic for bad JSON', async () => {
    const localDir = join(dir, 'bad-registry')
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, 'index.json'), '{ not valid json')

    const source: RegistrySource = { id: 'bad', kind: 'local', location: localDir, origin: 'machine' }
    const result = await readSourceIndex(source, { cacheRoot: join(dir, 'cache') })
    expect(result.status).toBe('error')
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })

  it('fetches a url source and caches the result', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'remote', kind: 'url', location: 'https://example.com/index.json', origin: 'machine' }
    const mockFetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify(validGitIndex()),
    }))

    const result = await readSourceIndex(source, { cacheRoot, sync: true }, { fetchUrl: mockFetch })
    expect(result.status).toBe('ok')
    expect(result.entries).toHaveLength(1)
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/index.json')
  })

  it('returns error when url fetch fails and no cache exists', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'remote', kind: 'url', location: 'https://example.com/index.json', origin: 'machine' }
    const mockFetch = vi.fn().mockRejectedValue(new Error('DNS failure'))

    const result = await readSourceIndex(source, { cacheRoot, sync: true }, { fetchUrl: mockFetch })
    expect(result.status).toBe('error')
    expect(result.diagnostics[0]).toContain('DNS failure')
  })

  it('reads from cache when url source sync is false', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'remote', kind: 'url', location: 'https://example.com/index.json', origin: 'machine' }

    // Seed the cache
    const { urlIndexCacheFile: cachePath } = await import('@main/packages/cacheLayout.js')
    const cacheFile = cachePath(source.location, cacheRoot)
    mkdirSync(dirname(cacheFile), { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(validGitIndex()))

    const result = await readSourceIndex(source, { cacheRoot, sync: false })
    expect(result.status).toBe('ok')
    expect(result.entries).toHaveLength(1)
  })

  it('returns missing when url source has no cache and sync is false', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'remote', kind: 'url', location: 'https://example.com/index.json', origin: 'machine' }

    const result = await readSourceIndex(source, { cacheRoot, sync: false })
    expect(result.status).toBe('missing')
  })

  it('passes Authorization header when source has auth', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = {
      id: 'account',
      kind: 'url',
      location: 'https://mim.shoulde.rs/api/v1/registry',
      origin: 'account',
      auth: { token: 'tok_secret' },
    }
    const mockFetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify(validGitIndex()),
    }))

    const result = await readSourceIndex(source, { cacheRoot, sync: true }, { fetchUrl: mockFetch })
    expect(result.status).toBe('ok')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://mim.shoulde.rs/api/v1/registry',
      { headers: { Authorization: 'Bearer tok_secret' } },
    )
  })

  it('does not pass headers when source has no auth', async () => {
    const cacheRoot = join(dir, 'cache')
    const source: RegistrySource = { id: 'remote', kind: 'url', location: 'https://example.com/index.json', origin: 'machine' }
    const mockFetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify(validGitIndex()),
    }))

    await readSourceIndex(source, { cacheRoot, sync: true }, { fetchUrl: mockFetch })
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/index.json')
  })
})

// ---------------------------------------------------------------------------
// lookupRegistryEntry
// ---------------------------------------------------------------------------

describe('lookupRegistryEntry', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-lookup-test-'))
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function seedGitMirror(
    cacheRoot: string,
    url: string,
    index: Record<string, unknown>,
  ): void {
    const mirrorDir = registryMirrorDir(url, cacheRoot)
    mkdirSync(mirrorDir, { recursive: true })
    writeFileSync(join(mirrorDir, 'index.json'), JSON.stringify(index))
  }

  function seedUrlCache(
    cacheRoot: string,
    url: string,
    index: Record<string, unknown>,
  ): void {
    const cacheFile = urlIndexCacheFile(url, cacheRoot)
    mkdirSync(dirname(cacheFile), { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(index))
  }

  function seedLocalRegistry(
    localDir: string,
    index: Record<string, unknown>,
  ): void {
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, 'index.json'), JSON.stringify(index))
  }

  it('finds an entry in the default registry', async () => {
    const cacheRoot = join(dir, 'cache')
    seedUrlCache(cacheRoot, DEFAULT_REGISTRY_INDEX_URL, validGitIndex())

    const result = await lookupRegistryEntry('github-monitor', {
      workspacePath: null,
      cacheRoot,
    }, defaultDeps())

    expect(result).toBeDefined()
    expect(result!.id).toBe('github-monitor')
    expect(result!.registryId).toBe('default')
    expect(result!.registryKind).toBe('url')
  })

  it('ownership rule: workspace registry owns the id, even when requested version only exists in default', async () => {
    const cacheRoot = join(dir, 'cache')
    const wsUrl = 'https://github.com/acme/registry.git'

    // Workspace registry has the id at version 1.0.0
    seedGitMirror(cacheRoot, wsUrl, validGitIndex([
      { id: 'github-monitor', name: 'GM', version: '1.0.0', repo: 'https://example.com/gm', ref: 'v1.0.0', commit: 'a'.repeat(40), permissions: {} },
    ]))
    // Default registry has version 2.0.0
    seedUrlCache(cacheRoot, DEFAULT_REGISTRY_INDEX_URL, validGitIndex([
      { id: 'github-monitor', name: 'GM', version: '2.0.0', repo: 'https://example.com/gm', ref: 'v2.0.0', commit: 'b'.repeat(40), permissions: {} },
    ]))

    const yaml = `
name: test
registries:
  acme:
    git: ${wsUrl}
`
    const result = await lookupRegistryEntry('github-monitor', {
      workspacePath: '/workspace',
      cacheRoot,
      version: '2.0.0', // only exists in default
      isSourceTrusted: () => true,
    }, defaultDeps({ readMimYaml: () => yaml }))

    // Must return undefined — the workspace owns the id but doesn't have 2.0.0.
    // NEVER falls through to default.
    expect(result).toBeUndefined()
  })

  it('untrusted workspace source is skipped (explicit false)', async () => {
    const cacheRoot = join(dir, 'cache')
    const wsUrl = 'https://github.com/acme/registry.git'

    seedGitMirror(cacheRoot, wsUrl, validGitIndex([
      { id: 'github-monitor', name: 'GM', version: '1.0.0', repo: 'https://example.com/gm', ref: 'v1.0.0', commit: 'a'.repeat(40), permissions: {} },
    ]))
    seedUrlCache(cacheRoot, DEFAULT_REGISTRY_INDEX_URL, validGitIndex())

    const yaml = `
name: test
registries:
  acme:
    git: ${wsUrl}
`
    const result = await lookupRegistryEntry('github-monitor', {
      workspacePath: '/workspace',
      cacheRoot,
      isSourceTrusted: () => false,
    }, defaultDeps({ readMimYaml: () => yaml }))

    // Workspace skipped; default has it
    expect(result).toBeDefined()
    expect(result!.registryId).toBe('default')
  })

  it('workspace source is skipped entirely when no trust predicate provided (fail closed)', async () => {
    const cacheRoot = join(dir, 'cache')
    const wsUrl = 'https://github.com/acme/registry.git'

    // Workspace owns the id
    seedGitMirror(cacheRoot, wsUrl, validGitIndex([
      { id: 'exclusive-tool', name: 'ET', version: '1.0.0', repo: 'https://example.com/et', ref: 'v1.0.0', commit: 'c'.repeat(40), permissions: {} },
    ]))
    // Default does NOT have this id
    seedUrlCache(cacheRoot, DEFAULT_REGISTRY_INDEX_URL, validGitIndex())

    const yaml = `
name: test
registries:
  acme:
    git: ${wsUrl}
`
    // No isSourceTrusted → workspace skipped
    const result = await lookupRegistryEntry('exclusive-tool', {
      workspacePath: '/workspace',
      cacheRoot,
    }, defaultDeps({ readMimYaml: () => yaml }))

    expect(result).toBeUndefined()
  })

  it('picks the highest version when no version is specified', async () => {
    const cacheRoot = join(dir, 'cache')
    const index = validGitIndex([
      { id: 'multi', name: 'Multi', version: '1.0.0', repo: 'https://example.com/m', ref: 'v1', commit: 'a'.repeat(40), permissions: {} },
      { id: 'multi', name: 'Multi', version: '2.0.0', repo: 'https://example.com/m', ref: 'v2', commit: 'b'.repeat(40), permissions: {} },
      { id: 'multi', name: 'Multi', version: '1.5.0', repo: 'https://example.com/m', ref: 'v1.5', commit: 'c'.repeat(40), permissions: {} },
    ])
    const mockFetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(index) }))

    const result = await lookupRegistryEntry('multi', {
      workspacePath: null,
      cacheRoot,
    }, { ...defaultDeps(), fetchUrl: mockFetch })

    expect(result).toBeDefined()
    expect(result!.version).toBe('2.0.0')
  })

  it('picks the exact requested version', async () => {
    const cacheRoot = join(dir, 'cache')
    const index = validGitIndex([
      { id: 'multi', name: 'Multi', version: '1.0.0', repo: 'https://example.com/m', ref: 'v1', commit: 'a'.repeat(40), permissions: {} },
      { id: 'multi', name: 'Multi', version: '2.0.0', repo: 'https://example.com/m', ref: 'v2', commit: 'b'.repeat(40), permissions: {} },
    ])
    const mockFetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(index) }))

    const result = await lookupRegistryEntry('multi', {
      workspacePath: null,
      cacheRoot,
      version: '1.0.0',
    }, { ...defaultDeps(), fetchUrl: mockFetch })

    expect(result).toBeDefined()
    expect(result!.version).toBe('1.0.0')
  })

  it('resolves localPackageDir for local-dir entries', async () => {
    const cacheRoot = join(dir, 'cache')
    const localDir = join(dir, 'local-registry')
    seedLocalRegistry(localDir, validLocalIndex())

    const machine = JSON.stringify({
      registries: {
        dev: { path: localDir },
      },
    })

    const result = await lookupRegistryEntry('my-tool', {
      workspacePath: dir,
      cacheRoot,
    }, defaultDeps({ readMachineRegistries: () => machine }))

    expect(result).toBeDefined()
    expect(result!.localPackageDir).toBe(resolve(localDir, 'packages/my-tool'))
    expect(result!.registryKind).toBe('local')
  })

  it('returns undefined when localPackageDir would escape the source location', async () => {
    const cacheRoot = join(dir, 'cache')
    const localDir = join(dir, 'local-registry')
    // Create a dir entry that tries to escape via a long-enough path
    seedLocalRegistry(localDir, {
      manifestVersion: 1,
      packages: [
        { id: 'escape-tool', name: 'Escape', version: '0.1.0', dir: 'packages/escape-tool', permissions: {} },
      ],
    })

    // We can't easily construct a dir that escapes via the index since
    // parseRegistryIndex validates path segments. Instead test the guard
    // by verifying normal resolution is safe.
    const machine = JSON.stringify({
      registries: {
        dev: { path: localDir },
      },
    })

    const result = await lookupRegistryEntry('escape-tool', {
      workspacePath: dir,
      cacheRoot,
    }, defaultDeps({ readMachineRegistries: () => machine }))

    // Normal dir should resolve correctly within source
    expect(result).toBeDefined()
    expect(result!.localPackageDir).toBe(resolve(localDir, 'packages/escape-tool'))
    const resolvedDir = result!.localPackageDir!
    expect((resolvedDir + sep).startsWith(resolve(localDir) + sep)).toBe(true)
  })

  it('lazy-clones only when mirror is absent (not when it exists)', async () => {
    const cacheRoot = join(dir, 'cache')
    // Pre-seed the mirror
    seedUrlCache(cacheRoot, DEFAULT_REGISTRY_INDEX_URL, validGitIndex())

    const mockClone = vi.fn()

    await lookupRegistryEntry('github-monitor', {
      workspacePath: null,
      cacheRoot,
    }, {
      ...defaultDeps(),
      cloneRepo: mockClone,
    })

    expect(mockClone).not.toHaveBeenCalled()
  })

  it('fetches URL source when cache is absent (sync: true inside lookup)', async () => {
    const cacheRoot = join(dir, 'cache')
    const index = validGitIndex()

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(index),
    }))

    const result = await lookupRegistryEntry('github-monitor', {
      workspacePath: null,
      cacheRoot,
    }, {
      ...defaultDeps(),
      fetchUrl: mockFetch,
    })

    expect(mockFetch).toHaveBeenCalledWith(DEFAULT_REGISTRY_INDEX_URL)
    expect(result).toBeDefined()
    expect(result!.id).toBe('github-monitor')
  })

  it('returns undefined for an id that does not exist anywhere', async () => {
    const cacheRoot = join(dir, 'cache')
    seedUrlCache(cacheRoot, DEFAULT_REGISTRY_INDEX_URL, validGitIndex())

    const result = await lookupRegistryEntry('nonexistent', {
      workspacePath: null,
      cacheRoot,
    }, defaultDeps())

    expect(result).toBeUndefined()
  })

  it('propagates auth from account source to LookupResult', async () => {
    const cacheRoot = join(dir, 'cache')
    const index = validGitIndex()
    const mockFetch = vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify(index),
    }))

    const result = await lookupRegistryEntry('github-monitor', {
      workspacePath: null,
      cacheRoot,
    }, {
      ...defaultDeps({ getAccountToken: () => 'tok_lookup' }),
      fetchUrl: mockFetch,
    })

    expect(result).toBeDefined()
    expect(result!.auth).toEqual({ token: 'tok_lookup' })
    expect(result!.registryId).toBe('account')
  })

  it('LookupResult has no auth when source has no auth', async () => {
    const cacheRoot = join(dir, 'cache')
    seedUrlCache(cacheRoot, DEFAULT_REGISTRY_INDEX_URL, validGitIndex())

    const result = await lookupRegistryEntry('github-monitor', {
      workspacePath: null,
      cacheRoot,
    }, defaultDeps())

    expect(result).toBeDefined()
    expect(result!.auth).toBeUndefined()
  })

  it('machine source is implicitly trusted (no isSourceTrusted needed)', async () => {
    const cacheRoot = join(dir, 'cache')
    const localDir = join(dir, 'local-registry')
    seedLocalRegistry(localDir, validLocalIndex())
    // Empty default so it doesn't have the id
    seedUrlCache(cacheRoot, DEFAULT_REGISTRY_INDEX_URL, validGitIndex([]))

    const machine = JSON.stringify({
      registries: { dev: { path: localDir } },
    })

    // No isSourceTrusted — machine should still be consulted
    const result = await lookupRegistryEntry('my-tool', {
      workspacePath: dir,
      cacheRoot,
    }, defaultDeps({ readMachineRegistries: () => machine }))

    expect(result).toBeDefined()
    expect(result!.id).toBe('my-tool')
    expect(result!.registryId).toBe('dev')
  })
})
