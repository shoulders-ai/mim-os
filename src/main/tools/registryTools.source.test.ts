import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { createPackageLoader } from '@main/packages/packages.js'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'

// Mock git operations at the system boundary (same pattern as registryTools.test.ts).
vi.mock('@main/git.js', () => ({
  cloneRepo: vi.fn(),
  pullRepo: vi.fn(),
  hasSystemGit: vi.fn().mockResolvedValue(false),
  isSshUrl: vi.fn().mockReturnValue(false),
  buildAuthedUrl: vi.fn((url: string) => url),
  checkoutRef: vi.fn(),
  resolveHead: vi.fn(),
}))

import { registerRegistryTools, type RegistryToolDeps } from '@main/tools/registryTools.js'

function validLocalIndex(packages?: unknown[]) {
  return {
    manifestVersion: 1,
    packages: packages ?? [
      {
        id: 'test-app',
        name: 'Test App',
        description: 'A test application',
        version: '1.0.0',
        dir: 'packages/test-app',
        permissions: {},
      },
    ],
  }
}

describe('registry.inspectSource', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-reg-source-'))
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

  async function makeDeps(): Promise<RegistryToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({
      getWorkspacePath: () => dir,
    })
    return { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => dir }
  }

  it('finds apps in a valid local folder', async () => {
    const sourceDir = join(dir, 'my-registry')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'index.json'), JSON.stringify(validLocalIndex()))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.inspectSource',
      { path: sourceDir },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result.status).toBe('ok')
    expect(result.appCount).toBe(1)
    expect(result.kind).toBe('local')
    expect(result.location).toBe(sourceDir)

    const apps = result.apps as Record<string, unknown>[]
    expect(apps).toHaveLength(1)
    expect(apps[0]).toMatchObject({
      id: 'test-app',
      name: 'Test App',
      description: 'A test application',
      version: '1.0.0',
    })
  })

  it('auto-discovers packages when no index.json exists', async () => {
    const sourceDir = join(dir, 'dev-folder')
    const pkgDir = join(sourceDir, 'packages', 'my-app')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: 'my-app', version: '0.2.0',
      mim: { manifestVersion: 1, id: 'my-app', name: 'My App', description: 'Auto-discovered', permissions: {} },
    }))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.inspectSource',
      { path: sourceDir },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result.status).toBe('ok')
    expect(result.appCount).toBe(1)
    const apps = result.apps as Record<string, unknown>[]
    expect(apps[0]).toMatchObject({ id: 'my-app', name: 'My App', version: '0.2.0' })
  })

  it('returns diagnostics for empty folder with no packages', async () => {
    const sourceDir = join(dir, 'empty-registry')
    mkdirSync(sourceDir, { recursive: true })

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.inspectSource',
      { path: sourceDir },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result.status).toBe('missing')
    expect(result.appCount).toBe(0)
    expect((result.diagnostics as string[])).toContain('No packages with a valid mim manifest found in this folder')
  })

  it('returns diagnostics for invalid index.json', async () => {
    const sourceDir = join(dir, 'bad-registry')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'index.json'), '{ not valid json')

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.inspectSource',
      { path: sourceDir },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result.status).toBe('error')
    expect((result.diagnostics as string[]).length).toBeGreaterThan(0)
  })

  it('auto-generates an id from the last path segment', async () => {
    const sourceDir = join(dir, 'My Cool Registry')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'index.json'), JSON.stringify(validLocalIndex()))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.inspectSource',
      { path: sourceDir },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result.id).toBe('my-cool-registry')
  })

  it('uses provided id when given', async () => {
    const sourceDir = join(dir, 'some-folder')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'index.json'), JSON.stringify(validLocalIndex()))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.inspectSource',
      { path: sourceDir, id: 'custom-id' },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result.id).toBe('custom-id')
  })

  it('rejects relative paths', async () => {
    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.inspectSource', { path: 'relative/path' }, { actor: 'user' }),
    ).rejects.toThrow('Path must be absolute')
  })

  it('rejects non-existent paths', async () => {
    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.inspectSource', { path: join(dir, 'nonexistent') }, { actor: 'user' }),
    ).rejects.toThrow('Path does not exist')
  })

  it('rejects paths that are files, not directories', async () => {
    const filePath = join(dir, 'not-a-dir')
    writeFileSync(filePath, 'hello')

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.inspectSource', { path: filePath }, { actor: 'user' }),
    ).rejects.toThrow('not a directory')
  })
})

describe('registry.addSource', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-reg-add-'))
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

  async function makeDeps(): Promise<RegistryToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({
      getWorkspacePath: () => dir,
    })
    return { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => dir }
  }

  it('writes a new source to registries.json', async () => {
    const sourceDir = join(dir, 'my-registry')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'index.json'), JSON.stringify(validLocalIndex()))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.addSource',
      { id: 'ext-test', path: sourceDir, name: 'External Test', confirmed: true },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result).toEqual({ added: 'ext-test', path: sourceDir })

    // Verify the file was written.
    const registriesPath = join(dir, '.mim', 'registries.json')
    expect(existsSync(registriesPath)).toBe(true)

    const data = JSON.parse(readFileSync(registriesPath, 'utf-8'))
    expect(data.registries['ext-test']).toEqual({ name: 'External Test', path: sourceDir })
  })

  it('appends to existing registries.json', async () => {
    const sourceDir = join(dir, 'my-registry')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'index.json'), JSON.stringify(validLocalIndex()))

    // Pre-seed an existing registries.json
    const registriesPath = join(dir, '.mim', 'registries.json')
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(registriesPath, JSON.stringify({
      registries: {
        existing: { name: 'Existing', path: '/some/path' },
      },
    }))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await tools.call(
      'registry.addSource',
      { id: 'new-one', path: sourceDir, confirmed: true },
      { actor: 'user' },
    )

    const data = JSON.parse(readFileSync(registriesPath, 'utf-8'))
    expect(data.registries.existing).toBeDefined()
    expect(data.registries['new-one']).toMatchObject({ path: sourceDir })
  })

  it('auto-generates index.json when adding a folder with packages but no index', async () => {
    const sourceDir = join(dir, 'dev-apps')
    const pkgDir = join(sourceDir, 'packages', 'cool-app')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: 'cool-app', version: '0.3.0',
      mim: { manifestVersion: 1, id: 'cool-app', name: 'Cool App', permissions: {} },
    }))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await tools.call(
      'registry.addSource',
      { id: 'dev-apps', path: sourceDir, confirmed: true },
      { actor: 'user' },
    )

    const indexPath = join(sourceDir, 'index.json')
    expect(existsSync(indexPath)).toBe(true)
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
    expect(index.manifestVersion).toBe(1)
    expect(index.packages).toHaveLength(1)
    expect(index.packages[0].id).toBe('cool-app')
    expect(index.packages[0].dir).toBe('packages/cool-app')
  })

  it('rejects without confirmed: true', async () => {
    const sourceDir = join(dir, 'my-registry')
    mkdirSync(sourceDir, { recursive: true })

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.addSource', { id: 'ext-test', path: sourceDir }, { actor: 'user' }),
    ).rejects.toThrow('requires confirmed: true')
  })

  it('rejects reserved id "default"', async () => {
    const sourceDir = join(dir, 'my-registry')
    mkdirSync(sourceDir, { recursive: true })

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.addSource', { id: 'default', path: sourceDir, confirmed: true }, { actor: 'user' }),
    ).rejects.toThrow('reserved id')
  })

  it('rejects reserved id "user"', async () => {
    const sourceDir = join(dir, 'my-registry')
    mkdirSync(sourceDir, { recursive: true })

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.addSource', { id: 'user', path: sourceDir, confirmed: true }, { actor: 'user' }),
    ).rejects.toThrow('reserved id')
  })

  it('rejects invalid id format', async () => {
    const sourceDir = join(dir, 'my-registry')
    mkdirSync(sourceDir, { recursive: true })

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.addSource', { id: 'UPPER-case', path: sourceDir, confirmed: true }, { actor: 'user' }),
    ).rejects.toThrow('Invalid source id')
  })

  it('throws when no workspace is open', async () => {
    const sourceDir = join(dir, 'my-registry')
    mkdirSync(sourceDir, { recursive: true })

    const deps = await makeDeps()
    deps.getWorkspacePath = () => null
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.addSource', { id: 'ext-test', path: sourceDir, confirmed: true }, { actor: 'user' }),
    ).rejects.toThrow('No workspace is open')
  })
})

describe('registry.removeSource', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-reg-rm-'))
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

  async function makeDeps(): Promise<RegistryToolDeps> {
    const packages = await createPackageLoader(tools, { globalDir })
    const enablement = createPackageEnablementStore({
      getWorkspacePath: () => dir,
    })
    return { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => dir }
  }

  it('removes an entry from registries.json', async () => {
    const registriesPath = join(dir, '.mim', 'registries.json')
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(registriesPath, JSON.stringify({
      registries: {
        'ext-test': { name: 'External Test', path: '/some/path' },
        'other': { name: 'Other', path: '/other/path' },
      },
    }))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.removeSource',
      { id: 'ext-test' },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result).toEqual({ removed: 'ext-test' })

    const data = JSON.parse(readFileSync(registriesPath, 'utf-8'))
    expect(data.registries['ext-test']).toBeUndefined()
    expect(data.registries.other).toBeDefined()
  })

  it('handles missing registries.json gracefully', async () => {
    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.removeSource',
      { id: 'nonexistent' },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result).toEqual({ removed: 'nonexistent' })
  })

  it('handles missing entry gracefully', async () => {
    const registriesPath = join(dir, '.mim', 'registries.json')
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(registriesPath, JSON.stringify({
      registries: {
        existing: { name: 'Existing', path: '/some/path' },
      },
    }))

    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    const result = await tools.call(
      'registry.removeSource',
      { id: 'nonexistent' },
      { actor: 'user' },
    ) as Record<string, unknown>

    expect(result).toEqual({ removed: 'nonexistent' })

    // Original entry should still be there.
    const data = JSON.parse(readFileSync(registriesPath, 'utf-8'))
    expect(data.registries.existing).toBeDefined()
  })

  it('rejects reserved id "default"', async () => {
    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.removeSource', { id: 'default' }, { actor: 'user' }),
    ).rejects.toThrow('reserved id')
  })

  it('rejects reserved id "user"', async () => {
    const deps = await makeDeps()
    registerRegistryTools(tools, deps)

    await expect(
      tools.call('registry.removeSource', { id: 'user' }, { actor: 'user' }),
    ).rejects.toThrow('reserved id')
  })
})
