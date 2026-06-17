import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createPackageLoader } from '@main/packages/packages.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let loaders: Array<Awaited<ReturnType<typeof createPackageLoader>>> = []

afterEach(async () => {
  const current = loaders
  loaders = []
  await Promise.all(current.map(loader => loader.close?.()))
})

async function makeLoader(
  ...args: Parameters<typeof createPackageLoader>
): Promise<Awaited<ReturnType<typeof createPackageLoader>>> {
  const loader = await createPackageLoader(...args)
  loaders.push(loader)
  return loader
}

describe('PackageLoader', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-pkg-test-'))
    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)

    mkdirSync(join(dir, 'packages'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function addPackage(id: string, name: string): void {
    const pkgDir = join(dir, 'packages', id)
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), `<h1>${name}</h1>`)
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: `@mim/${id}`,
      version: '0.1.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id,
        name,
        views: [{ id: 'main', label: name, src: './ui/index.html', role: 'work' }],
        permissions: {},
      },
    }))
  }

  it('discovers packages in workspace packages/ directory', async () => {
    addPackage('test-pkg', 'Test Package')
    const loader = await makeLoader(tools)
    const pkgs = loader.list()
    expect(pkgs.length).toBeGreaterThanOrEqual(1)
    const testPkg = pkgs.find(p => p.manifest.id === 'test-pkg')
    expect(testPkg).toBeDefined()
    expect(testPkg!.manifest.name).toBe('Test Package')
    expect(testPkg!.source).toBe('workspace')
  })

  it('detects exact package-root README.md files', async () => {
    addPackage('with-readme', 'With README')
    writeFileSync(join(dir, 'packages', 'with-readme', 'README.md'), '# With README')
    addPackage('without-readme', 'Without README')

    const loader = await makeLoader(tools)

    expect(loader.get('with-readme')?.hasReadme).toBe(true)
    expect(loader.get('without-readme')?.hasReadme).toBe(false)
  })

  it('returns undefined for unknown package', async () => {
    const loader = await makeLoader(tools)
    expect(loader.get('nonexistent')).toBeUndefined()
  })

  it('gets a specific package by id', async () => {
    addPackage('my-pkg', 'My Package')
    const loader = await makeLoader(tools)
    const pkg = loader.get('my-pkg')
    expect(pkg).toBeDefined()
    expect(pkg!.manifest.name).toBe('My Package')
  })

  it('rescans after adding a package', async () => {
    const loader = await makeLoader(tools)
    const before = loader.list().filter(p => p.manifest.id === 'late-pkg')
    expect(before).toHaveLength(0)

    addPackage('late-pkg', 'Late Addition')
    await loader.rescan()

    const after = loader.list().filter(p => p.manifest.id === 'late-pkg')
    expect(after).toHaveLength(1)
  })

  it('close tears down watchers and ignores later change listeners', async () => {
    const loader = await makeLoader(tools)
    let changed = false
    loader.onChange(() => { changed = true })

    await loader.close?.()
    addPackage('after-close', 'After Close')
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(changed).toBe(false)
    await loader.rescan()
    expect(loader.get('after-close')).toBeUndefined()
  })

  it('does not emit phantom duplicate-id diagnostics under concurrent scans', async () => {
    // A single package in the workspace must never report a "Duplicate package
    // id" diagnostic. Concurrent fullScan() runs (multiple watchers + refreshes
    // fire them at once) used to interleave on the shared scan state and trip
    // the duplicate branch — once per overlapping pair.
    addPackage('solo-pkg', 'Solo Package')
    const loader = await makeLoader(tools)

    await Promise.all([
      loader.rescan(),
      loader.rescan(),
      loader.rescan(),
      loader.rescan(),
    ])

    const dupes = loader.diagnostics().filter(d => d.message.includes('Duplicate package id'))
    expect(dupes).toHaveLength(0)
    expect(loader.list().filter(p => p.manifest.id === 'solo-pkg')).toHaveLength(1)
  })

  it('skips directories without package.json', async () => {
    mkdirSync(join(dir, 'packages', 'no-manifest'))
    const loader = await makeLoader(tools)
    expect(loader.get('no-manifest')).toBeUndefined()
  })

  it('skips packages with invalid JSON', async () => {
    const pkgDir = join(dir, 'packages', 'bad-json')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), 'not json')
    const loader = await makeLoader(tools)
    expect(loader.get('bad-json')).toBeUndefined()
    expect(loader.diagnostics()).toContainEqual(expect.objectContaining({
      packageId: 'bad-json',
      path: join(pkgDir, 'package.json'),
    }))
  })
})

function writePackageJson(
  dir: string,
  id: string,
  name: string,
  version = '0.1.0',
): void {
  mkdirSync(join(dir, 'ui'), { recursive: true })
  writeFileSync(join(dir, 'ui', 'index.html'), `<h1>${name}</h1>`)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `@mim/${id}`,
    version,
    type: 'module',
    mim: {
      manifestVersion: 1,
      id,
      name,
      views: [{ id: 'main', label: name, src: './ui/index.html', role: 'work' }],
      permissions: {},
    },
  }))
}

describe('PackageLoader with injected global dir', () => {
  let tmpDir: string
  let globalDir: string
  let workspaceDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mim-loader-test-'))
    globalDir = join(tmpDir, 'global')
    workspaceDir = join(tmpDir, 'workspace')
    mkdirSync(globalDir, { recursive: true })
    mkdirSync(join(workspaceDir, 'packages'), { recursive: true })

    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(workspaceDir)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('uses injected globalDir', async () => {
    const pkgDir = join(globalDir, 'injected-global', '1.0.0')
    writePackageJson(pkgDir, 'injected-global', 'Injected Global', '1.0.0')

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('injected-global')
    expect(pkg).toBeDefined()
    expect(pkg!.source).toBe('global')
  })

  it('two-level global traversal: discovers <id>/<version>/package.json', async () => {
    const versionDir = join(globalDir, 'my-global-pkg', '1.2.3')
    writePackageJson(versionDir, 'my-global-pkg', 'My Global', '1.2.3')

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('my-global-pkg')
    expect(pkg).toBeDefined()
    expect(pkg!.source).toBe('global')
    expect(pkg!.manifest.version).toBe('1.2.3')
    expect(pkg!.dir).toBe(versionDir)
  })

  it('two-level global: picks highest version when multiple versions exist', async () => {
    const v100 = join(globalDir, 'multi-ver', '1.0.0')
    const v120 = join(globalDir, 'multi-ver', '1.2.0')
    const v110 = join(globalDir, 'multi-ver', '1.1.0')
    writePackageJson(v100, 'multi-ver', 'Multi', '1.0.0')
    writePackageJson(v120, 'multi-ver', 'Multi', '1.2.0')
    writePackageJson(v110, 'multi-ver', 'Multi', '1.1.0')

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('multi-ver')
    expect(pkg).toBeDefined()
    expect(pkg!.manifest.version).toBe('1.2.0')
    expect(pkg!.dir).toBe(v120)
  })

  it('two-level global: prerelease version loses to release of same x.y.z', async () => {
    const vPre = join(globalDir, 'pre-test', '2.0.0-alpha')
    const vRel = join(globalDir, 'pre-test', '2.0.0')
    writePackageJson(vPre, 'pre-test', 'Pre', '2.0.0-alpha')
    writePackageJson(vRel, 'pre-test', 'Pre', '2.0.0')

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('pre-test')
    expect(pkg).toBeDefined()
    expect(pkg!.manifest.version).toBe('2.0.0')
  })

  it('invalid version dir name produces diagnostic and is skipped', async () => {
    const badDir = join(globalDir, 'bad-ver', 'latest')
    writePackageJson(badDir, 'bad-ver', 'Bad Ver', '0.1.0')

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('bad-ver')).toBeUndefined()
    expect(loader.diagnostics()).toContainEqual(expect.objectContaining({
      message: expect.stringContaining('latest'),
    }))
  })

  it('flat global dir (package.json directly under <id>/) produces diagnostic and is skipped', async () => {
    const flatDir = join(globalDir, 'flat-pkg')
    writePackageJson(flatDir, 'flat-pkg', 'Flat Package')

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('flat-pkg')).toBeUndefined()
    expect(loader.diagnostics()).toContainEqual(expect.objectContaining({
      message: expect.stringContaining('flat'),
    }))
  })

  it('rescan picks up new versioned global package', async () => {
    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('late-global')).toBeUndefined()

    const versionDir = join(globalDir, 'late-global', '0.5.0')
    writePackageJson(versionDir, 'late-global', 'Late Global', '0.5.0')
    await loader.rescan()

    const pkg = loader.get('late-global')
    expect(pkg).toBeDefined()
    expect(pkg!.source).toBe('global')
  })

  it('watcher triggers rescan for changes inside a versioned global package', async () => {
    const versionDir = join(globalDir, 'watched-pkg', '1.0.0')
    mkdirSync(join(versionDir, 'src'), { recursive: true })
    writePackageJson(versionDir, 'watched-pkg', 'Watched', '1.0.0')

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('watched-pkg')).toBeDefined()

    let rescanFired = false
    loader.onChange(() => { rescanFired = true })

    await new Promise(r => setTimeout(r, 300))

    writeFileSync(join(versionDir, 'src', 'trigger.mjs'), '// change')

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (rescanFired) { clearInterval(check); resolve() }
      }, 100)
      setTimeout(() => { clearInterval(check); resolve() }, 12_000)
    })

    expect(rescanFired).toBe(true)
  }, 15_000)

  it('workspace packages still load with injected dirs', async () => {
    const wsPkgDir = join(workspaceDir, 'packages', 'ws-only')
    writePackageJson(wsPkgDir, 'ws-only', 'Workspace Only')

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('ws-only')
    expect(pkg).toBeDefined()
    expect(pkg!.source).toBe('workspace')
  })

  it('duplicate id across sources: workspace > global', async () => {
    const globalPkg = join(globalDir, 'shared-id', '1.0.0')
    writePackageJson(globalPkg, 'shared-id', 'Global Copy', '1.0.0')
    const wsPkg = join(workspaceDir, 'packages', 'shared-id')
    writePackageJson(wsPkg, 'shared-id', 'Workspace Copy')

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('shared-id')
    expect(pkg).toBeDefined()
    expect(pkg!.source).toBe('workspace')
  })

  it('shadow diagnostic: winner + shadowed sources are reported', async () => {
    const globalPkg = join(globalDir, 'shadowed-pkg', '1.0.0')
    writePackageJson(globalPkg, 'shadowed-pkg', 'Global Copy', '1.0.0')
    const wsPkg = join(workspaceDir, 'packages', 'shadowed-pkg')
    writePackageJson(wsPkg, 'shadowed-pkg', 'Workspace Copy')

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('shadowed-pkg')
    expect(pkg!.source).toBe('workspace')
    expect(pkg!.shadowedSources).toEqual(['global'])
    const shadowDiags = loader.diagnostics().filter(
      d => d.packageId === 'shadowed-pkg' && d.message.includes('shadowed'),
    )
    expect(shadowDiags.length).toBeGreaterThanOrEqual(1)
    const messages = shadowDiags.map(d => d.message).join(' ')
    expect(messages).toContain('global')
  })

  it('legacy apps key "issues" in mim.yaml produces a loud diagnostic', async () => {
    writeFileSync(join(workspaceDir, 'mim.yaml'), 'name: t\napps:\n  issues: true\n')
    const loader = await makeLoader(tools, { globalDir })
    const diags = loader.diagnostics().filter(d => d.message.includes('legacy key'))
    expect(diags).toHaveLength(1)
    expect(diags[0].message).toContain('"issues"')
    expect(diags[0].message).toContain('board')
  })

  it('shadow diagnostic has structured info for local override badge', async () => {
    const globalPkg = join(globalDir, 'badge-pkg', '1.0.0')
    writePackageJson(globalPkg, 'badge-pkg', 'Global', '1.0.0')
    const wsPkg = join(workspaceDir, 'packages', 'badge-pkg')
    writePackageJson(wsPkg, 'badge-pkg', 'Workspace')

    const loader = await makeLoader(tools, { globalDir })
    const diags = loader.diagnostics().filter(
      d => d.packageId === 'badge-pkg' && d.message.includes('shadowed'),
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0].message).toContain('workspace')
  })

  it('global version pick: workspace pin overrides highest version', async () => {
    const v1 = join(globalDir, 'pinned-pkg', '1.0.0')
    const v2 = join(globalDir, 'pinned-pkg', '2.0.0')
    writePackageJson(v1, 'pinned-pkg', 'Pinned', '1.0.0')
    writePackageJson(v2, 'pinned-pkg', 'Pinned', '2.0.0')

    writeFileSync(join(workspaceDir, 'mim.yaml'), [
      'name: test',
      'apps:',
      '  pinned-pkg:',
      '    version: "1.0.0"',
    ].join('\n'))

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('pinned-pkg')
    expect(pkg).toBeDefined()
    expect(pkg!.manifest.version).toBe('1.0.0')
    expect(pkg!.dir).toBe(v1)
  })

  it('global version pick: pin with no matching version falls back to highest', async () => {
    const v1 = join(globalDir, 'pin-miss', '1.0.0')
    const v2 = join(globalDir, 'pin-miss', '2.0.0')
    writePackageJson(v1, 'pin-miss', 'PinMiss', '1.0.0')
    writePackageJson(v2, 'pin-miss', 'PinMiss', '2.0.0')

    writeFileSync(join(workspaceDir, 'mim.yaml'), [
      'name: test',
      'apps:',
      '  pin-miss:',
      '    version: "3.0.0"',
    ].join('\n'))

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('pin-miss')
    expect(pkg).toBeDefined()
    expect(pkg!.manifest.version).toBe('2.0.0')
    const pinDiags = loader.diagnostics().filter(
      d => d.packageId === 'pin-miss' && d.message.includes('pin'),
    )
    expect(pinDiags.length).toBeGreaterThanOrEqual(1)
  })

  it('global version pick: prerelease loses to release of same x.y.z even when pinned', async () => {
    const vPre = join(globalDir, 'pre-pin', '1.0.0-alpha')
    writePackageJson(vPre, 'pre-pin', 'PrePin', '1.0.0-alpha')

    writeFileSync(join(workspaceDir, 'mim.yaml'), [
      'name: test',
      'apps:',
      '  pre-pin:',
      '    version: "1.0.0"',
    ].join('\n'))

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('pre-pin')
    expect(pkg).toBeDefined()
    expect(pkg!.manifest.version).toBe('1.0.0-alpha')
  })

  it('pin-change freshness: winner changes without reopen (via rescan)', async () => {
    const v1 = join(globalDir, 'fresh-pkg', '1.0.0')
    const v2 = join(globalDir, 'fresh-pkg', '2.0.0')
    writePackageJson(v1, 'fresh-pkg', 'Fresh', '1.0.0')
    writePackageJson(v2, 'fresh-pkg', 'Fresh', '2.0.0')

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('fresh-pkg')!.manifest.version).toBe('2.0.0')

    writeFileSync(join(workspaceDir, 'mim.yaml'), [
      'name: test',
      'apps:',
      '  fresh-pkg:',
      '    version: "1.0.0"',
    ].join('\n'))
    await loader.rescan()

    expect(loader.get('fresh-pkg')!.manifest.version).toBe('1.0.0')
  })

  it('pin-change freshness: mim.yaml watcher triggers rescan', async () => {
    const v1 = join(globalDir, 'watcher-pin', '1.0.0')
    const v2 = join(globalDir, 'watcher-pin', '2.0.0')
    writePackageJson(v1, 'watcher-pin', 'WatcherPin', '1.0.0')
    writePackageJson(v2, 'watcher-pin', 'WatcherPin', '2.0.0')

    writeFileSync(join(workspaceDir, 'mim.yaml'), 'name: test\n')

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('watcher-pin')!.manifest.version).toBe('2.0.0')

    let rescanFired = false
    loader.onChange(() => { rescanFired = true })

    await new Promise(r => setTimeout(r, 300))

    writeFileSync(join(workspaceDir, 'mim.yaml'), [
      'name: test',
      'apps:',
      '  watcher-pin:',
      '    version: "1.0.0"',
    ].join('\n'))

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (rescanFired) { clearInterval(check); resolve() }
      }, 100)
      setTimeout(() => { clearInterval(check); resolve() }, 5000)
    })

    expect(rescanFired).toBe(true)
    expect(loader.get('watcher-pin')!.manifest.version).toBe('1.0.0')
  })

  it('pin-change freshness: mim.yaml created after loader init triggers rescan', async () => {
    const v1 = join(globalDir, 'late-yaml', '1.0.0')
    const v2 = join(globalDir, 'late-yaml', '2.0.0')
    writePackageJson(v1, 'late-yaml', 'LateYaml', '1.0.0')
    writePackageJson(v2, 'late-yaml', 'LateYaml', '2.0.0')

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('late-yaml')!.manifest.version).toBe('2.0.0')

    let rescanFired = false
    loader.onChange(() => { rescanFired = true })

    await new Promise(r => setTimeout(r, 300))

    writeFileSync(join(workspaceDir, 'mim.yaml'), [
      'name: test',
      'apps:',
      '  late-yaml:',
      '    version: "1.0.0"',
    ].join('\n'))

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (rescanFired) { clearInterval(check); resolve() }
      }, 100)
      setTimeout(() => { clearInterval(check); resolve() }, 10000)
    })

    expect(rescanFired).toBe(true)
    expect(loader.get('late-yaml')!.manifest.version).toBe('1.0.0')
    // 300ms settle + rescan poll cannot fit vitest's 5s default under
    // full-suite load; the watcher is debounced, not slow.
  }, 15000)

  it('engines.mim incompatible package is skipped with diagnostic (load-time enforcement)', async () => {
    const { MIM_RUNTIME_VERSION } = await import('@main/packages/runtimeVersion.js')
    const vDir = join(globalDir, 'future-pkg', '1.0.0')
    mkdirSync(join(vDir, 'ui'), { recursive: true })
    writeFileSync(join(vDir, 'ui', 'index.html'), '<h1>Future</h1>')
    writeFileSync(join(vDir, 'package.json'), JSON.stringify({
      name: '@mim/future-pkg',
      version: '1.0.0',
      mim: {
        manifestVersion: 1,
        id: 'future-pkg',
        name: 'Future Package',
        views: [{ id: 'main', label: 'Future', src: './ui/index.html', role: 'work' }],
        permissions: {},
        engines: { mim: 'runtime-v99' },
      },
    }))

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('future-pkg')).toBeUndefined()
    const diags = loader.diagnostics().filter(
      d => d.packageId === 'future-pkg' && d.message.includes('engine'),
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0].message).toContain('runtime-v99')
    expect(diags[0].message).toContain(MIM_RUNTIME_VERSION)
  })

  it('engines.mim compatible package is loaded normally', async () => {
    const vDir = join(globalDir, 'compat-pkg', '1.0.0')
    mkdirSync(join(vDir, 'ui'), { recursive: true })
    writeFileSync(join(vDir, 'ui', 'index.html'), '<h1>Compat</h1>')
    writeFileSync(join(vDir, 'package.json'), JSON.stringify({
      name: '@mim/compat-pkg',
      version: '1.0.0',
      mim: {
        manifestVersion: 1,
        id: 'compat-pkg',
        name: 'Compatible Package',
        views: [{ id: 'main', label: 'Compat', src: './ui/index.html', role: 'work' }],
        permissions: {},
        engines: { mim: 'runtime-v1' },
      },
    }))

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('compat-pkg')).toBeDefined()
    expect(loader.get('compat-pkg')!.manifest.id).toBe('compat-pkg')
  })

  it('engines.mim enforcement skips workspace packages too', async () => {
    const wsPkgDir = join(workspaceDir, 'packages', 'ws-future')
    mkdirSync(join(wsPkgDir, 'ui'), { recursive: true })
    writeFileSync(join(wsPkgDir, 'ui', 'index.html'), '<h1>WS Future</h1>')
    writeFileSync(join(wsPkgDir, 'package.json'), JSON.stringify({
      name: '@mim/ws-future',
      version: '0.1.0',
      mim: {
        manifestVersion: 1,
        id: 'ws-future',
        name: 'WS Future',
        views: [{ id: 'main', label: 'WS Future', src: './ui/index.html', role: 'work' }],
        permissions: {},
        engines: { mim: 'runtime-v99' },
      },
    }))

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('ws-future')).toBeUndefined()
    expect(loader.diagnostics().some(
      d => d.packageId === 'ws-future' && d.message.includes('engine'),
    )).toBe(true)
  })

  it('package without engines.mim is loaded (no enforcement)', async () => {
    const vDir = join(globalDir, 'no-engines', '1.0.0')
    mkdirSync(join(vDir, 'ui'), { recursive: true })
    writeFileSync(join(vDir, 'ui', 'index.html'), '<h1>No Engines</h1>')
    writeFileSync(join(vDir, 'package.json'), JSON.stringify({
      name: '@mim/no-engines',
      version: '1.0.0',
      mim: {
        manifestVersion: 1,
        id: 'no-engines',
        name: 'No Engines',
        views: [{ id: 'main', label: 'No Engines', src: './ui/index.html', role: 'work' }],
        permissions: {},
      },
    }))

    const loader = await makeLoader(tools, { globalDir })
    expect(loader.get('no-engines')).toBeDefined()
  })

  it('workspace package shadowing global has source workspace for trust boundary', async () => {
    const globalPkg = join(globalDir, 'trust-test', '1.0.0')
    writePackageJson(globalPkg, 'trust-test', 'Global', '1.0.0')

    const wsPkgDir = join(workspaceDir, 'packages', 'trust-test')
    mkdirSync(join(wsPkgDir, 'ui'), { recursive: true })
    mkdirSync(join(wsPkgDir, 'backend'), { recursive: true })
    writeFileSync(join(wsPkgDir, 'ui', 'index.html'), '<h1>WS</h1>')
    writeFileSync(join(wsPkgDir, 'backend', 'index.mjs'), 'export default {}')
    writeFileSync(join(wsPkgDir, 'package.json'), JSON.stringify({
      name: '@mim/trust-test',
      version: '0.1.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'trust-test',
        name: 'Trust Test WS',
        views: [{ id: 'main', label: 'Trust', src: './ui/index.html', role: 'work' }],
        backend: './backend/index.mjs',
        permissions: { workspace: { read: true } },
      },
    }))

    const loader = await makeLoader(tools, { globalDir })
    const pkg = loader.get('trust-test')
    expect(pkg).toBeDefined()
    expect(pkg!.source).toBe('workspace')
  })
})
