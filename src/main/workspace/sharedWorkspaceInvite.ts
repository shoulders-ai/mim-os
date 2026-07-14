import {
  decodeInvitePayload,
  inspectServeInvite,
} from '@main/serve/invites.js'
import type { MimSharedWorkspaceConfig } from './workspaceContract.js'
import { upsertSharedWorkspaceConnection } from './sharedWorkspaceConnections.js'
import { normalizeSharedWorkspaceConfig } from './sharedWorkspaceLinks.js'
import { writeSharedWorkspaceToken } from './sharedWorkspaceTokens.js'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface SharedWorkspaceInvitePreview {
  id: string
  workspaceId: string
  workspaceName: string
  callerName: string
  url: string
  host: string
  namespaces: string[]
  expiresAt?: string
}

export interface JoinSharedWorkspaceFromInviteOptions {
  workspacePath?: string
  invite: string
  home?: string
  fetchUrl?: FetchLike
}

export interface JoinSharedWorkspaceResult {
  joined: true
  callerName: string
  sharedWorkspace: MimSharedWorkspaceConfig
  tokenStored: true
}

interface RedeemResponse {
  callerName?: unknown
  token?: unknown
  sharedWorkspace?: unknown
}

export function inspectSharedWorkspaceInvite(invite: string): SharedWorkspaceInvitePreview {
  const inspected = inspectServeInvite(invite)
  return {
    id: inspected.id,
    workspaceId: inspected.workspaceId,
    workspaceName: inspected.workspaceName,
    callerName: inspected.callerName,
    url: inspected.url,
    host: inspected.host,
    namespaces: inspected.namespaces,
    ...(inspected.expiresAt ? { expiresAt: inspected.expiresAt } : {}),
  }
}

export async function joinSharedWorkspaceFromInvite(
  options: JoinSharedWorkspaceFromInviteOptions,
): Promise<JoinSharedWorkspaceResult> {
  const payload = decodeInvitePayload(options.invite)
  const fetchUrl = options.fetchUrl ?? globalThis.fetch.bind(globalThis)
  const response = await fetchUrl(joinEndpointForMcpUrl(payload.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite: options.invite }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Shared workspace invite failed (${response.status}): ${text || response.statusText}`)
  }

  const parsed = await response.json().catch(() => null) as RedeemResponse | null
  if (!parsed || typeof parsed !== 'object') throw new Error('Shared workspace invite returned invalid JSON')
  if (typeof parsed.token !== 'string' || !parsed.token) throw new Error('Shared workspace invite did not return a token')
  const sharedWorkspace = normalizeSharedWorkspace(parsed.sharedWorkspace)
  const callerName = typeof parsed.callerName === 'string' ? parsed.callerName : payload.callerName

  writeSharedWorkspaceToken(sharedWorkspace.id, parsed.token, { home: options.home })
  upsertSharedWorkspaceConnection(sharedWorkspace, { home: options.home, callerName })

  return {
    joined: true,
    callerName,
    sharedWorkspace,
    tokenStored: true,
  }
}

function joinEndpointForMcpUrl(url: string): string {
  const parsed = new URL(url)
  parsed.pathname = parsed.pathname.replace(/\/mcp\/?$/, '/join')
  if (!parsed.pathname.endsWith('/join')) parsed.pathname = '/join'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}

function normalizeSharedWorkspace(raw: unknown): MimSharedWorkspaceConfig {
  const normalized = normalizeSharedWorkspaceConfig(raw)
  if (!normalized) throw new Error('Shared workspace invite response has invalid workspace config')
  return normalized
}
