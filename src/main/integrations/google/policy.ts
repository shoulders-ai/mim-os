import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { loadUserConfig } from '@main/userConfig.js'

export interface GoogleConnectorPolicy {
  aiEnabled: boolean
  gmailEnabled: boolean
  gmailSendEnabled: boolean
  calendarEnabled: boolean
  calendarWriteEnabled: boolean
  driveEnabled: boolean
  sheetsWriteEnabled: boolean
}

export const GOOGLE_POLICY_DEFAULTS: Readonly<GoogleConnectorPolicy> = {
  aiEnabled: false,
  gmailEnabled: false,
  gmailSendEnabled: false,
  calendarEnabled: false,
  calendarWriteEnabled: false,
  driveEnabled: false,
  sheetsWriteEnabled: false,
}

const BOOL_KEYS: ReadonlyArray<keyof GoogleConnectorPolicy> = [
  'aiEnabled',
  'gmailEnabled',
  'gmailSendEnabled',
  'calendarEnabled',
  'calendarWriteEnabled',
  'driveEnabled',
  'sheetsWriteEnabled',
]

export function parseGooglePolicyFields(raw: unknown): GoogleConnectorPolicy {
  const policy = { ...GOOGLE_POLICY_DEFAULTS }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return policy
  const obj = raw as Record<string, unknown>
  for (const key of BOOL_KEYS) {
    if (typeof obj[key] === 'boolean') policy[key] = obj[key] as boolean
  }
  return policy
}

export function resolveGooglePolicy(
  workspaceRaw: unknown,
  userGlobalRaw: unknown,
): GoogleConnectorPolicy {
  const policy = { ...GOOGLE_POLICY_DEFAULTS }
  const userGlobal = objectOrNull(userGlobalRaw)
  const workspace = objectOrNull(workspaceRaw)

  for (const key of BOOL_KEYS) {
    if (workspace && typeof workspace[key] === 'boolean') {
      policy[key] = workspace[key] as boolean
    } else if (userGlobal && typeof userGlobal[key] === 'boolean') {
      policy[key] = userGlobal[key] as boolean
    }
  }
  return policy
}

export function readGooglePolicy(workspacePath: string | null): GoogleConnectorPolicy {
  const userGlobal = loadUserConfig().connectors.google
  const workspaceRaw = readWorkspaceGooglePolicy(workspacePath)
  return resolveGooglePolicy(workspaceRaw, userGlobal)
}

function readWorkspaceGooglePolicy(workspacePath: string | null): unknown {
  if (!workspacePath) return undefined
  try {
    const path = join(workspacePath, '.mim', 'settings.json')
    if (!existsSync(path)) return undefined
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const connectors = raw.connectors
    if (!connectors || typeof connectors !== 'object' || Array.isArray(connectors)) return undefined
    return (connectors as Record<string, unknown>).google
  } catch {
    return undefined
  }
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
