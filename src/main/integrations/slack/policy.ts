import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { loadUserConfig } from '@main/userConfig.js'

export interface SlackConnectorPolicy {
  aiEnabled: boolean
  sendEnabled: boolean
  privateChannels: boolean
  directMessages: boolean
}

export const SLACK_POLICY_DEFAULTS: Readonly<SlackConnectorPolicy> = {
  aiEnabled: false,
  sendEnabled: false,
  privateChannels: false,
  directMessages: false,
}

const BOOL_KEYS: ReadonlyArray<keyof SlackConnectorPolicy> = [
  'aiEnabled',
  'sendEnabled',
  'privateChannels',
  'directMessages',
]

export function parseSlackPolicyFields(raw: unknown): SlackConnectorPolicy {
  const policy = { ...SLACK_POLICY_DEFAULTS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return policy
  const obj = raw as Record<string, unknown>
  for (const key of BOOL_KEYS) {
    if (typeof obj[key] === 'boolean') policy[key] = obj[key] as boolean
  }
  return policy
}

/**
 * Resolve Slack connector policy from workspace and user-global config layers.
 * Per-field cascade: workspace → user-global → defaults.
 * Both arguments are the raw `connectors.slack` objects (or undefined).
 */
export function resolveSlackPolicy(
  workspaceRaw: unknown,
  userGlobalRaw: unknown,
): SlackConnectorPolicy {
  const policy = { ...SLACK_POLICY_DEFAULTS }

  const userGlobal = (userGlobalRaw && typeof userGlobalRaw === 'object' && !Array.isArray(userGlobalRaw))
    ? userGlobalRaw as Record<string, unknown>
    : null

  const workspace = (workspaceRaw && typeof workspaceRaw === 'object' && !Array.isArray(workspaceRaw))
    ? workspaceRaw as Record<string, unknown>
    : null

  for (const key of BOOL_KEYS) {
    if (workspace && typeof workspace[key] === 'boolean') {
      policy[key] = workspace[key] as boolean
    } else if (userGlobal && typeof userGlobal[key] === 'boolean') {
      policy[key] = userGlobal[key] as boolean
    }
  }
  return policy
}

/**
 * Read the effective Slack connector policy for a workspace.
 * Cascade: workspace .mim/settings.json → user-global ~/.mim/config.yaml → defaults.
 */
export function readSlackPolicy(workspacePath: string | null): SlackConnectorPolicy {
  const userGlobal = loadUserConfig().connectors.slack
  const workspaceRaw = readWorkspaceSlackPolicy(workspacePath)
  return resolveSlackPolicy(workspaceRaw, userGlobal)
}

function readWorkspaceSlackPolicy(workspacePath: string | null): unknown {
  if (!workspacePath) return undefined
  try {
    const path = join(workspacePath, '.mim', 'settings.json')
    if (!existsSync(path)) return undefined
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const connectors = raw.connectors
    if (!connectors || typeof connectors !== 'object' || Array.isArray(connectors)) return undefined
    return (connectors as Record<string, unknown>).slack
  } catch {
    return undefined
  }
}
