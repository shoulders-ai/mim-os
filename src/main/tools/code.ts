// code.run tool — execute allowlisted interpreters in the workspace.
//
// Security posture: spawns only toolchain-detected absolute binPaths (D6),
// no shell, workspace cwd, per-run approval gated. See docs/proposals/r-first-class.md §R2.2.

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { extname, join, relative, resolve } from 'path'
import { randomUUID } from 'crypto'
import { atomicWriteJson } from '@main/atomicJson.js'
import { defaultShell } from '@main/platform.js'
import { resolveInterpreter, type ToolchainEntry, type ToolchainDetectDeps } from '@main/toolchain/toolchain.js'
import type { ToolRegistry } from '@main/tools/registry.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodeRunResult {
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
  products: ProductEntry[]
  runId: string
  runDir?: string
}

export interface ProductEntry {
  path: string
  bytes: number
  kind: 'image' | 'pdf' | 'table' | 'html' | 'text' | 'other'
}

export interface CodeToolDeps {
  spawn?: typeof spawn
  generateId?: () => string
  toolchain?: ToolchainDetectDeps
  resolveInterpreter?: (name: string) => Promise<ToolchainEntry | null>
  readSetting?: (key: string) => unknown
  resolveHarnessPath?: () => string | null
  sendTerminalCommand?: (command: string) => void
}

// ---------------------------------------------------------------------------
// Kind mapping (duplicated from renderer fileOpenPolicy — DO NOT import renderer code)
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff', 'tif'])
const PDF_EXTS = new Set(['pdf'])
const TABLE_EXTS = new Set(['csv', 'tsv', 'xls', 'xlsx'])
const HTML_EXTS = new Set(['html', 'htm'])
const TEXT_EXTS = new Set(['txt', 'md', 'log', 'json', 'xml', 'yaml', 'yml', 'r', 'rmd', 'qmd', 'tex'])

export function classifyProductKind(filePath: string): ProductEntry['kind'] {
  const ext = extname(filePath).slice(1).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (PDF_EXTS.has(ext)) return 'pdf'
  if (TABLE_EXTS.has(ext)) return 'table'
  if (HTML_EXTS.has(ext)) return 'html'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
}

// ---------------------------------------------------------------------------
// Product ranking
// ---------------------------------------------------------------------------

const KIND_RANK: Record<ProductEntry['kind'], number> = {
  image: 0,
  pdf: 1,
  table: 2,
  html: 3,
  text: 4,
  other: 5,
}

export function rankProducts(products: ProductEntry[]): ProductEntry[] {
  return [...products].sort((a, b) => {
    const kindDiff = KIND_RANK[a.kind] - KIND_RANK[b.kind]
    if (kindDiff !== 0) return kindDiff
    // Within same kind, we cannot sort by mtime here (no mtime in ProductEntry)
    // so preserve discovery order (newest first from the scan).
    return 0
  })
}

// ---------------------------------------------------------------------------
// Workspace snapshot for product detection
// ---------------------------------------------------------------------------

interface FileSnapshot {
  mtimeMs: number
  size: number
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.mim'])
const MAX_SNAPSHOT_ENTRIES = 30_000
const MAX_PRODUCTS = 50

export function snapshotWorkspace(
  workspacePath: string,
  extraDirs: string[] = [],
): Map<string, FileSnapshot> {
  const snapshot = new Map<string, FileSnapshot>()
  const dirs = [workspacePath, ...extraDirs]

  for (const rootDir of dirs) {
    if (!existsSync(rootDir)) continue
    walkDir(rootDir, workspacePath, snapshot)
    if (snapshot.size >= MAX_SNAPSHOT_ENTRIES) break
  }

  return snapshot
}

function walkDir(dir: string, workspaceRoot: string, snapshot: Map<string, FileSnapshot>): void {
  if (snapshot.size >= MAX_SNAPSHOT_ENTRIES) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (snapshot.size >= MAX_SNAPSHOT_ENTRIES) return
    const fullPath = join(dir, entry)
    // Skip known dirs only at the workspace root level or within walks
    if (SKIP_DIRS.has(entry)) {
      // Allow scanning inside runDir (which is inside .mim)
      continue
    }
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walkDir(fullPath, workspaceRoot, snapshot)
      } else if (stat.isFile()) {
        snapshot.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size })
      }
    } catch {
      // permission errors, broken symlinks — skip
    }
  }
}

export function detectProducts(
  before: Map<string, FileSnapshot>,
  workspacePath: string,
  runDir: string | null,
  runJsonPath: string,
): ProductEntry[] {
  const after = snapshotWorkspace(workspacePath, runDir ? [runDir] : [])

  // Also scan runDir specifically (it's inside .mim which is skipped by default)
  if (runDir && existsSync(runDir)) {
    scanRunDir(runDir, after)
  }

  const products: ProductEntry[] = []

  for (const [path, afterSnap] of after) {
    if (path === runJsonPath) continue
    const beforeSnap = before.get(path)
    if (!beforeSnap || beforeSnap.mtimeMs !== afterSnap.mtimeMs || beforeSnap.size !== afterSnap.size) {
      products.push({
        // Workspace-relative slash path, like the fs.* tools: consumers
        // (chat product chips, editor_open) route absolute paths to the
        // native OS viewer instead of in-app tabs.
        path: relative(workspacePath, path).split('\\').join('/'),
        bytes: afterSnap.size,
        kind: classifyProductKind(path),
      })
    }
    if (products.length >= MAX_PRODUCTS) break
  }

  return rankProducts(products).slice(0, MAX_PRODUCTS)
}

function scanRunDir(runDir: string, snapshot: Map<string, FileSnapshot>): void {
  try {
    const entries = readdirSync(runDir)
    for (const entry of entries) {
      const fullPath = join(runDir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isFile()) {
          snapshot.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size })
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
}

// ---------------------------------------------------------------------------
// Tail-truncation helpers
// ---------------------------------------------------------------------------

const STDOUT_CAP = 16_000
const STDERR_CAP = 6_000

export function truncateTail(text: string, cap: number): string {
  if (text.length <= cap) return text
  const truncated = text.length - cap
  return `[...truncated ${truncated} chars]` + text.slice(-cap)
}

// ---------------------------------------------------------------------------
// Harness path resolution
// ---------------------------------------------------------------------------

export function resolveHarnessPath(): string | null {
  // Follow the resolveRegistryPath idiom from src/main/ai/ai.ts:
  // try multiple roots, handle asar unpacking.
  const candidates: string[] = []

  const roots = Array.from(new Set([
    process.cwd(),
    resolve(import.meta.dirname, '../..'),
    resolve(import.meta.dirname, '../../..'),
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    typeof process.resourcesPath === 'string' ? resolve(process.resourcesPath, '..') : '',
  ].filter(Boolean)))

  for (const root of roots) {
    candidates.push(join(root, 'resources', 'r', 'mim-run.R'))
  }

  for (const candidate of candidates) {
    // Handle asar: if the path contains 'app.asar', try the unpacked version
    const resolved = candidate.includes('app.asar')
      ? candidate.replace('app.asar', 'app.asar.unpacked')
      : candidate
    if (existsSync(resolved)) return resolved
  }

  // Boot-time warning (logged, never throws)
  return null
}

// ---------------------------------------------------------------------------
// Argv rewrite for R plot-capture harness (R2.3)
// ---------------------------------------------------------------------------

const R_FILE_RE = /\.[Rr]$/

export function shouldRewriteArgv(
  argv: string[],
  capturePlots: boolean,
  resolvedEntry: ToolchainEntry,
): boolean {
  if (!capturePlots) return false
  if (argv.length !== 2) return false
  // argv[0] is the interpreter name/id, argv[1] must end in .R or .r
  if (!R_FILE_RE.test(argv[1])) return false
  // Only rewrite for rscript-ish interpreters
  return resolvedEntry.id === 'rscript'
}

export function rewriteArgv(
  argv: string[],
  rscriptBinPath: string,
  harnessPath: string,
): string[] {
  // [<rscriptBinPath>, <abs mim-run.R>, <script arg>]
  return [rscriptBinPath, harnessPath, argv[1]]
}

// ---------------------------------------------------------------------------
// Process killing helpers
// ---------------------------------------------------------------------------

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      // best-effort
    }
  } else {
    // POSIX: kill the process group (detached spawn creates its own group)
    try {
      process.kill(-child.pid, signal)
    } catch {
      // Process may have already exited
    }
  }
}

// ---------------------------------------------------------------------------
// Shared execution core
// ---------------------------------------------------------------------------

export interface ExecuteCaptureOpts {
  spawnArgv: string[]        // [binary, ...args]
  workspacePath: string
  timeoutMs: number
  runId: string
  runDir: string
  runJsonPath: string
  beforeSnapshot: Map<string, { mtimeMs: number; size: number }>
  spawnFn: typeof spawn
  // Extra fields merged into run.json (e.g. { argv } or { shell, command })
  runJsonExtra?: Record<string, unknown>
}

export function executeCapture(opts: ExecuteCaptureOpts): Promise<CodeRunResult> {
  const {
    spawnArgv,
    workspacePath,
    timeoutMs,
    runId,
    runDir,
    runJsonPath,
    beforeSnapshot,
    spawnFn: spawnFunc,
    runJsonExtra,
  } = opts

  const startedAt = new Date().toISOString()
  const startMs = Date.now()

  return new Promise<CodeRunResult>((resolveResult) => {
    let stdoutBuf = ''
    let stderrBuf = ''
    let timedOut = false
    let finished = false

    const child = spawnFunc(spawnArgv[0], spawnArgv.slice(1), {
      shell: false,
      cwd: workspacePath,
      env: { ...process.env, MIM_RUN_DIR: runDir },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // --- Streaming tail capture ---
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    // --- Timeout handling ---
    const timer = setTimeout(() => {
      if (finished) return
      timedOut = true
      killProcessTree(child, 'SIGTERM')
      // SIGKILL after 2s grace
      setTimeout(() => {
        if (!finished) {
          killProcessTree(child, 'SIGKILL')
        }
      }, 2_000)
    }, timeoutMs)

    child.on('close', (exitCode) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const durationMs = Date.now() - startMs

      // --- Tail truncation ---
      const stdout = truncateTail(stdoutBuf, STDOUT_CAP)
      const stderr = truncateTail(stderrBuf, STDERR_CAP)

      // --- Products capture ---
      const products = detectProducts(beforeSnapshot, workspacePath, runDir, runJsonPath)

      const runResult: CodeRunResult = {
        exitCode: timedOut ? null : (exitCode ?? 0),
        timedOut,
        durationMs,
        stdout,
        stderr,
        products,
        runId,
        runDir: `.mim/code-runs/${runId}`,
      }

      // --- Write run.json atomically ---
      try {
        atomicWriteJson(runJsonPath, {
          ...runJsonExtra,
          startedAt,
          durationMs,
          exitCode: runResult.exitCode,
          timedOut: runResult.timedOut,
          products: runResult.products,
        })
      } catch {
        // Best-effort — don't fail the tool if run.json write fails
      }

      resolveResult(runResult)
    })

    child.on('error', (err) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      const durationMs = Date.now() - startMs

      resolveResult({
        exitCode: null,
        timedOut: false,
        durationMs,
        stdout: truncateTail(stdoutBuf, STDOUT_CAP),
        stderr: truncateTail(stderrBuf + `\nSpawn error: ${err.message}`, STDERR_CAP),
        products: [],
        runId,
        runDir: `.mim/code-runs/${runId}`,
      })
    })
  })
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCodeTools(tools: ToolRegistry, deps?: CodeToolDeps): void {
  const spawnFn = deps?.spawn ?? spawn
  const generateId = deps?.generateId ?? randomUUID
  const resolveInterpreterFn = deps?.resolveInterpreter ?? resolveInterpreter
  const readSettingFn = deps?.readSetting ?? ((key: string) => {
    // Read from workspace settings via the tools registry
    const ws = tools.getWorkspacePath()
    if (!ws) return undefined
    try {
      const settingsFilePath = join(ws, '.mim', 'settings.json')
      if (!existsSync(settingsFilePath)) return undefined
      const raw = JSON.parse(readFileSync(settingsFilePath, 'utf-8'))
      return raw[key]
    } catch {
      return undefined
    }
  })
  const resolveHarnessFn = deps?.resolveHarnessPath ?? resolveHarnessPath

  tools.register({
    name: 'code.run',
    description:
      'Run a script with a detected interpreter (Rscript, R, quarto) in the workspace. ' +
      'Write code to a real file first, then run it — do not pass code inline. ' +
      'Returns exit code, output tails, and files the run created or changed (products). ' +
      'After a successful run that produced a figure, PDF, or table, open the most ' +
      'relevant product with editor_open so the user sees it. ' +
      'If the run fails, read the stderr tail, fix the script, and re-run. ' +
      'The plot-capture harness only applies to the exact two-token form [Rscript, file.R]; ' +
      'any other shape (flags, -e, multiple args) runs verbatim. ' +
      'To render an R Markdown or Quarto document, run quarto render (or rmarkdown::render) on the file, then open the produced PDF.',
    inputSchema: {
      type: 'object',
      properties: {
        argv: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'argv[0]: interpreter basename or catalog id; remaining: args passed verbatim',
        },
        timeout_ms: {
          type: 'number',
          description: 'Execution timeout in milliseconds (default 120000, max 480000)',
        },
        capture_plots: {
          type: 'boolean',
          description: 'Enable plot-capture harness for Rscript file.R form (default true)',
        },
      },
      required: ['argv'],
    },
    execute: async (params) => {
      // --- Rule 1: Validate inputs ---
      const workspacePath = tools.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace open')

      const argv = params.argv as unknown
      if (!Array.isArray(argv) || argv.length === 0) {
        throw new Error('argv must be a non-empty array of strings')
      }
      for (const arg of argv) {
        if (typeof arg !== 'string') {
          throw new Error('argv must contain only strings')
        }
      }
      const argvStrings = argv as string[]

      // --- Rule 2: Resolve interpreter ---
      const entry = await resolveInterpreterFn(argvStrings[0])
      if (!entry || !entry.installed || !entry.binPath) {
        throw new Error(`Interpreter not found or not installed: ${argvStrings[0]}`)
      }

      // Check allowlist from settings
      const allowlist = readSettingFn('codeInterpreters') as string[] | undefined
      const effectiveAllowlist = Array.isArray(allowlist) ? allowlist : ['rscript', 'r', 'quarto']
      if (!effectiveAllowlist.includes(entry.id)) {
        throw new Error(`Interpreter '${entry.id}' is not in the codeInterpreters allowlist`)
      }

      // --- Timeout clamping ---
      const rawTimeout = typeof params.timeout_ms === 'number' ? params.timeout_ms : 120_000
      const timeoutMs = Math.max(1_000, Math.min(480_000, rawTimeout))

      // --- Run setup ---
      const runId = generateId()
      const runDir = join(workspacePath, '.mim', 'code-runs', runId)
      mkdirSync(runDir, { recursive: true })
      const runJsonPath = join(runDir, 'run.json')

      // --- Argv rewrite for R plot-capture (R2.3) ---
      const capturePlots = params.capture_plots !== false
      let spawnArgv: string[]
      let runDirOutput: string | undefined

      if (shouldRewriteArgv(argvStrings, capturePlots, entry)) {
        const harnessPath = resolveHarnessFn()
        if (harnessPath) {
          spawnArgv = rewriteArgv(argvStrings, entry.binPath, harnessPath)
          runDirOutput = runDir
        } else {
          // Harness missing — run verbatim
          spawnArgv = [entry.binPath, ...argvStrings.slice(1)]
          runDirOutput = runDir
        }
      } else {
        spawnArgv = [entry.binPath, ...argvStrings.slice(1)]
        runDirOutput = runDir
      }

      // --- Products: pre-spawn snapshot ---
      const beforeSnapshot = snapshotWorkspace(workspacePath)

      // --- Execute via shared helper ---
      const result = await executeCapture({
        spawnArgv,
        workspacePath,
        timeoutMs,
        runId,
        runDir,
        runJsonPath,
        beforeSnapshot,
        spawnFn,
        runJsonExtra: { argv: argvStrings },
      })

      return result
    },
  })

  // -------------------------------------------------------------------------
  // shell.run — run a shell command with captured output
  // -------------------------------------------------------------------------

  tools.register({
    name: 'shell.run',
    description: 'Run a shell command in the workspace with captured output.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1, description: 'Shell command to execute' },
        terminal: { type: 'boolean', description: 'Type into visible terminal instead of capturing (default false)' },
        timeout_ms: { type: 'number', description: 'Execution timeout in milliseconds (default 120000, max 480000)' },
        capture_plots: { type: 'boolean', description: 'Enable R plot-capture for bare Rscript file.R commands (default true)' },
      },
      required: ['command'],
    },
    execute: async (params) => {
      // Validate
      const workspacePath = tools.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace open')
      const command = params.command
      if (typeof command !== 'string' || command.trim().length === 0) {
        throw new Error('command must be a non-empty string')
      }

      // Terminal mode
      const terminal = params.terminal === true
      if (terminal) {
        const sender = deps?.sendTerminalCommand
        if (!sender) throw new Error('terminal mode requires the desktop app')
        sender(command)
        return { sent: true }
      }

      // Captured mode
      const rawTimeout = typeof params.timeout_ms === 'number' ? params.timeout_ms : 120_000
      const timeoutMs = Math.max(1_000, Math.min(480_000, rawTimeout))
      const capturePlots = params.capture_plots !== false

      // R plot-capture fast path: Rscript file.R exact form
      const rscriptMatch = capturePlots ? /^\s*Rscript\s+(\S+\.[rR])\s*$/.exec(command) : null
      if (rscriptMatch) {
        const entry = await resolveInterpreterFn('rscript')
        if (entry && entry.installed && entry.binPath) {
          const harnessPath = resolveHarnessFn()
          if (harnessPath) {
            // Bypass shell, spawn directly
            const runId = generateId()
            const runDir = join(workspacePath, '.mim', 'code-runs', runId)
            mkdirSync(runDir, { recursive: true })
            const runJsonPath = join(runDir, 'run.json')
            const beforeSnapshot = snapshotWorkspace(workspacePath)
            const spawnArgv = [entry.binPath, harnessPath, rscriptMatch[1]]
            const result = await executeCapture({
              spawnArgv,
              workspacePath,
              timeoutMs,
              runId,
              runDir,
              runJsonPath,
              beforeSnapshot,
              spawnFn,
              runJsonExtra: { shell: true, command },
            })
            return result
          }
        }
      }

      // Normal shell execution
      const shell = defaultShell(process.env, process.platform)
      let spawnArgv: string[]
      if (process.platform === 'win32') {
        spawnArgv = [shell, '/d', '/s', '/c', command]
      } else {
        spawnArgv = [shell, '-lc', command]
      }

      const runId = generateId()
      const runDir = join(workspacePath, '.mim', 'code-runs', runId)
      mkdirSync(runDir, { recursive: true })
      const runJsonPath = join(runDir, 'run.json')
      const beforeSnapshot = snapshotWorkspace(workspacePath)

      const result = await executeCapture({
        spawnArgv,
        workspacePath,
        timeoutMs,
        runId,
        runDir,
        runJsonPath,
        beforeSnapshot,
        spawnFn,
        runJsonExtra: { shell: true, command },
      })
      return result
    },
  })
}
