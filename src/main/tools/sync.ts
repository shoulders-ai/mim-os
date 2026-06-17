import { execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { promisify } from 'util'
import type { ToolRegistry } from '@main/tools/registry.js'
import { parseMimYaml, serializeMimYaml, type MimConfig, type MimSyncMode } from '@main/workspace/workspaceContract.js'

const execFileAsync = promisify(execFile)

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function requireWorkspace(tools: ToolRegistry): string {
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  return workspace
}

async function git(workspace: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', workspace, ...args], {
    timeout: 120000,
    maxBuffer: 5 * 1024 * 1024,
  })
  return stdout.trimEnd()
}

async function gitMaybe(workspace: string, args: string[]): Promise<string> {
  try {
    return await git(workspace, args)
  } catch {
    return ''
  }
}

function readWorkspaceConfig(workspace: string): MimConfig {
  const path = join(workspace, 'mim.yaml')
  if (!existsSync(path)) return { name: basename(workspace) }
  return parseMimYaml(readFileSync(path, 'utf-8'))
}

function writeWorkspaceConfig(workspace: string, config: MimConfig): void {
  writeFileSync(join(workspace, 'mim.yaml'), serializeMimYaml(config))
}

function inferMode(config: MimConfig): MimSyncMode {
  if (config.sync?.mode === 'managed') return 'managed'
  if (config.sync?.mode === 'manual') return 'manual'
  return 'manual'
}

async function syncState(workspace: string) {
  const hasGit = existsSync(join(workspace, '.git'))
  const config = readWorkspaceConfig(workspace)
  const mode = inferMode(config)
  const remote = config.sync?.remote
    || await gitMaybe(workspace, ['remote', 'get-url', 'origin'])
    || ''
  const branchLine = hasGit ? await gitMaybe(workspace, ['status', '--short', '--branch']) : ''
  const dirty = hasGit
    ? branchLine.split('\n').slice(1).some(line => line.trim().length > 0)
    : false
  const ahead = /\[.*ahead\s+\d+/.test(branchLine)
  const behind = /\[.*behind\s+\d+/.test(branchLine)
  const conflict = hasGit
    ? (await gitMaybe(workspace, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean)
    : []

  let state: 'manual' | 'not-configured' | 'synced' | 'needs-sync' | 'stopped'
  if (mode === 'manual') state = 'manual'
  else if (!hasGit || !remote) state = 'not-configured'
  else if (conflict.length > 0) state = 'stopped'
  else if (dirty || ahead || behind) state = 'needs-sync'
  else state = 'synced'

  return {
    mode,
    state,
    git: hasGit,
    remote: remote || null,
    dirty,
    ahead,
    behind,
    conflicts: conflict,
    message: syncMessage(mode, state),
  }
}

function syncMessage(mode: MimSyncMode, state: string): string {
  if (mode === 'manual') return 'Manual sync. Mim will not run git commands unless you ask.'
  if (state === 'not-configured') return 'Managed sync is on, but this workspace needs a remote before it can sync.'
  if (state === 'synced') return 'Synced.'
  if (state === 'stopped') return 'Sync stopped because the workspace needs conflict resolution.'
  return 'Sync needed.'
}

async function currentUpstream(workspace: string): Promise<string> {
  return gitMaybe(workspace, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
}

async function currentBranch(workspace: string): Promise<string> {
  return gitMaybe(workspace, ['branch', '--show-current'])
}

async function remoteHasBranch(workspace: string, branch: string): Promise<boolean> {
  if (!branch) return false
  const output = await gitMaybe(workspace, ['ls-remote', '--heads', 'origin', branch])
  return output.trim().length > 0
}

async function pullBeforePush(workspace: string): Promise<{ hadUpstream: boolean }> {
  const upstream = await currentUpstream(workspace)
  if (upstream) {
    await git(workspace, ['pull', '--ff-only'])
    return { hadUpstream: true }
  }

  const branch = await currentBranch(workspace)
  if (branch && await remoteHasBranch(workspace, branch)) {
    await git(workspace, ['pull', '--ff-only', 'origin', branch])
  }
  return { hadUpstream: false }
}

async function pushAfterSync(workspace: string, hadUpstream: boolean): Promise<void> {
  if (hadUpstream) await git(workspace, ['push'])
  else await git(workspace, ['push', '-u', 'origin', 'HEAD'])
}

export function registerSyncTools(tools: ToolRegistry): void {
  tools.register({
    name: 'sync.status',
    description: 'Plain-language backup/sync status for the current workspace.',
    inputSchema: objectSchema({}),
    execute: async () => syncState(requireWorkspace(tools)),
  })

  tools.register({
    name: 'sync.configure',
    description: 'Set the explicit workspace sync mode in mim.yaml. Managed mode may also set an origin remote.',
    inputSchema: objectSchema({
      mode: { type: 'string', enum: ['manual', 'managed'] },
      remote: { type: 'string' },
    }, ['mode']),
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const mode = optionalString(params, 'mode')
      if (mode !== 'manual' && mode !== 'managed') throw new Error('mode must be manual or managed')
      const remote = optionalString(params, 'remote')
      const config = readWorkspaceConfig(workspace)
      const nextConfig: MimConfig = { ...config, sync: { mode } }
      if (remote) nextConfig.sync!.remote = remote

      if (mode === 'managed') {
        if (!existsSync(join(workspace, '.git'))) await execFileAsync('git', ['init', workspace], { timeout: 30000 })
        if (remote) {
          const existing = await gitMaybe(workspace, ['remote', 'get-url', 'origin'])
          if (existing) await git(workspace, ['remote', 'set-url', 'origin', remote])
          else await git(workspace, ['remote', 'add', 'origin', remote])
        }
      }

      writeWorkspaceConfig(workspace, nextConfig)
      return syncState(workspace)
    },
  })

  tools.register({
    name: 'sync.now',
    description: 'Run the managed sync workflow. Refuses Manual mode.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const workspace = requireWorkspace(tools)
      const status = await syncState(workspace)
      if (status.mode !== 'managed') throw new Error('Managed sync is not enabled for this workspace')
      if (!status.git) throw new Error('Managed sync needs a git repository')
      if (!status.remote) throw new Error('Managed sync needs a remote')
      if (status.conflicts.length > 0) throw new Error('Sync is stopped until conflicts are resolved')

      try {
        await git(workspace, ['add', '-A'])
        const pending = await gitMaybe(workspace, ['status', '--short'])
        if (pending.trim()) {
          await git(workspace, ['commit', '-m', 'Mim sync'])
        }
        const { hadUpstream } = await pullBeforePush(workspace)
        await pushAfterSync(workspace, hadUpstream)
      } catch (err) {
        return {
          ...(await syncState(workspace)),
          state: 'stopped',
          message: err instanceof Error ? err.message : String(err),
        }
      }
      return syncState(workspace)
    },
  })
}
