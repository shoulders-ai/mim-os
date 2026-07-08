import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHeadlessKernel } from '@main/headless.js'
import { PermissionDeniedError } from '@main/security/gate.js'
import type { AppStatus } from '@main/tools/coreApps.js'
import { MCP_TOOL_SPECS } from '@main/server/server.js'
import { writeSharedWorkspaceToken } from '@main/workspace/sharedWorkspaceTokens.js'

describe('createHeadlessKernel', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-headless-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers the expected tool surface', () => {
    const kernel = createHeadlessKernel()
    const names = new Set(kernel.tools.list().map(t => t.name))

    for (const expected of [
      'fs.read', 'fs.write', 'fs.list',
      'workspace.open', 'workspace.info', 'workspace.init',
      'settings.get', 'settings.set',
      'session.create', 'session.list',
      'routine.create', 'routine.list', 'routine.get', 'routine.run', 'routine.pause', 'routine.resume',
      'search', 'search.files', 'search.sessions',
      'trace.query', 'trace.stats',
      'telemetry.track', 'telemetry.status', 'telemetry.setEnabled',
      'skill.list',
      'log.append', 'log.read',
      'web.read', 'web.search',
      'web.browser.status', 'web.browser.allowDomain',
      'ai.registry',
      'documents.docx.read',
      'slack.status',
      'google.status',
      'app.status',
    ]) {
      expect(names.has(expected), `missing tool: ${expected}`).toBe(true)
    }
  })

  it('every static MCP tool that is registered has an inputSchema', () => {
    const kernel = createHeadlessKernel()
    const missing: string[] = []
    for (const spec of MCP_TOOL_SPECS) {
      const tool = kernel.tools.get(spec.mimName)
      if (!tool) continue
      if (!tool.inputSchema) missing.push(spec.mimName)
    }
    expect(missing, `MCP tools missing inputSchema: ${missing.join(', ')}`).toEqual([])
  })

  it('openWorkspace opens a tmp dir and scaffolds .mim/workspace.json', async () => {
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(dir)

    expect(kernel.tools.getWorkspacePath()).toBe(dir)
    expect(existsSync(join(dir, '.mim', 'workspace.json'))).toBe(true)
    const config = JSON.parse(readFileSync(join(dir, '.mim', 'workspace.json'), 'utf-8'))
    expect(config.name).toBe(dir.split('/').pop())
  })

  it('does not create telemetry identity while disabled under tests', async () => {
    const oldHome = process.env.HOME
    process.env.HOME = dir
    try {
      const kernel = createHeadlessKernel()
      expect(existsSync(join(dir, '.mim', 'telemetry.json'))).toBe(false)
      await kernel.shutdown()
    } finally {
      process.env.HOME = oldHome
    }
  })

  it('openWorkspace rejects a path that does not exist', async () => {
    const kernel = createHeadlessKernel()
    await expect(kernel.openWorkspace(join(dir, 'nope'))).rejects.toThrow('Path does not exist')
  })

  it('read-only AI calls work under the default deny policy', async () => {
    const kernel = createHeadlessKernel() // approvals defaults to 'deny'
    await kernel.openWorkspace(dir)
    writeFileSync(join(dir, 'readme.md'), 'hello headless')

    const result = await kernel.tools.call('fs.read', { path: 'readme.md' }, { actor: 'ai' }) as {
      content: string
    }
    expect(result.content).toBe('hello headless')
  })

  it("approvals 'deny' blocks an approval-required mutating AI call", async () => {
    const kernel = createHeadlessKernel({ approvals: 'deny' })
    await kernel.openWorkspace(dir)

    await expect(
      kernel.tools.call('fs.write', { path: 'blocked.md', content: 'nope' }, { actor: 'ai' }),
    ).rejects.toThrow(PermissionDeniedError)
    expect(existsSync(join(dir, 'blocked.md'))).toBe(false)
  })

  it("approvals 'allow' permits the same mutating AI call", async () => {
    const kernel = createHeadlessKernel({ approvals: 'allow' })
    await kernel.openWorkspace(dir)

    await kernel.tools.call('fs.write', { path: 'allowed.md', content: 'yes' }, { actor: 'ai' })
    expect(readFileSync(join(dir, 'allowed.md'), 'utf-8')).toBe('yes')
  })

  it("approvals 'prompt' defers to confirmApproval", async () => {
    const seen: string[] = []
    const kernel = createHeadlessKernel({
      approvals: 'prompt',
      confirmApproval: async (request) => {
        seen.push(request.toolName)
        return request.params.path === 'ok.md'
      },
    })
    await kernel.openWorkspace(dir)

    await kernel.tools.call('fs.write', { path: 'ok.md', content: 'approved' }, { actor: 'ai' })
    expect(readFileSync(join(dir, 'ok.md'), 'utf-8')).toBe('approved')

    await expect(
      kernel.tools.call('fs.write', { path: 'rejected.md', content: 'denied' }, { actor: 'ai' }),
    ).rejects.toThrow('Permission denied: fs.write')
    expect(existsSync(join(dir, 'rejected.md'))).toBe(false)

    expect(seen).toEqual(['fs.write', 'fs.write'])
  })

  it("approvals 'allow' grants website access domains before a stateful web read executes", async () => {
    const kernel = createHeadlessKernel({ approvals: 'allow' })
    await kernel.openWorkspace(dir)

    await expect(
      kernel.tools.call('web.read', {
        url: 'https://private.example/report',
        stateful: true,
      }, { actor: 'ai', sessionId: 's1' }),
    ).rejects.toThrow('Stateful web reads are only available')

    const status = await kernel.tools.call('web.browser.status', {}, { actor: 'user' }) as {
      allowedDomains: string[]
    }
    expect(status.allowedDomains).toContain('private.example')
  })

  it("approvals 'prompt' shows the website access domain in the approval request", async () => {
    const seen: unknown[] = []
    const kernel = createHeadlessKernel({
      approvals: 'prompt',
      confirmApproval: async (request) => {
        seen.push(request.savedBrowserSession)
        return true
      },
    })
    await kernel.openWorkspace(dir)

    await expect(
      kernel.tools.call('web.read', {
        url: 'https://secure.example/report',
        stateful: true,
      }, { actor: 'ai', sessionId: 's1' }),
    ).rejects.toThrow('Stateful web reads are only available')

    expect(seen).toEqual([{ domain: 'secure.example', granted: false }])
  })

  it('direct user mutations do not need approval even under deny', async () => {
    const kernel = createHeadlessKernel({ approvals: 'deny' })
    await kernel.openWorkspace(dir)

    await kernel.tools.call('fs.write', { path: 'user.md', content: 'mine' }, { actor: 'user' })
    expect(readFileSync(join(dir, 'user.md'), 'utf-8')).toBe('mine')
  })
})

const ctx = { actor: 'user' as const }

function writeWorkspacePackage(root: string, id: string): void {
  const packageDir = join(root, 'packages', id)
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name: `@mim/${id}`,
    version: '0.1.0',
    type: 'module',
    mim: {
      manifestVersion: 1,
      id,
      name: id,
      permissions: {},
    },
  }))
}

describe('headless app.enable', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-headless-'))
    writeFileSync(join(root, 'mim.yaml'), 'name: headless-test\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('enables a workspace app personally and persists the enablement via app.status', async () => {
    writeWorkspacePackage(root, 'board')
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)

    const before = await kernel.tools.call('app.status', {}, ctx) as { apps: AppStatus[] }
    const boardBefore = before.apps.find(a => a.id === 'board')
    if (boardBefore) {
      expect(boardBefore.enabled).toBe(false)
    }

    const result = await kernel.tools.call('app.enable', { id: 'board' }, ctx)
    expect(result).toMatchObject({ ok: true, id: 'board', layer: 'local' })

    const after = await kernel.tools.call('app.status', {}, ctx) as { apps: AppStatus[] }
    const boardAfter = after.apps.find(a => a.id === 'board')
    expect(boardAfter).toBeDefined()
    expect(boardAfter!.enabled).toBe(true)
    expect(boardAfter!.layer).toBe('local')
  })

  it('enables at the local layer and resolves through app.status', async () => {
    writeWorkspacePackage(root, 'board')
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)

    const result = await kernel.tools.call('app.enable', { id: 'board', layer: 'local' }, ctx)
    expect(result).toMatchObject({ ok: true, id: 'board', layer: 'local' })

    const after = await kernel.tools.call('app.status', {}, ctx) as { apps: AppStatus[] }
    const boardAfter = after.apps.find(a => a.id === 'board')
    expect(boardAfter).toBeDefined()
    expect(boardAfter!.enabled).toBe(true)
    expect(boardAfter!.layer).toBe('local')
  })

  it('emit is no-op in headless (does not throw)', async () => {
    writeWorkspacePackage(root, 'board')
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)

    await expect(
      kernel.tools.call('app.enable', { id: 'board' }, ctx),
    ).resolves.toMatchObject({ ok: true })
  })
})

describe('headless registry and install tool registration', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-headless-reg-'))
    writeFileSync(join(root, 'mim.yaml'), 'name: headless-registry-test\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('registers registry.list tool in headless kernel', async () => {
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)
    const tool = kernel.tools.get('registry.list')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('registry.list')
  })

  it('registers the package.install tool in headless kernel', async () => {
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)
    const tool = kernel.tools.get('package.install')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('package.install')
  })

  it('registers the package.update tool in headless kernel', async () => {
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)
    const tool = kernel.tools.get('package.update')
    expect(tool).toBeDefined()
  })

  it('registers the package.uninstall tool in headless kernel', async () => {
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)
    const tool = kernel.tools.get('package.uninstall')
    expect(tool).toBeDefined()
  })
})

describe('headless named app tools', () => {
  let root: string

  function writeFixturePackage(): void {
    const pkgDir = join(root, 'packages', 'fixture')
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: 'fixture',
      version: '0.1.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'fixture',
        name: 'Fixture',
        views: [],
        backend: 'backend/index.js',
        permissions: { workspace: { read: true } },
        provides: { tools: [{ name: 'fixture.ping', category: 'read', risk: 'low' }] },
      },
    }, null, 2))
    writeFileSync(join(pkgDir, 'backend', 'index.js'), [
      'export const tools = {',
      "  ping: { name: 'fixture.ping', description: 'Ping fixture', audience: ['chat'], execute: async () => ({ ok: true }) },",
      '}',
      "export const agentContext = async () => 'fixture section body'",
      '',
    ].join('\n'))
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-headless-named-'))
    writeFileSync(join(root, 'mim.yaml'), 'name: headless-named-test\n')
    writeFixturePackage()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  async function openTrustedFixture(): Promise<ReturnType<typeof createHeadlessKernel>> {
    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)
    await kernel.tools.call('app.trust', { id: 'fixture' }, ctx)
    await kernel.tools.call('app.enable', { id: 'fixture', layer: 'local' }, ctx)
    // enable triggers a fire-and-forget named-tool sync; wait for it to land
    await vi.waitFor(() => expect(kernel.tools.get('fixture.ping')).toBeDefined(), { timeout: 3000 })
    return kernel
  }

  it('a granted named tool is callable as a first-class tool', async () => {
    const kernel = await openTrustedFixture()
    const result = await kernel.tools.call('fixture.ping', {}, ctx)
    expect(result).toEqual({ ok: true })
  })

  it('manifest-declared read/low policy lets AI call it without approval under deny mode', async () => {
    const kernel = await openTrustedFixture()
    // The unknown-tool fallback policy is general (mutate -> denied under 'deny'),
    // so success here proves the dynamic per-tool policy was consulted.
    const result = await kernel.tools.call('fixture.ping', {}, { actor: 'ai' })
    expect(result).toEqual({ ok: true })
  })

  it('workspace.orient includes the app-contributed section', async () => {
    const kernel = await openTrustedFixture()
    const result = await kernel.tools.call('workspace.orient', {}, ctx) as { content: string }
    expect(result.content).toContain('## Fixture')
    expect(result.content).toContain('fixture section body')
  })
})

describe('headless shared workspace tools', () => {
  let root: string
  let home: string
  let oldHome: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-headless-shared-'))
    home = mkdtempSync(join(tmpdir(), 'mim-headless-home-'))
    oldHome = process.env.HOME
    process.env.HOME = home
    writeFileSync(join(root, 'mim.yaml'), [
      'name: headless-shared-test',
      'sharedWorkspace:',
      '  id: team-server',
      '  url: https://mim.example.com/mcp',
      '  namespaces:',
      '    - issues.*',
      '',
    ].join('\n'))
    writeSharedWorkspaceToken('team-server', 'tok_remote', { home })
  })

  afterEach(() => {
    if (oldHome === undefined) delete process.env.HOME
    else process.env.HOME = oldHome
    vi.unstubAllGlobals()
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('mounts configured remote MCP namespaces into the local tool registry', async () => {
    const fetchUrl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'))
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-06-18',
            serverInfo: { name: 'mim', version: '0.1.2' },
            capabilities: { tools: {} },
          },
        }))
      }
      if (body.method === 'tools/list') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'issues_create',
              description: 'Create remote issue',
              inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
            }],
          },
        }))
      }
      if (body.method === 'tools/call') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({ id: 'ISS-1', title: body.params.arguments.title }),
            }],
          },
        }))
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: 'unexpected method' } }))
    })
    vi.stubGlobal('fetch', fetchUrl)

    const kernel = createHeadlessKernel()
    await kernel.openWorkspace(root)

    expect(kernel.tools.get('issues.create')?.description).toBe('Create remote issue')
    expect(kernel.getNamedMcpTools()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'issues_create', mimName: 'issues.create' }),
    ]))
    await expect(kernel.tools.call('issues.create', { title: 'Fix auth' }, ctx)).resolves.toEqual({
      id: 'ISS-1',
      title: 'Fix auth',
    })
    expect(fetchUrl).toHaveBeenCalledWith('https://mim.example.com/mcp', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok_remote' }),
    }))
  })
})
