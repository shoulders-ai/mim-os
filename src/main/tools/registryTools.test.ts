import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { createPackageLoader } from '@main/packages/packages.js'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'
import type { RegistryEntry } from '@main/packages/registryIndex.js'
import { registryMirrorDir, urlIndexCacheFile } from '@main/packages/cacheLayout.js'
import { DEFAULT_REGISTRY_URL, DEFAULT_REGISTRY_INDEX_URL } from '@main/userConfig.js'
import { dirname } from 'path'

// Mock git operations at the system boundary (same pattern as git.test.ts).
vi.mock('@main/git.js', () => ({
  cloneRepo: vi.fn(),
  pullRepo: vi.fn(),
  hasSystemGit: vi.fn().mockResolvedValue(false),
  isSshUrl: vi.fn().mockReturnValue(false),
  buildAuthedUrl: vi.fn((url: string) => url),
  checkoutRef: vi.fn(),
  resolveHead: vi.fn(),
}))

import { cloneRepo, pullRepo } from '@main/git.js'
import { registerRegistryTools, type RegistryToolDeps } from '@main/tools/registryTools.js'

function validEntry(overrides?: Partial<RegistryEntry>): RegistryEntry {
  return {
    id: 'github-monitor',
    name: 'GitHub Monitor',
    description: 'Org-wide issues/PRs/activity monitoring',
    repo: 'https://github.com/shoulders-ai/mim-github-monitor',
    version: '1.2.0',
    ref: 'v1.2.0',
    commit: 'a'.repeat(40),
    permissions: { http: ['api.github.com'], secrets: ['github_token'] },
    engines: { mim: 'runtime-v1' },
    ...overrides,
  }
}

function validIndex(packages?: RegistryEntry[]): unknown {
  return {
    manifestVersion: 1,
    packages: packages ?? [validEntry()],
  }
}

describe('registry.list (multi-source)', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-reg-test-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    mkdirSync(globalDir, { recursive: true })

    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)

    // Write a minimal mim.yaml so the workspace is valid.
    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\n')

    vi.clearAllMocks()
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

  function mockFetchOk(index: unknown): void {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify(index)),
    }))
  }

  async function makeDeps(): Promise<RegistryToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({
      getWorkspacePath: () => dir,
    })
    return { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => dir }
  }

  async function callRegistryList(deps: RegistryToolDeps): Promise<Record<string, unknown>> {
    registerRegistryTools(tools, deps)
    return (await tools.call('registry.list', {}, { actor: 'user' })) as Record<string, unknown>
  }

  it('fetches the default registry index via HTTPS and returns parsed entries', async () => {
    const deps = await makeDeps()
    mockFetchOk(validIndex())

    const result = await callRegistryList(deps)

    expect(fetch).toHaveBeenCalledWith(DEFAULT_REGISTRY_INDEX_URL)
    const entries = result.entries as Record<string, unknown>[]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'github-monitor', version: '1.2.0', registryId: 'default' })

    const registries = result.registries as Record<string, unknown>[]
    expect(registries).toHaveLength(1)
    expect(registries[0]).toMatchObject({ id: 'default', status: 'ok', origin: 'default', kind: 'url' })
  })

  it('multi-source: failing git source does not break others', async () => {
    // Set up a workspace registry that will fail, plus the default.
    const wsUrl = 'https://github.com/acme/broken-reg.git'
    writeFileSync(join(dir, 'mim.yaml'), [
      'name: test-workspace',
      'registries:',
      '  acme:',
      `    git: ${wsUrl}`,
    ].join('\n') + '\n')

    const deps = await makeDeps()
    // Trust the workspace registry
    deps.enablement.ackRegistryTrust({ id: 'acme', location: wsUrl })

    // acme clone fails, default URL source works
    vi.mocked(cloneRepo).mockRejectedValue(new Error('DNS resolution failed'))
    mockFetchOk(validIndex())

    const result = await callRegistryList(deps)
    const registries = result.registries as Record<string, unknown>[]
    const acmeReg = registries.find(r => r.id === 'acme')
    expect(acmeReg).toMatchObject({ status: 'error' })

    const defaultReg = registries.find(r => r.id === 'default')
    expect(defaultReg).toMatchObject({ status: 'ok' })

    // Default entries still present despite acme failure.
    const entries = result.entries as Record<string, unknown>[]
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0]).toMatchObject({ registryId: 'default' })
  })

  it('stale fallback: fetch failure with cached index returns stale status', async () => {
    const deps = await makeDeps()
    // Seed cache, then fail the fetch.
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')))

    const result = await callRegistryList(deps)

    const registries = result.registries as Record<string, unknown>[]
    expect(registries[0]).toMatchObject({ id: 'default', status: 'stale' })

    // Entries still parsed from stale cache.
    const entries = result.entries as Record<string, unknown>[]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'github-monitor' })
  })

  it('needs-trust: workspace source contributes no entries until trusted', async () => {
    const wsUrl = 'https://github.com/acme/registry.git'
    writeFileSync(join(dir, 'mim.yaml'), [
      'name: test-workspace',
      'registries:',
      '  acme:',
      `    git: ${wsUrl}`,
    ].join('\n') + '\n')

    const deps = await makeDeps()
    // Do NOT trust acme
    seedMirror(wsUrl, validIndex([validEntry({ id: 'acme-tool' })]))
    mockFetchOk(validIndex())

    const result = await callRegistryList(deps)

    const registries = result.registries as Record<string, unknown>[]
    const acmeReg = registries.find(r => r.id === 'acme')
    expect(acmeReg).toMatchObject({ status: 'needs-trust' })

    // No acme-tool in entries.
    const entries = result.entries as Record<string, unknown>[]
    expect(entries.find(e => (e as Record<string, unknown>).id === 'acme-tool')).toBeUndefined()
    // Default entries still present.
    expect(entries.some(e => (e as Record<string, unknown>).id === 'github-monitor')).toBe(true)
  })

  it('trusted workspace source contributes entries after ack', async () => {
    const wsUrl = 'https://github.com/acme/registry.git'
    writeFileSync(join(dir, 'mim.yaml'), [
      'name: test-workspace',
      'registries:',
      '  acme:',
      `    git: ${wsUrl}`,
    ].join('\n') + '\n')

    const deps = await makeDeps()
    deps.enablement.ackRegistryTrust({ id: 'acme', location: wsUrl })

    seedMirror(wsUrl, validIndex([validEntry({ id: 'acme-tool' })]))
    vi.mocked(pullRepo).mockResolvedValue({ pulled: '' })
    mockFetchOk(validIndex())

    const result = await callRegistryList(deps)

    const registries = result.registries as Record<string, unknown>[]
    const acmeReg = registries.find(r => r.id === 'acme')
    expect(acmeReg).toMatchObject({ status: 'ok' })

    const entries = result.entries as Record<string, unknown>[]
    expect(entries.find(e => (e as Record<string, unknown>).id === 'acme-tool')).toBeDefined()
  })

  it('shadowing: first source with an id owns it; later sources marked shadowed', async () => {
    const wsUrl = 'https://github.com/acme/registry.git'
    writeFileSync(join(dir, 'mim.yaml'), [
      'name: test-workspace',
      'registries:',
      '  acme:',
      `    git: ${wsUrl}`,
    ].join('\n') + '\n')

    const deps = await makeDeps()
    deps.enablement.ackRegistryTrust({ id: 'acme', location: wsUrl })

    // Both registries have github-monitor — acme should own it.
    seedMirror(wsUrl, validIndex([validEntry({ version: '2.0.0' })]))
    vi.mocked(pullRepo).mockResolvedValue({ pulled: '' })
    mockFetchOk(validIndex([validEntry({ version: '1.2.0' })]))

    const result = await callRegistryList(deps)

    const entries = result.entries as Record<string, unknown>[]
    const gmEntries = entries.filter(e => (e as Record<string, unknown>).id === 'github-monitor')
    expect(gmEntries).toHaveLength(2)

    const owner = gmEntries.find(e => !(e as Record<string, unknown>).shadowed) as Record<string, unknown>
    expect(owner.registryId).toBe('acme')
    expect(owner.version).toBe('2.0.0')

    const shadow = gmEntries.find(e => (e as Record<string, unknown>).shadowed) as Record<string, unknown>
    expect(shadow.registryId).toBe('default')
    expect(shadow.shadowedBy).toBe('acme')
  })

  it('multiple versions of an id within one source are not shadowed', async () => {
    const deps = await makeDeps()
    mockFetchOk(validIndex([
      validEntry({ version: '1.2.0' }),
      validEntry({ version: '2.0.0' }),
    ]))

    const result = await callRegistryList(deps)

    const entries = result.entries as Record<string, unknown>[]
    const gmEntries = entries.filter(e => (e as Record<string, unknown>).id === 'github-monitor')
    expect(gmEntries).toHaveLength(2)
    expect(gmEntries.every(e => !(e as Record<string, unknown>).shadowed)).toBe(true)
  })

  it('local source listing via readSourceIndex', async () => {
    const localDir = join(dir, 'tools', 'registry')
    mkdirSync(localDir, { recursive: true })
    writeFileSync(join(localDir, 'index.json'), JSON.stringify({
      manifestVersion: 1,
      packages: [
        { id: 'local-tool', name: 'Local Tool', version: '0.1.0', dir: 'packages/local-tool', permissions: {} },
      ],
    }))

    writeFileSync(join(dir, 'mim.yaml'), [
      'name: test-workspace',
      'registries:',
      '  in-repo:',
      '    path: tools/registry',
    ].join('\n') + '\n')

    // Seed the default mirror.
    mockFetchOk(validIndex())

    const deps = await makeDeps()
    // Local workspace paths still need trust because origin is 'workspace'.
    deps.enablement.ackRegistryTrust({ id: 'in-repo', location: join(dir, 'tools', 'registry') })

    const result = await callRegistryList(deps)

    const registries = result.registries as Record<string, unknown>[]
    const localReg = registries.find(r => r.id === 'in-repo')
    expect(localReg).toMatchObject({ status: 'ok', kind: 'local', origin: 'workspace' })

    const entries = result.entries as Record<string, unknown>[]
    expect(entries.find(e => (e as Record<string, unknown>).id === 'local-tool')).toBeDefined()
  })

  it('enriches entries with install state: not installed', async () => {
    const deps = await makeDeps()
    mockFetchOk(validIndex())

    const result = await callRegistryList(deps)

    const entry = (result.entries as Record<string, unknown>[])[0]
    expect(entry.installedVersions).toEqual([])
    expect(entry.enabledHere).toBe(false)
  })

  it('enriches entries with install state: installed version', async () => {
    const pkgDir = join(globalDir, 'github-monitor', '1.2.0')
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>GitHub Monitor</h1>')
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@mim/github-monitor',
      version: '1.2.0',
      mim: {
        manifestVersion: 1,
        id: 'github-monitor',
        name: 'GitHub Monitor',
        views: [{ id: 'main', label: 'GitHub Monitor', src: './ui/index.html', role: 'work' }],
        permissions: { http: ['api.github.com'], secrets: ['github_token'] },
        engines: { mim: 'runtime-v1' },
      },
    }))

    const deps = await makeDeps()
    mockFetchOk(validIndex())

    const result = await callRegistryList(deps)

    const entry = (result.entries as Record<string, unknown>[])[0]
    expect(entry.installedVersions).toContain('1.2.0')
  })

  it('handles fetch failure gracefully when no cache exists', async () => {
    const deps = await makeDeps()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unreachable')))

    const result = await callRegistryList(deps)

    const registries = result.registries as Record<string, unknown>[]
    expect(registries[0]).toMatchObject({ status: 'error' })
    expect((registries[0].diagnostics as string[]).some(d => d.includes('Network unreachable'))).toBe(true)
    expect(result.entries).toHaveLength(0)
  })
})

describe('registry.trust', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-reg-trust-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    mkdirSync(globalDir, { recursive: true })

    const eventLog = createTraceLog()
    tools = createToolRegistry(eventLog)
    tools.setWorkspacePath(dir)

    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function makeDeps(): Promise<RegistryToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({
      getWorkspacePath: () => dir,
    })
    return { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => dir }
  }

  it('happy path: trusts a workspace registry by id', async () => {
    const wsUrl = 'https://github.com/acme/registry.git'
    writeFileSync(join(dir, 'mim.yaml'), [
      'name: test-workspace',
      'registries:',
      '  acme:',
      `    git: ${wsUrl}`,
    ].join('\n') + '\n')

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call('registry.trust', { id: 'acme' }, { actor: 'user' }) as Record<string, unknown>
    expect(result).toEqual({ trusted: 'acme' })

    // Verify enablement store was updated.
    expect(deps.enablement.isRegistryTrusted({ id: 'acme', location: wsUrl })).toBe(true)
  })

  it('errors for unknown registry id', async () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\n')
    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.trust', { id: 'nonexistent' }, { actor: 'user' }),
    ).rejects.toThrow('Unknown registry source: nonexistent')
  })

  it('errors for non-workspace origin (default)', async () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\n')
    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.trust', { id: 'default' }, { actor: 'user' }),
    ).rejects.toThrow('does not need trust acknowledgement')
  })
})

describe('app.updates (happy path)', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-app-updates-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    mkdirSync(globalDir, { recursive: true })

    const eventLog = createTraceLog()
    tools = createToolRegistry(eventLog)
    tools.setWorkspacePath(dir)
    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\n')

    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function seedMirror(url: string, index: unknown): void {
    const mirrorDir = registryMirrorDir(url, cacheRoot)
    mkdirSync(mirrorDir, { recursive: true })
    writeFileSync(join(mirrorDir, 'index.json'), JSON.stringify(index))
  }

  function seedInstalled(id: string, version: string): void {
    const pkgDir = join(globalDir, id, version)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{}')
  }

  function seedUrlCache(url: string, index: unknown): void {
    const cacheFile = urlIndexCacheFile(url, cacheRoot)
    mkdirSync(dirname(cacheFile), { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(index))
  }

  it('returns available updates via the tool', async () => {
    seedUrlCache(DEFAULT_REGISTRY_INDEX_URL, validIndex([validEntry({ version: '2.0.0' })]))
    seedInstalled('github-monitor', '1.2.0')
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })

    registerRegistryTools(tools, { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => dir })

    const result = await tools.call('app.updates', {}, { actor: 'user' }) as Record<string, unknown>

    expect((result.updates as unknown[]).length).toBe(1)
    expect((result.updates as Record<string, unknown>[])[0]).toMatchObject({
      id: 'github-monitor',
      installed: '1.2.0',
      latest: '2.0.0',
    })
  })
})

describe('app.updates gate', () => {
  it('is classified as read/low', async () => {
    const { getToolPolicy, toolEffect } = await import('@main/security/gate.js')
    const policy = getToolPolicy('app.updates')
    expect(policy.category).toBe('read')
    expect(policy.risk).toBe('low')
    expect(toolEffect('app.updates')).toBe('read')
  })
})

describe('registry.list gate', () => {
  it('is classified as network/external effect', async () => {
    const { getToolPolicy, toolEffect } = await import('@main/security/gate.js')
    const policy = getToolPolicy('registry.list')
    expect(policy.category).toBe('network')
    expect(toolEffect('registry.list')).toBe('external')
  })
})

describe('registry.trust gate', () => {
  it('is classified as settings/high with targetParam id', async () => {
    const { getToolPolicy } = await import('@main/security/gate.js')
    const policy = getToolPolicy('registry.trust')
    expect(policy).toMatchObject({ category: 'settings', risk: 'high', targetParam: 'id' })
  })
})

describe('registry.list app-actor denial', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-reg-gate-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('denies registry.list to app actors', async () => {
    const { createPermissionGate, PermissionDeniedError } = await import('@main/security/gate.js')
    const decisions: unknown[] = []
    const gate = createPermissionGate({
      getApprovalMode: () => 'normal',
      getWorkspacePath: () => dir,
      getPackagePermissions: () => ({ workspace: { read: true, write: true } }),
      sendApprovalRequest: () => true,
      recordDecision: (e) => decisions.push(e),
    })

    const toolDef = { name: 'registry.list', description: '', execute: async () => ({}) }
    await expect(
      gate.check(toolDef, {}, { actor: 'package', package_id: 'some-pkg' }),
    ).rejects.toThrow(PermissionDeniedError)
  })

  it('denies registry.trust to app actors', async () => {
    const { createPermissionGate, PermissionDeniedError } = await import('@main/security/gate.js')
    const gate = createPermissionGate({
      getApprovalMode: () => 'normal',
      getWorkspacePath: () => dir,
      getPackagePermissions: () => ({ workspace: { read: true, write: true } }),
      sendApprovalRequest: () => true,
      recordDecision: () => {},
    })

    const toolDef = { name: 'registry.trust', description: '', execute: async () => ({}) }
    await expect(
      gate.check(toolDef, { id: 'acme' }, { actor: 'package', package_id: 'some-pkg' }),
    ).rejects.toThrow(PermissionDeniedError)
  })
})
