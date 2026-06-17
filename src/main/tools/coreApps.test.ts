import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createPackageEnablementStore, type PackageEnablementStore } from '@main/packages/packageEnablement.js'
import type { PackagePermissions } from '@main/packages/packageManifest.js'
import type { LoadedPackage, PackageLoader } from '@main/packages/packages.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import { registerCoreAppTools, type AppStatus } from '@main/tools/coreApps.js'

const ctx = { actor: 'user' as const }

function makePackage(
  id: string,
  source: LoadedPackage['source'],
  opts: { backend?: string; permissions?: PackagePermissions; dir?: string; version?: string; dataFolder?: string } = {},
): LoadedPackage {
  return {
    source,
    dir: opts.dir ?? `/tmp/${id}`,
    hasReadme: false,
    manifest: {
      manifestVersion: 1,
      id,
      name: id,
      version: opts.version ?? '0.1.0',
      views: [],
      backend: opts.backend,
      permissions: opts.permissions ?? {},
      dataFolder: opts.dataFolder,
    },
  }
}

function makeLoader(pkgs: LoadedPackage[]): PackageLoader {
  return {
    list: () => pkgs,
    get: (id) => pkgs.find(p => p.manifest.id === id),
    diagnostics: () => [],
    onChange: () => {},
    rescan: async () => {},
  }
}

describe('app tools (status / enable / disable / trust)', () => {
  let root: string
  let tools: ReturnType<typeof createToolRegistry>
  let enablement: PackageEnablementStore
  let emit: ReturnType<typeof vi.fn>
  let invalidate: ReturnType<typeof vi.fn>

  function register(pkgs: LoadedPackage[]): void {
    registerCoreAppTools(tools, {
      packages: makeLoader(pkgs),
      enablement,
      emit,
      invalidate,
    })
  }

  function writeMimYaml(body: string): void {
    writeFileSync(join(root, 'mim.yaml'), body)
  }

  async function status(): Promise<AppStatus[]> {
    const result = await tools.call('app.status', {}, ctx) as { apps: AppStatus[] }
    return result.apps
  }

  async function statusOf(id: string): Promise<AppStatus> {
    const row = (await status()).find(app => app.id === id)
    expect(row, id).toBeDefined()
    return row!
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-apps-'))
    writeMimYaml('name: test-ws\n')
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(root)
    enablement = createPackageEnablementStore({ getWorkspacePath: () => tools.getWorkspacePath() })
    emit = vi.fn()
    invalidate = vi.fn()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('declares inputSchema (not parameters) on every app tool', () => {
    register([])
    for (const name of ['app.status', 'app.enable', 'app.disable', 'app.trust']) {
      const def = tools.get(name)
      expect(def, name).toBeDefined()
      expect(def!.inputSchema, name).toBeDefined()
      expect((def as Record<string, unknown>).parameters, name).toBeUndefined()
    }
  })

  describe('app.status', () => {
    it('returns one resolved row per loaded package, sorted by id', async () => {
      register([
        makePackage('hello', 'global'),
        makePackage('board', 'global'),
      ])
      const apps = await status()
      expect(apps.map(app => app.id)).toEqual(['board', 'hello'])
      expect(apps[1]).toEqual({
        id: 'hello',
        enabled: false,
        layer: 'default',
        installed: true,
        installedVersions: ['0.1.0'],
        source: 'global',
        shadowed: false,
        needsTrust: false,
        needsInstall: false,
        folderPresent: false,
      })
      expect(apps[0]).toMatchObject({ id: 'board', enabled: false, layer: 'default' })
    })

    it('reports shadowed when the loader winner shadows other copies', async () => {
      const winner = makePackage('hello', 'workspace')
      winner.shadowedSources = ['global']
      register([winner])
      expect(await statusOf('hello')).toMatchObject({ source: 'workspace', shadowed: true })
    })

    it('reports layer workspace when a committed entry decides enablement', async () => {
      writeMimYaml('name: test-ws\napps:\n  board: true\n')
      register([makePackage('board', 'workspace')])
      expect(await statusOf('board')).toMatchObject({ enabled: true, layer: 'workspace' })
    })

    it('reports layer local when enabled.json decides enablement', async () => {
      register([makePackage('hello', 'global')])
      enablement.setEnabled('hello', true)
      expect(await statusOf('hello')).toMatchObject({ enabled: true, layer: 'local' })
    })

    it('committed entry beats a local override for workspace packages', async () => {
      writeMimYaml('name: test-ws\napps:\n  board: true\n')
      register([makePackage('board', 'workspace')])
      enablement.setEnabled('board', false)
      expect(await statusOf('board')).toMatchObject({ enabled: true, layer: 'workspace' })
    })

    it('reports folderPresent from the manifest dataFolder', async () => {
      register([makePackage('board', 'global', { dataFolder: 'issues' })])
      expect((await statusOf('board')).folderPresent).toBe(false)
      mkdirSync(join(root, 'issues'), { recursive: true })
      expect((await statusOf('board')).folderPresent).toBe(true)
    })

    it('surfaces a committed-but-not-loaded package as a needsInstall row', async () => {
      writeMimYaml([
        'name: test-ws',
        'apps:',
        '  github-monitor:',
        '    source: https://github.com/shoulders-ai/mim-github-monitor',
        '    version: 1.2.0',
      ].join('\n') + '\n')
      register([makePackage('hello', 'global')])
      expect(await statusOf('github-monitor')).toEqual({
        id: 'github-monitor',
        enabled: true,
        layer: 'workspace',
        installed: false,
        installedVersions: [],
        source: 'https://github.com/shoulders-ai/mim-github-monitor',
        shadowed: false,
        needsTrust: false,
        needsInstall: true,
        folderPresent: false,
      })
    })

    it('flags an untrusted vendored package even without a committed entry', async () => {
      const dir = join(root, 'packages', 'vendored')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.mjs'), 'export const tools = {}')
      register([makePackage('vendored', 'workspace', { backend: './index.mjs', dir })])

      expect(await statusOf('vendored')).toMatchObject({ enabled: false, needsTrust: true })
    })

    it('flags an untrusted vendored package and ignores its committed flag', async () => {
      const dir = join(root, 'packages', 'vendored')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.mjs'), 'export const tools = {}')
      writeMimYaml('name: test-ws\napps:\n  vendored: true\n')
      register([makePackage('vendored', 'workspace', { backend: './index.mjs', dir })])

      expect(await statusOf('vendored')).toMatchObject({
        enabled: false,
        layer: 'default',
        needsTrust: true,
        needsInstall: false,
      })

      await tools.call('app.trust', { id: 'vendored' }, ctx)
      expect(await statusOf('vendored')).toMatchObject({
        enabled: true,
        layer: 'workspace',
        needsTrust: false,
      })
    })
  })

  describe('app.enable / app.disable', () => {
    it('defaults to the local layer when no committed entry exists', async () => {
      register([makePackage('docx-review', 'global')])
      enablement.setEnabled('docx-review', false)

      await expect(tools.call('app.enable', { id: 'docx-review' }, ctx))
        .resolves.toEqual({ ok: true, id: 'docx-review', layer: 'local' })

      expect(enablement.localOverride('docx-review')).toBe(true)
      expect(parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8')).apps).toBeUndefined()
    })

    it('defaults to the workspace layer when a committed entry exists', async () => {
      writeMimYaml('name: test-ws\napps:\n  board: false\n')
      register([makePackage('board', 'workspace')])

      await expect(tools.call('app.enable', { id: 'board' }, ctx))
        .resolves.toEqual({ ok: true, id: 'board', layer: 'workspace' })

      const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
      expect(config.apps?.board).toBe(true)
      expect(enablement.localOverride('board')).toBeNull()
    })

    it('honors an explicit layer and rejects an invalid one', async () => {
      register([makePackage('board', 'workspace')])

      await tools.call('app.enable', { id: 'board', layer: 'workspace' }, ctx)
      const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
      expect(config.apps?.board).toBe(true)

      await expect(tools.call('app.enable', { id: 'board', layer: 'global' }, ctx))
        .rejects.toThrow('Invalid layer')
    })

    it('app.enable mkdirs the manifest dataFolder and is idempotent', async () => {
      register([makePackage('knowledge', 'global', { dataFolder: 'knowledge' })])
      mkdirSync(join(root, 'knowledge'), { recursive: true })
      writeFileSync(join(root, 'knowledge', 'note.md'), '# keep me\n')

      await tools.call('app.enable', { id: 'knowledge' }, ctx)
      await tools.call('app.enable', { id: 'knowledge' }, ctx)

      expect(readFileSync(join(root, 'knowledge', 'note.md'), 'utf-8')).toBe('# keep me\n')
    })

    it('app.enable creates no folder for packages without a dataFolder', async () => {
      register([makePackage('docx-review', 'global')])
      await tools.call('app.enable', { id: 'docx-review' }, ctx)
      expect(existsSync(join(root, 'docx-review'))).toBe(false)
    })

    it('app.disable is non-destructive: the folder and its files stay', async () => {
      writeMimYaml('name: test-ws\napps:\n  knowledge: true\n')
      register([makePackage('knowledge', 'workspace')])
      mkdirSync(join(root, 'knowledge'), { recursive: true })
      writeFileSync(join(root, 'knowledge', 'kept.md'), '# do not delete\n')

      await expect(tools.call('app.disable', { id: 'knowledge' }, ctx))
        .resolves.toEqual({ ok: true, id: 'knowledge', layer: 'workspace' })

      const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
      expect(config.apps?.knowledge).toBe(false)
      expect(readFileSync(join(root, 'knowledge', 'kept.md'), 'utf-8')).toBe('# do not delete\n')
    })

    it('toggles a committed-but-not-installed package without refusing', async () => {
      writeMimYaml('name: test-ws\napps:\n  github-monitor: true\n')
      register([])
      await tools.call('app.disable', { id: 'github-monitor' }, ctx)
      const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
      expect(config.apps?.['github-monitor']).toBe(false)
    })

    it('app.enable refuses an untrusted vendored package with a clear error and writes nothing', async () => {
      const dir = join(root, 'packages', 'vendored')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.mjs'), 'export const tools = {}')
      register([makePackage('vendored', 'workspace', { backend: './index.mjs', dir })])

      await expect(tools.call('app.enable', { id: 'vendored' }, ctx))
        .rejects.toThrow(/needs trust/)

      expect(enablement.localOverride('vendored')).toBeNull()
      expect(parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8')).apps).toBeUndefined()
    })

    it('app.enable succeeds for a vendored package once trust is acked', async () => {
      const dir = join(root, 'packages', 'vendored')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.mjs'), 'export const tools = {}')
      register([makePackage('vendored', 'workspace', { backend: './index.mjs', dir })])

      await tools.call('app.trust', { id: 'vendored' }, ctx)
      await expect(tools.call('app.enable', { id: 'vendored' }, ctx))
        .resolves.toEqual({ ok: true, id: 'vendored', layer: 'local' })

      expect(await statusOf('vendored')).toMatchObject({ enabled: true, needsTrust: false })
    })

    it('app.enable throws instead of silently not taking effect (unverified global with committed entry)', async () => {
      const dir = join(root, 'fake-install', 'gpkg')
      mkdirSync(dir, { recursive: true })
      writeMimYaml('name: test-ws\napps:\n  gpkg: false\n')
      register([makePackage('gpkg', 'global', { dir })])

      await expect(tools.call('app.enable', { id: 'gpkg' }, ctx))
        .rejects.toThrow(/did not take effect/)
    })

    it('invalidates the package runtime and emits apps:changed on every write', async () => {
      register([makePackage('board', 'global')])

      await tools.call('app.enable', { id: 'board' }, ctx)
      expect(invalidate).toHaveBeenCalledWith('board')
      expect(emit).toHaveBeenCalledWith('apps:changed')

      emit.mockClear()
      invalidate.mockClear()
      await tools.call('app.disable', { id: 'board' }, ctx)
      expect(invalidate).toHaveBeenCalledWith('board')
      expect(emit).toHaveBeenCalledWith('apps:changed')
    })
  })

  describe('app.trust', () => {
    function vendored(): LoadedPackage {
      const dir = join(root, 'packages', 'vendored')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.mjs'), 'export const tools = {}')
      return makePackage('vendored', 'workspace', { backend: './index.mjs', dir })
    }

    it('records trust and emits apps:changed', async () => {
      const pkg = vendored()
      writeMimYaml('name: test-ws\napps:\n  vendored: true\n')
      register([pkg])

      await expect(tools.call('app.trust', { id: 'vendored' }, ctx))
        .resolves.toEqual({ ok: true, id: 'vendored' })

      expect(enablement.isTrusted(pkg)).toBe(true)
      expect(emit).toHaveBeenCalledWith('apps:changed')
      expect(invalidate).toHaveBeenCalledWith('vendored')

      writeFileSync(join(pkg.dir, 'index.mjs'), 'export const tools = { changed: true }')
      expect(enablement.isTrusted(pkg)).toBe(true)
    })

    it('refuses unknown package ids', async () => {
      register([])
      await expect(tools.call('app.trust', { id: 'ghost' }, ctx)).rejects.toThrow('Package not found: ghost')
    })
  })

  describe('app.remove', () => {
    it('removes the mim.yaml pin and clears any local override', async () => {
      writeMimYaml('name: test-ws\napps:\n  github-monitor:\n    source: https://x.example/r.git\n    version: 1.2.0\n')
      register([makePackage('github-monitor', 'global')])

      await expect(tools.call('app.remove', { id: 'github-monitor' }, ctx))
        .resolves.toEqual({ ok: true, id: 'github-monitor' })

      const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
      expect(config.apps?.['github-monitor']).toBeUndefined()
      expect(enablement.localOverride('github-monitor')).toBeNull()
    })

    it('drops the app out of the Installed set: app.status reports default layer, disabled', async () => {
      // A locally-enabled global package that the user then removes must leave
      // the manageable/Installed set entirely — not linger as a disabled row.
      register([makePackage('board', 'global')])
      enablement.setEnabled('board', true)
      expect(await statusOf('board')).toMatchObject({ enabled: true, layer: 'local' })

      await tools.call('app.remove', { id: 'board' }, ctx)

      // layer 'default' (not 'local') is what isManageableApp uses to exclude it.
      expect(await statusOf('board')).toMatchObject({ enabled: false, layer: 'default' })
    })

    it('is non-destructive: install dir and data folder survive', async () => {
      const installDir = join(root, 'fake-install', 'github-monitor')
      mkdirSync(installDir, { recursive: true })
      writeFileSync(join(installDir, 'manifest.json'), '{}')
      mkdirSync(join(root, 'issues'), { recursive: true })
      writeFileSync(join(root, 'issues', 'issue-1.md'), '# Issue 1\n')

      writeMimYaml('name: test-ws\napps:\n  github-monitor: true\n')
      register([makePackage('github-monitor', 'global', { dir: installDir })])

      await tools.call('app.remove', { id: 'github-monitor' }, ctx)

      expect(existsSync(join(installDir, 'manifest.json'))).toBe(true)
      expect(existsSync(join(root, 'issues', 'issue-1.md'))).toBe(true)
    })

    it('removes a loaded global package, clearing its local override', async () => {
      register([makePackage('board', 'global')])
      enablement.setEnabled('board', false)

      await expect(tools.call('app.remove', { id: 'board' }, ctx))
        .resolves.toEqual({ ok: true, id: 'board' })

      expect(enablement.localOverride('board')).toBeNull()
      expect(invalidate).toHaveBeenCalledWith('board')
      expect(emit).toHaveBeenCalledWith('apps:changed')
    })

    it('errors for an unknown id (not committed and not loaded)', async () => {
      register([])

      await expect(tools.call('app.remove', { id: 'ghost' }, ctx))
        .rejects.toThrow('Unknown package: ghost')
    })

    it('emits apps:changed and invalidates the runtime', async () => {
      writeMimYaml('name: test-ws\napps:\n  github-monitor: true\n')
      register([makePackage('github-monitor', 'global')])

      await tools.call('app.remove', { id: 'github-monitor' }, ctx)

      expect(invalidate).toHaveBeenCalledWith('github-monitor')
      expect(emit).toHaveBeenCalledWith('apps:changed')
    })

    it('works for committed-but-not-loaded packages', async () => {
      writeMimYaml('name: test-ws\napps:\n  github-monitor:\n    source: https://x.example/r.git\n    version: 1.2.0\n')
      register([])

      await expect(tools.call('app.remove', { id: 'github-monitor' }, ctx))
        .resolves.toEqual({ ok: true, id: 'github-monitor' })

      const config = parseMimYaml(readFileSync(join(root, 'mim.yaml'), 'utf-8'))
      expect(config.apps?.['github-monitor']).toBeUndefined()
    })
  })

  it('every app tool throws "No workspace open" when no workspace is set', async () => {
    const detached = createToolRegistry(createTraceLog())
    registerCoreAppTools(detached, {
      packages: makeLoader([]),
      enablement: createPackageEnablementStore({ getWorkspacePath: () => null }),
    })
    await expect(detached.call('app.status', {}, ctx)).rejects.toThrow('No workspace open')
    await expect(detached.call('app.enable', { id: 'board' }, ctx)).rejects.toThrow('No workspace open')
    await expect(detached.call('app.disable', { id: 'board' }, ctx)).rejects.toThrow('No workspace open')
    await expect(detached.call('app.trust', { id: 'board' }, ctx)).rejects.toThrow('No workspace open')
    await expect(detached.call('app.remove', { id: 'board' }, ctx)).rejects.toThrow('No workspace open')
  })
})
