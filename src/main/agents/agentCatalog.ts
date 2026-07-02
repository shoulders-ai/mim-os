// Static catalog of CLI coding agents + installation detection.
//
// GUI Electron on macOS inherits the launchd PATH, which lacks /opt/homebrew/bin
// (and other shell-profile additions), so POSIX detection resolves each binary
// through the user's login shell. Windows does not have that shell contract and
// npm/pnpm CLI installs usually expose .cmd shims, so Windows detection asks
// where.exe instead. Detection is cached — login-shell startup is expensive.
// No Electron imports — unit-testable.

import { execFile } from 'child_process'
import { basename, isAbsolute, join, win32 } from 'path'
import { defaultShell } from '@main/platform.js'

export interface AgentDefinition {
  id: string
  name: string
  bin: string
  args: string[]
}

export interface DetectedAgent extends AgentDefinition {
  installed: boolean
  binPath?: string
}

export const AGENT_CATALOG: AgentDefinition[] = [
  { id: 'claude-code', name: 'Claude Code', bin: 'claude', args: [] },
  { id: 'codex', name: 'Codex', bin: 'codex', args: [] },
  { id: 'gemini-cli', name: 'Gemini CLI', bin: 'gemini', args: [] },
]

// System boundary: tests inject this so they never spawn a real shell.
export type ExecLoginShell = (file: string, args: string[]) => Promise<{ stdout: string; exitCode: number }>

export interface DetectAgentsDeps {
  exec?: ExecLoginShell
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

const defaultExec: ExecLoginShell = (shell, args) =>
  new Promise((resolve) => {
    execFile(shell, args, { timeout: 15000 }, (error, stdout) => {
      if (!error) return resolve({ stdout, exitCode: 0 })
      const code = (error as NodeJS.ErrnoException).code
      resolve({ stdout: stdout ?? '', exitCode: typeof code === 'number' ? code : 1 })
    })
  })

function detectCommand(
  def: AgentDefinition,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): { file: string; args: string[] } {
  if (platform === 'win32') return { file: 'where.exe', args: [def.bin] }

  const shell = defaultShell(env, platform)
  const name = basename(shell).toLowerCase()
  const flags = name === 'sh' || name === 'dash' ? '-lc' : '-lic'
  return { file: shell, args: [flags, `command -v ${def.bin}`] }
}

// Login shells can echo profile noise before the answer; where.exe can return
// several PATH matches. Keep only real absolute paths. POSIX takes the last
// one to survive shell startup noise; Windows takes the first where.exe hit.
function absolutePathFrom(stdout: string, platform: NodeJS.Platform): string | undefined {
  const lines = stdout.split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l.length > 0)
  const absolute = lines.filter(line => platform === 'win32' ? win32.isAbsolute(line) : isAbsolute(line))
  return platform === 'win32' ? absolute[0] : absolute[absolute.length - 1]
}

async function detectOne(
  def: AgentDefinition,
  exec: ExecLoginShell,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<DetectedAgent> {
  try {
    const command = detectCommand(def, platform, env)
    const { stdout, exitCode } = await exec(command.file, command.args)
    if (exitCode !== 0) return { ...def, installed: false }
    const binPath = absolutePathFrom(stdout, platform)
    if (!binPath) return { ...def, installed: false }
    return { ...def, installed: true, binPath }
  } catch {
    return { ...def, installed: false }
  }
}

let cache: Promise<DetectedAgent[]> | null = null

export function detectAgents(deps?: DetectAgentsDeps): Promise<DetectedAgent[]> {
  if (cache) return cache
  const exec = deps?.exec ?? defaultExec
  const platform = deps?.platform ?? process.platform
  const env = deps?.env ?? process.env
  cache = Promise.all(AGENT_CATALOG.map(def => detectOne(def, exec, platform, env)))
  return cache
}

export function resetAgentDetection(): void {
  cache = null
}

export function resumeArgs(agentId: string, cliSessionId?: string, cwd?: string): string[] {
  if (agentId === 'claude-code') return cliSessionId ? ['--resume', cliSessionId] : ['--continue']
  if (agentId === 'codex') return cliSessionId ? ['resume', cliSessionId] : ['resume', '--last']
  if (agentId === 'gemini-cli') {
    if (cliSessionId && cwd) {
      const dir = cliSessionsDir('gemini-cli', cwd)
      if (dir) return ['--session-file', join(dir, `${cliSessionId}.jsonl`)]
    }
    return ['--resume', 'latest']
  }
  return []
}

export function cliSessionsDir(agentId: string, cwd: string): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  if (agentId === 'claude-code') return join(home, '.claude', 'projects', cwd.replace(/[\\/]/g, '-'))
  if (agentId === 'gemini-cli') return join(home, '.gemini', 'tmp', basename(cwd), 'chats')
  return null
}

export function extractCodexSessionId(filename: string): string | undefined {
  const match = filename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)
  return match?.[1]
}
