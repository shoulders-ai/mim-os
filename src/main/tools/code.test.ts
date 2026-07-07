import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry, type ToolRegistry } from '@main/tools/registry.js'
import {
  classifyProductKind,
  detectProducts,
  rankProducts,
  registerCodeTools,
  resolveHarnessPath,
  rewriteArgv,
  shouldRewriteArgv,
  snapshotWorkspace,
  truncateTail,
  type CodeToolDeps,
  type ProductEntry,
} from '@main/tools/code.js'
import { getToolPolicy } from '@main/security/gate.js'
import { CORE_TOOL_POLICY_ROWS } from '@main/tools/toolPolicy.js'
import { detectToolchain, resetToolchainDetection } from '@main/toolchain/toolchain.js'

describe('code.run tool', () => {
  let dir: string
  let tools: ToolRegistry
  const ctx = { actor: 'ai' as const, sessionId: 'test-session' }

  function createTools(deps?: CodeToolDeps) {
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerCodeTools(tools, deps)
  }

  function fakeResolveInterpreter(entries: Record<string, { id: string; binPath: string }>) {
    return async (name: string) => {
      const normalized = name.toLowerCase().replace(/\.exe$/i, '')
      const entry = entries[normalized]
      if (!entry) return null
      return { id: entry.id, bin: name, installed: true, binPath: entry.binPath, version: '1.0' } as any
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-code-test-'))
    mkdirSync(join(dir, '.mim'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // Rejection cases
  // -------------------------------------------------------------------------

  describe('rejections', () => {
    it('rejects when no workspace is open', async () => {
      tools = createToolRegistry(createTraceLog())
      // No workspace set
      registerCodeTools(tools, {
        resolveInterpreter: fakeResolveInterpreter({ node: { id: 'rscript', binPath: '/usr/bin/node' } }),
      })

      await expect(tools.call('code.run', { argv: ['node', 'test.js'] }, ctx))
        .rejects.toThrow('No workspace open')
    })

    it('rejects empty argv', async () => {
      createTools({
        resolveInterpreter: fakeResolveInterpreter({}),
      })
      await expect(tools.call('code.run', { argv: [] }, ctx))
        .rejects.toThrow('argv must be a non-empty array')
    })

    it('rejects non-string argv elements', async () => {
      createTools({
        resolveInterpreter: fakeResolveInterpreter({}),
      })
      await expect(tools.call('code.run', { argv: ['rscript', 123 as any] }, ctx))
        .rejects.toThrow('argv must contain only strings')
    })

    it('rejects unknown interpreter', async () => {
      createTools({
        resolveInterpreter: fakeResolveInterpreter({}),
      })
      await expect(tools.call('code.run', { argv: ['unknown-bin', 'script.R'] }, ctx))
        .rejects.toThrow('Interpreter not found or not installed')
    })

    it('rejects interpreter not in allowlist', async () => {
      createTools({
        resolveInterpreter: fakeResolveInterpreter({
          python3: { id: 'python3', binPath: '/usr/bin/python3' },
        }),
        readSetting: (key) => {
          if (key === 'codeInterpreters') return ['rscript', 'r', 'quarto']
          return undefined
        },
      })
      await expect(tools.call('code.run', { argv: ['python3', 'script.py'] }, ctx))
        .rejects.toThrow("Interpreter 'python3' is not in the codeInterpreters allowlist")
    })
  })

  // -------------------------------------------------------------------------
  // Spawn behavior (using real `node` as a fake interpreter)
  // -------------------------------------------------------------------------

  describe('execution with real node', () => {
    const nodePath = process.execPath

    function createNodeTools(overrides?: Partial<CodeToolDeps>) {
      createTools({
        resolveInterpreter: fakeResolveInterpreter({
          node: { id: 'rscript', binPath: nodePath },
        }),
        readSetting: () => ['rscript', 'r', 'quarto'],
        resolveHarnessPath: () => null,
        generateId: () => 'test-run-id',
        ...overrides,
      })
    }

    it('spawns detected absolute path with shell:false and cwd=workspace', async () => {
      writeFileSync(join(dir, 'hello.js'), 'console.log("hello from workspace")')
      createNodeTools()

      const result = await tools.call('code.run', { argv: ['node', 'hello.js'] }, ctx) as any

      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.stdout).toContain('hello from workspace')
      expect(result.runId).toBe('test-run-id')
    })

    it('sets MIM_RUN_DIR env for the child process', async () => {
      writeFileSync(join(dir, 'env.js'), 'console.log(process.env.MIM_RUN_DIR)')
      createNodeTools()

      const result = await tools.call('code.run', { argv: ['node', 'env.js'] }, ctx) as any

      expect(result.stdout).toContain('.mim/code-runs/test-run-id')
    })

    it('timeout kills and reports timedOut', async () => {
      writeFileSync(join(dir, 'slow.js'), 'setTimeout(() => {}, 60000)')
      createNodeTools()

      const result = await tools.call('code.run', {
        argv: ['node', 'slow.js'],
        timeout_ms: 1_000,
      }, ctx) as any

      expect(result.timedOut).toBe(true)
      expect(result.exitCode).toBeNull()
    }, 10_000)

    it('captures non-zero exit code', async () => {
      writeFileSync(join(dir, 'fail.js'), 'process.exit(42)')
      createNodeTools()

      const result = await tools.call('code.run', { argv: ['node', 'fail.js'] }, ctx) as any

      expect(result.exitCode).toBe(42)
      expect(result.timedOut).toBe(false)
    })

    it('captures stderr output', async () => {
      writeFileSync(join(dir, 'err.js'), 'console.error("something went wrong")')
      createNodeTools()

      const result = await tools.call('code.run', { argv: ['node', 'err.js'] }, ctx) as any

      expect(result.stderr).toContain('something went wrong')
    })

    it('detects new files as products', async () => {
      writeFileSync(join(dir, 'create.js'), `
        const fs = require('fs');
        fs.writeFileSync(require('path').join(process.cwd(), 'output.png'), 'fake-image');
      `)
      createNodeTools()

      const result = await tools.call('code.run', { argv: ['node', 'create.js'] }, ctx) as any

      expect(result.products.length).toBeGreaterThan(0)
      const pngProduct = result.products.find((p: any) => p.path.endsWith('output.png'))
      expect(pngProduct).toBeDefined()
      expect(pngProduct.kind).toBe('image')
      // Workspace-relative slash path: absolute paths would bounce chat chips
      // and editor_open to the native OS viewer instead of the in-app tab.
      expect(pngProduct.path).toBe('output.png')
    })

    it('detects modified files as products', async () => {
      const existingFile = join(dir, 'data.csv')
      writeFileSync(existingFile, 'old data')
      // Wait a moment so mtime differs
      writeFileSync(join(dir, 'modify.js'), `
        const fs = require('fs');
        const path = require('path');
        // Ensure different mtime
        setTimeout(() => {
          fs.writeFileSync(path.join(process.cwd(), 'data.csv'), 'new data with more content');
        }, 50);
      `)
      createNodeTools()

      const result = await tools.call('code.run', { argv: ['node', 'modify.js'] }, ctx) as any

      const csvProduct = result.products.find((p: any) => p.path.endsWith('data.csv'))
      expect(csvProduct).toBeDefined()
      expect(csvProduct.kind).toBe('table')
      expect(csvProduct.path).toBe('data.csv')
    })

    it('writes run.json with expected shape', async () => {
      writeFileSync(join(dir, 'simple.js'), 'console.log("done")')
      createNodeTools()

      await tools.call('code.run', { argv: ['node', 'simple.js'] }, ctx)

      const runJsonPath = join(dir, '.mim', 'code-runs', 'test-run-id', 'run.json')
      expect(existsSync(runJsonPath)).toBe(true)
      const runJson = JSON.parse(readFileSync(runJsonPath, 'utf-8'))
      expect(runJson.argv).toEqual(['node', 'simple.js'])
      expect(runJson.startedAt).toBeDefined()
      expect(typeof runJson.durationMs).toBe('number')
      expect(runJson.exitCode).toBe(0)
      expect(runJson.timedOut).toBe(false)
      expect(Array.isArray(runJson.products)).toBe(true)
    })

    it('returns runDir path in result', async () => {
      writeFileSync(join(dir, 'x.js'), '')
      createNodeTools()

      const result = await tools.call('code.run', { argv: ['node', 'x.js'] }, ctx) as any

      expect(result.runDir).toBe('.mim/code-runs/test-run-id')
    })
  })

  // -------------------------------------------------------------------------
  // Tail truncation
  // -------------------------------------------------------------------------

  describe('tail truncation', () => {
    it('preserves short output unchanged', () => {
      expect(truncateTail('short', 16_000)).toBe('short')
    })

    it('truncates and prepends marker with count', () => {
      const long = 'x'.repeat(20_000)
      const result = truncateTail(long, 16_000)
      expect(result).toContain('[...truncated 4000 chars]')
      expect(result.length).toBe('[...truncated 4000 chars]'.length + 16_000)
    })

    it('ensures total tool output stays under 24k chars', async () => {
      const bigOutput = 'x'.repeat(50_000)
      const stdoutTrunc = truncateTail(bigOutput, 16_000)
      const stderrTrunc = truncateTail(bigOutput, 6_000)
      // Total of stdout + stderr tails should be reasonable
      expect(stdoutTrunc.length + stderrTrunc.length).toBeLessThan(24_000)
    })
  })

  // -------------------------------------------------------------------------
  // Product classification and ranking
  // -------------------------------------------------------------------------

  describe('product classification', () => {
    it('classifies image extensions', () => {
      expect(classifyProductKind('plot.png')).toBe('image')
      expect(classifyProductKind('photo.jpg')).toBe('image')
      expect(classifyProductKind('diagram.svg')).toBe('image')
    })

    it('classifies pdf', () => {
      expect(classifyProductKind('report.pdf')).toBe('pdf')
    })

    it('classifies table extensions', () => {
      expect(classifyProductKind('data.csv')).toBe('table')
      expect(classifyProductKind('sheet.tsv')).toBe('table')
    })

    it('classifies html', () => {
      expect(classifyProductKind('output.html')).toBe('html')
    })

    it('classifies text extensions', () => {
      expect(classifyProductKind('notes.md')).toBe('text')
      expect(classifyProductKind('analysis.R')).toBe('text')
    })

    it('classifies unknown as other', () => {
      expect(classifyProductKind('data.rds')).toBe('other')
    })
  })

  describe('product ranking', () => {
    it('ranks image > pdf > table > html > text > other', () => {
      const products: ProductEntry[] = [
        { path: 'a.txt', bytes: 100, kind: 'text' },
        { path: 'b.png', bytes: 200, kind: 'image' },
        { path: 'c.pdf', bytes: 300, kind: 'pdf' },
        { path: 'd.csv', bytes: 50, kind: 'table' },
        { path: 'e.html', bytes: 150, kind: 'html' },
        { path: 'f.rds', bytes: 400, kind: 'other' },
      ]
      const ranked = rankProducts(products)
      expect(ranked[0].kind).toBe('image')
      expect(ranked[1].kind).toBe('pdf')
      expect(ranked[2].kind).toBe('table')
      expect(ranked[3].kind).toBe('html')
      expect(ranked[4].kind).toBe('text')
      expect(ranked[5].kind).toBe('other')
    })
  })

  // -------------------------------------------------------------------------
  // Argv rewrite (R2.3)
  // -------------------------------------------------------------------------

  describe('argv rewrite', () => {
    const rscriptEntry = { id: 'rscript' as const, bin: 'Rscript', installed: true, binPath: '/usr/bin/Rscript' }
    const rEntry = { id: 'r' as const, bin: 'R', installed: true, binPath: '/usr/bin/R' }

    it('rewrites [rscript, file.R] → [binPath, harness, file.R]', () => {
      expect(shouldRewriteArgv(['rscript', 'analysis.R'], true, rscriptEntry)).toBe(true)
      expect(rewriteArgv(['rscript', 'analysis.R'], '/usr/bin/Rscript', '/path/to/mim-run.R'))
        .toEqual(['/usr/bin/Rscript', '/path/to/mim-run.R', 'analysis.R'])
    })

    it('rewrites case-insensitive .R extension', () => {
      expect(shouldRewriteArgv(['Rscript', 'test.r'], true, rscriptEntry)).toBe(true)
    })

    it('does NOT rewrite when capture_plots is false', () => {
      expect(shouldRewriteArgv(['rscript', 'analysis.R'], false, rscriptEntry)).toBe(false)
    })

    it('does NOT rewrite when argv has flags (more than 2 tokens)', () => {
      expect(shouldRewriteArgv(['rscript', '--vanilla', 'analysis.R'], true, rscriptEntry)).toBe(false)
    })

    it('does NOT rewrite when file is not .R', () => {
      expect(shouldRewriteArgv(['rscript', 'analysis.py'], true, rscriptEntry)).toBe(false)
    })

    it('does NOT rewrite for non-rscript interpreters', () => {
      expect(shouldRewriteArgv(['r', 'analysis.R'], true, rEntry)).toBe(false)
    })

    it('does NOT rewrite -e inline code', () => {
      expect(shouldRewriteArgv(['rscript', '-e'], true, rscriptEntry)).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Snapshot and products exclusions
  // -------------------------------------------------------------------------

  describe('workspace snapshot', () => {
    it('skips .git and node_modules directories', () => {
      mkdirSync(join(dir, '.git'), { recursive: true })
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, '.git', 'config'), 'git-data')
      writeFileSync(join(dir, 'node_modules', 'pkg.json'), '{}')
      writeFileSync(join(dir, 'src', 'main.ts'), 'code')

      const snapshot = snapshotWorkspace(dir)

      expect(snapshot.has(join(dir, '.git', 'config'))).toBe(false)
      expect(snapshot.has(join(dir, 'node_modules', 'pkg.json'))).toBe(false)
      expect(snapshot.has(join(dir, 'src', 'main.ts'))).toBe(true)
    })

    it('skips .mim directory', () => {
      mkdirSync(join(dir, '.mim', 'data'), { recursive: true })
      writeFileSync(join(dir, '.mim', 'data', 'file.json'), '{}')

      const snapshot = snapshotWorkspace(dir)

      expect(snapshot.has(join(dir, '.mim', 'data', 'file.json'))).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Gate policy entry
  // -------------------------------------------------------------------------

  describe('gate and policy integration', () => {
    it('has TOOL_POLICIES entry for code.run', () => {
      const policy = getToolPolicy('code.run')
      expect(policy.category).toBe('system')
      expect(policy.risk).toBe('high')
      expect(policy.targetParam).toBe('argv')
    })

    it('has CORE_TOOL_POLICY_ROWS entry for code.run', () => {
      const row = CORE_TOOL_POLICY_ROWS.find(r => r.id === 'code.run')
      expect(row).toBeDefined()
      expect(row!.domain).toBe('code')
      expect(row!.toolIds).toContain('code.run')
      // code.run no longer has an AI tool key — the bash key is on the shell.run row
      expect(row!.aiToolKeys).toBeUndefined()
      expect(row!.risk).toBe('sensitive')
    })
  })

  // -------------------------------------------------------------------------
  // R-dependent integration test (skipped when R is not installed)
  // -------------------------------------------------------------------------

  describe('R integration', async () => {
    let rscriptDetected = false
    try {
      resetToolchainDetection()
      const entries = await detectToolchain()
      const rscript = entries.find(e => e.id === 'rscript')
      rscriptDetected = rscript?.installed === true
    } catch {
      rscriptDetected = false
    } finally {
      resetToolchainDetection()
    }

    describe.skipIf(!rscriptDetected)('with real Rscript', () => {
      it('runs plot(1:10) and produces a plot-01.png product', async () => {
        writeFileSync(join(dir, 'plot-test.R'), 'plot(1:10)')

        createTools({
          generateId: () => 'r-integration-run',
          readSetting: () => ['rscript', 'r', 'quarto'],
        })

        const result = await tools.call('code.run', {
          argv: ['Rscript', 'plot-test.R'],
          timeout_ms: 30_000,
        }, ctx) as any

        expect(result.exitCode).toBe(0)
        expect(result.timedOut).toBe(false)
        const plotProduct = result.products.find((p: any) => p.path.includes('plot-01.png'))
        expect(plotProduct).toBeDefined()
        expect(plotProduct.kind).toBe('image')
        expect(plotProduct.path).toBe('.mim/code-runs/r-integration-run/plot-01.png')
      }, 60_000)
    })
  })
})
