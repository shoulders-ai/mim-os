import { describe, it, expect } from 'vitest'
import { createAgentContextContributionsProvider } from '@main/packages/packageContributions.js'
import type { PackageRuntime, PackageCapabilities, PackageRuntimeContext } from '@main/packages/packageRuntime.js'
import type { LoadedPackage, PackageLoader } from '@main/packages/packages.js'

function fakePkg(id: string, name?: string): LoadedPackage {
  return {
    source: 'global',
    dir: `/tmp/${id}`,
    hasReadme: false,
    manifest: {
      manifestVersion: 1,
      id,
      name: name ?? id,
      version: '1.0.0',
      views: [],
      permissions: {},
    },
  }
}

function fakeRuntime(caps: PackageCapabilities[]): PackageRuntime {
  return {
    listCapabilities: async () => caps,
    createContext: ({ pkg }) => ({ package: { id: pkg.manifest.id, name: pkg.manifest.name, version: pkg.manifest.version, source: pkg.source } }) as unknown as PackageRuntimeContext,
    loadCapabilities: async () => caps[0],
    listChatTools: async () => [],
    getJob: async () => { throw new Error('not implemented') },
    executeTool: async () => { throw new Error('not implemented') },
    invalidate: () => {},
  }
}

function fakeLoader(pkgs: LoadedPackage[]): PackageLoader {
  return {
    list: () => pkgs,
    get: (id) => pkgs.find(p => p.manifest.id === id),
    diagnostics: () => [],
    onChange: () => {},
    rescan: async () => {},
  }
}

describe('createAgentContextContributionsProvider', () => {
  it('collects string results as sections', async () => {
    const pkg = fakePkg('test-app', 'Test App')
    const caps: PackageCapabilities[] = [{
      packageId: 'test-app',
      jobs: [],
      tools: [],
      skills: [],
      agentContext: async () => 'hello from test',
      diagnostics: [],
    }]
    const provider = createAgentContextContributionsProvider({
      runtime: fakeRuntime(caps),
      packages: fakeLoader([pkg]),
    })

    const sections = await provider('/ws')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({ appId: 'test-app', title: 'Test App', body: 'hello from test' })
  })

  it('collects object results with title and body', async () => {
    const pkg = fakePkg('obj-app', 'Obj App')
    const caps: PackageCapabilities[] = [{
      packageId: 'obj-app',
      jobs: [],
      tools: [],
      skills: [],
      agentContext: async () => ({ title: 'Custom Title', body: 'custom body' }),
      diagnostics: [],
    }]
    const provider = createAgentContextContributionsProvider({
      runtime: fakeRuntime(caps),
      packages: fakeLoader([pkg]),
    })

    const sections = await provider('/ws')
    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({ appId: 'obj-app', title: 'Custom Title', body: 'custom body' })
  })

  it('uses package name when object result has no title', async () => {
    const pkg = fakePkg('no-title', 'My App')
    const caps: PackageCapabilities[] = [{
      packageId: 'no-title',
      jobs: [],
      tools: [],
      skills: [],
      agentContext: async () => ({ body: 'just body' }),
      diagnostics: [],
    }]
    const provider = createAgentContextContributionsProvider({
      runtime: fakeRuntime(caps),
      packages: fakeLoader([pkg]),
    })

    const sections = await provider('/ws')
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toBe('My App')
  })

  it('skips object results without body', async () => {
    const pkg = fakePkg('no-body')
    const caps: PackageCapabilities[] = [{
      packageId: 'no-body',
      jobs: [],
      tools: [],
      skills: [],
      agentContext: async () => ({ title: 'T' }),
      diagnostics: [],
    }]
    const provider = createAgentContextContributionsProvider({
      runtime: fakeRuntime(caps),
      packages: fakeLoader([pkg]),
    })

    const sections = await provider('/ws')
    expect(sections).toHaveLength(0)
  })

  it('skips capabilities that throw', async () => {
    const good = fakePkg('good')
    const bad = fakePkg('bad')
    const caps: PackageCapabilities[] = [
      {
        packageId: 'bad',
        jobs: [],
        tools: [],
        skills: [],
        agentContext: async () => { throw new Error('boom') },
        diagnostics: [],
      },
      {
        packageId: 'good',
        jobs: [],
        tools: [],
        skills: [],
        agentContext: async () => 'works',
        diagnostics: [],
      },
    ]
    const provider = createAgentContextContributionsProvider({
      runtime: fakeRuntime(caps),
      packages: fakeLoader([good, bad]),
    })

    const sections = await provider('/ws')
    expect(sections).toHaveLength(1)
    expect(sections[0].appId).toBe('good')
  })

  it('skips capabilities with no agentContext', async () => {
    const pkg = fakePkg('no-ctx')
    const caps: PackageCapabilities[] = [{
      packageId: 'no-ctx',
      jobs: [],
      tools: [],
      skills: [],
      diagnostics: [],
    }]
    const provider = createAgentContextContributionsProvider({
      runtime: fakeRuntime(caps),
      packages: fakeLoader([pkg]),
    })

    const sections = await provider('/ws')
    expect(sections).toHaveLength(0)
  })

  it('skips when package is not found in loader', async () => {
    const caps: PackageCapabilities[] = [{
      packageId: 'missing',
      jobs: [],
      tools: [],
      skills: [],
      agentContext: async () => 'ghost',
      diagnostics: [],
    }]
    const provider = createAgentContextContributionsProvider({
      runtime: fakeRuntime(caps),
      packages: fakeLoader([]),
    })

    const sections = await provider('/ws')
    expect(sections).toHaveLength(0)
  })
})
