import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createMemorySecretStore, type SecretStore } from '@main/integrations/secrets.js'
import type { HttpClient, HttpResponse } from '@main/integrations/http.js'
import { createPackageEnablementStore } from '@main/packages/packageEnablement.js'
import { createPackageRuntime } from '@main/packages/packageRuntime.js'
import { createPackageLoader } from '@main/packages/packages.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerFileTools } from '@main/tools/fs.js'

describe('app runtime capabilities', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-runtime-test-'))
    mkdirSync(join(dir, 'packages'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writePackage(id: string, backend: string, permissions: Record<string, unknown> = { workspace: { read: true } }): void {
    const pkgDir = join(dir, 'packages', id)
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>Runtime</h1>')
    writeFileSync(join(pkgDir, 'backend', 'index.mjs'), backend)
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: `@mim/${id}`,
      version: '0.1.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id,
        name: id,
        views: [],
        backend: './backend/index.mjs',
        permissions,
      },
    }))
  }

  async function makeRuntime(boundaries: { http?: HttpClient; secrets?: SecretStore } = {}) {
    const trace = createTraceLog()
    const tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)
    registerFileTools(tools)
    const packages = await createPackageLoader(tools)
    const enablement = createPackageEnablementStore({ getWorkspacePath: () => dir })
    const runtime = createPackageRuntime({ packages, enablement, tools, trace, ...boundaries })
    return { packages, enablement, runtime, tools }
  }

  it('does not import backend modules during static discovery', async () => {
    writePackage('explosive', 'throw new Error("imported too early")')
    const { packages } = await makeRuntime()
    expect(packages.get('explosive')).toBeDefined()
  })

  it('loads jobs and tools from an enabled headless app and ignores legacy skills exports', async () => {
    writePackage('stats-checker', `
      export const jobs = {
        checkCsv: { label: 'Check CSV', async run() { return { ok: true } } }
      }
      export const tools = {
        checkDataset: {
          label: 'Check dataset',
          description: 'Check a dataset',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          async execute() { return { ok: true } }
        }
      }
      export const skills = {
        review: { label: 'Review', tools: ['checkDataset'] }
      }
    `)
    const { enablement, runtime, tools, packages } = await makeRuntime()
    enablement.setEnabled('stats-checker', true)
    enablement.ackTrust(packages.get('stats-checker')!)

    const capabilities = await runtime.loadCapabilities('stats-checker')

    expect(capabilities.diagnostics).toEqual([])
    expect(capabilities.jobs.map(job => job.id)).toEqual(['checkCsv'])
    expect(capabilities.tools[0]).toMatchObject({
      id: 'checkDataset',
      packageId: 'stats-checker',
      description: 'Check a dataset',
    })
    expect(capabilities.tools[0].publicName).toMatch(/^pkg_[a-f0-9]{8}__checkDataset$/)
    // Filesystem skills ({package}/skills/<name>/SKILL.md) replace backend skill exports.
    expect('skills' in capabilities).toBe(false)
  })

  it('omits disabled app capabilities', async () => {
    writePackage('stats-checker', `
      export const tools = {
        checkDataset: { description: 'Check', async execute() { return true } }
      }
    `)
    const { runtime } = await makeRuntime()

    const tools = await runtime.listChatTools()
    expect(tools.some(tool => tool.packageId === 'stats-checker')).toBe(false)
  })

  it('executes app tools through an app runtime context', async () => {
    writeFileSync(join(dir, 'data.csv'), 'x,y\n1,2\n')
    writePackage('stats-checker', `
      export const tools = {
        checkDataset: {
          description: 'Check',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          async execute(ctx, input) {
            const text = await ctx.files.readWorkspaceText(input.path)
            await ctx.data.kv.set('lastPath', input.path)
            return { length: text.length, packageId: ctx.package.id }
          }
        }
      }
    `)
    const { enablement, runtime, tools, packages } = await makeRuntime()
    enablement.setEnabled('stats-checker', true)
    enablement.ackTrust(packages.get('stats-checker')!)
    const tool = (await runtime.listChatTools()).find(candidate => candidate.packageId === 'stats-checker')!

    const call = vi.spyOn(tools, 'call')

    const result = await runtime.executeTool(tool.publicName, { path: 'data.csv' }, { actor: 'ai', sessionId: 's1' })

    expect(result).toEqual({ length: 8, packageId: 'stats-checker' })
    expect(call).toHaveBeenCalledWith('fs.read', { path: 'data.csv' }, {
      actor: 'package',
      package_id: 'stats-checker',
      sessionId: 's1',
    })
  })

  it('validates app tool input against declared schemas before executing handlers', async () => {
    const pkgDir = join(dir, 'packages', 'board')
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>Board</h1>')
    writeFileSync(join(pkgDir, 'backend', 'index.mjs'), `
      export const tools = {
        update: {
          name: 'issues.update',
          description: 'Update issue',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              labels: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    color: { type: 'string' }
                  },
                  required: ['name']
                }
              },
              relatedIds: { type: 'array', items: { type: 'string' } }
            },
            required: ['id']
          },
          async execute() {
            throw new Error('handler should not run')
          }
        }
      }
    `)
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@mim/board',
      version: '1.0.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'board',
        name: 'Board',
        views: [],
        backend: './backend/index.mjs',
        permissions: {},
        provides: { tools: [{ name: 'issues.*', category: 'write', risk: 'medium' }] },
      },
    }))
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('board', true)
    enablement.ackTrust(packages.get('board')!)
    await runtime.listCapabilities()

    await expect(
      runtime.executeTool('issues.update', {
        id: 'issue-1700000000-ab12',
        labels: '[{"name":"bug"}]',
      }, { actor: 'ai' }),
    ).rejects.toThrow('Invalid input for issues.update: labels must be an array')

    await expect(
      runtime.executeTool('issues.update', {
        id: 'issue-1700000000-ab12',
        relatedIds: '["issue-1"]',
      }, { actor: 'ai' }),
    ).rejects.toThrow('Invalid input for issues.update: relatedIds must be an array')
  })

  it('builds runtime contexts with frozen inputs and app-scoped tool calls', async () => {
    writePackage('stats-checker', 'export const jobs = {}')
    const { enablement, runtime, packages, tools } = await makeRuntime()
    enablement.setEnabled('stats-checker', true)
    const call = vi.spyOn(tools, 'call')
    const pkg = packages.get('stats-checker')!

    const ctx = runtime.createContext({
      pkg,
      inputs: { path: 'data.csv' },
      caller: { sessionId: 's1' },
      job: { id: 'job', runId: 'run', startedAt: 'now' },
    })

    expect(Object.isFrozen(ctx.inputs)).toBe(true)
    await ctx.tools.call('fs.exists', { path: 'data.csv' })
    // Job-context calls trace under the run: traceId = runId, parented to the
    // run root span (spanId = runId).
    expect(call).toHaveBeenCalledWith('fs.exists', { path: 'data.csv' }, {
      actor: 'package',
      package_id: 'stats-checker',
      sessionId: 's1',
      traceId: 'run',
      spanId: 'run',
    })
  })

  it('routes ctx.documents.pdf.extract through the app-scoped tool registry', async () => {
    writePackage('references', 'export const jobs = {}', { workspace: { read: true } })
    const { enablement, runtime, packages, tools } = await makeRuntime()
    enablement.setEnabled('references', true)
    tools.register({
      name: 'documents.pdf.extract',
      description: 'Extract PDF',
      execute: async (params) => ({ ok: true, params }),
    })
    const call = vi.spyOn(tools, 'call')
    const ctx = runtime.createContext({
      pkg: packages.get('references')!,
      caller: { sessionId: 's1' },
    })

    const result = await ctx.documents.pdf.extract('papers/source.pdf', { max_chars: 1200 })

    expect(result).toEqual({ ok: true, params: { path: 'papers/source.pdf', max_chars: 1200 } })
    expect(call).toHaveBeenCalledWith('documents.pdf.extract', { path: 'papers/source.pdf', max_chars: 1200 }, {
      actor: 'package',
      package_id: 'references',
      sessionId: 's1',
    })
  })

  it('routes ctx.http through the injected client for declared hosts', async () => {
    writePackage('github-monitor', 'export const jobs = {}', { http: ['api.github.com'] })
    const response: HttpResponse = { ok: true, status: 200, json: async () => ({}), text: async () => '' }
    const http: HttpClient = { request: vi.fn(async () => response) }
    const { enablement, runtime, packages } = await makeRuntime({ http })
    enablement.setEnabled('github-monitor', true)
    const ctx = runtime.createContext({ pkg: packages.get('github-monitor')! })

    const res = await ctx.http.request({ url: 'https://api.github.com/orgs/acme/repos' })

    expect(res.status).toBe(200)
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.github.com/orgs/acme/repos' }))
  })

  it('rejects ctx.http for hosts outside the manifest declaration', async () => {
    writePackage('github-monitor', 'export const jobs = {}', { http: ['api.github.com'] })
    const http: HttpClient = { request: vi.fn() }
    const { enablement, runtime, packages } = await makeRuntime({ http })
    enablement.setEnabled('github-monitor', true)
    const ctx = runtime.createContext({ pkg: packages.get('github-monitor')! })

    await expect(ctx.http.request({ url: 'https://evil.example.com/' })).rejects.toThrow('did not declare HTTP access')
    expect(http.request).not.toHaveBeenCalled()
  })

  it('scopes ctx.secrets to declared names through the injected store', async () => {
    writePackage('github-monitor', 'export const jobs = {}', { secrets: ['github_token'] })
    const secrets = createMemorySecretStore()
    const { enablement, runtime, packages } = await makeRuntime({ secrets })
    enablement.setEnabled('github-monitor', true)
    const ctx = runtime.createContext({ pkg: packages.get('github-monitor')! })

    await ctx.secrets.set('github_token', 'ghp_abc')
    expect(await ctx.secrets.get('github_token')).toBe('ghp_abc')
    expect(secrets.dump()).toEqual({ 'Mim:package:github-monitor:github_token': 'ghp_abc' })
    await expect(ctx.secrets.get('other')).rejects.toThrow('did not declare secret')
  })

  it('fails ctx.secrets loudly when no secret store is wired into the runtime', async () => {
    writePackage('github-monitor', 'export const jobs = {}', { secrets: ['github_token'] })
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('github-monitor', true)
    const ctx = runtime.createContext({ pkg: packages.get('github-monitor')! })

    await expect(ctx.secrets.get('github_token')).rejects.toThrow('Secret store is not available')
  })

  it('resolves a named tool to its stable name when granted by manifest provides.tools', async () => {
    const pkgDir = join(dir, 'packages', 'board')
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>Board</h1>')
    writeFileSync(join(pkgDir, 'backend', 'index.mjs'), `
      export const tools = {
        list: {
          name: 'issues.list',
          description: 'List issues',
          async execute() { return { ok: true } }
        }
      }
    `)
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@mim/board',
      version: '1.0.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'board',
        name: 'Board',
        views: [],
        backend: './backend/index.mjs',
        permissions: {},
        provides: { tools: [{ name: 'issues.*', category: 'write', risk: 'medium' }] },
      },
    }))
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('board', true)
    enablement.ackTrust(packages.get('board')!)

    const caps = await runtime.loadCapabilities('board')
    const tool = caps.tools.find(t => t.id === 'list')!

    expect(tool.publicName).toBe('issues.list')
    expect(tool.named).toBe(true)
    expect(caps.diagnostics).toEqual([])
  })

  it('denies app actors executing named tools owned by another app', async () => {
    const pkgDir = join(dir, 'packages', 'board')
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>Board</h1>')
    writeFileSync(join(pkgDir, 'backend', 'index.mjs'), `
      export const tools = {
        list: {
          name: 'issues.list',
          description: 'List issues',
          async execute() { return { ok: true } }
        }
      }
    `)
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@mim/board',
      version: '1.0.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'board',
        name: 'Board',
        views: [],
        backend: './backend/index.mjs',
        permissions: {},
        provides: { tools: [{ name: 'issues.*', category: 'read', risk: 'low' }] },
      },
    }))
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('board', true)
    enablement.ackTrust(packages.get('board')!)
    await runtime.listCapabilities()

    await expect(
      runtime.executeTool('issues.list', {}, { actor: 'package', package_id: 'knowledge' }),
    ).rejects.toThrow('Package knowledge cannot execute tools owned by package board')
  })

  it('falls back to mangled name with diagnostic when name is not granted', async () => {
    const pkgDir = join(dir, 'packages', 'board2')
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>Board</h1>')
    writeFileSync(join(pkgDir, 'backend', 'index.mjs'), `
      export const tools = {
        list: {
          name: 'issues.list',
          description: 'List issues',
          async execute() { return { ok: true } }
        }
      }
    `)
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@mim/board2',
      version: '1.0.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'board2',
        name: 'Board 2',
        views: [],
        backend: './backend/index.mjs',
        permissions: {},
      },
    }))
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('board2', true)
    enablement.ackTrust(packages.get('board2')!)

    const caps = await runtime.loadCapabilities('board2')
    const tool = caps.tools.find(t => t.id === 'list')!

    expect(tool.publicName).toMatch(/^pkg_[a-f0-9]{8}__list$/)
    expect(tool.named).toBe(false)
    expect(caps.diagnostics.some(d => d.includes('not granted'))).toBe(true)
  })

  it('falls back to mangled name with diagnostic when name is invalid', async () => {
    const pkgDir = join(dir, 'packages', 'board3')
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'ui', 'index.html'), '<h1>Board</h1>')
    writeFileSync(join(pkgDir, 'backend', 'index.mjs'), `
      export const tools = {
        list: {
          name: 'INVALID',
          description: 'List issues',
          async execute() { return { ok: true } }
        }
      }
    `)
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@mim/board3',
      version: '1.0.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'board3',
        name: 'Board 3',
        views: [],
        backend: './backend/index.mjs',
        permissions: {},
        provides: { tools: [{ name: 'issues.*', category: 'write', risk: 'medium' }] },
      },
    }))
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('board3', true)
    enablement.ackTrust(packages.get('board3')!)

    const caps = await runtime.loadCapabilities('board3')
    const tool = caps.tools.find(t => t.id === 'list')!

    expect(tool.publicName).toMatch(/^pkg_[a-f0-9]{8}__list$/)
    expect(tool.named).toBe(false)
    expect(caps.diagnostics.some(d => d.includes('not granted'))).toBe(true)
  })

  it('tools with no name declared remain mangled (unchanged behavior)', async () => {
    writePackage('stats-checker', `
      export const tools = {
        checkDataset: {
          description: 'Check a dataset',
          async execute() { return { ok: true } }
        }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('stats-checker', true)
    enablement.ackTrust(packages.get('stats-checker')!)

    const caps = await runtime.loadCapabilities('stats-checker')
    const tool = caps.tools.find(t => t.id === 'checkDataset')!

    expect(tool.publicName).toMatch(/^pkg_[a-f0-9]{8}__checkDataset$/)
    expect(tool.named).toBe(false)
  })

  it('captures agentContext function export as a capability', async () => {
    writePackage('ctx-provider', `
      export function agentContext(ctx) {
        return { summary: 'test context for ' + ctx.package.id }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('ctx-provider', true)
    enablement.ackTrust(packages.get('ctx-provider')!)

    const caps = await runtime.loadCapabilities('ctx-provider')

    expect(caps.agentContext).toBeTypeOf('function')
    expect(caps.diagnostics).toEqual([])
  })

  it('emits diagnostic for non-function agentContext export', async () => {
    writePackage('ctx-bad', `
      export const agentContext = "not a function"
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('ctx-bad', true)
    enablement.ackTrust(packages.get('ctx-bad')!)

    const caps = await runtime.loadCapabilities('ctx-bad')

    expect(caps.agentContext).toBeUndefined()
    expect(caps.diagnostics.some(d => d.includes('agentContext') && d.includes('must be a function'))).toBe(true)
  })

  // ---- Agent descriptor parsing ----

  it('parses agents export with two agents, one minimal one full', async () => {
    writePackage('agent-app', `
      export const agents = {
        minimal: {
          async instructions() { return 'You are minimal.' }
        },
        full: {
          name: 'Full Agent',
          icon: 'FA',
          model: 'claude-opus-4-8',
          tools: ['fs.read', 'search.files'],
          skills: ['review-methods'],
          async instructions(ctx) {
            return 'You are the full agent.'
          }
        }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agent-app', true)
    enablement.ackTrust(packages.get('agent-app')!)

    const caps = await runtime.loadCapabilities('agent-app')

    expect(caps.diagnostics).toEqual([])
    expect(caps.agents).toHaveLength(2)

    const minimal = caps.agents.find(a => a.key === 'minimal')!
    expect(minimal.name).toBe('minimal')
    expect(minimal.icon).toBeUndefined()
    expect(minimal.model).toBeUndefined()
    expect(minimal.tools).toBeUndefined()
    expect(minimal.skills).toBeUndefined()
    expect(minimal.instructions).toBeTypeOf('function')

    const full = caps.agents.find(a => a.key === 'full')!
    expect(full.name).toBe('Full Agent')
    expect(full.icon).toBe('FA')
    expect(full.model).toBe('claude-opus-4-8')
    expect(full.tools).toEqual(['fs.read', 'search.files'])
    expect(full.skills).toEqual(['review-methods'])
    expect(full.instructions).toBeTypeOf('function')
  })

  it('returns empty agents array for packages without agents export', async () => {
    writePackage('no-agents', `
      export const jobs = {
        run: { label: 'Run', async run() { return {} } }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('no-agents', true)
    enablement.ackTrust(packages.get('no-agents')!)

    const caps = await runtime.loadCapabilities('no-agents')

    expect(caps.agents).toEqual([])
    expect(caps.diagnostics).toEqual([])
  })

  it('emits diagnostic when agents export is not an object', async () => {
    writePackage('agents-bad-type', `
      export const agents = "not an object"
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agents-bad-type', true)
    enablement.ackTrust(packages.get('agents-bad-type')!)

    const caps = await runtime.loadCapabilities('agents-bad-type')

    expect(caps.agents).toEqual([])
    expect(caps.diagnostics).toContain('backend export "agents" must be an object')
  })

  it('emits diagnostic for invalid agent key', async () => {
    writePackage('agents-bad-key', `
      export const agents = {
        'INVALID KEY!': {
          async instructions() { return 'x' }
        }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agents-bad-key', true)
    enablement.ackTrust(packages.get('agents-bad-key')!)

    const caps = await runtime.loadCapabilities('agents-bad-key')

    expect(caps.agents).toEqual([])
    expect(caps.diagnostics.some(d => d.includes('Invalid agent key'))).toBe(true)
  })

  it('emits diagnostic when agent value is not an object', async () => {
    writePackage('agents-not-obj', `
      export const agents = {
        broken: 42
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agents-not-obj', true)
    enablement.ackTrust(packages.get('agents-not-obj')!)

    const caps = await runtime.loadCapabilities('agents-not-obj')

    expect(caps.agents).toEqual([])
    expect(caps.diagnostics).toContain('Agent broken must be an object')
  })

  it('emits diagnostic when agent instructions is not a function', async () => {
    writePackage('agents-no-fn', `
      export const agents = {
        broken: {
          instructions: 'not a function'
        }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agents-no-fn', true)
    enablement.ackTrust(packages.get('agents-no-fn')!)

    const caps = await runtime.loadCapabilities('agents-no-fn')

    expect(caps.agents).toEqual([])
    expect(caps.diagnostics).toContain('Agent broken must export instructions(ctx)')
  })

  it('emits diagnostics for non-string name/icon/model and falls back', async () => {
    writePackage('agents-bad-strings', `
      export const agents = {
        test: {
          name: 42,
          icon: false,
          model: [],
          async instructions() { return 'x' }
        }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agents-bad-strings', true)
    enablement.ackTrust(packages.get('agents-bad-strings')!)

    const caps = await runtime.loadCapabilities('agents-bad-strings')

    expect(caps.agents).toHaveLength(1)
    const agent = caps.agents[0]
    expect(agent.name).toBe('test')
    expect(agent.icon).toBeUndefined()
    expect(agent.model).toBeUndefined()
    expect(caps.diagnostics).toContain('Agent test: name must be a string')
    expect(caps.diagnostics).toContain('Agent test: icon must be a string')
    expect(caps.diagnostics).toContain('Agent test: model must be a string')
  })

  it('emits diagnostics for non-array tools/skills and treats as absent', async () => {
    writePackage('agents-bad-arrays', `
      export const agents = {
        test: {
          tools: 'not-an-array',
          skills: 42,
          async instructions() { return 'x' }
        }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agents-bad-arrays', true)
    enablement.ackTrust(packages.get('agents-bad-arrays')!)

    const caps = await runtime.loadCapabilities('agents-bad-arrays')

    expect(caps.agents).toHaveLength(1)
    const agent = caps.agents[0]
    expect(agent.tools).toBeUndefined()
    expect(agent.skills).toBeUndefined()
    expect(caps.diagnostics).toContain('Agent test: tools must be an array of strings')
    expect(caps.diagnostics).toContain('Agent test: skills must be an array of strings')
  })

  it('filters non-string entries in tools/skills arrays with diagnostics', async () => {
    writePackage('agents-mixed-entries', `
      export const agents = {
        test: {
          tools: ['fs.read', 42, 'search.files'],
          skills: ['review', null],
          async instructions() { return 'x' }
        }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agents-mixed-entries', true)
    enablement.ackTrust(packages.get('agents-mixed-entries')!)

    const caps = await runtime.loadCapabilities('agents-mixed-entries')

    expect(caps.agents).toHaveLength(1)
    const agent = caps.agents[0]
    expect(agent.tools).toEqual(['fs.read', 'search.files'])
    expect(agent.skills).toEqual(['review'])
    expect(caps.diagnostics.some(d => d.includes('tools entries must be strings'))).toBe(true)
    expect(caps.diagnostics.some(d => d.includes('skills entries must be strings'))).toBe(true)
  })

  it('distinguishes tools absent (undefined) from tools empty array', async () => {
    writePackage('agents-scope', `
      export const agents = {
        unscoped: {
          async instructions() { return 'full set' }
        },
        scoped: {
          tools: [],
          async instructions() { return 'scoped to nothing extra' }
        }
      }
    `)
    const { enablement, runtime, packages } = await makeRuntime()
    enablement.setEnabled('agents-scope', true)
    enablement.ackTrust(packages.get('agents-scope')!)

    const caps = await runtime.loadCapabilities('agents-scope')

    expect(caps.diagnostics).toEqual([])
    const unscoped = caps.agents.find(a => a.key === 'unscoped')!
    const scoped = caps.agents.find(a => a.key === 'scoped')!
    expect(unscoped.tools).toBeUndefined()
    expect(scoped.tools).toEqual([])
  })

  it('disabled package returns no agents', async () => {
    writePackage('agents-disabled', `
      export const agents = {
        helper: {
          async instructions() { return 'never loaded' }
        }
      }
    `)
    const { runtime } = await makeRuntime()

    const caps = await runtime.loadCapabilities('agents-disabled')

    expect(caps.agents).toEqual([])
    expect(caps.diagnostics.some(d => d.includes('disabled'))).toBe(true)
  })
})
