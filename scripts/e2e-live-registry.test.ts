// End-to-end check against the LIVE registry on GitHub. Needs network, so it
// only runs when explicitly asked for: MIM_E2E=1 npx vitest run scripts/e2e-live-registry.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { createPackageLoader } from '@main/packages/packages.js'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'
import { registerInstallTools } from '@main/tools/install.js'
import { registerRegistryTools } from '@main/tools/registryTools.js'
import { lookupRegistryEntry } from '@main/packages/registrySources.js'
import { registerCoreAppTools } from '@main/tools/coreApps.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'

describe.skipIf(!process.env.MIM_E2E)('live registry end-to-end', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mim-e2e-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    const builtinDir = join(dir, 'builtin-packages')
    mkdirSync(globalDir, { recursive: true })
    mkdirSync(builtinDir, { recursive: true })
    writeFileSync(join(dir, 'mim.yaml'), 'name: e2e-workspace\n')

    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    const packages = await createPackageLoader(tools, { builtinDir, globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })
    registerCoreAppTools(tools, { packages, enablement })
    registerRegistryTools(tools, { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => dir })
    registerInstallTools(tools, {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: Date.now,
      lookupRegistryEntry: (id, version) => lookupRegistryEntry(id, {
        workspacePath: dir,
        cacheRoot,
        version,
      }),
    })
  }, 120_000)

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists the three packages from the live registry', async () => {
    const result = await tools.call('registry.list', {}, { actor: 'user' }) as {
      registries: Array<{ id: string; kind: string; location: string; origin: string; status: string; diagnostics: string[] }>
      entries: Array<{ id: string; registryId: string; path?: string; commit: string }>
    }
    // Should have exactly one registry source (the default)
    expect(result.registries).toHaveLength(1)
    expect(result.registries[0].id).toBe('default')
    expect(result.registries[0].status).toBe('ok')
    expect(result.registries[0].kind).toBe('git')
    expect(result.registries[0].origin).toBe('default')
    expect(result.registries[0].diagnostics).toEqual([])

    // Should have the three packages from the live registry
    expect(result.entries.map(e => e.id).sort()).toEqual(['docx-review', 'github-monitor', 'slides'])
    for (const entry of result.entries) {
      expect(entry.registryId).toBe('default')
      expect(entry.path).toMatch(/^packages\//)
      expect(entry.commit).toBe('c4987a1a8f607ce56138f81cebe8cec77b50e4e0')
    }
  }, 120_000)

  it('app.add installs slides from the monorepo subdir, pins mim.yaml, and enables it', async () => {
    const result = await tools.call('app.add', { id: 'slides' }, { actor: 'user' }) as Record<string, unknown>
    expect(result.added).toBe('slides')
    expect(result.version).toBe('0.1.0')

    const installDir = join(globalDir, 'slides', '0.1.0')
    expect(existsSync(join(installDir, 'package.json'))).toBe(true)
    expect(existsSync(join(installDir, 'ui', 'index.html'))).toBe(true)
    // Monorepo root content must NOT be in the install.
    expect(existsSync(join(installDir, 'packages'))).toBe(false)
    expect(existsSync(join(installDir, 'vitest.config.ts'))).toBe(false)

    const provenance = JSON.parse(readFileSync(join(installDir, '.mim-install.json'), 'utf-8'))
    expect(provenance.source).toBe('https://github.com/shoulders-ai/mim-apps')
    expect(provenance.path).toBe('packages/slides')
    expect(provenance.ref).toBe('slides-v0.1.0')
    expect(provenance.commit).toBe('c4987a1a8f607ce56138f81cebe8cec77b50e4e0')

    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps?.slides).toEqual({
      source: 'https://github.com/shoulders-ai/mim-apps',
      path: 'packages/slides',
      version: '0.1.0',
      enabled: true,
    })
  }, 180_000)

  it('installs github-monitor with manifest-exact permission verification', async () => {
    const result = await tools.call('package.install', { id: 'github-monitor' }, { actor: 'user' }) as Record<string, unknown>
    expect(result.installed).toBe('github-monitor')
    expect(result.version).toBe('0.1.0')
    expect(existsSync(join(globalDir, 'github-monitor', '0.1.0', 'package.json'))).toBe(true)
  }, 180_000)
})

// Local-dir registry test — runs offline, seeded in a temp workspace with a
// machine-local .mim/registries.json pointing at a local registry dir.
describe('local registry dir entry', () => {
  let dir: string
  let cacheRoot: string
  let globalDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mim-localreg-'))
    cacheRoot = join(dir, 'cache')
    globalDir = join(dir, 'global-packages')
    const builtinDir = join(dir, 'builtin-packages')
    mkdirSync(globalDir, { recursive: true })
    mkdirSync(builtinDir, { recursive: true })

    // Create a minimal workspace
    writeFileSync(join(dir, 'mim.yaml'), 'name: local-reg-test\n')
    mkdirSync(join(dir, '.mim', 'packages'), { recursive: true })

    // Create a local registry with a dir entry pointing at a tiny seeded package
    const registryDir = join(dir, 'my-registry')
    const packageDir = join(registryDir, 'test-app')
    mkdirSync(packageDir, { recursive: true })

    writeFileSync(join(registryDir, 'index.json'), JSON.stringify({
      manifestVersion: 1,
      packages: [
        {
          id: 'test-app',
          name: 'Test App',
          description: 'A tiny seeded test package',
          version: '0.1.0',
          dir: 'test-app',
          permissions: { workspace: { read: true, write: false } },
          engines: { mim: 'runtime-v1' },
        },
      ],
    }))

    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: '@mim/test-app',
      version: '0.1.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'test-app',
        name: 'Test App',
        description: 'A tiny seeded test package',
        permissions: { workspace: { read: true } },
        engines: { mim: 'runtime-v1' },
      },
    }))

    // Write .mim/registries.json pointing at the local registry
    writeFileSync(join(dir, '.mim', 'registries.json'), JSON.stringify({
      registries: {
        'local-dev': {
          path: registryDir,
          name: 'Local Dev',
        },
      },
    }))

    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    const packages = await createPackageLoader(tools, { builtinDir, globalDir })
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })
    registerCoreAppTools(tools, { packages, enablement })
    registerRegistryTools(tools, { packages, enablement, cacheRoot, globalDir, getWorkspacePath: () => dir })
    registerInstallTools(tools, {
      packages,
      enablement,
      cacheRoot,
      globalDir,
      clock: Date.now,
      lookupRegistryEntry: (id, version) => lookupRegistryEntry(id, {
        workspacePath: dir,
        cacheRoot,
        version,
      }),
    })
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('registry.list includes the local registry source and its dir entry', async () => {
    const result = await tools.call('registry.list', {}, { actor: 'user' }) as {
      registries: Array<{ id: string; kind: string; origin: string; status: string }>
      entries: Array<{ id: string; registryId: string; dir?: string }>
    }

    // Should have at least the local-dev source and the default source
    const localSource = result.registries.find(r => r.id === 'local-dev')
    expect(localSource).toBeDefined()
    expect(localSource!.kind).toBe('local')
    expect(localSource!.origin).toBe('machine')
    expect(localSource!.status).toBe('ok')

    const defaultSource = result.registries.find(r => r.id === 'default')
    expect(defaultSource).toBeDefined()

    // The local entry should appear with the correct registryId
    const testEntry = result.entries.find(e => e.id === 'test-app')
    expect(testEntry).toBeDefined()
    expect(testEntry!.registryId).toBe('local-dev')
    expect(testEntry!.dir).toBe('test-app')
  })

  it('app.add from a local registry enables locally without a mim.yaml pin', async () => {
    const result = await tools.call('app.add', { id: 'test-app' }, { actor: 'user' }) as Record<string, unknown>
    expect(result.added).toBe('test-app')
    expect(result.version).toBe('0.1.0')
    expect(result.local).toBe(true)

    // Verify install dir exists with file:// provenance
    const installDir = join(globalDir, 'test-app', '0.1.0')
    expect(existsSync(join(installDir, 'package.json'))).toBe(true)

    const provenance = JSON.parse(readFileSync(join(installDir, '.mim-install.json'), 'utf-8'))
    expect(provenance.source).toMatch(/^file:\/\//)
    expect(provenance.commit).toBeNull()

    // mim.yaml must NOT have a pin for test-app (local-only enablement)
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps?.['test-app']).toBeUndefined()

    // But the package should be locally enabled (via enabled.json)
    const enabledJson = JSON.parse(readFileSync(join(dir, '.mim', 'packages', 'enabled.json'), 'utf-8'))
    expect(enabledJson.enabled).toContain('test-app')
  })
})
