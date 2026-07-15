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
import { compareSemver } from '@main/packages/semver.js'

export type AgentMimToolConnection = 'mcp' | 'extension' | 'none'

export interface AgentDefinition {
  id: string
  name: string
  bin: string
  args: string[]
  minimumVersion?: string
  mimToolConnection?: AgentMimToolConnection
  extensionResource?: string
}

export interface DetectedAgent extends AgentDefinition {
  installed: boolean
  binPath?: string
  version?: string
  compatible?: boolean
  compatibilityMessage?: string
}

export const AGENT_CATALOG: AgentDefinition[] = [
  { id: 'claude-code', name: 'Claude Code', bin: 'claude', args: [] },
  { id: 'codex', name: 'Codex', bin: 'codex', args: [] },
  { id: 'gemini-cli', name: 'Gemini CLI', bin: 'gemini', args: [] },
  {
    id: 'pi',
    name: 'Pi',
    bin: 'pi',
    args: [],
    minimumVersion: '0.76.0',
    mimToolConnection: 'extension',
    extensionResource: 'pi/mim-extension.mjs',
  },
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

function versionCommand(binPath: string, platform: NodeJS.Platform): { file: string; args: string[] } {
  if (platform === 'win32') {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${binPath}" --version`] }
  }
  return { file: binPath, args: ['--version'] }
}

function semverFrom(output: string): string | undefined {
  return output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)?.[1]
}

async function withVersionCompatibility(
  detected: DetectedAgent,
  exec: ExecLoginShell,
  platform: NodeJS.Platform,
): Promise<DetectedAgent> {
  const minimumVersion = detected.minimumVersion
  if (!minimumVersion || !detected.binPath) return detected

  let version: string | undefined
  try {
    const command = versionCommand(detected.binPath, platform)
    const result = await exec(command.file, command.args)
    if (result.exitCode === 0) version = semverFrom(result.stdout)
  } catch {
    // Installation remains visible even if a separate version probe fails.
  }

  if (!version) {
    return {
      ...detected,
      compatible: false,
      compatibilityMessage: `Could not verify ${detected.name} version; version ${minimumVersion} or newer is required`,
    }
  }
  if (compareSemver(version, minimumVersion) < 0) {
    return {
      ...detected,
      version,
      compatible: false,
      compatibilityMessage: `${detected.name} ${version} found; version ${minimumVersion} or newer is required`,
    }
  }
  return { ...detected, version, compatible: true }
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
    return withVersionCompatibility({ ...def, installed: true, binPath }, exec, platform)
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

export function launchArgs(
  agentId: string,
  sessionId: string,
  userArgs: string[] = [],
  managedArgs: string[] = [],
): string[] {
  if (agentId === 'pi') return ['--session-id', sessionId, ...userArgs, ...managedArgs]
  return [...userArgs, ...managedArgs]
}

export function resumeArgs(
  agentId: string,
  cliSessionId?: string,
  cwd?: string,
  userArgs: string[] = [],
  managedArgs: string[] = [],
): string[] {
  if (agentId === 'claude-code') return cliSessionId ? ['--resume', cliSessionId] : ['--continue']
  if (agentId === 'codex') return cliSessionId ? ['resume', cliSessionId] : ['resume', '--last']
  if (agentId === 'gemini-cli') {
    if (cliSessionId && cwd) {
      const dir = cliSessionsDir('gemini-cli', cwd)
      if (dir) return ['--session-file', join(dir, `${cliSessionId}.jsonl`)]
    }
    return ['--resume', 'latest']
  }
  if (agentId === 'pi' && cliSessionId) return ['--session-id', cliSessionId, ...userArgs, ...managedArgs]
  return []
}

const PI_MANAGED_SESSION_FLAGS = new Set([
  '--session-id',
  '--session',
  '--continue',
  '-c',
  '--resume',
  '-r',
  '--no-session',
  '--fork',
])

export function assertAgentExtraArgs(agentId: string, args: string[]): void {
  if (agentId !== 'pi') return
  for (const arg of args) {
    const managedFlag = [...PI_MANAGED_SESSION_FLAGS].find(flag =>
      arg === flag || (flag.startsWith('--') && arg.startsWith(`${flag}=`)))
    if (managedFlag) throw new Error(`Pi flag ${managedFlag} is managed by Mim`)
  }
}

export function assertDetectedAgentAvailable(
  agent: DetectedAgent,
): asserts agent is DetectedAgent & { installed: true; binPath: string } {
  if (!agent.installed || !agent.binPath) throw new Error(`Agent not installed: ${agent.id}`)
  if (agent.compatible === false) {
    throw new Error(agent.compatibilityMessage ?? `${agent.name} is not compatible with this version of Mim`)
  }
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
