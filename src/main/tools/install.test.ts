import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { createPackageLoader } from '@main/packages/packages.js'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'
import { packageMirrorDir } from '@main/packages/cacheLayout.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import type { RegistryEntry } from '@main/packages/registryIndex.js'
import type { LookupResult } from '@main/packages/registrySources.js'

// Mock git operations at the system boundary (same pattern as git.test.ts).
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

import { cloneRepo, pullRepo, fetchRepo, checkoutRef, resolveHead } from '@main/git.js'
import { registerInstallTools, type InstallToolDeps } from '@main/tools/install.js'

const COMMIT_SHA = 'a'.repeat(40)

function validRegistryEntry(overrides?: Partial<RegistryEntry>): RegistryEntry {
  return {
    id: 'github-monitor',
    name: 'GitHub Monitor',
    description: 'Org-wide issues/PRs/activity monitoring',
    repo: 'https://github.com/shoulders-ai/mim-github-monitor',
    version: '1.2.0',
    ref: 'v1.2.0',
    commit: COMMIT_SHA,
    permissions: { http: ['api.github.com'], secrets: ['github_token'] },
    engines: { mim: 'runtime-v1' },
    ...overrides,
  }
}

function asGitLookup(entry: RegistryEntry): LookupResult {
  return {
    ...entry,
    registryId: 'default',
    registryKind: 'git',
    registryLocation: 'https://github.com/shoulders-ai/mim-apps',
  }
}

function asLocalLookup(entry: RegistryEntry, registryLocation: string, localPackageDir: string): LookupResult {
  return {
    ...entry,
    registryId: 'local-dev',
    registryKind: 'local',
    registryLocation,
    localPackageDir,
  }
}

// Minimal valid package.json for the checkout (app manifest).
function validPackageJson(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
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
    ...overrides,
  }
}

// Seed a fake checkout in the app mirror dir with a valid app structure.
function seedPackageMirror(
  mirrorDir: string,
  packageJson?: Record<string, unknown>,
  opts?: { gitmodules?: boolean; symlink?: boolean; existingProvenance?: boolean },
): void {
  mkdirSync(join(mirrorDir, 'ui'), { recursive: true })
  mkdirSync(join(mirrorDir, '.git'), { recursive: true })
  writeFileSync(join(mirrorDir, 'package.json'), JSON.stringify(packageJson ?? validPackageJson()))
  writeFileSync(join(mirrorDir, 'ui', 'index.html'), '<h1>GitHub Monitor</h1>')
  if (opts?.gitmodules) {
    writeFileSync(join(mirrorDir, '.gitmodules'), '[submodule "vendor"]\n  path = vendor\n  url = https://example.com/repo.git\n')
  }
  if (opts?.symlink) {
    symlinkSync('/etc/passwd', join(mirrorDir, 'ui', 'evil-link'))
  }
  if (opts?.existingProvenance) {
    writeFileSync(join(mirrorDir, '.mim-install.json'), '{"old": true}')
  }
}

describe('package.install', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>
  const FIXED_CLOCK = 1718000000000

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-install-test-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    mkdirSync(globalDir, { recursive: true })

    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)

    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\n')

    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function makeDeps(overrides?: Partial<InstallToolDeps>): Promise<InstallToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({
      getWorkspacePath: () => dir,
    })
    return {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: () => FIXED_CLOCK,
      lookupRegistryEntry: async (id: string, _version?: string) => {
        if (id === 'github-monitor') return asGitLookup(validRegistryEntry())
        return undefined
      },
      ...overrides,
    }
  }

  function setupGitMocks(mirrorDir: string, packageJson?: Record<string, unknown>, opts?: Parameters<typeof seedPackageMirror>[2]): void {
    // cloneRepo creates the mirror with the package structure.
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      seedPackageMirror(target, packageJson, opts)
      return { cloned: target }
    })
    // pullRepo just succeeds (mirror already exists).
    vi.mocked(pullRepo).mockResolvedValue({ pulled: mirrorDir })
    // checkoutRef is a no-op (the seeded files are already in place).
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    // resolveHead returns the expected commit.
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)
  }

  async function callInstall(deps: InstallToolDeps, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    registerInstallTools(tools, deps)
    return (await tools.call('package.install', params, { actor: 'user' })) as Record<string, unknown>
  }

  // ---- Happy path ----

  it('installs an app from the registry by id', async () => {
    const deps = await makeDeps()
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir)

    const result = await callInstall(deps, { id: 'github-monitor' })

    expect(result.installed).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')

    // Verify the package was copied to the global dir.
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    expect(existsSync(join(installDir, 'package.json'))).toBe(true)
    expect(existsSync(join(installDir, 'ui', 'index.html'))).toBe(true)

    // .git must NOT be copied.
    expect(existsSync(join(installDir, '.git'))).toBe(false)
  })

  it('writes a credential-free provenance file', async () => {
    const deps = await makeDeps()
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir)

    await callInstall(deps, { id: 'github-monitor' })

    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    const provenance = JSON.parse(readFileSync(join(installDir, '.mim-install.json'), 'utf-8'))
    expect(provenance.source).toBe('https://github.com/shoulders-ai/mim-github-monitor')
    expect(provenance.ref).toBe('v1.2.0')
    expect(provenance.commit).toBe(COMMIT_SHA)
    expect(provenance.installedAt).toBe(FIXED_CLOCK)
    // Must never contain a token.
    const raw = readFileSync(join(installDir, '.mim-install.json'), 'utf-8')
    expect(raw).not.toContain('token')
    expect(raw).not.toContain('password')
    expect(raw).not.toContain('secret')
  })

  it('excludes .mim-install.json from the app checkout during copy', async () => {
    const deps = await makeDeps()
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir, validPackageJson(), { existingProvenance: true })

    await callInstall(deps, { id: 'github-monitor' })

    // The provenance file is our own, not the one from the checkout.
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    const provenance = JSON.parse(readFileSync(join(installDir, '.mim-install.json'), 'utf-8'))
    expect(provenance.installedAt).toBe(FIXED_CLOCK)
    expect(provenance.old).toBeUndefined()
  })

  it('installs a direct repo app (no registry entry)', async () => {
    const deps = await makeDeps({
      lookupRegistryEntry: async () => undefined,
    })
    const repoUrl = 'https://github.com/shoulders-ai/mim-github-monitor'
    const mirrorDir = packageMirrorDir(repoUrl, cacheRoot)

    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      seedPackageMirror(target)
      return { cloned: target }
    })
    vi.mocked(pullRepo).mockResolvedValue({ pulled: mirrorDir })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)

    const result = await callInstall(deps, { repo: repoUrl })

    expect(result.installed).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')
  })

  // ---- Monorepo subdirectory installs ----

  // Seed a monorepo-shaped checkout: a non-package root with the real
  // package under packages/github-monitor/.
  function seedMonorepoMirror(target: string, opts?: { symlinkOutside?: boolean; symlinkInside?: boolean }): void {
    const pkgRoot = join(target, 'packages', 'github-monitor')
    mkdirSync(join(pkgRoot, 'ui'), { recursive: true })
    mkdirSync(join(target, '.git'), { recursive: true })
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'mim-apps', private: true }))
    writeFileSync(join(target, 'README.md'), '# mim-apps')
    writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify(validPackageJson()))
    writeFileSync(join(pkgRoot, 'ui', 'index.html'), '<h1>GitHub Monitor</h1>')
    if (opts?.symlinkOutside) {
      mkdirSync(join(target, 'packages', 'other'), { recursive: true })
      symlinkSync('/etc/passwd', join(target, 'packages', 'other', 'evil-link'))
    }
    if (opts?.symlinkInside) {
      symlinkSync('/etc/passwd', join(pkgRoot, 'ui', 'evil-link'))
    }
  }

  it('installs an app from a registry entry with a monorepo path', async () => {
    const deps = await makeDeps({
      lookupRegistryEntry: async (id) => id === 'github-monitor'
        ? asGitLookup(validRegistryEntry({ repo: 'https://github.com/shoulders-ai/mim-apps', path: 'packages/github-monitor' }))
        : undefined,
    })
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      seedMonorepoMirror(target)
      return { cloned: target }
    })
    vi.mocked(pullRepo).mockResolvedValue({ pulled: 'x' })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)

    const result = await callInstall(deps, { id: 'github-monitor' })
    expect(result.installed).toBe('github-monitor')

    // Only the subdirectory contents are copied — not the monorepo root.
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    expect(existsSync(join(installDir, 'ui', 'index.html'))).toBe(true)
    expect(existsSync(join(installDir, 'README.md'))).toBe(false)
    expect(existsSync(join(installDir, 'packages'))).toBe(false)

    const provenance = JSON.parse(readFileSync(join(installDir, '.mim-install.json'), 'utf-8'))
    expect(provenance.path).toBe('packages/github-monitor')
  })

  it('installs a direct repo app with a path parameter', async () => {
    const deps = await makeDeps({ lookupRegistryEntry: () => undefined })
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      seedMonorepoMirror(target)
      return { cloned: target }
    })
    vi.mocked(pullRepo).mockResolvedValue({ pulled: 'x' })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)

    const result = await callInstall(deps, {
      repo: 'https://github.com/shoulders-ai/mim-apps',
      path: 'packages/github-monitor',
    })
    expect(result.installed).toBe('github-monitor')
  })

  it('rejects traversal in the path parameter', async () => {
    const deps = await makeDeps({ lookupRegistryEntry: () => undefined })
    registerInstallTools(tools, deps)

    for (const path of ['../escape', 'packages/../../escape', '/abs/path', 'a\\b', '.hidden/pkg']) {
      await expect(
        tools.call('package.install', { repo: 'https://github.com/shoulders-ai/mim-apps', path }, { actor: 'user' }),
      ).rejects.toThrow(/invalid app path/i)
    }
  })

  it('refuses when the checkout does not contain the app path', async () => {
    const deps = await makeDeps({ lookupRegistryEntry: () => undefined })
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      seedMonorepoMirror(target)
      return { cloned: target }
    })
    vi.mocked(pullRepo).mockResolvedValue({ pulled: 'x' })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)

    await expect(
      callInstall(deps, { repo: 'https://github.com/shoulders-ai/mim-apps', path: 'packages/nope' }),
    ).rejects.toThrow(/does not contain the app path/i)
  })

  it('refuses a symlink inside the app path but tolerates one elsewhere in the monorepo', async () => {
    const deps = await makeDeps({ lookupRegistryEntry: () => undefined })
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      seedMonorepoMirror(target, { symlinkOutside: true })
      return { cloned: target }
    })
    vi.mocked(pullRepo).mockResolvedValue({ pulled: 'x' })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)

    // Symlink outside the installed subtree: install succeeds.
    const result = await callInstall(deps, {
      repo: 'https://github.com/shoulders-ai/mim-apps',
      path: 'packages/github-monitor',
    })
    expect(result.installed).toBe('github-monitor')

    // Symlink inside the installed subtree: refused.
    rmSync(packageMirrorDir('https://github.com/shoulders-ai/mim-apps-2', cacheRoot), { recursive: true, force: true })
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      seedMonorepoMirror(target, { symlinkInside: true })
      return { cloned: target }
    })
    await expect(
      callInstall(deps, { repo: 'https://github.com/shoulders-ai/mim-apps-2', path: 'packages/github-monitor' }),
    ).rejects.toThrow(/symlink/i)
  })

  // ---- Refusal tests ----

  it('rejects source URLs carrying credentials', async () => {
    const deps = await makeDeps()
    registerInstallTools(tools, deps)

    await expect(
      tools.call('package.install', { repo: 'https://tok123@github.com/example-org/repo.git' }, { actor: 'user' }),
    ).rejects.toThrow(/credential/)
  })

  it('rejects source URLs with password credentials', async () => {
    const deps = await makeDeps()
    registerInstallTools(tools, deps)

    await expect(
      tools.call('package.install', { repo: 'https://user:pass@github.com/example-org/repo.git' }, { actor: 'user' }),
    ).rejects.toThrow(/credential/)
  })

  it('refuses a checkout containing .gitmodules', async () => {
    const deps = await makeDeps()
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir, validPackageJson(), { gitmodules: true })

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/gitmodules/)
  })

  it('refuses any symlink in the tree', async () => {
    const deps = await makeDeps()
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir, validPackageJson(), { symlink: true })

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/symlink/i)
  })

  it('refuses when resolveHead does not match registry commit (commit mismatch)', async () => {
    const deps = await makeDeps()
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir)
    vi.mocked(resolveHead).mockResolvedValue('b'.repeat(40))

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/commit.*mismatch/i)
  })

  it('refuses when manifest id does not match requested id', async () => {
    const deps = await makeDeps()
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    const wrongPkg = validPackageJson()
    ;(wrongPkg.mim as Record<string, unknown>).id = 'wrong-id'
    setupGitMocks(mirrorDir, wrongPkg)

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/id.*mismatch/i)
  })

  it('refuses when engines.mim does not match runtime version', async () => {
    const deps = await makeDeps({
      lookupRegistryEntry: async (id) => id === 'github-monitor'
        ? asGitLookup(validRegistryEntry({ engines: { mim: 'runtime-v99' } }))
        : undefined,
    })
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    const futurePkg = validPackageJson()
    ;(futurePkg.mim as Record<string, unknown>).engines = { mim: 'runtime-v99' }
    setupGitMocks(mirrorDir, futurePkg)

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/engine/i)
  })

  it('refuses when manifest permissions differ from registry entry', async () => {
    const deps = await makeDeps()
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    const mismatchPkg = validPackageJson()
    ;(mismatchPkg.mim as Record<string, unknown>).permissions = { workspace: { write: true } }
    setupGitMocks(mirrorDir, mismatchPkg)

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/permission.*mismatch/i)
  })

  it('validates the version dir name against the semver regex', async () => {
    const deps = await makeDeps({
      lookupRegistryEntry: async () => asGitLookup(validRegistryEntry({ version: '../escape' })),
    })
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir)

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/version/)
  })

  it('validates the version dir name matches the registry-declared version', async () => {
    // The manifest says 1.2.0 but the registry entry says 2.0.0.
    const deps = await makeDeps({
      lookupRegistryEntry: async () => asGitLookup(validRegistryEntry({ version: '2.0.0' })),
    })
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir)

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/version.*mismatch/i)
  })

  // ---- Failure cleanup ----

  it('cleans up the install directory when provenance write fails', async () => {
    // Use a clock that throws to simulate a failure after copyTree
    // succeeds but before provenance is fully written.
    const deps = await makeDeps({
      clock: () => { throw new Error('Simulated provenance failure') },
    })
    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    setupGitMocks(mirrorDir)

    await expect(
      callInstall(deps, { id: 'github-monitor' }),
    ).rejects.toThrow(/provenance failure/i)

    // The install directory must be cleaned up — no partial install left.
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    expect(existsSync(installDir)).toBe(false)
  })
})

describe('app.add', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>
  const FIXED_CLOCK = 1718000000000

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-app-add-test-'))
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

  async function makeAddDeps(entry: RegistryEntry): Promise<InstallToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })
    const { registerCoreAppTools } = await import('@main/tools/coreApps.js')
    registerCoreAppTools(tools, { packages, enablement })
    return {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: () => FIXED_CLOCK,
      lookupRegistryEntry: async (id) => id === entry.id ? asGitLookup(entry) : undefined,
    }
  }

  it('adds a registry app to my sidebar without sharing it with the workspace', async () => {
    const entry = validRegistryEntry({ repo: 'https://github.com/shoulders-ai/mim-apps', path: 'packages/github-monitor' })
    const deps = await makeAddDeps(entry)
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      const pkgRoot = join(target, 'packages', 'github-monitor')
      mkdirSync(join(pkgRoot, 'ui'), { recursive: true })
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'mim-apps', private: true }))
      writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify(validPackageJson()))
      writeFileSync(join(pkgRoot, 'ui', 'index.html'), '<h1>GM</h1>')
      return { cloned: target }
    })
    vi.mocked(pullRepo).mockResolvedValue({ pulled: 'x' })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)

    registerInstallTools(tools, deps)
    const result = (await tools.call('app.add', { id: 'github-monitor' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.added).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')
    expect(result.local).toBe(true)
    expect(existsSync(join(globalDir, 'github-monitor', '1.2.0', 'package.json'))).toBe(true)

    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps?.['github-monitor']).toBeUndefined()
    expect(deps.enablement.localOverride('github-monitor')).toBe(true)
    expect(deps.packages.get('github-monitor')?.manifest.views[0]?.role).toBe('work')
    const status = await tools.call('app.status', {}, { actor: 'user' }) as { apps: Array<{ id: string; enabled: boolean; installed: boolean }> }
    expect(status.apps.find(app => app.id === 'github-monitor')).toMatchObject({
      enabled: true,
      installed: true,
    })
  })

  it('shares a registry app with the workspace without enabling it in my sidebar', async () => {
    const entry = validRegistryEntry({ repo: 'https://github.com/shoulders-ai/mim-apps', path: 'packages/github-monitor' })
    const deps = await makeAddDeps(entry)
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      const pkgRoot = join(target, 'packages', 'github-monitor')
      mkdirSync(join(pkgRoot, 'ui'), { recursive: true })
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'mim-apps', private: true }))
      writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify(validPackageJson()))
      writeFileSync(join(pkgRoot, 'ui', 'index.html'), '<h1>GM</h1>')
      return { cloned: target }
    })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)

    registerInstallTools(tools, deps)
    const result = (await tools.call('app.share', { id: 'github-monitor' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.shared).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')
    expect(deps.enablement.localOverride('github-monitor')).toBeNull()

    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps?.['github-monitor']).toEqual({
      source: 'https://github.com/shoulders-ai/mim-apps',
      path: 'packages/github-monitor',
      version: '1.2.0',
    })
    const status = await tools.call('app.status', {}, { actor: 'user' }) as { apps: Array<{ id: string; enabled: boolean; layer: string }> }
    expect(status.apps.find(app => app.id === 'github-monitor')).toMatchObject({
      enabled: false,
      layer: 'workspace',
    })
  })

  it('skips the download when the version is already installed with matching provenance', async () => {
    const entry = validRegistryEntry()
    const deps = await makeAddDeps(entry)

    // Pre-install the exact version with matching provenance.
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    mkdirSync(join(installDir, 'ui'), { recursive: true })
    writeFileSync(join(installDir, 'package.json'), JSON.stringify(validPackageJson()))
    writeFileSync(join(installDir, 'ui', 'index.html'), '<h1>GM</h1>')
    writeFileSync(join(installDir, '.mim-install.json'), JSON.stringify({ source: entry.repo }))

    registerInstallTools(tools, deps)
    const result = (await tools.call('app.add', { id: 'github-monitor' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.added).toBe('github-monitor')
    const git = await import('@main/git.js')
    expect(vi.mocked(cloneRepo)).not.toHaveBeenCalled()
    expect(vi.mocked(git.fetchRepo)).not.toHaveBeenCalled()

    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    const pinned = config.apps?.['github-monitor']
    expect(pinned).toBeUndefined()
    expect(deps.enablement.localOverride('github-monitor')).toBe(true)
  })

  it('reinstalls when provenance source does not match registry repo', async () => {
    const entry = validRegistryEntry({ repo: 'https://github.com/shoulders-ai/mim-apps', path: 'packages/github-monitor' })
    const deps = await makeAddDeps(entry)

    // Pre-install with OLD provenance source (repo was renamed).
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    mkdirSync(join(installDir, 'ui'), { recursive: true })
    writeFileSync(join(installDir, 'package.json'), JSON.stringify(validPackageJson()))
    writeFileSync(join(installDir, 'ui', 'index.html'), '<h1>GM</h1>')
    writeFileSync(join(installDir, '.mim-install.json'), JSON.stringify({
      source: 'https://github.com/shoulders-ai/mim-packages',
    }))

    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      const pkgRoot = join(target, 'packages', 'github-monitor')
      mkdirSync(join(pkgRoot, 'ui'), { recursive: true })
      writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'mim-apps', private: true }))
      writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify(validPackageJson()))
      writeFileSync(join(pkgRoot, 'ui', 'index.html'), '<h1>GM</h1>')
      return { cloned: target }
    })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(COMMIT_SHA)

    registerInstallTools(tools, deps)
    const result = (await tools.call('app.add', { id: 'github-monitor' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.added).toBe('github-monitor')
    expect(vi.mocked(cloneRepo)).toHaveBeenCalled()

    // Provenance must now point to the new source.
    const provenance = JSON.parse(readFileSync(join(installDir, '.mim-install.json'), 'utf-8'))
    expect(provenance.source).toBe('https://github.com/shoulders-ai/mim-apps')
  })

  it('skips reinstall when provenance file is missing from existing install', async () => {
    const entry = validRegistryEntry()
    const deps = await makeAddDeps(entry)

    // Pre-install the exact version with NO provenance file.
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    mkdirSync(join(installDir, 'ui'), { recursive: true })
    writeFileSync(join(installDir, 'package.json'), JSON.stringify(validPackageJson()))
    writeFileSync(join(installDir, 'ui', 'index.html'), '<h1>GM</h1>')

    registerInstallTools(tools, deps)
    const result = (await tools.call('app.add', { id: 'github-monitor' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.added).toBe('github-monitor')
    expect(vi.mocked(cloneRepo)).not.toHaveBeenCalled()
  })

  it('fails when the app is not in the registry', async () => {
    const deps = await makeAddDeps(validRegistryEntry())
    registerInstallTools(tools, deps)

    await expect(
      tools.call('app.add', { id: 'unknown-app' }, { actor: 'user' }),
    ).rejects.toThrow(/not found in registry/)
  })

  it('is denied to app actors', async () => {
    const { createPermissionGate, PermissionDeniedError } = await import('@main/security/gate.js')
    const gate = createPermissionGate({
      getApprovalMode: () => 'normal',
      getWorkspacePath: () => dir,
      getPackagePermissions: () => ({ workspace: { read: true, write: true } }),
      sendApprovalRequest: () => true,
      recordDecision: () => {},
    })
    const toolDef = { name: 'app.add', description: '', execute: async () => ({}) }
    await expect(
      gate.check(toolDef, { id: 'github-monitor' }, { actor: 'package', package_id: 'some-pkg' }),
    ).rejects.toThrow(PermissionDeniedError)
  })
})

describe('package.update', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>
  const FIXED_CLOCK = 1718000000000
  const OLD_COMMIT = 'a'.repeat(40)
  const NEW_COMMIT = 'b'.repeat(40)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-update-test-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    mkdirSync(globalDir, { recursive: true })

    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)

    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\napps:\n  github-monitor:\n    source: https://github.com/shoulders-ai/mim-github-monitor\n    version: 1.2.0\n')

    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function newVersionPackageJson(): Record<string, unknown> {
    return {
      name: '@mim/github-monitor',
      version: '1.3.0',
      mim: {
        manifestVersion: 1,
        id: 'github-monitor',
        name: 'GitHub Monitor',
        views: [{ id: 'main', label: 'GitHub Monitor', src: './ui/index.html', role: 'work' }],
        permissions: { http: ['api.github.com'], secrets: ['github_token'] },
        engines: { mim: 'runtime-v1' },
      },
    }
  }

  it('installs new version side-by-side and repoints the workspace pin', async () => {
    // Install old version first.
    const oldDir = join(globalDir, 'github-monitor', '1.2.0')
    mkdirSync(join(oldDir, 'ui'), { recursive: true })
    writeFileSync(join(oldDir, 'package.json'), JSON.stringify(validPackageJson()))
    writeFileSync(join(oldDir, 'ui', 'index.html'), '<h1>old</h1>')
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })

    const newEntry = validRegistryEntry({ version: '1.3.0', ref: 'v1.3.0', commit: NEW_COMMIT })
    const deps: InstallToolDeps = {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: () => FIXED_CLOCK,
      lookupRegistryEntry: async (id) => id === 'github-monitor' ? asGitLookup(newEntry) : undefined,
    }

    const mirrorDir = packageMirrorDir('https://github.com/shoulders-ai/mim-github-monitor', cacheRoot)
    vi.mocked(cloneRepo).mockImplementation(async (_url, target) => {
      mkdirSync(join(target, 'ui'), { recursive: true })
      mkdirSync(join(target, '.git'), { recursive: true })
      writeFileSync(join(target, 'package.json'), JSON.stringify(newVersionPackageJson()))
      writeFileSync(join(target, 'ui', 'index.html'), '<h1>new</h1>')
      return { cloned: target }
    })
    vi.mocked(pullRepo).mockResolvedValue({ pulled: mirrorDir })
    vi.mocked(checkoutRef).mockResolvedValue(undefined)
    vi.mocked(resolveHead).mockResolvedValue(NEW_COMMIT)

    registerInstallTools(tools, deps)
    const result = (await tools.call('package.update', { id: 'github-monitor' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.installed).toBe('github-monitor')
    expect(result.version).toBe('1.3.0')

    // Old version is still there (side-by-side).
    expect(existsSync(join(globalDir, 'github-monitor', '1.2.0', 'package.json'))).toBe(true)
    // New version is installed.
    expect(existsSync(join(globalDir, 'github-monitor', '1.3.0', 'package.json'))).toBe(true)

    // Workspace pin has been repointed.
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    const entry = config.apps?.['github-monitor']
    expect(entry).toBeDefined()
    expect(typeof entry === 'object' && !Array.isArray(entry) && (entry as Record<string, unknown>).version).toBe('1.3.0')
  })
})

describe('package.uninstall', () => {
  let dir: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-uninstall-test-'))
    globalDir = join(dir, 'global-packages')
    mkdirSync(globalDir, { recursive: true })

    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)

    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\n')

    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('removes the version directory', async () => {
    const pkgDir = join(globalDir, 'github-monitor', '1.2.0')
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{}')
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>x</h1>')
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })

    const deps: InstallToolDeps = {
      packages,
      enablement,
      cacheRoot: join(dir, 'cache'),
      globalDir,
      clock: () => Date.now(),
      lookupRegistryEntry: async () => undefined,
    }

    registerInstallTools(tools, deps)
    const result = (await tools.call('package.uninstall', { id: 'github-monitor', version: '1.2.0' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.uninstalled).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')
    expect(existsSync(pkgDir)).toBe(false)
  })

  it('does not refuse when the app is enabled (fix-forward)', async () => {
    // Enable the package, then uninstall — no error, surfaces in UI later.
    const pkgDir = join(globalDir, 'github-monitor', '1.2.0')
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>x</h1>')
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@mim/github-monitor', version: '1.2.0',
      mim: { manifestVersion: 1, id: 'github-monitor', name: 'GM', views: [{ id: 'main', label: 'GM', src: './ui/index.html', role: 'work' }], permissions: {}, engines: { mim: 'runtime-v1' } },
    }))
    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\napps:\n  github-monitor: true\n')
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })

    const deps: InstallToolDeps = {
      packages,
      enablement,
      cacheRoot: join(dir, 'cache'),
      globalDir,
      clock: () => Date.now(),
      lookupRegistryEntry: async () => undefined,
    }

    registerInstallTools(tools, deps)
    // Should not throw even though the package is enabled.
    const result = (await tools.call('package.uninstall', { id: 'github-monitor', version: '1.2.0' }, { actor: 'user' })) as Record<string, unknown>
    expect(result.uninstalled).toBe('github-monitor')
  })
})

describe('install tools gate policies', () => {
  it('package.install is classified as network/external', async () => {
    const { getToolPolicy, toolEffect } = await import('@main/security/gate.js')
    expect(getToolPolicy('package.install').category).toBe('network')
    expect(toolEffect('package.install')).toBe('external')
  })

  it('package.update is classified as network/external', async () => {
    const { getToolPolicy, toolEffect } = await import('@main/security/gate.js')
    expect(getToolPolicy('package.update').category).toBe('network')
    expect(toolEffect('package.update')).toBe('external')
  })

  it('package.uninstall is classified as settings/mutate', async () => {
    const { getToolPolicy, toolEffect } = await import('@main/security/gate.js')
    expect(getToolPolicy('package.uninstall').category).toBe('settings')
    expect(toolEffect('package.uninstall')).toBe('mutate')
  })
})

describe('install tools app-actor denials', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-install-gate-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function expectDenied(toolName: string): Promise<void> {
    const { createPermissionGate, PermissionDeniedError } = await import('@main/security/gate.js')
    const gate = createPermissionGate({
      getApprovalMode: () => 'normal',
      getWorkspacePath: () => dir,
      getPackagePermissions: () => ({ workspace: { read: true, write: true } }),
      sendApprovalRequest: () => true,
      recordDecision: () => {},
    })

    const toolDef = { name: toolName, description: '', execute: async () => ({}) }
    await expect(
      gate.check(toolDef, {}, { actor: 'package', package_id: 'some-pkg' }),
    ).rejects.toThrow(PermissionDeniedError)
  }

  it('denies package.install to app actors', async () => {
    await expectDenied('package.install')
  })

  it('denies package.update to app actors', async () => {
    await expectDenied('package.update')
  })

  it('denies package.uninstall to app actors', async () => {
    await expectDenied('package.uninstall')
  })
})

describe('local-dir installs', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let localRegistryDir: string
  let tools: ReturnType<typeof createToolRegistry>
  const FIXED_CLOCK = 1718000000000

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-local-install-test-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    localRegistryDir = join(dir, 'local-registry')
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

  function seedLocalPackage(pkgDir: string, packageJson?: Record<string, unknown>, opts?: { symlink?: boolean }): void {
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(packageJson ?? validPackageJson()))
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>GitHub Monitor</h1>')
    if (opts?.symlink) {
      symlinkSync('/etc/passwd', join(pkgDir, 'ui', 'evil-link'))
    }
  }

  async function makeDeps(lookupFn: InstallToolDeps['lookupRegistryEntry']): Promise<InstallToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })
    return {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: () => FIXED_CLOCK,
      lookupRegistryEntry: lookupFn,
    }
  }

  async function callInstall(deps: InstallToolDeps, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    registerInstallTools(tools, deps)
    return (await tools.call('package.install', params, { actor: 'user' })) as Record<string, unknown>
  }

  it('installs from a local-dir entry (happy path)', async () => {
    const pkgDir = join(localRegistryDir, 'packages', 'github-monitor')
    seedLocalPackage(pkgDir)

    const entry = validRegistryEntry()
    const lookup = asLocalLookup(entry, localRegistryDir, pkgDir)
    const deps = await makeDeps(async (id) => id === 'github-monitor' ? lookup : undefined)

    const result = await callInstall(deps, { id: 'github-monitor' })

    expect(result.installed).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')

    // Package copied to global dir.
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    expect(existsSync(join(installDir, 'package.json'))).toBe(true)
    expect(existsSync(join(installDir, 'ui', 'index.html'))).toBe(true)

    // Provenance uses file:// source.
    const provenance = JSON.parse(readFileSync(join(installDir, '.mim-install.json'), 'utf-8'))
    expect(provenance.source).toBe('file://' + localRegistryDir)
    expect(provenance.ref).toBeNull()
    expect(provenance.commit).toBeNull()

    // No git calls made.
    expect(vi.mocked(cloneRepo)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchRepo)).not.toHaveBeenCalled()
  })

  it('refuses when manifest version does not match registry entry version', async () => {
    const pkgDir = join(localRegistryDir, 'packages', 'github-monitor')
    seedLocalPackage(pkgDir)

    const entry = validRegistryEntry({ version: '2.0.0' })
    const lookup = asLocalLookup(entry, localRegistryDir, pkgDir)
    const deps = await makeDeps(async (id) => id === 'github-monitor' ? lookup : undefined)

    await expect(callInstall(deps, { id: 'github-monitor' })).rejects.toThrow(/version.*mismatch/i)
  })

  it('refuses when manifest permissions differ from registry entry', async () => {
    const pkgDir = join(localRegistryDir, 'packages', 'github-monitor')
    const mismatchPkg = validPackageJson()
    ;(mismatchPkg.mim as Record<string, unknown>).permissions = { workspace: { write: true } }
    seedLocalPackage(pkgDir, mismatchPkg)

    const entry = validRegistryEntry()
    const lookup = asLocalLookup(entry, localRegistryDir, pkgDir)
    const deps = await makeDeps(async (id) => id === 'github-monitor' ? lookup : undefined)

    await expect(callInstall(deps, { id: 'github-monitor' })).rejects.toThrow(/permission.*mismatch/i)
  })

  it('refuses when a symlink is found in the local app tree', async () => {
    const pkgDir = join(localRegistryDir, 'packages', 'github-monitor')
    seedLocalPackage(pkgDir, validPackageJson(), { symlink: true })

    const entry = validRegistryEntry()
    const lookup = asLocalLookup(entry, localRegistryDir, pkgDir)
    const deps = await makeDeps(async (id) => id === 'github-monitor' ? lookup : undefined)

    await expect(callInstall(deps, { id: 'github-monitor' })).rejects.toThrow(/symlink/i)
  })

  it('refuses when manifest id does not match requested id', async () => {
    const pkgDir = join(localRegistryDir, 'packages', 'github-monitor')
    const wrongPkg = validPackageJson()
    ;(wrongPkg.mim as Record<string, unknown>).id = 'wrong-id'
    seedLocalPackage(pkgDir, wrongPkg)

    const entry = validRegistryEntry()
    const lookup = asLocalLookup(entry, localRegistryDir, pkgDir)
    const deps = await makeDeps(async (id) => id === 'github-monitor' ? lookup : undefined)

    await expect(callInstall(deps, { id: 'github-monitor' })).rejects.toThrow(/id.*mismatch/i)
  })
})

describe('archive installs', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>
  const FIXED_CLOCK = 1718000000000

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-archive-install-test-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    mkdirSync(globalDir, { recursive: true })

    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)

    writeFileSync(join(dir, 'mim.yaml'), 'name: test-workspace\n')

    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * Build a real .tar.gz from a directory. Returns the buffer and its sha256 hex hash.
   */
  function buildTarball(sourceDir: string): { buffer: Buffer; hash: string } {
    const { execFileSync } = require('child_process') as typeof import('child_process')
    const { createHash } = require('crypto') as typeof import('crypto')

    const tmpTar = join(dir, 'test-archive.tar.gz')
    execFileSync('tar', ['czf', tmpTar, '-C', sourceDir, '.'])
    const buffer = readFileSync(tmpTar)
    const hash = createHash('sha256').update(buffer).digest('hex')
    rmSync(tmpTar, { force: true })
    return { buffer, hash }
  }

  function archiveRegistryEntry(overrides?: Partial<RegistryEntry>): RegistryEntry {
    return {
      id: 'github-monitor',
      name: 'GitHub Monitor',
      description: 'Org-wide issues/PRs/activity monitoring',
      archive: 'https://registry.example.com/packages/github-monitor-1.2.0.tar.gz',
      hash: 'sha256:placeholder',
      version: '1.2.0',
      permissions: { http: ['api.github.com'], secrets: ['github_token'] },
      engines: { mim: 'runtime-v1' },
      ...overrides,
    }
  }

  function asArchiveLookup(entry: RegistryEntry, auth?: { token: string }): LookupResult {
    const result: LookupResult = {
      ...entry,
      registryId: 'account',
      registryKind: 'url',
      registryLocation: 'https://mim.shoulde.rs/api/v1/registry/index',
    }
    if (auth) result.auth = auth
    return result
  }

  /** Seed a directory with a valid package structure (to be tarred up). */
  function seedArchiveContent(pkgDir: string, packageJson?: Record<string, unknown>): void {
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(packageJson ?? validPackageJson()))
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>GitHub Monitor</h1>')
  }

  async function makeDeps(
    lookupFn: InstallToolDeps['lookupRegistryEntry'],
    fetchUrlFn?: InstallToolDeps['fetchUrl'],
  ): Promise<InstallToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({
      getWorkspacePath: () => dir,
    })
    return {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: () => FIXED_CLOCK,
      lookupRegistryEntry: lookupFn,
      ...(fetchUrlFn ? { fetchUrl: fetchUrlFn } : {}),
    }
  }

  async function callInstall(deps: InstallToolDeps, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    registerInstallTools(tools, deps)
    return (await tools.call('package.install', params, { actor: 'user' })) as Record<string, unknown>
  }

  it('installs an archive entry (happy path)', async () => {
    // Build a real tarball from a valid package.
    const contentDir = join(dir, 'archive-content')
    seedArchiveContent(contentDir)
    const { buffer, hash } = buildTarball(contentDir)

    const entry = archiveRegistryEntry({ hash: `sha256:${hash}` })
    const lookup = asArchiveLookup(entry)

    const mockFetch = vi.fn<InstallToolDeps['fetchUrl']>().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    } as Response)

    const deps = await makeDeps(
      async (id) => id === 'github-monitor' ? lookup : undefined,
      mockFetch,
    )
    const result = await callInstall(deps, { id: 'github-monitor' })

    expect(result.installed).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')

    // Package was copied to global dir.
    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    expect(existsSync(join(installDir, 'package.json'))).toBe(true)
    expect(existsSync(join(installDir, 'ui', 'index.html'))).toBe(true)

    // Provenance records archive URL, no git info.
    const provenance = JSON.parse(readFileSync(join(installDir, '.mim-install.json'), 'utf-8'))
    expect(provenance.source).toBe('https://registry.example.com/packages/github-monitor-1.2.0.tar.gz')
    expect(provenance.path).toBeNull()
    expect(provenance.ref).toBeNull()
    expect(provenance.commit).toBeNull()
    expect(provenance.installedAt).toBe(FIXED_CLOCK)

    // No git calls made.
    expect(vi.mocked(cloneRepo)).not.toHaveBeenCalled()
    expect(vi.mocked(fetchRepo)).not.toHaveBeenCalled()

    // Temp files cleaned up.
    const tmpDir = join(cacheRoot, 'tmp')
    const tmpTarball = join(tmpDir, 'github-monitor-1.2.0.tar.gz')
    const tmpExtract = join(tmpDir, 'github-monitor-1.2.0')
    expect(existsSync(tmpTarball)).toBe(false)
    expect(existsSync(tmpExtract)).toBe(false)
  })

  it('installs an archive whose package is inside one top-level folder', async () => {
    const archiveRoot = join(dir, 'archive-root')
    const contentDir = join(archiveRoot, 'github-monitor-1.2.0')
    seedArchiveContent(contentDir)
    const { buffer, hash } = buildTarball(archiveRoot)

    const entry = archiveRegistryEntry({ hash: `sha256:${hash}` })
    const lookup = asArchiveLookup(entry)

    const mockFetch = vi.fn<InstallToolDeps['fetchUrl']>().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    } as Response)

    const deps = await makeDeps(
      async (id) => id === 'github-monitor' ? lookup : undefined,
      mockFetch,
    )
    const result = await callInstall(deps, { id: 'github-monitor' })

    expect(result.installed).toBe('github-monitor')
    expect(existsSync(join(globalDir, 'github-monitor', '1.2.0', 'package.json'))).toBe(true)
    expect(deps.packages.get('github-monitor')?.manifest.id).toBe('github-monitor')
  })

  it('throws on hash mismatch', async () => {
    const contentDir = join(dir, 'archive-content')
    seedArchiveContent(contentDir)
    const { buffer } = buildTarball(contentDir)

    const wrongHash = 'f'.repeat(64)
    const entry = archiveRegistryEntry({ hash: `sha256:${wrongHash}` })
    const lookup = asArchiveLookup(entry)

    const mockFetch = vi.fn<InstallToolDeps['fetchUrl']>().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    } as Response)

    const deps = await makeDeps(
      async (id) => id === 'github-monitor' ? lookup : undefined,
      mockFetch,
    )

    await expect(callInstall(deps, { id: 'github-monitor' })).rejects.toThrow(/hash mismatch/i)
  })

  it('throws on non-HTTPS archive URL', async () => {
    const entry = archiveRegistryEntry({
      archive: 'http://insecure.example.com/pkg.tar.gz',
      hash: 'sha256:' + 'a'.repeat(64),
    })
    const lookup = asArchiveLookup(entry)

    const deps = await makeDeps(
      async (id) => id === 'github-monitor' ? lookup : undefined,
    )

    await expect(callInstall(deps, { id: 'github-monitor' })).rejects.toThrow(/HTTPS/)
  })

  it('throws on credential URL in archive', async () => {
    const entry = archiveRegistryEntry({
      archive: 'https://user:pass@registry.example.com/pkg.tar.gz',
      hash: 'sha256:' + 'a'.repeat(64),
    })
    const lookup = asArchiveLookup(entry)

    const deps = await makeDeps(
      async (id) => id === 'github-monitor' ? lookup : undefined,
    )

    await expect(callInstall(deps, { id: 'github-monitor' })).rejects.toThrow(/credential/)
  })

  it('passes Authorization header when auth is present', async () => {
    const contentDir = join(dir, 'archive-content')
    seedArchiveContent(contentDir)
    const { buffer, hash } = buildTarball(contentDir)

    const entry = archiveRegistryEntry({ hash: `sha256:${hash}` })
    const lookup = asArchiveLookup(entry, { token: 'secret-token-123' })

    const mockFetch = vi.fn<InstallToolDeps['fetchUrl']>().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    } as Response)

    const deps = await makeDeps(
      async (id) => id === 'github-monitor' ? lookup : undefined,
      mockFetch,
    )
    await callInstall(deps, { id: 'github-monitor' })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://registry.example.com/packages/github-monitor-1.2.0.tar.gz',
      { headers: { Authorization: 'Bearer secret-token-123' } },
    )
  })

  it('throws when archive download fails (HTTP error)', async () => {
    const entry = archiveRegistryEntry({ hash: 'sha256:' + 'a'.repeat(64) })
    const lookup = asArchiveLookup(entry)

    const mockFetch = vi.fn<InstallToolDeps['fetchUrl']>().mockResolvedValue({
      ok: false,
      status: 403,
    } as Response)

    const deps = await makeDeps(
      async (id) => id === 'github-monitor' ? lookup : undefined,
      mockFetch,
    )

    await expect(callInstall(deps, { id: 'github-monitor' })).rejects.toThrow(/failed to download archive.*403/i)
  })

  it('provenance file does not contain tokens', async () => {
    const contentDir = join(dir, 'archive-content')
    seedArchiveContent(contentDir)
    const { buffer, hash } = buildTarball(contentDir)

    const entry = archiveRegistryEntry({ hash: `sha256:${hash}` })
    const lookup = asArchiveLookup(entry, { token: 'super-secret-token' })

    const mockFetch = vi.fn<InstallToolDeps['fetchUrl']>().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    } as Response)

    const deps = await makeDeps(
      async (id) => id === 'github-monitor' ? lookup : undefined,
      mockFetch,
    )
    await callInstall(deps, { id: 'github-monitor' })

    const installDir = join(globalDir, 'github-monitor', '1.2.0')
    const raw = readFileSync(join(installDir, '.mim-install.json'), 'utf-8')
    expect(raw).not.toContain('token')
    expect(raw).not.toContain('secret')
  })
})

describe('app.add archive entry', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>
  const FIXED_CLOCK = 1718000000000

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-app-add-archive-'))
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

  it('enables on the local layer and does not write a mim.yaml pin', async () => {
    // Build a real tarball.
    const contentDir = join(dir, 'archive-content')
    mkdirSync(join(contentDir, 'ui'), { recursive: true })
    writeFileSync(join(contentDir, 'package.json'), JSON.stringify(validPackageJson()))
    writeFileSync(join(contentDir, 'ui', 'index.html'), '<h1>GM</h1>')
    const { execFileSync } = require('child_process') as typeof import('child_process')
    const { createHash } = require('crypto') as typeof import('crypto')
    const tmpTar = join(dir, 'test-archive.tar.gz')
    execFileSync('tar', ['czf', tmpTar, '-C', contentDir, '.'])
    const buffer = readFileSync(tmpTar)
    const hash = createHash('sha256').update(buffer).digest('hex')
    rmSync(tmpTar, { force: true })

    const entry: RegistryEntry = {
      id: 'github-monitor',
      name: 'GitHub Monitor',
      archive: 'https://registry.example.com/packages/github-monitor-1.2.0.tar.gz',
      hash: `sha256:${hash}`,
      version: '1.2.0',
      permissions: { http: ['api.github.com'], secrets: ['github_token'] },
      engines: { mim: 'runtime-v1' },
    }
    const lookup: LookupResult = {
      ...entry,
      registryId: 'account',
      registryKind: 'url',
      registryLocation: 'https://mim.shoulde.rs/api/v1/registry/index',
      auth: { token: 'my-token' },
    }

    const mockFetch = vi.fn<InstallToolDeps['fetchUrl']>().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    } as Response)

    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })
    const { registerCoreAppTools } = await import('@main/tools/coreApps.js')
    registerCoreAppTools(tools, { packages, enablement })

    const deps: InstallToolDeps = {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: () => FIXED_CLOCK,
      lookupRegistryEntry: async (id) => id === entry.id ? lookup : undefined,
      fetchUrl: mockFetch,
    }

    registerInstallTools(tools, deps)
    const result = (await tools.call('app.add', { id: 'github-monitor' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.added).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')
    expect(result.local).toBe(true)

    // Installed to global dir.
    expect(existsSync(join(globalDir, 'github-monitor', '1.2.0', 'package.json'))).toBe(true)

    // mim.yaml must NOT have an apps entry (archive entries use local layer).
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps?.['github-monitor']).toBeUndefined()

    // Enabled on the local layer.
    expect(enablement.localOverride('github-monitor')).toBe(true)
  })
})

describe('app.add local entry', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let localRegistryDir: string
  let tools: ReturnType<typeof createToolRegistry>
  const FIXED_CLOCK = 1718000000000

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-app-add-local-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    localRegistryDir = join(dir, 'local-registry')
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

  it('enables locally without a mim.yaml apps pin, returns local: true', async () => {
    const pkgDir = join(localRegistryDir, 'packages', 'github-monitor')
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(validPackageJson()))
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>GM</h1>')

    const entry = validRegistryEntry()
    const lookup = asLocalLookup(entry, localRegistryDir, pkgDir)
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })
    const { registerCoreAppTools } = await import('@main/tools/coreApps.js')
    registerCoreAppTools(tools, { packages, enablement })

    const deps: InstallToolDeps = {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: () => FIXED_CLOCK,
      lookupRegistryEntry: async (id) => id === entry.id ? lookup : undefined,
    }

    registerInstallTools(tools, deps)
    const result = (await tools.call('app.add', { id: 'github-monitor' }, { actor: 'user' })) as Record<string, unknown>

    expect(result.added).toBe('github-monitor')
    expect(result.version).toBe('1.2.0')
    expect(result.local).toBe(true)

    // Installed to global dir.
    expect(existsSync(join(globalDir, 'github-monitor', '1.2.0', 'package.json'))).toBe(true)

    // mim.yaml must NOT have an apps entry for this package.
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps?.['github-monitor']).toBeUndefined()

    // Enabled on the local layer.
    expect(enablement.localOverride('github-monitor')).toBe(true)
  })
})
