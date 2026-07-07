import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry, type ToolRegistry } from '@main/tools/registry.js'
import { registerCodeTools, type CodeToolDeps } from '@main/tools/code.js'
import { getToolPolicy } from '@main/security/gate.js'
import { CORE_TOOL_POLICY_ROWS, aiToolKeyEnabled, readToolsPolicy } from '@main/tools/toolPolicy.js'

describe('shell.run tool', () => {
  let dir: string
  let tools: ToolRegistry
  const ctx = { actor: 'ai' as const, sessionId: 'test-session' }

  function fakeResolveInterpreter(entries: Record<string, { id: string; binPath: string }>) {
    return async (name: string) => {
      const normalized = name.toLowerCase().replace(/\.exe$/i, '')
      const entry = entries[normalized]
      if (!entry) return null
      return { id: entry.id, bin: name, installed: true, binPath: entry.binPath, version: '1.0' } as any
    }
  }

  function createTools(deps?: CodeToolDeps) {
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerCodeTools(tools, deps)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-shell-test-'))
    mkdirSync(join(dir, '.mim'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------------
  // Rejections
  // ---------------------------------------------------------------------------

  describe('rejections', () => {
    it('rejects when no workspace is open', async () => {
      tools = createToolRegistry(createTraceLog())
      registerCodeTools(tools)
      await expect(tools.call('shell.run', { command: 'echo hello' }, ctx))
        .rejects.toThrow('No workspace open')
    })

    it('rejects empty command', async () => {
      createTools()
      await expect(tools.call('shell.run', { command: '' }, ctx))
        .rejects.toThrow('command must be a non-empty string')
    })

    it('rejects whitespace-only command', async () => {
      createTools()
      await expect(tools.call('shell.run', { command: '   ' }, ctx))
        .rejects.toThrow('command must be a non-empty string')
    })
  })

  // ---------------------------------------------------------------------------
  // Captured mode — spawn shape
  // ---------------------------------------------------------------------------

  describe('captured spawn shape', () => {
    it('spawns the user login shell with [-lc, command] on POSIX', async () => {
      const spawnCalls: Array<{ file: string; args: string[]; opts: Record<string, unknown> }> = []
      const fakeSpawn: any = (file: string, args: string[], opts: Record<string, unknown>) => {
        spawnCalls.push({ file, args, opts })
        // Return a mock ChildProcess
        const ee = new (require('events').EventEmitter)()
        ee.stdout = new (require('events').EventEmitter)()
        ee.stderr = new (require('events').EventEmitter)()
        ee.pid = 12345
        // Emit close after a tick
        setTimeout(() => ee.emit('close', 0), 10)
        return ee
      }

      createTools({ spawn: fakeSpawn })
      await tools.call('shell.run', { command: 'echo hello' }, ctx)

      expect(spawnCalls.length).toBe(1)
      const call = spawnCalls[0]
      // shell binary should be process.env.SHELL or a default
      expect(call.args).toEqual(['-lc', 'echo hello'])
      expect(call.opts.shell).toBe(false)
      expect(call.opts.cwd).toBe(dir)
      expect((call.opts.env as Record<string, string>).MIM_RUN_DIR).toContain('.mim/code-runs/')
    })
  })

  // ---------------------------------------------------------------------------
  // Real shell integration
  // ---------------------------------------------------------------------------

  describe('real shell integration', () => {
    it('captures stdout from echo', async () => {
      createTools()
      const result = await tools.call('shell.run', { command: 'echo hello' }, ctx) as any
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('hello')
      expect(result.timedOut).toBe(false)
    })

    it('propagates non-zero exit code', async () => {
      createTools()
      const result = await tools.call('shell.run', { command: 'exit 42' }, ctx) as any
      expect(result.exitCode).toBe(42)
    })

    it('detects file-creating commands as products', async () => {
      createTools()
      const result = await tools.call('shell.run', {
        command: `echo "test output" > "${join(dir, 'output.txt')}"`,
      }, ctx) as any
      expect(result.exitCode).toBe(0)
      const product = result.products.find((p: any) => p.path.includes('output.txt'))
      expect(product).toBeDefined()
      expect(product.kind).toBe('text')
    })
  })

  // ---------------------------------------------------------------------------
  // Rscript fast-path rewrite
  // ---------------------------------------------------------------------------

  describe('R plot-capture fast path', () => {
    it('matches exact Rscript file.R shape', async () => {
      const spawnCalls: Array<{ file: string; args: string[] }> = []
      const fakeSpawn: any = (file: string, args: string[], _opts: Record<string, unknown>) => {
        spawnCalls.push({ file, args })
        const ee = new (require('events').EventEmitter)()
        ee.stdout = new (require('events').EventEmitter)()
        ee.stderr = new (require('events').EventEmitter)()
        ee.pid = 123
        setTimeout(() => ee.emit('close', 0), 10)
        return ee
      }

      createTools({
        spawn: fakeSpawn,
        resolveInterpreter: fakeResolveInterpreter({
          rscript: { id: 'rscript', binPath: '/usr/bin/Rscript' },
        }),
        resolveHarnessPath: () => '/path/to/mim-run.R',
      })

      await tools.call('shell.run', { command: 'Rscript analysis/fit.R' }, ctx)

      expect(spawnCalls.length).toBe(1)
      expect(spawnCalls[0].file).toBe('/usr/bin/Rscript')
      expect(spawnCalls[0].args).toEqual(['/path/to/mim-run.R', 'analysis/fit.R'])
    })

    it('does NOT match commands with flags', async () => {
      const spawnCalls: Array<{ file: string; args: string[] }> = []
      const fakeSpawn: any = (file: string, args: string[], _opts: Record<string, unknown>) => {
        spawnCalls.push({ file, args })
        const ee = new (require('events').EventEmitter)()
        ee.stdout = new (require('events').EventEmitter)()
        ee.stderr = new (require('events').EventEmitter)()
        ee.pid = 123
        setTimeout(() => ee.emit('close', 0), 10)
        return ee
      }

      createTools({
        spawn: fakeSpawn,
        resolveInterpreter: fakeResolveInterpreter({
          rscript: { id: 'rscript', binPath: '/usr/bin/Rscript' },
        }),
        resolveHarnessPath: () => '/path/to/mim-run.R',
      })

      await tools.call('shell.run', { command: 'Rscript --vanilla analysis/fit.R' }, ctx)

      // Should go through shell, not direct spawn
      expect(spawnCalls.length).toBe(1)
      expect(spawnCalls[0].file).not.toBe('/usr/bin/Rscript')
    })

    it('does NOT match piped commands', async () => {
      const spawnCalls: Array<{ file: string; args: string[] }> = []
      const fakeSpawn: any = (file: string, args: string[], _opts: Record<string, unknown>) => {
        spawnCalls.push({ file, args })
        const ee = new (require('events').EventEmitter)()
        ee.stdout = new (require('events').EventEmitter)()
        ee.stderr = new (require('events').EventEmitter)()
        ee.pid = 123
        setTimeout(() => ee.emit('close', 0), 10)
        return ee
      }

      createTools({
        spawn: fakeSpawn,
        resolveInterpreter: fakeResolveInterpreter({
          rscript: { id: 'rscript', binPath: '/usr/bin/Rscript' },
        }),
        resolveHarnessPath: () => '/path/to/mim-run.R',
      })

      await tools.call('shell.run', { command: 'Rscript file.R | grep error' }, ctx)

      expect(spawnCalls.length).toBe(1)
      expect(spawnCalls[0].file).not.toBe('/usr/bin/Rscript')
    })

    it('does NOT match chained commands (&&)', async () => {
      const spawnCalls: Array<{ file: string; args: string[] }> = []
      const fakeSpawn: any = (file: string, args: string[], _opts: Record<string, unknown>) => {
        spawnCalls.push({ file, args })
        const ee = new (require('events').EventEmitter)()
        ee.stdout = new (require('events').EventEmitter)()
        ee.stderr = new (require('events').EventEmitter)()
        ee.pid = 123
        setTimeout(() => ee.emit('close', 0), 10)
        return ee
      }

      createTools({
        spawn: fakeSpawn,
        resolveInterpreter: fakeResolveInterpreter({
          rscript: { id: 'rscript', binPath: '/usr/bin/Rscript' },
        }),
        resolveHarnessPath: () => '/path/to/mim-run.R',
      })

      await tools.call('shell.run', { command: 'Rscript file.R && echo done' }, ctx)

      expect(spawnCalls.length).toBe(1)
      expect(spawnCalls[0].file).not.toBe('/usr/bin/Rscript')
    })

    it('does NOT match quoted file arguments', async () => {
      const spawnCalls: Array<{ file: string; args: string[] }> = []
      const fakeSpawn: any = (file: string, args: string[], _opts: Record<string, unknown>) => {
        spawnCalls.push({ file, args })
        const ee = new (require('events').EventEmitter)()
        ee.stdout = new (require('events').EventEmitter)()
        ee.stderr = new (require('events').EventEmitter)()
        ee.pid = 123
        setTimeout(() => ee.emit('close', 0), 10)
        return ee
      }

      createTools({
        spawn: fakeSpawn,
        resolveInterpreter: fakeResolveInterpreter({
          rscript: { id: 'rscript', binPath: '/usr/bin/Rscript' },
        }),
        resolveHarnessPath: () => '/path/to/mim-run.R',
      })

      await tools.call('shell.run', { command: 'Rscript "file name.R"' }, ctx)

      // Quoted path has a space so \S+ won't match — goes through shell
      expect(spawnCalls.length).toBe(1)
      expect(spawnCalls[0].file).not.toBe('/usr/bin/Rscript')
    })

    it('skips fast path when capture_plots is false', async () => {
      const spawnCalls: Array<{ file: string; args: string[] }> = []
      const fakeSpawn: any = (file: string, args: string[], _opts: Record<string, unknown>) => {
        spawnCalls.push({ file, args })
        const ee = new (require('events').EventEmitter)()
        ee.stdout = new (require('events').EventEmitter)()
        ee.stderr = new (require('events').EventEmitter)()
        ee.pid = 123
        setTimeout(() => ee.emit('close', 0), 10)
        return ee
      }

      createTools({
        spawn: fakeSpawn,
        resolveInterpreter: fakeResolveInterpreter({
          rscript: { id: 'rscript', binPath: '/usr/bin/Rscript' },
        }),
        resolveHarnessPath: () => '/path/to/mim-run.R',
      })

      await tools.call('shell.run', { command: 'Rscript analysis/fit.R', capture_plots: false }, ctx)

      expect(spawnCalls.length).toBe(1)
      expect(spawnCalls[0].file).not.toBe('/usr/bin/Rscript')
    })

    it('skips fast path when rscript is not detected', async () => {
      const spawnCalls: Array<{ file: string; args: string[] }> = []
      const fakeSpawn: any = (file: string, args: string[], _opts: Record<string, unknown>) => {
        spawnCalls.push({ file, args })
        const ee = new (require('events').EventEmitter)()
        ee.stdout = new (require('events').EventEmitter)()
        ee.stderr = new (require('events').EventEmitter)()
        ee.pid = 123
        setTimeout(() => ee.emit('close', 0), 10)
        return ee
      }

      createTools({
        spawn: fakeSpawn,
        resolveInterpreter: fakeResolveInterpreter({}), // no rscript
        resolveHarnessPath: () => '/path/to/mim-run.R',
      })

      await tools.call('shell.run', { command: 'Rscript file.R' }, ctx)

      expect(spawnCalls.length).toBe(1)
      expect(spawnCalls[0].file).not.toBe('/usr/bin/Rscript')
    })
  })

  // ---------------------------------------------------------------------------
  // Timeout kill
  // ---------------------------------------------------------------------------

  describe('timeout', () => {
    it('kills process and reports timedOut on timeout', async () => {
      createTools()
      const result = await tools.call('shell.run', {
        command: 'sleep 60',
        timeout_ms: 1000,
      }, ctx) as any
      expect(result.timedOut).toBe(true)
      expect(result.exitCode).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // run.json
  // ---------------------------------------------------------------------------

  describe('run.json', () => {
    it('writes shell:true and command to run.json', async () => {
      createTools()
      const result = await tools.call('shell.run', { command: 'echo hi' }, ctx) as any
      expect(result.runId).toBeDefined()
      const runJsonPath = join(dir, '.mim', 'code-runs', result.runId, 'run.json')
      const runJson = JSON.parse(readFileSync(runJsonPath, 'utf-8'))
      expect(runJson.shell).toBe(true)
      expect(runJson.command).toBe('echo hi')
      expect(typeof runJson.startedAt).toBe('string')
      expect(typeof runJson.durationMs).toBe('number')
      expect(runJson.exitCode).toBe(0)
      expect(runJson.timedOut).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Terminal mode
  // ---------------------------------------------------------------------------

  describe('terminal mode', () => {
    it('calls the injected sender and returns {sent: true}', async () => {
      const sendCalls: string[] = []
      createTools({
        sendTerminalCommand: (cmd) => sendCalls.push(cmd),
      })
      const result = await tools.call('shell.run', { command: 'npm run dev', terminal: true }, ctx) as any
      expect(result).toEqual({ sent: true })
      expect(sendCalls).toEqual(['npm run dev'])
    })

    it('throws clear error when sender dep is absent (headless)', async () => {
      createTools() // no sendTerminalCommand
      await expect(tools.call('shell.run', { command: 'npm run dev', terminal: true }, ctx))
        .rejects.toThrow('terminal mode requires the desktop app')
    })
  })

  // ---------------------------------------------------------------------------
  // Gate + policy
  // ---------------------------------------------------------------------------

  describe('gate and policy', () => {
    it('has a gate policy entry', () => {
      const policy = getToolPolicy('shell.run')
      expect(policy).toBeDefined()
      expect(policy!.category).toBe('system')
      expect(policy!.risk).toBe('high')
      expect(policy!.targetParam).toBe('command')
    })

    it('has a tool policy row with aiToolKeys: bash', () => {
      const row = CORE_TOOL_POLICY_ROWS.find(r => r.id === 'shell.run')
      expect(row).toBeDefined()
      expect(row!.domain).toBe('code')
      expect(row!.label).toBe('Bash')
      expect(row!.toolIds).toEqual(['shell.run'])
      expect(row!.aiToolKeys).toEqual(['bash'])
      expect(row!.risk).toBe('sensitive')
    })

    it('disabling shell.run withholds the bash AI tool key', () => {
      writeFileSync(join(dir, '.mim', 'settings.json'), JSON.stringify({
        tools: { disabled: ['shell.run'] },
      }))
      const policy = readToolsPolicy(dir)
      expect(aiToolKeyEnabled(policy, 'bash')).toBe(false)
    })

    it('disabling shell.run does not break code.run (Render button path)', () => {
      writeFileSync(join(dir, '.mim', 'settings.json'), JSON.stringify({
        tools: { disabled: ['shell.run'] },
      }))
      const policy = readToolsPolicy(dir)
      // code.run still enabled
      expect(policy.isEnabled('code.run')).toBe(true)
    })
  })
})
