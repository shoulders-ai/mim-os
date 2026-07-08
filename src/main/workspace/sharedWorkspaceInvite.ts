import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import {
  decodeInvitePayload,
  inspectServeInvite,
} from '@main/serve/invites.js'
import {
  parseMimYaml,
  serializeMimYaml,
  type MimSharedWorkspaceConfig,
} from './workspaceContract.js'
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
  workspacePath: string
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
  writeSharedWorkspaceConfig(options.workspacePath, sharedWorkspace)

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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Shared workspace invite response is missing workspace config')
  }
  const source = raw as Record<string, unknown>
  const candidate: MimSharedWorkspaceConfig = {
    id: typeof source.id === 'string' ? source.id : '',
    url: typeof source.url === 'string' ? source.url : '',
    namespaces: Array.isArray(source.namespaces)
      ? source.namespaces.filter((item): item is string => typeof item === 'string')
      : [],
    ...(typeof source.name === 'string' ? { name: source.name } : {}),
  }
  const reparsed = parseMimYaml(serializeMimYaml({ name: 'x', sharedWorkspace: candidate })).sharedWorkspace
  if (!reparsed) throw new Error('Shared workspace invite response has invalid workspace config')
  return reparsed
}

function writeSharedWorkspaceConfig(workspacePath: string, sharedWorkspace: MimSharedWorkspaceConfig): void {
  mkdirSync(workspacePath, { recursive: true })
  const path = join(workspacePath, 'mim.yaml')
  const config = existsSync(path)
    ? parseMimYaml(readFileSync(path, 'utf-8'))
    : { name: basename(workspacePath) }
  config.sharedWorkspace = sharedWorkspace
  writeFileSync(path, serializeMimYaml(config))
}
