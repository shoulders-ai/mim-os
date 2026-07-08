import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { findWorkspaceRoot, parseArgs, runCli } from '@main/cli.js'
import type { PermissionApprovalRequest } from '@main/security/gate.js'
import { recordServeDeniedRequest } from '@main/serve/denials.js'

describe('mim CLI', () => {
  let dir: string
  let stdout: string[]
  let stderr: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-cli-'))
    stdout = []
    stderr = []
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function io(cwd = dir, stdin?: string, options: {
    isTTY?: boolean
    confirmApproval?: (request: PermissionApprovalRequest) => Promise<boolean>
    runMcp?: () => Promise<number>
    runServe?: (options: { workspacePath: string; host: string; port: number; home?: string }) => Promise<number>
    platform?: NodeJS.Platform
    spawn?: any
    home?: string
  } = {}) {
    return {
      cwd,
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      stdin: stdin === undefined ? undefined : async () => stdin,
      isTTY: options.isTTY,
      confirmApproval: options.confirmApproval,
      runMcp: options.runMcp,
      runServe: options.runServe,
      platform: options.platform,
      spawn: options.spawn,
      home: options.home,
    }
  }

  it('parses global workspace and json flags', () => {
    expect(parseArgs(['--workspace', 'demo', '--json', 'status'])).toEqual({
      command: 'status',
      args: [],
      workspace: 'demo',
      json: true,
      yes: false,
    })
  })

  it('parses the explicit approval flag', () => {
    expect(parseArgs(['tool', 'fs.delete', '{"path":"a.md"}', '--yes'])).toEqual({
      command: 'tool',
      args: ['fs.delete', '{"path":"a.md"}'],
      workspace: undefined,
      json: false,
      yes: true,
    })
  })

  it('preserves external command flags after the go separator', () => {
    expect(parseArgs(['go', '--workspace', 'demo', '--', 'agent', '--json', '--workspace', 'inner'])).toEqual({
      command: 'go',
      args: ['--', 'agent', '--json', '--workspace', 'inner'],
      workspace: 'demo',
      json: false,
      yes: false,
    })
  })

  it('reports a missing workspace flag value', async () => {
    const code = await runCli(['status', '--workspace'], io())

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('Missing value for --workspace')
  })

  it('finds a workspace root by walking upward', () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: demo\n')
    const nested = join(dir, 'a/b/c')
    expect(findWorkspaceRoot(nested)).toBe(dir)
  })

  it('initializes a workspace', async () => {
    const code = await runCli(['init', '--name', 'demo'], io())

    expect(code).toBe(0)
    expect(existsSync(join(dir, 'mim.yaml'))).toBe(true)
    expect(readFileSync(join(dir, 'mim.yaml'), 'utf-8')).toContain('name: demo')
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    expect(stdout.join('')).toContain('initialized')
  })

  it('orients the current workspace', async () => {
    await runCli(['init', '--name', 'demo'], io())
    stdout = []

    const code = await runCli(['orient'], io())

    expect(code).toBe(0)
    expect(stdout.join('')).toContain('Workspace context: demo')
    expect(existsSync(join(dir, '.mim', 'agent-context.md'))).toBe(true)
  })

  it('appends and reads log entries', async () => {
    await runCli(['init', '--name', 'demo'], io())

    expect(await runCli(['log', 'Finished', 'review'], io())).toBe(0)
    stdout = []
    expect(await runCli(['log', '--read'], io())).toBe(0)

    expect(stdout.join('')).toContain('[user] Finished review')
  })

  it('runs a generic tool with JSON params', async () => {
    await runCli(['init', '--name', 'demo'], io())
    stdout = []

    const code = await runCli(['tool', 'workspace.info', '{}', '--json'], io())

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout.join(''))
    expect(parsed.name).toBe('demo')
  })

  it('runs generic tool calls as the AI actor', async () => {
    await runCli(['init', '--name', 'demo'], io())
    stdout = []

    const code = await runCli(['tool', 'workspace.info', '{}', '--json'], io())

    expect(code).toBe(0)
    const tracesDir = join(dir, '.mim', 'traces')
    const lines = readdirSync(tracesDir).filter(f => f.endsWith('.jsonl')).sort()
      .flatMap(f => readFileSync(join(tracesDir, f), 'utf-8').trim().split('\n').map(line => JSON.parse(line)))
    expect(lines).toContainEqual(expect.objectContaining({
      actor: 'ai',
      kind: 'tool.call',
      tool: 'workspace.info',
    }))
  })

  it('denies high-risk generic tool calls by default in non-interactive mode', async () => {
    await runCli(['init', '--name', 'demo'], io())
    writeFileSync(join(dir, 'victim.txt'), 'delete me')
    stdout = []

    const code = await runCli(['tool', 'fs.delete', '{"path":"victim.txt"}'], io())

    expect(code).toBe(1)
    expect(existsSync(join(dir, 'victim.txt'))).toBe(true)
    expect(stderr.join('')).toContain('Permission denied')
  })

  it('allows high-risk generic tool calls with --yes', async () => {
    await runCli(['init', '--name', 'demo'], io())
    writeFileSync(join(dir, 'victim.txt'), 'delete me')
    stdout = []

    const code = await runCli(['tool', 'fs.delete', '{"path":"victim.txt"}', '--yes'], io())

    expect(code).toBe(0)
    expect(existsSync(join(dir, 'victim.txt'))).toBe(false)
  })

  it('prompts for high-risk generic tool calls on a TTY', async () => {
    await runCli(['init', '--name', 'demo'], io())
    writeFileSync(join(dir, 'victim.txt'), 'delete me')
    const prompts: string[] = []
    stdout = []

    const code = await runCli(['tool', 'fs.delete', '{"path":"victim.txt"}'], io(dir, undefined, {
      isTTY: true,
      confirmApproval: async (request) => {
        prompts.push(request.toolName)
        return true
      },
    }))

    expect(code).toBe(0)
    expect(prompts).toEqual(['fs.delete'])
    expect(existsSync(join(dir, 'victim.txt'))).toBe(false)
  })

  it('runs a generic tool with JSON params from stdin', async () => {
    await runCli(['init', '--name', 'demo'], io())
    stdout = []

    const code = await runCli(['tool', 'workspace.info', '--stdin', '--json'], io(dir, '{}\n'))

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout.join(''))
    expect(parsed.name).toBe('demo')
  })

  it('starts the MCP stdio bridge without opening a headless workspace', async () => {
    const code = await runCli(['mcp'], io(dir, undefined, {
      runMcp: async () => 7,
    }))

    expect(code).toBe(7)
    expect(stderr.join('')).toBe('')
  })

  it('stores, reports, and clears a shared workspace client token', async () => {
    const home = join(dir, 'home')

    const set = await runCli(['shared-workspace', 'token', 'set', 'team-server', 'tok_remote', '--json'], io(dir, undefined, { home }))
    expect(set).toBe(0)
    const keysPath = join(home, '.mim', 'keys.env')
    expect(readFileSync(keysPath, 'utf-8')).toContain('MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN=tok_remote')
    expect(stdout.join('')).not.toContain('tok_remote')
    expect(JSON.parse(stdout.join(''))).toEqual({
      saved: true,
      id: 'team-server',
      key: 'MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN',
    })

    stdout = []
    const setFromStdin = await runCli(['shared-workspace', 'token', 'set', 'team-server', '--stdin', '--json'], io(dir, 'tok_stdin\n', { home }))
    expect(setFromStdin).toBe(0)
    expect(readFileSync(keysPath, 'utf-8')).toContain('MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN=tok_stdin')
    expect(stdout.join('')).not.toContain('tok_stdin')

    stdout = []
    const status = await runCli(['shared-workspace', 'token', 'status', 'team-server', '--json'], io(dir, undefined, { home }))
    expect(status).toBe(0)
    expect(JSON.parse(stdout.join(''))).toEqual({
      configured: true,
      id: 'team-server',
      key: 'MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN',
    })

    stdout = []
    const clear = await runCli(['shared-workspace', 'token', 'clear', 'team-server', '--json'], io(dir, undefined, { home }))
    expect(clear).toBe(0)
    expect(JSON.parse(stdout.join(''))).toEqual({
      cleared: true,
      id: 'team-server',
      key: 'MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN',
    })
    expect(readFileSync(keysPath, 'utf-8')).not.toContain('MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN')
  })

  it('creates and lists serve tokens for the selected workspace', async () => {
    await runCli(['init', '--name', 'demo'], io())
    stdout = []

    const create = await runCli(['serve', 'token', 'create', '--name', 'anna', '--json'], io(dir, undefined, {
      home: join(dir, 'home'),
    }))
    expect(create).toBe(0)
    const created = JSON.parse(stdout.join('')) as { token: string; record: { id: string; name: string }; snippets: { claude: string } }
    expect(created.token).toMatch(/^mim_serve_/)
    expect(created.record).toMatchObject({ name: 'anna' })
    expect(created.snippets.claude).toContain('claude mcp add')

    stdout = []
    const list = await runCli(['serve', 'token', 'list', '--json'], io(dir, undefined, {
      home: join(dir, 'home'),
    }))
    expect(list).toBe(0)
    const listed = JSON.parse(stdout.join('')) as { callers: Array<{ id: string; name: string; hash?: string }> }
    expect(listed.callers).toEqual([expect.objectContaining({ id: created.record.id, name: 'anna' })])
    expect(listed.callers[0].hash).toBeUndefined()
  })

  it('creates, lists, and revokes serve invites for human desktop join', async () => {
    await runCli(['init', '--name', 'demo'], io())
    const home = join(dir, 'home')
    stdout = []

    const create = await runCli([
      'serve',
      'invite',
      'create',
      '--name',
      'anna',
      '--url',
      'https://mim.example.com/mcp',
      '--workspace-id',
      'team-server',
      '--workspace-name',
      'HTA Model',
      '--namespaces',
      'issues.*,knowledge.*',
      '--json',
    ], io(dir, undefined, { home }))
    expect(create).toBe(0)
    const created = JSON.parse(stdout.join('')) as {
      invite: string
      deepLink: string
      record: { id: string; name: string; hash: string; workspaceName: string }
    }
    expect(created.invite).toMatch(/^mim-invite-/)
    expect(created.deepLink).toMatch(/^mim:\/\/join\//)
    expect(created.record).toMatchObject({ name: 'anna', workspaceName: 'HTA Model' })

    stdout = []
    const list = await runCli(['serve', 'invite', 'list', '--json'], io(dir, undefined, { home }))
    expect(list).toBe(0)
    const listed = JSON.parse(stdout.join('')) as { invites: Array<{ id: string; hash?: string; invite?: string; name: string }> }
    expect(listed.invites).toEqual([expect.objectContaining({ id: created.record.id, name: 'anna' })])
    expect(listed.invites[0].hash).toBeUndefined()
    expect(listed.invites[0].invite).toBeUndefined()

    stdout = []
    const revoke = await runCli(['serve', 'invite', 'revoke', created.record.id, '--json'], io(dir, undefined, { home }))
    expect(revoke).toBe(0)
    expect(JSON.parse(stdout.join(''))).toEqual({ revoked: created.record.id })
  })

  it('starts serve mode through the injected runner with host and port', async () => {
    await runCli(['init', '--name', 'demo'], io())
    let seen: { workspacePath: string; host: string; port: number; home?: string } | null = null

    const code = await runCli(['serve', '--host', '0.0.0.0', '--port', '4780'], io(dir, undefined, {
      home: join(dir, 'home'),
      runServe: async (options) => {
        seen = options
        return 11
      },
    }))

    expect(code).toBe(11)
    expect(seen).toEqual({
      workspacePath: dir,
      host: '0.0.0.0',
      port: 4780,
      home: join(dir, 'home'),
    })
  })

  it('lists serve denied requests for operator review', async () => {
    await runCli(['init', '--name', 'demo'], io())
    const home = join(dir, 'home')
    recordServeDeniedRequest({
      home,
      workspacePath: dir,
      now: () => new Date('2026-07-08T10:00:00.000Z'),
      event: {
        decision: 'denied',
        tool: 'fs.write',
        actor: 'remote',
        principal: 'caller_anna',
        callerName: 'anna',
        transport: 'mcp-http',
        category: 'write',
        risk: 'medium',
        mode: 'normal',
        reason: 'Grant does not include mutate effects',
      },
    })
    stdout = []

    const code = await runCli(['serve', 'denials', 'list', '--json'], io(dir, undefined, { home }))

    expect(code).toBe(0)
    const parsed = JSON.parse(stdout.join('')) as { deniedRequests: Array<{ tool: string; principal?: string }> }
    expect(parsed.deniedRequests).toEqual([
      expect.objectContaining({ tool: 'fs.write', principal: 'caller_anna' }),
    ])
  })

  it('migrates selected structured app state into the served workspace', async () => {
    await runCli(['init', '--name', 'demo'], io())
    const source = join(dir, 'source-workspace')
    mkdirSync(join(source, '.mim/packages/board/data/collections/issues'), { recursive: true })
    writeFileSync(join(source, '.mim/packages/board/data/collections/issues/issue-1.json'), '{"title":"Existing"}')
    stdout = []

    const code = await runCli(['serve', 'state', 'migrate', '--from', source, '--apps', 'board', '--json'], io())

    expect(code).toBe(0)
    expect(JSON.parse(stdout.join(''))).toMatchObject({ migrated: ['board'] })
    expect(readFileSync(join(dir, '.mim/packages/board/data/collections/issues/issue-1.json'), 'utf-8'))
      .toBe('{"title":"Existing"}')
  })

  it('creates and restores serve backups from the CLI', async () => {
    await runCli(['init', '--name', 'demo'], io())
    writeFileSync(join(dir, '.mim/settings.json'), '{"traceRetentionDays":14}')
    const backupDir = join(dir, 'backup')
    stdout = []

    const create = await runCli(['serve', 'backup', 'create', '--output', backupDir, '--json'], io())

    expect(create).toBe(0)
    expect(JSON.parse(stdout.join(''))).toMatchObject({ copied: expect.arrayContaining(['settings.json']) })

    const restoreTarget = join(dir, 'restored')
    stdout = []
    const restore = await runCli(['serve', 'backup', 'restore', '--from', backupDir, '--workspace', restoreTarget, '--json'], io())

    expect(restore).toBe(0)
    expect(JSON.parse(stdout.join(''))).toMatchObject({ restored: expect.arrayContaining(['settings.json']) })
    expect(readFileSync(join(restoreTarget, '.mim/settings.json'), 'utf-8')).toBe('{"traceRetentionDays":14}')
  })

  it('runs mim go commands through the shell on Windows so .cmd shims resolve', async () => {
    await runCli(['init', '--name', 'demo'], io())
    const child = {
      on(event: string, cb: (code?: number) => void) {
        if (event === 'exit') cb(0)
        return child
      },
    }
    const spawnCalls: unknown[][] = []

    const code = await runCli(['go', '--', 'codex', '--help'], io(dir, undefined, {
      platform: 'win32',
      spawn: ((...args: unknown[]) => {
        spawnCalls.push(args)
        return child
      }) as typeof spawn,
    }))

    expect(code).toBe(0)
    expect(spawnCalls.at(-1)?.[0]).toBe('codex')
    expect(spawnCalls.at(-1)?.[2]).toMatchObject({ cwd: dir, stdio: 'inherit', shell: true })
  })

  it('reports command errors on stderr', async () => {
    const code = await runCli(['tool'], io())

    expect(code).toBe(1)
    expect(stderr.join('')).toContain('Usage: mim tool')
  })
})
