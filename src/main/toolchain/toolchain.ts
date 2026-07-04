// Toolchain detection: R, Rscript, Quarto, pandoc, python3.
//
// Resolves each binary through the user's login shell (POSIX) or where.exe
// (Windows) to find absolute paths even when the GUI Electron PATH lacks them.
// Detection is promise-cached; reset for tests. No Electron imports.

import { execFile } from 'child_process'
import { basename, isAbsolute, win32 } from 'path'
import { defaultShell } from '@main/platform.js'

export interface ToolchainEntry {
  id: 'r' | 'rscript' | 'quarto' | 'pandoc' | 'python3'
  bin: string
  installed: boolean
  binPath?: string
  version?: string
}

export type ExecLoginShell = (file: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>
export type ExecVersion = (binPath: string) => Promise<string>

export interface ToolchainDetectDeps {
  exec?: ExecLoginShell
  execVersion?: ExecVersion
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

interface CatalogEntry {
  id: ToolchainEntry['id']
  bin: string
}

export const TOOLCHAIN_CATALOG: CatalogEntry[] = [
  { id: 'r', bin: 'R' },
  { id: 'rscript', bin: 'Rscript' },
  { id: 'quarto', bin: 'quarto' },
  { id: 'pandoc', bin: 'pandoc' },
  { id: 'python3', bin: 'python3' },
]

// --- Default exec boundaries ---

const defaultExec: ExecLoginShell = (shell, args) =>
  new Promise((resolve) => {
    execFile(shell, args, { timeout: 15000 }, (error, stdout) => {
      if (!error) return resolve({ stdout, exitCode: 0 })
      const code = (error as NodeJS.ErrnoException).code
      resolve({ stdout: stdout ?? '', exitCode: typeof code === 'number' ? code : 1 })
    })
  })

const defaultExecVersion: ExecVersion = (binPath) =>
  new Promise((resolve, reject) => {
    execFile(binPath, ['--version'], { timeout: 5000 }, (error, stdout, stderr) => {
      // Resolve with combined stdout+stderr even on non-zero exit —
      // R prints version to stdout, some tools to stderr.
      if (error && !stdout && !stderr) return reject(error)
      resolve((stdout || '') + (stderr || ''))
    })
  })

// --- Detection helpers ---

function detectCommand(
  bin: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { file: string; args: string[] } {
  if (platform === 'win32') return { file: 'where.exe', args: [bin] }

  const shell = defaultShell(env, platform)
  const name = basename(shell).toLowerCase()
  const flags = name === 'sh' || name === 'dash' ? '-lc' : '-lic'
  return { file: shell, args: [flags, `command -v ${bin}`] }
}

function absolutePathFrom(stdout: string, platform: NodeJS.Platform): string | undefined {
  const lines = stdout.split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l.length > 0)
  const absolute = lines.filter(line =>
    platform === 'win32' ? win32.isAbsolute(line) : isAbsolute(line),
  )
  // POSIX: last absolute line (survives shell startup noise).
  // Windows: first where.exe hit.
  return platform === 'win32' ? absolute[0] : absolute[absolute.length - 1]
}

function firstNonEmptyLine(output: string): string | undefined {
  const lines = output.split(/\r\n|\n|\r/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

async function detectOne(
  entry: CatalogEntry,
  exec: ExecLoginShell,
  execVersion: ExecVersion,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<ToolchainEntry> {
  try {
    const command = detectCommand(entry.bin, platform, env)
    const { stdout, exitCode } = await exec(command.file, command.args)
    if (exitCode !== 0) return { id: entry.id, bin: entry.bin, installed: false }
    const binPath = absolutePathFrom(stdout, platform)
    if (!binPath) return { id: entry.id, bin: entry.bin, installed: false }

    // Version capture — failure keeps installed:true with version undefined.
    let version: string | undefined
    try {
      const versionOutput = await execVersion(binPath)
      version = firstNonEmptyLine(versionOutput)
    } catch {
      // best-effort
    }

    return { id: entry.id, bin: entry.bin, installed: true, binPath, version }
  } catch {
    return { id: entry.id, bin: entry.bin, installed: false }
  }
}

// --- Module-level promise cache ---

let cache: Promise<ToolchainEntry[]> | null = null

export function detectToolchain(deps?: ToolchainDetectDeps): Promise<ToolchainEntry[]> {
  if (cache) return cache
  const exec = deps?.exec ?? defaultExec
  const execVersion = deps?.execVersion ?? defaultExecVersion
  const platform = deps?.platform ?? process.platform
  const env = deps?.env ?? process.env
  cache = Promise.all(
    TOOLCHAIN_CATALOG.map(entry => detectOne(entry, exec, execVersion, platform, env)),
  )
  return cache
}

export function resetToolchainDetection(): void {
  cache = null
}

export async function resolveInterpreter(name: string): Promise<ToolchainEntry | null> {
  const entries = await detectToolchain()
  const normalized = name.toLowerCase().replace(/\.exe$/i, '')

  for (const entry of entries) {
    if (!entry.installed) continue
    // Match by catalog id OR by binary basename (case-insensitive, .exe stripped)
    if (entry.id === normalized || entry.bin.toLowerCase() === normalized) {
      return entry
    }
  }
  return null
}
