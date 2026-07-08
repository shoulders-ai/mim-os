import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { ToolDef, ToolRegistry } from '@main/tools/registry.js'
import { readSharedWorkspaceToken } from './sharedWorkspaceTokens.js'
import { parseMimYaml, type MimSharedWorkspaceConfig } from './workspaceContract.js'
import {
  createSharedWorkspaceToolMount,
  type SharedWorkspaceToolMount,
} from './sharedWorkspaceRemote.js'

export interface SharedWorkspaceMountLoaderOptions {
  workspacePath: string
  tools: ToolRegistry
  home?: string
  appVersion?: string
  canShadowTool?: (name: string, existing: ToolDef) => boolean
  watchCatalog?: boolean
  onWarning?: (message: string) => void
}

export function readSharedWorkspaceConfig(workspacePath: string): MimSharedWorkspaceConfig | null {
  const path = join(workspacePath, 'mim.yaml')
  if (!existsSync(path)) return null
  try {
    return parseMimYaml(readFileSync(path, 'utf-8')).sharedWorkspace ?? null
  } catch {
    return null
  }
}

export async function openSharedWorkspaceToolMount(
  options: SharedWorkspaceMountLoaderOptions,
): Promise<SharedWorkspaceToolMount | null> {
  const config = readSharedWorkspaceConfig(options.workspacePath)
  if (!config) return null

  const token = readSharedWorkspaceToken(config.id, { home: options.home })
  if (!token) {
    options.onWarning?.(`Shared workspace "${config.id}" is configured but no local token is stored`)
    return null
  }

  const mount = createSharedWorkspaceToolMount({
    config,
    token,
    tools: options.tools,
    canShadowTool: options.canShadowTool,
  })
  const ok = await syncSharedWorkspaceToolMount(mount, options.onWarning)
  if (ok) warnCompatibility(config, mount, options.appVersion ?? process.env.npm_package_version ?? '0.1.0', options.onWarning)
  if (ok && options.watchCatalog !== false) mount.startWatching(options.onWarning)
  return ok ? mount : null
}

export async function syncSharedWorkspaceToolMount(
  mount: SharedWorkspaceToolMount | null,
  onWarning?: (message: string) => void,
): Promise<boolean> {
  if (!mount) return true
  try {
    await mount.sync()
    for (const diagnostic of mount.diagnostics()) onWarning?.(diagnostic)
    return true
  } catch (err) {
    onWarning?.(`Shared workspace tool sync failed: ${errorMessage(err)}`)
    return false
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return 'Unknown error'
}

function warnCompatibility(
  config: MimSharedWorkspaceConfig,
  mount: SharedWorkspaceToolMount,
  localVersion: string,
  onWarning?: (message: string) => void,
): void {
  const serverInfo = mount.serverInfo()
  const remoteVersion = serverInfo?.serverInfo?.version
  if (
    typeof remoteVersion === 'string' &&
    remoteVersion.length > 0 &&
    !sameMajorMinor(remoteVersion, localVersion)
  ) {
    onWarning?.(`Shared workspace "${config.id}" server version ${remoteVersion} differs from local version ${localVersion}; remote tool schemas may be incompatible`)
  }

  const capabilities = serverInfo?.capabilities
  if (!capabilities || typeof capabilities.tools !== 'object' || capabilities.tools === null) {
    onWarning?.(`Shared workspace "${config.id}" did not advertise MCP tools capability`)
  }
}

function sameMajorMinor(a: string, b: string): boolean {
  const left = a.match(/^(\d+)\.(\d+)/)
  const right = b.match(/^(\d+)\.(\d+)/)
  if (!left || !right) return a === b
  return left[1] === right[1] && left[2] === right[2]
}
