import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'
import { userHomeDir } from '@main/platform.js'
import type { MimSharedWorkspaceConfig } from './workspaceContract.js'
import { normalizeSharedWorkspaceConfig } from './sharedWorkspaceLinks.js'

export interface SharedWorkspaceConnectionOptions {
  home?: string
  callerName?: string
  now?: () => Date
}

export interface SharedWorkspaceConnection extends MimSharedWorkspaceConfig {
  callerName?: string
  connectedAt: string
}

interface SharedWorkspaceConnectionStore {
  version: 1
  connections: SharedWorkspaceConnection[]
}

export function sharedWorkspaceConnectionsPath(options: { home?: string } = {}): string {
  return join(options.home ?? userHomeDir(), '.mim', 'shared-workspaces.json')
}

export function listSharedWorkspaceConnections(
  options: { home?: string } = {},
): SharedWorkspaceConnection[] {
  return readSharedWorkspaceConnectionStore(options.home).connections
}

export function readSharedWorkspaceConnection(
  id: string,
  options: { home?: string } = {},
): SharedWorkspaceConnection | null {
  return listSharedWorkspaceConnections(options).find(connection => connection.id === id) ?? null
}

export function upsertSharedWorkspaceConnection(
  sharedWorkspace: MimSharedWorkspaceConfig,
  options: SharedWorkspaceConnectionOptions = {},
): SharedWorkspaceConnection {
  const normalized = normalizeSharedWorkspaceConfig(sharedWorkspace)
  if (!normalized) throw new Error('Invalid shared workspace connection')
  const store = readSharedWorkspaceConnectionStore(options.home)
  const connection: SharedWorkspaceConnection = {
    ...normalized,
    ...(options.callerName ? { callerName: options.callerName } : {}),
    connectedAt: (options.now?.() ?? new Date()).toISOString(),
  }
  const index = store.connections.findIndex(item => item.id === normalized.id)
  if (index >= 0) store.connections[index] = connection
  else store.connections.push(connection)
  writeSharedWorkspaceConnectionStore(store, options.home)
  return connection
}

function readSharedWorkspaceConnectionStore(home?: string): SharedWorkspaceConnectionStore {
  const path = sharedWorkspaceConnectionsPath({ home })
  if (!existsSync(path)) return emptyStore()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyStore()
    const source = parsed as Record<string, unknown>
    const connections = Array.isArray(source.connections)
      ? source.connections.map(normalizeConnection).filter((item): item is SharedWorkspaceConnection => item !== null)
      : []
    return { version: 1, connections }
  } catch {
    return emptyStore()
  }
}

function writeSharedWorkspaceConnectionStore(store: SharedWorkspaceConnectionStore, home?: string): void {
  atomicWriteJson(sharedWorkspaceConnectionsPath({ home }), store)
}

function normalizeConnection(raw: unknown): SharedWorkspaceConnection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const sharedWorkspace = normalizeSharedWorkspaceConfig(source)
  if (!sharedWorkspace) return null
  return {
    ...sharedWorkspace,
    ...(typeof source.callerName === 'string' && source.callerName.trim()
      ? { callerName: source.callerName.trim().slice(0, 80) }
      : {}),
    connectedAt: typeof source.connectedAt === 'string' && source.connectedAt.trim()
      ? source.connectedAt
      : new Date(0).toISOString(),
  }
}

function emptyStore(): SharedWorkspaceConnectionStore {
  return { version: 1, connections: [] }
}
