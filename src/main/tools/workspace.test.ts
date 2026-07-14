import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerWorkspaceTools } from '@main/tools/workspace.js'
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { upsertSharedWorkspaceConnection } from '@main/workspace/sharedWorkspaceConnections.js'
import { readSharedWorkspaceConfig } from '@main/workspace/sharedWorkspaceLinks.js'
import { writeSharedWorkspaceToken } from '@main/workspace/sharedWorkspaceTokens.js'

describe('Workspace tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-ws-test-'))
    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    registerWorkspaceTools(tools)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('workspace.open sets workspace path and creates .mim/', async () => {
    await tools.call('workspace.open', { path: dir }, ctx)
    expect(tools.getWorkspacePath()).toBe(dir)
    expect(existsSync(join(dir, '.mim', 'workspace.json'))).toBe(true)
  })

  it('workspace.open creates workspace.json with correct shape', async () => {
    await tools.call('workspace.open', { path: dir }, ctx)
    const config = JSON.parse(readFileSync(join(dir, '.mim', 'workspace.json'), 'utf-8'))
    expect(config.name).toBe(dir.split('/').pop())
    expect(config.created).toBeDefined()
  })

  it('workspace.open throws for non-existent path', async () => {
    await expect(
      tools.call('workspace.open', { path: '/nonexistent/path' }, ctx)
    ).rejects.toThrow('does not exist')
  })

  it('can switch workspaces after the previously active workspace was deleted', async () => {
    const next = mkdtempSync(join(tmpdir(), 'mim-ws-next-'))
    try {
      await tools.call('workspace.open', { path: dir }, ctx)
      rmSync(dir, { recursive: true, force: true })

      await tools.call('workspace.open', { path: next }, ctx)

      expect(tools.getWorkspacePath()).toBe(next)
      expect(existsSync(join(next, '.mim', 'workspace.json'))).toBe(true)
    } finally {
      rmSync(next, { recursive: true, force: true })
    }
  })

  it('workspace.info returns open: false when no workspace', async () => {
    const result = await tools.call('workspace.info', {}, ctx) as { open: boolean }
    expect(result.open).toBe(false)
  })

  it('workspace.info returns config after open', async () => {
    await tools.call('workspace.open', { path: dir }, ctx)
    const result = await tools.call('workspace.info', {}, ctx) as { open: boolean; path: string; config: { name: string } }
    expect(result.open).toBe(true)
    expect(result.path).toBe(dir)
    expect(result.config.name).toBeDefined()
  })

  it('workspace.open writes the runtime agent context file', async () => {
    await tools.call('workspace.open', { path: dir }, ctx)
    expect(existsSync(join(dir, '.mim', 'agent-context.md'))).toBe(true)
  })

  it('workspace.orient regenerates and returns the agent context', async () => {
    await tools.call('workspace.open', { path: dir }, ctx)
    const result = await tools.call('workspace.orient', {}, ctx) as { path: string; content: string }
    expect(result.path).toBe(join(dir, '.mim', 'agent-context.md'))
    expect(result.content.toLowerCase()).toContain('generated')
  })

  it('workspace.orient throws when no workspace is open', async () => {
    const fresh = createToolRegistry(createTraceLog())
    registerWorkspaceTools(fresh)
    await expect(fresh.call('workspace.orient', {}, ctx)).rejects.toThrow('No workspace open')
  })
})

describe('Workspace contract tools (status / init / info)', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-ws-contract-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerWorkspaceTools(tools)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('workspace.status on a fresh workspace reports not initialized with all three missing', async () => {
    const result = await tools.call('workspace.status', {}, ctx) as {
      initialized: boolean; missing: string[]; path: string
    }
    expect(result.initialized).toBe(false)
    expect(result.missing.sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'mim.yaml'])
    expect(result.path).toBe(dir)
  })

  it('workspace.init makes workspace.status report initialized with all files present', async () => {
    await tools.call('workspace.init', {}, ctx)
    const result = await tools.call('workspace.status', {}, ctx) as { initialized: boolean }
    expect(result.initialized).toBe(true)
    expect(existsSync(join(dir, 'mim.yaml'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)
  })

  it('workspace.init writes mim.yaml with name = folder basename by default', async () => {
    await tools.call('workspace.init', {}, ctx)
    const text = readFileSync(join(dir, 'mim.yaml'), 'utf-8')
    expect(text).toContain(`name: ${dir.split('/').pop()}`)
  })

  it('workspace.init honors an explicit { name } override', async () => {
    await tools.call('workspace.init', { name: 'custom-name' }, ctx)
    const text = readFileSync(join(dir, 'mim.yaml'), 'utf-8')
    expect(text).toContain('name: custom-name')
  })

  it('workspace.init adds .mim/ to .gitignore', async () => {
    await tools.call('workspace.init', {}, ctx)
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(gitignore.split('\n')).toContain('.mim/')
  })

  it('open != init: workspace.open does not create the committed contract files', async () => {
    await tools.call('workspace.open', { path: dir }, ctx)
    expect(existsSync(join(dir, 'mim.yaml'))).toBe(false)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false)
    const status = await tools.call('workspace.status', {}, ctx) as { initialized: boolean }
    expect(status.initialized).toBe(false)
  })

  it('workspace.info returns mim.yaml name as authoritative when present', async () => {
    await tools.call('workspace.init', { name: 'authoritative' }, ctx)
    const result = await tools.call('workspace.info', {}, ctx) as { name?: string; config?: { name?: string } }
    const name = result.name ?? result.config?.name
    expect(name).toBe('authoritative')
  })

  it('workspace.info falls back to folder basename when no mim.yaml', async () => {
    await tools.call('workspace.open', { path: dir }, ctx)
    const result = await tools.call('workspace.info', {}, ctx) as { name?: string; config?: { name?: string } }
    const name = result.name ?? result.config?.name
    expect(name).toBe(dir.split('/').pop())
  })

  it('workspace.sharedWorkspace.status reports config and token presence without exposing the token', async () => {
    const oldHome = process.env.HOME
    const home = mkdtempSync(join(tmpdir(), 'mim-ws-home-'))
    process.env.HOME = home
    try {
      writeFileSync(join(dir, 'mim.yaml'), [
        'name: shared-status-test',
        'sharedWorkspace:',
        '  id: team-server',
        '  url: https://mim.example.com/mcp',
        '  namespaces:',
        '    - issues.*',
        '',
      ].join('\n'))
      writeSharedWorkspaceToken('team-server', 'tok_secret', { home })

      const result = await tools.call('workspace.sharedWorkspace.status', {}, ctx)

      expect(result).toEqual({
        configured: true,
        linked: true,
        linkSource: 'mim-yaml',
        id: 'team-server',
        url: 'https://mim.example.com/mcp',
        namespaces: ['issues.*'],
        tokenConfigured: true,
        tokenKey: 'MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN',
        connections: [],
      })
      expect(JSON.stringify(result)).not.toContain('tok_secret')
    } finally {
      if (oldHome === undefined) delete process.env.HOME
      else process.env.HOME = oldHome
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('workspace.sharedWorkspace.status reports user connections separately from folder links', async () => {
    const oldHome = process.env.HOME
    const home = mkdtempSync(join(tmpdir(), 'mim-ws-home-'))
    process.env.HOME = home
    try {
      upsertSharedWorkspaceConnection({
        id: 'team-server',
        name: 'HTA Model',
        url: 'https://mim.example.com/mcp',
        namespaces: ['issues.*', 'knowledge.*'],
      }, {
        home,
        callerName: 'Anna',
        now: () => new Date('2026-07-09T10:00:00.000Z'),
      })
      writeSharedWorkspaceToken('team-server', 'tok_secret', { home })

      const result = await tools.call('workspace.sharedWorkspace.status', {}, ctx)

      expect(result).toEqual({
        configured: false,
        linked: false,
        connections: [{
          id: 'team-server',
          name: 'HTA Model',
          url: 'https://mim.example.com/mcp',
          namespaces: ['issues.*', 'knowledge.*'],
          callerName: 'Anna',
          connectedAt: '2026-07-09T10:00:00.000Z',
          tokenConfigured: true,
          linked: false,
        }],
      })
      expect(JSON.stringify(result)).not.toContain('tok_secret')
    } finally {
      if (oldHome === undefined) delete process.env.HOME
      else process.env.HOME = oldHome
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('workspace.sharedWorkspace.link explicitly links the open folder without editing mim.yaml', async () => {
    const oldHome = process.env.HOME
    const home = mkdtempSync(join(tmpdir(), 'mim-ws-home-'))
    process.env.HOME = home
    try {
      upsertSharedWorkspaceConnection({
        id: 'team-server',
        name: 'HTA Model',
        url: 'https://mim.example.com/mcp',
        namespaces: ['issues.*', 'knowledge.*'],
      }, { home })
      writeSharedWorkspaceToken('team-server', 'tok_secret', { home })

      const result = await tools.call('workspace.sharedWorkspace.link', { id: 'team-server' }, ctx)

      expect(result).toEqual({
        linked: true,
        sharedWorkspace: {
          id: 'team-server',
          name: 'HTA Model',
          url: 'https://mim.example.com/mcp',
          namespaces: ['issues.*', 'knowledge.*'],
        },
      })
      expect(readSharedWorkspaceConfig(dir)).toEqual({
        id: 'team-server',
        name: 'HTA Model',
        url: 'https://mim.example.com/mcp',
        namespaces: ['issues.*', 'knowledge.*'],
      })
      expect(existsSync(join(dir, '.mim', 'shared-workspace.json'))).toBe(true)
      expect(existsSync(join(dir, 'mim.yaml'))).toBe(false)
    } finally {
      if (oldHome === undefined) delete process.env.HOME
      else process.env.HOME = oldHome
      rmSync(home, { recursive: true, force: true })
    }
  })
})
