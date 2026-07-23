// One writable, Git-backed Team source per Mim installation.
// System Git is intentional: SSH keys and credential helpers are the sole
// authentication path, and the Team checkout must support ordinary Git writes.

import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { parse as parseYaml } from 'yaml'
import {
  gitInstallAction,
  gitLfsInstallAction,
  hasSystemGit,
  hasSystemGitLfs,
} from '@main/git.js'
import { userHomeDir } from '@main/platform.js'
import {
  clearSyncStop,
  isRetryableGitError,
  preserveRebaseConflicts,
  readSyncStop,
  writeSyncStop,
} from '@main/sync/conflicts.js'
import { loadUserConfig, setTeamConnection } from '@main/userConfig.js'

const execFileAsync = promisify(execFile)
const CONTRIBUTION_DIRS = ['files', 'skills', 'apps', 'routines'] as const

export interface TeamCheckout {
  name: string
  root: string
  manifestPath: string
  instructionsPath: string | null
  filesPath: string
  skillsPath: string
  appsPath: string
  routinesPath: string
  contributions: {
    instructions: boolean
    files: number
    skills: number
    apps: number
    routines: number
  }
}

export type TeamSourceState =
  | 'disconnected'
  | 'not-cloned'
  | 'invalid'
  | 'synced'
  | 'needs-sync'
  | 'stopped'

export interface TeamSourceStatus {
  state: TeamSourceState
  repository: string | null
  root: string
  team: TeamCheckout | null
  git: {
    available: boolean
    installAction: string | null
    lfsRequired: boolean
    lfsAvailable: boolean | null
    lfsInstallAction: string | null
  }
  dirty: boolean
  ahead: number
  behind: number
  conflicts: string[]
  retryable: boolean
  message: string
}

export interface TeamSource {
  status(): Promise<TeamSourceStatus>
  connect(repository: string): Promise<TeamSourceStatus>
  open(): Promise<TeamCheckout>
  sync(): Promise<TeamSourceStatus>
}

export interface CreateTeamSourceOptions {
  homeDir?: string
  platform?: NodeJS.Platform
  hasGitLfs?: () => Promise<boolean>
}

export function teamCheckoutPath(home = userHomeDir()): string {
  return join(home, '.mim', 'team')
}

export function resolveTeamCheckout(root: string): TeamCheckout {
  const manifestPath = join(root, 'team.yaml')
  requireRegularFile(manifestPath, 'team.yaml is required')

  let raw: unknown
  try {
    raw = parseYaml(readFileSync(manifestPath, 'utf-8'))
  } catch {
    throw new Error('team.yaml must contain valid YAML')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('team.yaml must contain a mapping')
  }
  const nameValue = (raw as Record<string, unknown>).name
  if (typeof nameValue !== 'string' || !nameValue.trim()) {
    throw new Error('team.yaml must define a non-empty name')
  }
  const name = nameValue.trim()

  const instructionsPath = join(root, 'instructions.md')
  if (existsSync(instructionsPath)) {
    requireRegularFile(instructionsPath, 'instructions.md must be a regular file')
  }

  const counts = {
    instructions: existsSync(instructionsPath),
    files: 0,
    skills: 0,
    apps: 0,
    routines: 0,
  }
  for (const contribution of CONTRIBUTION_DIRS) {
    const path = join(root, contribution)
    if (!existsSync(path)) continue
    const stat = lstatSync(path)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`${contribution}/ must be a directory`)
    }
    counts[contribution] = readdirSync(path).filter(entry => !entry.startsWith('.')).length
  }

  return {
    name,
    root,
    manifestPath,
    instructionsPath: counts.instructions ? instructionsPath : null,
    filesPath: join(root, 'files'),
    skillsPath: join(root, 'skills'),
    appsPath: join(root, 'apps'),
    routinesPath: join(root, 'routines'),
    contributions: counts,
  }
}

export function repositoryUsesGitLfs(root: string): boolean {
  const pending = [root]
  while (pending.length > 0) {
    const dir = pending.pop()!
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        pending.push(path)
        continue
      }
      if (entry.isFile() && entry.name === '.gitattributes') {
        const attributes = readFileSync(path, 'utf-8')
        if (/\bfilter\s*=\s*lfs\b/i.test(attributes)) return true
      }
    }
  }
  return false
}

export function createTeamSource(options: CreateTeamSourceOptions = {}): TeamSource {
  const home = options.homeDir ?? userHomeDir()
  const platform = options.platform ?? process.platform
  const root = teamCheckoutPath(home)
  const hasGitLfs = options.hasGitLfs ?? hasSystemGitLfs
  const stopPath = join(root, '.git', 'mim-sync-stop.json')

  async function gitAvailable(): Promise<boolean> {
    return hasSystemGit()
  }

  function repository(): string | null {
    return loadUserConfig(home).team?.repository ?? null
  }

  async function status(): Promise<TeamSourceStatus> {
    const available = await gitAvailable()
    const configured = repository()
    const git: TeamSourceStatus['git'] = {
      available,
      installAction: available ? null : gitInstallAction(platform),
      lfsRequired: false,
      lfsAvailable: null,
      lfsInstallAction: null,
    }
    if (!configured) {
      return baseStatus('disconnected', null, root, git, 'Connect a Team source.')
    }
    if (!existsSync(root)) {
      return baseStatus('not-cloned', configured, root, git, 'The Team checkout is missing. Sync to clone it again.')
    }
    if (!available) {
      return baseStatus('stopped', configured, root, git, 'Git is required to inspect or sync the Team source.')
    }

    let team: TeamCheckout
    try {
      team = resolveTeamCheckout(root)
      const origin = await gitMaybe(root, ['remote', 'get-url', 'origin'])
      if (origin !== configured) {
        return {
          ...baseStatus('invalid', configured, root, git, 'The Team checkout origin does not match the connected repository.'),
          team,
        }
      }
    } catch (error) {
      return baseStatus(
        'invalid',
        configured,
        root,
        git,
        error instanceof Error ? error.message : String(error),
      )
    }

    let lfsRequired: boolean
    try {
      lfsRequired = repositoryUsesGitLfs(root)
    } catch (error) {
      return baseStatus(
        'invalid',
        configured,
        root,
        git,
        error instanceof Error ? error.message : String(error),
      )
    }
    const lfsAvailable = lfsRequired ? await hasGitLfs() : null
    git.lfsRequired = lfsRequired
    git.lfsAvailable = lfsAvailable
    git.lfsInstallAction = lfsRequired && !lfsAvailable ? gitLfsInstallAction(platform) : null
    if (lfsRequired && !lfsAvailable) {
      return {
        ...baseStatus('stopped', configured, root, git, `Git LFS is required. ${git.lfsInstallAction}`),
        team,
      }
    }

    const stop = readSyncStop(stopPath)
    if (stop) {
      return {
        ...baseStatus('stopped', configured, root, git, stop.message),
        team,
        conflicts: stop.conflicts,
        retryable: stop.retryable,
      }
    }

    const branchStatus = await gitMaybe(root, ['status', '--short', '--branch'])
    const lines = branchStatus.split('\n')
    const tracking = lines[0] ?? ''
    const dirty = lines.slice(1).some(line => line.trim().length > 0)
    const ahead = parseTrackingCount(tracking, 'ahead')
    const behind = parseTrackingCount(tracking, 'behind')
    const conflicts = (await gitMaybe(root, ['diff', '--name-only', '--diff-filter=U']))
      .split('\n')
      .filter(Boolean)
    const state: TeamSourceState = conflicts.length > 0
      ? 'stopped'
      : dirty || ahead > 0 || behind > 0
        ? 'needs-sync'
        : 'synced'

    return {
      state,
      repository: configured,
      root,
      team,
      git,
      dirty,
      ahead,
      behind,
      conflicts,
      retryable: false,
      message: state === 'synced'
        ? 'Synced.'
        : state === 'stopped'
          ? 'Sync stopped because the Team checkout needs conflict resolution.'
          : 'Team changes need to sync.',
    }
  }

  async function connect(repositoryValue: string): Promise<TeamSourceStatus> {
    const configured = repository()
    if (configured) throw new Error('A Team source is already connected')
    const repositoryUrl = validateRepository(repositoryValue)
    if (!await gitAvailable()) {
      throw new Error(`Git is required to connect a Team source. ${gitInstallAction(platform)}`)
    }
    if (existsSync(root)) {
      throw new Error(`A Team checkout already exists at ${root}`)
    }

    await cloneAndValidate(repositoryUrl)
    try {
      setTeamConnection({ repository: repositoryUrl }, home)
    } catch (error) {
      rmSync(root, { recursive: true, force: true })
      throw error
    }
    return status()
  }

  async function open(): Promise<TeamCheckout> {
    const current = await status()
    if (!current.repository) throw new Error('No Team source is connected')
    if (!current.team || current.state === 'invalid' || current.state === 'not-cloned') {
      throw new Error(current.message)
    }
    if (current.git.lfsRequired && !current.git.lfsAvailable) throw new Error(current.message)
    return current.team
  }

  async function sync(): Promise<TeamSourceStatus> {
    const configured = repository()
    if (!configured) throw new Error('No Team source is connected')
    if (!await gitAvailable()) {
      throw new Error(`Git is required to sync the Team source. ${gitInstallAction(platform)}`)
    }
    if (!existsSync(root)) {
      await cloneAndValidate(configured)
      return status()
    }

    clearSyncStop(stopPath)
    const before = await status()
    if (before.state === 'invalid') throw new Error(before.message)
    if (before.git.lfsRequired && !before.git.lfsAvailable) throw new Error(before.message)
    if (before.conflicts.length > 0) return before

    try {
      await gitExec(root, ['add', '-A'])
      const pending = await gitMaybe(root, ['status', '--short'])
      if (pending.trim()) await gitExec(root, ['commit', '-m', 'Mim Team sync'])
      await gitExec(root, ['pull', '--rebase'])
      resolveTeamCheckout(root)
      await gitExec(root, ['push'])
    } catch (error) {
      const preserved = await preserveRebaseConflicts(root, stopPath, 'Team')
      if (preserved) return status()
      const retryable = isRetryableGitError(error)
      if (retryable) {
        writeSyncStop(stopPath, {
          message: 'Team sync paused while the remote is unavailable. Mim will retry automatically.',
          conflicts: [],
          retryable: true,
        })
        return status()
      }
      const current = await status()
      return {
        ...current,
        state: 'stopped',
        retryable: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    return status()
  }

  async function cloneAndValidate(repositoryUrl: string): Promise<void> {
    const personalDir = join(home, '.mim')
    mkdirSync(personalDir, { recursive: true })
    const tempParent = mkdtempSync(join(personalDir, 'team-clone-'))
    const clonePath = join(tempParent, `repo-${randomBytes(4).toString('hex')}`)
    try {
      await gitExec(undefined, ['clone', '--', repositoryUrl, clonePath], {
        GIT_LFS_SKIP_SMUDGE: '1',
      })
      resolveTeamCheckout(clonePath)
      if (repositoryUsesGitLfs(clonePath)) {
        if (!await hasGitLfs()) {
          throw new Error(`Git LFS is required. ${gitLfsInstallAction(platform)}`)
        }
        await gitExec(clonePath, ['lfs', 'pull'])
      }
      renameSync(clonePath, root)
    } finally {
      rmSync(tempParent, { recursive: true, force: true })
    }
  }

  return { status, connect, open, sync }
}

function requireRegularFile(path: string, message: string): void {
  if (!existsSync(path)) throw new Error(message)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(message)
}

function validateRepository(value: string): string {
  const repository = value.trim()
  if (!repository || /[\r\n\0]/.test(repository)) throw new Error('repository must be a non-empty Git location')
  if (repository.startsWith('-')) throw new Error('repository must not begin with "-"')

  if (/^https?:\/\//i.test(repository)) {
    const parsed = new URL(repository)
    if (parsed.protocol !== 'https:') throw new Error('Team HTTP repositories must use HTTPS')
    if (parsed.username || parsed.password) {
      throw new Error('Team repository URLs must not contain credentials; use the system Git credential helper')
    }
  }
  return repository
}

async function gitExec(
  cwd: string | undefined,
  args: string[],
  env?: Record<string, string>,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', cwd ? ['-C', cwd, ...args] : args, {
      timeout: 120000,
      maxBuffer: 5 * 1024 * 1024,
      env: env ? { ...process.env, ...env } : undefined,
    })
    return stdout.trimEnd()
  } catch (error) {
    const stderr = typeof error === 'object' && error && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '').trim()
      : ''
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)))
  }
}

async function gitMaybe(cwd: string, args: string[]): Promise<string> {
  try {
    return await gitExec(cwd, args)
  } catch {
    return ''
  }
}

function parseTrackingCount(line: string, label: 'ahead' | 'behind'): number {
  const match = line.match(new RegExp(`\\b${label} (\\d+)\\b`))
  return match ? Number(match[1]) : 0
}

function baseStatus(
  state: TeamSourceState,
  repository: string | null,
  root: string,
  git: TeamSourceStatus['git'],
  message: string,
): TeamSourceStatus {
  return {
    state,
    repository,
    root,
    team: null,
    git,
    dirty: false,
    ahead: 0,
    behind: 0,
    conflicts: [],
    retryable: false,
    message,
  }
}
