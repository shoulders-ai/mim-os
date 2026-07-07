import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createAgentMounts, type AgentInstructionsContext } from '@main/ai/agentMounts.js'
import type { PackageRuntime, PackageAgentDescriptor, PackageCapabilities } from '@main/packages/packageRuntime.js'
import type { PackageLoader, LoadedPackage } from '@main/packages/packages.js'
import type { ToolRegistry } from '@main/tools/registry.js'

vi.mock('@main/ai/ai.js', () => ({
  loadRegistry: vi.fn(() => ({
    models: [
      { id: 'claude-opus-4-8', model: 'claude-opus-4-8', provider: 'anthropic' },
      { id: 'test-model', model: 'test-model', provider: 'anthropic' },
    ],
    defaults: {},
    providers: { anthropic: { url: 'https://api.anthropic.com/v1/messages' } },
  })),
  resolveKey: vi.fn(() => ({ key: 'sk-test', source: 'env' })),
}))

function makePackage(id: string, dir: string): LoadedPackage {
  return {
    manifest: {
      id,
      name: `Test ${id}`,
      version: '1.0.0',
      description: '',
      backend: 'backend.js',
    },
    dir,
    source: 'workspace',
    hasReadme: false,
  } as LoadedPackage
}

function makeAgent(key: string, overrides: Partial<PackageAgentDescriptor> = {}): PackageAgentDescriptor {
  return {
    key,
    name: overrides.name ?? `Agent ${key}`,
    instructions: overrides.instructions ?? (async () => 'You are a test agent.'),
    ...(overrides.icon !== undefined ? { icon: overrides.icon } : {}),
    ...(overrides.model !== undefined ? { model: overrides.model } : {}),
    ...(overrides.tools !== undefined ? { tools: overrides.tools } : {}),
    ...(overrides.skills !== undefined ? { skills: overrides.skills } : {}),
  }
}

function makeCapabilities(
  packageId: string,
  agents: PackageAgentDescriptor[],
  toolPublicNames: string[] = [],
): PackageCapabilities {
  return {
    packageId,
    jobs: [],
    tools: toolPublicNames.map(name => ({
      id: name.split('.').pop()!,
      publicName: name,
      named: true,
      packageId,
      label: name,
      description: name,
      inputSchema: { type: 'object', properties: {} },
      audience: ['chat'],
      execute: async () => ({}),
    })),
    agents,
    diagnostics: [],
  }
}

function makeMocks(
  dir: string,
  opts: {
    packageId?: string
    agents?: PackageAgentDescriptor[]
    toolPublicNames?: string[]
    disabled?: boolean
    registryTools?: string[]
    skillResults?: Record<string, unknown>
  } = {},
) {
  const packageId = opts.packageId ?? 'test-app'
  const agents = opts.agents ?? [makeAgent('referee')]
  const toolPublicNames = opts.toolPublicNames ?? []
  const disabled = opts.disabled ?? false

  const pkg = makePackage(packageId, dir)
  const caps = disabled
    ? { packageId, jobs: [], tools: [], agents: [], diagnostics: [`Package is disabled: ${packageId}`] }
    : makeCapabilities(packageId, agents, toolPublicNames)

  const traced: Array<Record<string, unknown>> = []

  const runtime: PackageRuntime = {
    loadCapabilities: vi.fn(async (id: string) => {
      if (id !== packageId) throw new Error(`Package not found: ${id}`)
      return caps
    }),
    listCapabilities: vi.fn(async () => disabled ? [] : [caps]),
    listChatTools: vi.fn(async () => []),
    getJob: vi.fn(async () => { throw new Error('not impl') }),
    executeTool: vi.fn(async () => ({})),
    createContext: vi.fn(() => { throw new Error('should not be called') }),
    invalidate: vi.fn(),
  }

  const packages: PackageLoader = {
    list: () => [pkg],
    get: (id: string) => id === packageId ? pkg : undefined,
    diagnostics: () => [],
    onChange: () => {},
    rescan: async () => {},
  }

  const registryToolSet = new Set(opts.registryTools ?? ['fs.read', 'search.files', 'stats.check'])

  const tools = {
    call: vi.fn(async (name: string, params: Record<string, unknown>) => {
      if (name === 'skill.get') {
        const skillName = params.name as string
        if (opts.skillResults && skillName in opts.skillResults) {
          return { skill: opts.skillResults[skillName] }
        }
        throw new Error('Skill not found')
      }
      return { ok: true }
    }),
    get: vi.fn((name: string) => {
      if (registryToolSet.has(name)) {
        return { name, handler: async () => ({}) }
      }
      return undefined
    }),
    getWorkspacePath: () => dir,
    setWorkspacePath: () => {},
    list: () => [],
    register: () => {},
    unregister: () => {},
    shouldCaptureContent: () => false,
    trace: {
      append: vi.fn((event: Record<string, unknown>) => traced.push(event)),
      writePayload: vi.fn(() => null),
      setWorkspacePath: () => {},
    },
  } as unknown as ToolRegistry

  const mounts = createAgentMounts({ runtime, packages, tools })
  return { mounts, runtime, packages, tools, traced, caps }
}

describe('agentMounts.list()', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-agent-mounts-'))
    mkdirSync(join(dir, '.mim', 'packages', 'test-app', 'data', 'kv'), { recursive: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns agents with correct id format: package:<packageId>/<key>', async () => {
    const { mounts } = makeMocks(dir)
    const list = await mounts.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('package:test-app/referee')
    expect(list[0].packageId).toBe('test-app')
    expect(list[0].key).toBe('referee')
    expect(list[0].name).toBe('Agent referee')
  })

  it('reports scoped=true with toolCount when descriptor.tools is defined', async () => {
    const agent = makeAgent('narrow', { tools: ['fs.read', 'search.files'] })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const list = await mounts.list()
    expect(list[0].scoped).toBe(true)
    expect(list[0].toolCount).toBe(2)
  })

  it('reports scoped=false with no toolCount when descriptor.tools is undefined', async () => {
    const agent = makeAgent('broad')
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const list = await mounts.list()
    expect(list[0].scoped).toBe(false)
    expect(list[0].toolCount).toBeUndefined()
  })

  it('produces diagnostic for unknown tool id', async () => {
    const agent = makeAgent('bad-tools', { tools: ['fs.read', 'nonexistent.tool'] })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const list = await mounts.list()
    expect(list[0].diagnostics).toContain('Unknown tool id in agent bad-tools: nonexistent.tool')
    // known tool should NOT produce a diagnostic
    expect(list[0].diagnostics).not.toContainEqual(expect.stringContaining('fs.read'))
  })

  it('allows an app own tool even when not in registry', async () => {
    const agent = makeAgent('with-own-tools', { tools: ['myapp.query'] })
    const { mounts } = makeMocks(dir, {
      agents: [agent],
      toolPublicNames: ['myapp.query'],
      registryTools: [],
    })
    const list = await mounts.list()
    expect(list[0].diagnostics).not.toContainEqual(expect.stringContaining('myapp.query'))
  })

  it('produces diagnostic for unknown skill', async () => {
    const agent = makeAgent('bad-skills', { skills: ['nonexistent-skill'] })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const list = await mounts.list()
    expect(list[0].diagnostics).toContain('Unknown skill in agent bad-skills: nonexistent-skill')
  })

  it('no diagnostic for a valid skill', async () => {
    const agent = makeAgent('good-skills', { skills: ['review'] })
    const { mounts } = makeMocks(dir, {
      agents: [agent],
      skillResults: {
        'package:test-app/review': { name: 'review', body: 'do review', tools: [], unlocks: [] },
      },
    })
    const list = await mounts.list()
    expect(list[0].diagnostics).toEqual([])
    expect(list[0].skills).toEqual(['review'])
  })

  it('produces diagnostic for unknown model', async () => {
    const agent = makeAgent('bad-model', { model: 'gpt-fictional-99' })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const list = await mounts.list()
    expect(list[0].diagnostics).toContain('Unknown model in agent bad-model: gpt-fictional-99')
  })

  it('no diagnostic for a known model', async () => {
    const agent = makeAgent('good-model', { model: 'claude-opus-4-8' })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const list = await mounts.list()
    expect(list[0].diagnostics.filter(d => d.includes('model'))).toEqual([])
  })

  it('disabled package is excluded from list', async () => {
    const { mounts } = makeMocks(dir, { disabled: true })
    const list = await mounts.list()
    expect(list).toEqual([])
  })
})

describe('agentMounts.resolveProfile()', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-agent-mounts-'))
    mkdirSync(join(dir, '.mim', 'packages', 'test-app', 'data', 'kv'), { recursive: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('throws for unknown agent id', async () => {
    const { mounts } = makeMocks(dir)
    await expect(mounts.resolveProfile('package:test-app/unknown'))
      .rejects.toThrow('Unknown or unavailable agent')
  })

  it('throws for unknown package', async () => {
    const { mounts } = makeMocks(dir)
    await expect(mounts.resolveProfile('package:nonexistent/referee'))
      .rejects.toThrow('Unknown or unavailable agent')
  })

  it('throws for malformed id', async () => {
    const { mounts } = makeMocks(dir)
    await expect(mounts.resolveProfile('bad-id'))
      .rejects.toThrow('Unknown or unavailable agent')
  })

  it('throws for disabled package', async () => {
    const { mounts } = makeMocks(dir, { disabled: true })
    await expect(mounts.resolveProfile('package:test-app/referee'))
      .rejects.toThrow('Unknown or unavailable agent')
  })

  it('returns profile with correct field values', async () => {
    const agent = makeAgent('referee', {
      model: 'claude-opus-4-8',
      tools: ['fs.read', 'search.files'],
      skills: ['review-methods'],
    })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/referee')

    expect(profile.id).toBe('package:test-app/referee')
    expect(profile.toolSurface).toBe('chat')
    expect(profile.modelFeature).toBe('chat')
    expect(profile.defaultModelId).toBe('claude-opus-4-8')
    expect(profile.useCatalogs).toBe(true)
    expect(profile.persistSession).toBe(true)
    expect(profile.stepCap).toBe(100)
    expect(profile.sendReasoning).toBe(true)
    expect(profile.toolAllowlist).toEqual(['fs.read', 'search.files'])
    expect(profile.preActivatedSkills).toEqual(['package:test-app/review-methods'])
  })

  it('preActivatedSkills qualifies names with package:<packageId>/', async () => {
    const agent = makeAgent('referee', { skills: ['alpha', 'beta'] })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/referee')
    expect(profile.preActivatedSkills).toEqual([
      'package:test-app/alpha',
      'package:test-app/beta',
    ])
  })

  it('has no toolAllowlist when descriptor.tools is undefined', async () => {
    const agent = makeAgent('broad')
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/broad')
    expect(profile.toolAllowlist).toBeUndefined()
  })

  it('preActivatedSkills is empty array when descriptor.skills is undefined', async () => {
    const agent = makeAgent('plain')
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/plain')
    expect(profile.preActivatedSkills).toEqual([])
  })
})

describe('agentMounts buildInstructions', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-agent-mounts-'))
    mkdirSync(join(dir, '.mim', 'packages', 'test-app', 'data', 'kv'), { recursive: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('receives ONLY the constrained ctx (no tools, http, secrets, ai keys)', async () => {
    let capturedCtx: unknown
    const agent = makeAgent('inspector', {
      instructions: async (ctx: unknown) => {
        capturedCtx = ctx
        return 'inspected'
      },
    })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/inspector')
    await profile.buildInstructions({
      workspacePath: dir,
      skillCatalog: [],
      selectedSkillsSection: null,
      request: { messages: [] as any },
    })

    expect(capturedCtx).toBeDefined()
    const ctx = capturedCtx as Record<string, unknown>
    // Must have constrained fields
    expect(ctx.package).toBeDefined()
    expect(ctx.data).toBeDefined()
    expect(ctx.files).toBeDefined()
    expect(ctx.abort).toBeDefined()
    // Must NOT have full runtime fields
    expect(ctx.tools).toBeUndefined()
    expect(ctx.http).toBeUndefined()
    expect(ctx.secrets).toBeUndefined()
    expect(ctx.ai).toBeUndefined()
  })

  it('resolves template vars ({{DATE_TODAY}} is substituted)', async () => {
    const agent = makeAgent('tmpl', {
      instructions: async () => 'Today is {{DATE_TODAY}}. Tree: {{WORKSPACE_TREE}}',
    })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/tmpl')
    const result = await profile.buildInstructions({
      workspacePath: dir,
      skillCatalog: [],
      selectedSkillsSection: null,
      request: { messages: [] as any },
    })

    expect(result).not.toContain('{{DATE_TODAY}}')
    // Should contain a resolved date like "Monday, 7 July 2026"
    expect(result).toMatch(/\w+day, \d+ \w+ \d{4}/)
  })

  it('appends selectedSkillsSection with triple newline join', async () => {
    const agent = makeAgent('skills-join', {
      instructions: async () => 'Base instructions',
    })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/skills-join')
    const result = await profile.buildInstructions({
      workspacePath: dir,
      skillCatalog: [],
      selectedSkillsSection: '# ACTIVE SKILLS\n\nSkill body here.',
      request: { messages: [] as any },
    })

    expect(result).toContain('Base instructions')
    expect(result).toContain('# ACTIVE SKILLS')
    expect(result).toContain('\n\n\n# ACTIVE SKILLS')
  })

  it('timeout produces error naming app and agent', async () => {
    const agent = makeAgent('slow', {
      name: 'Slow Agent',
      instructions: async () => new Promise(() => {}), // never resolves
    })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/slow')
    await expect(profile.buildInstructions({
      workspacePath: dir,
      skillCatalog: [],
      selectedSkillsSection: null,
      request: { messages: [] as any },
    })).rejects.toThrow(/Agent "Slow Agent".*package:test-app\/slow.*timeout/)
  }, 10000)

  it('non-string return produces error naming app and agent', async () => {
    const agent = makeAgent('bad-return', {
      name: 'Bad Return',
      instructions: async () => 42,
    })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/bad-return')
    await expect(profile.buildInstructions({
      workspacePath: dir,
      skillCatalog: [],
      selectedSkillsSection: null,
      request: { messages: [] as any },
    })).rejects.toThrow(/Agent "Bad Return".*package:test-app\/bad-return.*must return a string/)
  })

  it('rejection produces error naming app and agent', async () => {
    const agent = makeAgent('failing', {
      name: 'Failing Agent',
      instructions: async () => { throw new Error('db connection lost') },
    })
    const { mounts } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/failing')
    await expect(profile.buildInstructions({
      workspacePath: dir,
      skillCatalog: [],
      selectedSkillsSection: null,
      request: { messages: [] as any },
    })).rejects.toThrow(/Agent "Failing Agent".*package:test-app\/failing.*db connection lost/)
  })

  it('trace event emitted with parent span on success', async () => {
    const agent = makeAgent('traced', {
      instructions: async () => 'hello',
    })
    const { mounts, traced } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/traced')
    await profile.buildInstructions({
      workspacePath: dir,
      skillCatalog: [],
      selectedSkillsSection: null,
      request: { messages: [] as any },
      trace: { traceId: 'turn-trace-1', spanId: 'turn-span-1' },
    })

    const event = traced.find(e => e.kind === 'agent.instructions')
    expect(event).toBeDefined()
    expect(event!.actor).toBe('ai')
    expect(event!.traceId).toBe('turn-trace-1')
    expect(event!.parentSpanId).toBe('turn-span-1')
    expect(event!.packageId).toBe('test-app')
    expect(event!.status).toBe('ok')
    expect(typeof event!.durationMs).toBe('number')
    expect((event!.data as Record<string, unknown>).agentId).toBe('package:test-app/traced')
  })

  it('trace event emitted with status error on failure, before throw', async () => {
    const agent = makeAgent('traced-fail', {
      name: 'Traced Fail',
      instructions: async () => { throw new Error('boom') },
    })
    const { mounts, traced } = makeMocks(dir, { agents: [agent] })
    const profile = await mounts.resolveProfile('package:test-app/traced-fail')

    await expect(profile.buildInstructions({
      workspacePath: dir,
      skillCatalog: [],
      selectedSkillsSection: null,
      request: { messages: [] as any },
      trace: { traceId: 'trace-2', spanId: 'span-2' },
    })).rejects.toThrow()

    const event = traced.find(e => e.kind === 'agent.instructions')
    expect(event).toBeDefined()
    expect(event!.status).toBe('error')
    expect(event!.traceId).toBe('trace-2')
    expect(event!.parentSpanId).toBe('span-2')
  })
})
