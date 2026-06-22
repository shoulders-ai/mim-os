import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createNamedPackageToolSync } from '@main/packages/namedPackageTools.js'
import type { PackageRuntime, PackageCapabilities, PackageToolDescriptor, PackageRuntimeContext } from '@main/packages/packageRuntime.js'
import type { ToolRegistry, ToolDef, ToolContext } from '@main/tools/registry.js'
import type { PackageLoader, LoadedPackage } from '@main/packages/packages.js'
import type { MimPackageManifest } from '@main/packages/packageManifest.js'

function fakeToolRegistry(): ToolRegistry & { registered: Map<string, ToolDef> } {
  const registered = new Map<string, ToolDef>()
  return {
    registered,
    register(tool) { registered.set(tool.name, tool) },
    unregister(name) { registered.delete(name) },
    get(name) { return registered.get(name) },
    list() { return Array.from(registered.values()) },
    async call(name, params, ctx) {
      const tool = registered.get(name)
      if (!tool) throw new Error(`Unknown tool: ${name}`)
      return tool.execute(params, ctx)
    },
    getWorkspacePath() { return '/tmp/test' },
    setWorkspacePath() {},
  }
}

function fakeManifest(id: string, name: string, grants: MimPackageManifest['provides']): MimPackageManifest {
  return {
    manifestVersion: 1,
    id,
    name,
    version: '1.0.0',
    views: [],
    permissions: {},
    provides: grants,
  }
}

function fakePackage(id: string, name: string, grants: MimPackageManifest['provides']): LoadedPackage {
  return {
    manifest: fakeManifest(id, name, grants),
    dir: `/tmp/packages/${id}`,
    source: 'workspace',
    hasReadme: false,
  }
}

function fakeTool(overrides: Partial<PackageToolDescriptor> & { id: string; publicName: string; packageId: string }): PackageToolDescriptor {
  return {
    named: false,
    label: overrides.id,
    description: `${overrides.id} description`,
    inputSchema: { type: 'object', properties: {} },
    audience: ['chat'],
    execute: vi.fn(async () => ({ ok: true })),
    ...overrides,
  }
}

describe('namedPackageTools', () => {
  let tools: ReturnType<typeof fakeToolRegistry>
  let executeTool: ReturnType<typeof vi.fn>

  function makeRuntime(caps: PackageCapabilities[]): PackageRuntime {
    executeTool = vi.fn(async (_name: string, input: Record<string, unknown>) => ({ echoed: input }))
    return {
      listCapabilities: vi.fn(async () => caps),
      loadCapabilities: vi.fn(),
      listChatTools: vi.fn(),
      getJob: vi.fn(),
      executeTool,
      createContext: vi.fn(),
      invalidate: vi.fn(),
    } as unknown as PackageRuntime
  }

  function makePackages(pkgs: LoadedPackage[]): PackageLoader {
    const map = new Map(pkgs.map(p => [p.manifest.id, p]))
    return {
      list: () => pkgs,
      get: (id: string) => map.get(id),
      diagnostics: () => [],
      onChange: () => {},
      rescan: async () => {},
    }
  }

  beforeEach(() => {
    tools = fakeToolRegistry()
  })

  it('registers a granted named tool and makes it callable through the registry', async () => {
    const pkg = fakePackage('board', 'Board', { tools: [{ pattern: 'issues.*', category: 'write', risk: 'medium' }] })
    const caps: PackageCapabilities[] = [{
      packageId: 'board',
      jobs: [],
      tools: [fakeTool({ id: 'list', publicName: 'issues.list', packageId: 'board', named: true })],
      skills: [],
      diagnostics: [],
    }]

    const sync = createNamedPackageToolSync({
      runtime: makeRuntime(caps),
      tools,
      packages: makePackages([pkg]),
    })

    await sync.sync()

    expect(tools.get('issues.list')).toBeDefined()
    const result = await tools.call('issues.list', { status: 'open' }, { actor: 'ai' })
    expect(executeTool).toHaveBeenCalledWith('issues.list', { status: 'open' }, { actor: 'ai' })
    expect(result).toEqual({ echoed: { status: 'open' } })
  })

  it('does not override a pre-registered core tool; emits collision diagnostic', async () => {
    // Pre-register a core tool
    tools.register({ name: 'issues.list', description: 'Core issues list', execute: async () => ({ core: true }) })

    const pkg = fakePackage('board', 'Board', { tools: [{ pattern: 'issues.*', category: 'read', risk: 'low' }] })
    const caps: PackageCapabilities[] = [{
      packageId: 'board',
      jobs: [],
      tools: [fakeTool({ id: 'list', publicName: 'issues.list', packageId: 'board', named: true })],
      skills: [],
      diagnostics: [],
    }]

    const sync = createNamedPackageToolSync({
      runtime: makeRuntime(caps),
      tools,
      packages: makePackages([pkg]),
    })

    await sync.sync()

    // Core tool is preserved
    const result = await tools.call('issues.list', {}, { actor: 'user' })
    expect(result).toEqual({ core: true })
    expect(sync.diagnostics().some(d => d.includes('collides with existing'))).toBe(true)
  })

  it('first-enabled-package wins when two packages claim the same name', async () => {
    const pkg1 = fakePackage('board-a', 'Board A', { tools: [{ pattern: 'issues.*', category: 'write', risk: 'medium' }] })
    const pkg2 = fakePackage('board-b', 'Board B', { tools: [{ pattern: 'issues.*', category: 'write', risk: 'medium' }] })
    const caps: PackageCapabilities[] = [
      {
        packageId: 'board-a',
        jobs: [],
        tools: [fakeTool({ id: 'list', publicName: 'issues.list', packageId: 'board-a', named: true, label: 'List A' })],
        skills: [],
        diagnostics: [],
      },
      {
        packageId: 'board-b',
        jobs: [],
        tools: [fakeTool({ id: 'list', publicName: 'issues.list', packageId: 'board-b', named: true, label: 'List B' })],
        skills: [],
        diagnostics: [],
      },
    ]

    const sync = createNamedPackageToolSync({
      runtime: makeRuntime(caps),
      tools,
      packages: makePackages([pkg1, pkg2]),
    })

    await sync.sync()

    expect(tools.get('issues.list')).toBeDefined()
    expect(sync.diagnostics().some(d => d.includes('board-b') && d.includes('collides'))).toBe(true)
  })

  it('unregisters names when a package is disabled, re-registers on re-enable', async () => {
    const pkg = fakePackage('board', 'Board', { tools: [{ pattern: 'issues.*', category: 'write', risk: 'medium' }] })
    const enabledCaps: PackageCapabilities[] = [{
      packageId: 'board',
      jobs: [],
      tools: [fakeTool({ id: 'list', publicName: 'issues.list', packageId: 'board', named: true })],
      skills: [],
      diagnostics: [],
    }]

    let currentCaps = enabledCaps
    const runtime = {
      listCapabilities: vi.fn(async () => currentCaps),
      executeTool: vi.fn(async () => ({ ok: true })),
    } as unknown as PackageRuntime

    const sync = createNamedPackageToolSync({
      runtime,
      tools,
      packages: makePackages([pkg]),
    })

    await sync.sync()
    expect(tools.get('issues.list')).toBeDefined()

    // Disable: empty capabilities
    currentCaps = []
    await sync.sync()
    expect(tools.get('issues.list')).toBeUndefined()

    // Re-enable
    currentCaps = enabledCaps
    await sync.sync()
    expect(tools.get('issues.list')).toBeDefined()
  })

  it('getPolicy returns correct category/risk from grant, with wildcard risk floor', async () => {
    const pkg = fakePackage('board', 'Board', {
      tools: [{ pattern: 'issues.*', category: 'write', risk: 'low' }],
    })
    const caps: PackageCapabilities[] = [{
      packageId: 'board',
      jobs: [],
      tools: [
        fakeTool({ id: 'list', publicName: 'issues.list', packageId: 'board', named: true, label: 'List issues' }),
        fakeTool({ id: 'delete', publicName: 'issues.delete', packageId: 'board', named: true, label: 'Delete issue' }),
      ],
      skills: [],
      diagnostics: [],
    }]

    const sync = createNamedPackageToolSync({
      runtime: makeRuntime(caps),
      tools,
      packages: makePackages([pkg]),
    })

    await sync.sync()

    const listPolicy = sync.getPolicy('issues.list')
    expect(listPolicy).toMatchObject({ category: 'write', risk: 'low', ownerPackageId: 'board' })
    expect(listPolicy?.label).toBe('Board: List issues')

    // Wildcard grant declared 'low' but issues.delete gets floor 'high'
    const deletePolicy = sync.getPolicy('issues.delete')
    expect(deletePolicy).toMatchObject({ category: 'write', risk: 'high', ownerPackageId: 'board' })
    expect(deletePolicy?.label).toBe('Board: Delete issue')
  })

  it('ownedNames returns the currently registered named tool names', async () => {
    const pkg = fakePackage('board', 'Board', { tools: [{ pattern: 'issues.*', category: 'write', risk: 'medium' }] })
    const enabledCaps: PackageCapabilities[] = [{
      packageId: 'board',
      jobs: [],
      tools: [
        fakeTool({ id: 'list', publicName: 'issues.list', packageId: 'board', named: true }),
        fakeTool({ id: 'create', publicName: 'issues.create', packageId: 'board', named: true }),
      ],
      skills: [],
      diagnostics: [],
    }]

    let currentCaps = enabledCaps
    const runtime = {
      listCapabilities: vi.fn(async () => currentCaps),
      executeTool: vi.fn(async () => ({ ok: true })),
    } as unknown as PackageRuntime

    const sync = createNamedPackageToolSync({
      runtime,
      tools,
      packages: makePackages([pkg]),
    })

    expect(sync.ownedNames()).toEqual([])

    await sync.sync()
    const names = sync.ownedNames()
    expect(names).toContain('issues.list')
    expect(names).toContain('issues.create')
    expect(names).toHaveLength(2)

    currentCaps = []
    await sync.sync()
    expect(sync.ownedNames()).toEqual([])
  })

  it('sync is idempotent — no collision diagnostics for own names', async () => {
    const pkg = fakePackage('board', 'Board', { tools: [{ pattern: 'issues.*', category: 'write', risk: 'medium' }] })
    const caps: PackageCapabilities[] = [{
      packageId: 'board',
      jobs: [],
      tools: [fakeTool({ id: 'list', publicName: 'issues.list', packageId: 'board', named: true })],
      skills: [],
      diagnostics: [],
    }]

    const sync = createNamedPackageToolSync({
      runtime: makeRuntime(caps),
      tools,
      packages: makePackages([pkg]),
    })

    await sync.sync()
    await sync.sync()

    expect(sync.diagnostics()).toEqual([])
    expect(tools.get('issues.list')).toBeDefined()
  })
})
