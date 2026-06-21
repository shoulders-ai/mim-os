import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'
import type { PackagePermissions } from '@main/packages/packageManifest.js'
import type { LoadedPackage } from '@main/packages/packages.js'

describe('app enablement', () => {
  let workspace: string
  let pkgRoot: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'mim-enable-ws-'))
    pkgRoot = mkdtempSync(join(tmpdir(), 'mim-enable-pkg-'))
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(pkgRoot, { recursive: true, force: true })
  })

  function makeStore() {
    return createPackageEnablementStore({ getWorkspacePath: () => workspace })
  }

  function pkg(
    id: string,
    source: LoadedPackage['source'],
    opts: { backend?: string; permissions?: PackagePermissions; dir?: string } = {},
  ): Pick<LoadedPackage, 'manifest' | 'source' | 'dir'> {
    return {
      source,
      dir: opts.dir ?? join(pkgRoot, id),
      manifest: {
        manifestVersion: 1,
        id,
        name: id,
        version: '0.1.0',
        views: [],
        backend: opts.backend,
        permissions: opts.permissions ?? {},
      },
    }
  }

  function scaffoldPackageDir(id: string): string {
    const dir = join(pkgRoot, id)
    mkdirSync(join(dir, 'backend'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: id }))
    writeFileSync(join(dir, 'backend', 'index.mjs'), 'export const tools = {}')
    return dir
  }

  function writeMimYaml(apps: Record<string, unknown>): void {
    const lines = ['name: test', 'apps:']
    for (const [id, value] of Object.entries(apps)) lines.push(`  ${id}: ${String(value)}`)
    writeFileSync(join(workspace, 'mim.yaml'), lines.join('\n') + '\n')
  }

  describe('defaults (no committed entry, no local entry)', () => {
    it('does not implicitly enable any app source', () => {
      const store = makeStore()
      expect(store.isEnabled(pkg('global-pkg', 'global'))).toBe(false)
      expect(store.isEnabled(pkg('vendored', 'workspace'))).toBe(false)
    })
  })

  describe('local layer (enabled.json)', () => {
    it('local enable/disable controls otherwise disabled apps', () => {
      const store = makeStore()
      store.setEnabled('vendored', true)
      store.setEnabled('global-pkg', false)
      expect(store.isEnabled(pkg('vendored', 'workspace'))).toBe(true)
      expect(store.isEnabled(pkg('global-pkg', 'global'))).toBe(false)
    })

    it('persists sorted, deduped lists under .mim/packages/enabled.json', () => {
      const store = makeStore()
      store.setEnabled('zeta', true)
      store.setEnabled('alpha', true)
      store.setEnabled('mid', false)
      const raw = JSON.parse(readFileSync(join(workspace, '.mim', 'packages', 'enabled.json'), 'utf-8'))
      expect(raw.enabled).toEqual(['alpha', 'zeta'])
      expect(raw.disabled).toEqual(['mid'])
    })

    it('rejects invalid app ids', () => {
      const store = makeStore()
      expect(() => store.setEnabled('Not Valid!', true)).toThrow(/Invalid app id/)
    })

    it('reports a diagnostic for a corrupt enablement file', () => {
      mkdirSync(join(workspace, '.mim', 'packages'), { recursive: true })
      writeFileSync(join(workspace, '.mim', 'packages', 'enabled.json'), '{nope')
      const store = makeStore()
      expect(store.isEnabled(pkg('hello', 'global'))).toBe(false)
      expect(store.diagnostics().some(d => d.includes('Could not read app enablement file'))).toBe(true)
    })
  })

  describe('committed layer (mim.yaml)', () => {
    it('a committed entry is authoritative for benign workspace apps — false beats local enabled', () => {
      const store = makeStore()
      store.setEnabled('hello', true)
      writeMimYaml({ hello: false })
      expect(store.isEnabled(pkg('hello', 'workspace'))).toBe(false)
    })

    it('a committed entry is authoritative for benign workspace apps — true beats local disabled', () => {
      const store = makeStore()
      store.setEnabled('board', false)
      writeMimYaml({ board: true })
      expect(store.isEnabled(pkg('board', 'workspace'))).toBe(true)
    })

    it('a committed entry is authoritative for provenance-verified global apps', () => {
      const dir = join(pkgRoot, 'global-pkg')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, '.mim-install.json'), JSON.stringify({
        source: 'https://github.com/example-org/test.git',
        ref: 'v1.0.0',
        commit: 'a'.repeat(40),
        installedAt: 1718000000000,
      }))
      const store = makeStore()
      store.setEnabled('global-pkg', false)
      writeMimYaml({ 'global-pkg': true })
      expect(store.isEnabled(pkg('global-pkg', 'global', { dir }))).toBe(true)

      writeMimYaml({ 'global-pkg': false })
      store.setEnabled('global-pkg', true)
      expect(store.isEnabled(pkg('global-pkg', 'global', { dir }))).toBe(false)
    })

    it('reads mim.yaml fresh on every check', () => {
      const store = makeStore()
      const hello = pkg('hello', 'workspace')
      writeMimYaml({ hello: false })
      expect(store.isEnabled(hello)).toBe(false)
      writeMimYaml({ hello: true })
      expect(store.isEnabled(hello)).toBe(true)
    })

    it('committed entries activate workspace apps with no backend and no permissions', () => {
      const store = makeStore()
      writeMimYaml({ vendored: true })
      expect(store.isEnabled(pkg('vendored', 'workspace'))).toBe(true)
    })
  })

  describe('trust boundary (vendored workspace apps with backend/permissions)', () => {
    it('a committed flag alone never activates an untrusted vendored backend', () => {
      const dir = scaffoldPackageDir('vendored')
      const store = makeStore()
      writeMimYaml({ vendored: true })
      const p = pkg('vendored', 'workspace', { backend: './backend/index.mjs', dir })
      expect(store.isEnabled(p)).toBe(false)
      expect(store.needsTrust(p)).toBe(true)
    })

    it('non-empty permissions without a backend also require trust', () => {
      const dir = scaffoldPackageDir('fetcher')
      const store = makeStore()
      writeMimYaml({ fetcher: true })
      const p = pkg('fetcher', 'workspace', { permissions: { http: ['api.github.com'] }, dir })
      expect(store.isEnabled(p)).toBe(false)
      expect(store.needsTrust(p)).toBe(true)
    })

    it('empty permission shapes do not require trust', () => {
      const store = makeStore()
      writeMimYaml({ benign: true })
      const p = pkg('benign', 'workspace', {
        permissions: { workspace: { read: false, write: false }, http: [], secrets: [] },
      })
      expect(store.needsTrust(p)).toBe(false)
      expect(store.isEnabled(p)).toBe(true)
    })

    it('a personal local enable does NOT activate an untrusted vendored backend (trust boundary)', () => {
      const dir = scaffoldPackageDir('vendored')
      const store = makeStore()
      writeMimYaml({ vendored: true })
      store.setEnabled('vendored', true)
      expect(store.isEnabled(pkg('vendored', 'workspace', { backend: './backend/index.mjs', dir }))).toBe(false)
    })

    it('a personal local enable activates a vendored backend once trust is acked', () => {
      const dir = scaffoldPackageDir('vendored')
      const store = makeStore()
      store.setEnabled('vendored', true)
      const p = pkg('vendored', 'workspace', { backend: './backend/index.mjs', dir })
      expect(store.isEnabled(p)).toBe(false)

      store.ackTrust(p)
      expect(store.isEnabled(p)).toBe(true)
    })

    it('ackTrust activates the committed entry and clears needsTrust', () => {
      const dir = scaffoldPackageDir('vendored')
      const store = makeStore()
      writeMimYaml({ vendored: true })
      const p = pkg('vendored', 'workspace', { backend: './backend/index.mjs', dir })

      store.ackTrust(p)

      expect(store.isTrusted(p)).toBe(true)
      expect(store.needsTrust(p)).toBe(false)
      expect(store.isEnabled(p)).toBe(true)
    })

    it('an ack survives app tree changes', () => {
      const dir = scaffoldPackageDir('vendored')
      const store = makeStore()
      writeMimYaml({ vendored: true })
      const p = pkg('vendored', 'workspace', { backend: './backend/index.mjs', dir })
      store.ackTrust(p)
      expect(store.isEnabled(p)).toBe(true)

      writeFileSync(join(dir, 'backend', 'index.mjs'), 'export const tools = { evil: true }')

      expect(store.isTrusted(p)).toBe(true)
      expect(store.isEnabled(p)).toBe(true)
      const raw = JSON.parse(readFileSync(join(workspace, '.mim', 'packages', 'enabled.json'), 'utf-8'))
      expect(raw.trusted).toEqual(['vendored@*'])
    })

    it('needsTrust is true for an untrusted vendored app even without a committed entry', () => {
      // The trust prompt must surface for any workspace copy that the trust
      // gate would block — committed or not — or the enable toggle dead-ends
      // with no visible way to trust the app.
      const dir = scaffoldPackageDir('vendored')
      const store = makeStore()
      const p = pkg('vendored', 'workspace', { backend: './backend/index.mjs', dir })
      expect(store.needsTrust(p)).toBe(true)

      store.ackTrust(p)
      expect(store.needsTrust(p)).toBe(false)
    })

    it('needsTrust is false for non-workspace sources and for benign apps', () => {
      const dir = scaffoldPackageDir('vendored')
      const store = makeStore()
      writeMimYaml({ vendored: true })
      expect(store.needsTrust(pkg('vendored', 'global', { backend: './backend/index.mjs', dir }))).toBe(false)
    })

    it('persists the trust ledger in enabled.json alongside enable/disable, sorted and deduped', () => {
      const dir = scaffoldPackageDir('vendored')
      const store = makeStore()
      writeMimYaml({ vendored: true })
      const p = pkg('vendored', 'workspace', { backend: './backend/index.mjs', dir })
      store.ackTrust(p)
      store.ackTrust(p)
      store.setEnabled('other', true)

      const raw = JSON.parse(readFileSync(join(workspace, '.mim', 'packages', 'enabled.json'), 'utf-8'))
      expect(raw.trusted).toEqual(['vendored@*'])
      expect(raw.enabled).toEqual(['other'])

      expect(makeStore().isTrusted(p)).toBe(true)
    })
  })

  describe('localOverride', () => {
    it('reports the local enabled.json entry for an id, or null when absent', () => {
      const store = makeStore()
      expect(store.localOverride('hello')).toBeNull()

      store.setEnabled('hello', false)
      store.setEnabled('vendored', true)
      expect(store.localOverride('hello')).toBe(false)
      expect(store.localOverride('vendored')).toBe(true)
      expect(store.localOverride('absent')).toBeNull()

      expect(makeStore().localOverride('hello')).toBe(false)
    })

    it('is null for every id when no workspace is open', () => {
      const store = createPackageEnablementStore({ getWorkspacePath: () => null })
      expect(store.localOverride('hello')).toBeNull()
    })
  })

  describe('clearOverride', () => {
    it('drops an id from both the enabled and disabled lists', () => {
      const store = makeStore()
      store.setEnabled('hello', false)
      store.setEnabled('vendored', true)
      expect(store.localOverride('hello')).toBe(false)
      expect(store.localOverride('vendored')).toBe(true)

      store.clearOverride('hello')
      store.clearOverride('vendored')
      expect(store.localOverride('hello')).toBeNull()
      expect(store.localOverride('vendored')).toBeNull()

      // Persists: a fresh store reading from disk agrees.
      expect(makeStore().localOverride('hello')).toBeNull()
    })

    it('is a no-op when the id has no override (no needless write)', () => {
      const store = makeStore()
      store.clearOverride('absent')
      expect(store.localOverride('absent')).toBeNull()
    })

    it('rejects an invalid app id', () => {
      const store = makeStore()
      expect(() => store.clearOverride('Not Valid!')).toThrow(/Invalid app id/)
    })
  })

  describe('registry trust', () => {
    it('round-trips: ack then check returns trusted', () => {
      const store = makeStore()
      const source = { id: 'acme', location: 'https://github.com/acme/registry.git' }
      expect(store.isRegistryTrusted(source)).toBe(false)

      store.ackRegistryTrust(source)
      expect(store.isRegistryTrusted(source)).toBe(true)

      // New store instance reads from disk and agrees.
      expect(makeStore().isRegistryTrusted(source)).toBe(true)
    })

    it('re-prompts when the location changes (location-hashed)', () => {
      const store = makeStore()
      const source = { id: 'acme', location: 'https://github.com/acme/registry.git' }
      store.ackRegistryTrust(source)
      expect(store.isRegistryTrusted(source)).toBe(true)

      const changed = { id: 'acme', location: 'https://github.com/evil/registry.git' }
      expect(store.isRegistryTrusted(changed)).toBe(false)
    })

    it('tolerant of missing registries key in enablement file', () => {
      // Write a file without the registries key.
      mkdirSync(join(workspace, '.mim', 'packages'), { recursive: true })
      writeFileSync(
        join(workspace, '.mim', 'packages', 'enabled.json'),
        JSON.stringify({ enabled: [], disabled: [], trusted: [] }),
      )
      const store = makeStore()
      expect(store.isRegistryTrusted({ id: 'acme', location: 'https://example.com' })).toBe(false)
    })

    it('persists registry trust entries in enabled.json alongside other keys', () => {
      const store = makeStore()
      store.setEnabled('some-pkg', true)
      store.ackRegistryTrust({ id: 'acme', location: 'https://github.com/acme/reg.git' })

      const raw = JSON.parse(readFileSync(join(workspace, '.mim', 'packages', 'enabled.json'), 'utf-8'))
      expect(raw.registries).toHaveLength(1)
      expect(raw.registries[0]).toMatch(/^acme@[0-9a-f]{12}$/)
      expect(raw.enabled).toEqual(['some-pkg'])
    })

    it('ack replaces previous entry for the same id (no duplicates)', () => {
      const store = makeStore()
      store.ackRegistryTrust({ id: 'acme', location: 'https://v1.example.com' })
      store.ackRegistryTrust({ id: 'acme', location: 'https://v2.example.com' })

      const raw = JSON.parse(readFileSync(join(workspace, '.mim', 'packages', 'enabled.json'), 'utf-8'))
      expect(raw.registries).toHaveLength(1)
    })
  })

  describe('provenance-verified global packages', () => {
    function scaffoldGlobalPackage(id: string, version = '1.2.0'): string {
      const dir = join(pkgRoot, id, version)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: id }))
      return dir
    }

    function writeProvenance(dir: string, opts?: { source?: string; commit?: string }): void {
      const provenance = {
        source: opts?.source ?? 'https://github.com/shoulders-ai/mim-test.git',
        ref: 'v1.2.0',
        commit: opts?.commit ?? 'a'.repeat(40),
        installedAt: 1718000000000,
      }
      writeFileSync(join(dir, '.mim-install.json'), JSON.stringify(provenance))
    }

    it('committed entry is authoritative for a global package WITH valid provenance', () => {
      const dir = scaffoldGlobalPackage('global-prov')
      writeProvenance(dir)
      const store = makeStore()
      writeMimYaml({ 'global-prov': true })
      expect(store.isEnabled(pkg('global-prov', 'global', { dir }))).toBe(true)

      writeMimYaml({ 'global-prov': false })
      expect(store.isEnabled(pkg('global-prov', 'global', { dir }))).toBe(false)
    })

    it('committed entry falls through to local for a global package WITHOUT provenance', () => {
      const dir = scaffoldGlobalPackage('global-no-prov')
      const store = makeStore()
      writeMimYaml({ 'global-no-prov': true })
      expect(store.isEnabled(pkg('global-no-prov', 'global', { dir }))).toBe(false)

      store.setEnabled('global-no-prov', true)
      expect(store.isEnabled(pkg('global-no-prov', 'global', { dir }))).toBe(true)
    })

    it('committed entry with source/version checks provenance consistency', () => {
      const dir = scaffoldGlobalPackage('global-pin')
      writeProvenance(dir, { source: 'https://github.com/shoulders-ai/mim-test.git' })
      const store = makeStore()
      const yaml = [
        'name: test',
        'apps:',
        '  global-pin:',
        '    source: https://github.com/shoulders-ai/mim-test.git',
        '    version: "1.2.0"',
      ].join('\n') + '\n'
      writeFileSync(join(workspace, 'mim.yaml'), yaml)
      expect(store.isEnabled(pkg('global-pin', 'global', { dir }))).toBe(true)
    })

    it('committed entry with mismatched source falls through to local layer', () => {
      const dir = scaffoldGlobalPackage('global-mismatch')
      writeProvenance(dir, { source: 'https://github.com/other/repo.git' })
      const store = makeStore()
      const yaml = [
        'name: test',
        'apps:',
        '  global-mismatch:',
        '    source: https://github.com/shoulders-ai/mim-test.git',
        '    version: "1.2.0"',
      ].join('\n') + '\n'
      writeFileSync(join(workspace, 'mim.yaml'), yaml)
      expect(store.isEnabled(pkg('global-mismatch', 'global', { dir }))).toBe(false)
    })

    it('committed entry is authoritative for benign workspace packages regardless of provenance', () => {
      const store = makeStore()
      writeMimYaml({ hello: true })
      expect(store.isEnabled(pkg('hello', 'workspace'))).toBe(true)
    })

    it('provenance with malformed JSON is treated as absent', () => {
      const dir = scaffoldGlobalPackage('global-bad-prov')
      writeFileSync(join(dir, '.mim-install.json'), '{not valid json')
      const store = makeStore()
      writeMimYaml({ 'global-bad-prov': true })
      expect(store.isEnabled(pkg('global-bad-prov', 'global', { dir }))).toBe(false)
    })
  })

  it('treats every package as disabled and refuses writes when no workspace is open', () => {
    const store = createPackageEnablementStore({ getWorkspacePath: () => null })
    expect(store.isEnabled(pkg('hello', 'global'))).toBe(false)
    expect(store.isEnabled(pkg('vendored', 'workspace'))).toBe(false)
    expect(() => store.setEnabled('hello', true)).toThrow(/No workspace open/)
  })
})
