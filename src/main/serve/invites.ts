import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { basename, resolve } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'
import { createServeToken, defaultServeGrant, serveStateDir, type ServeGrant } from './tokens.js'
import type { MimSharedWorkspaceConfig } from '@main/workspace/workspaceContract.js'
import { SHARED_WORKSPACE_ID_PATTERN } from '@main/workspace/workspaceContract.js'

export interface ServeInviteRecord {
  id: string
  name: string
  hash: string
  url: string
  workspaceId: string
  workspaceName: string
  namespaces: string[]
  createdAt: string
  expiresAt?: string
  revokedAt?: string
  redeemedAt?: string
  callerId?: string
  token?: string
  grants?: ServeGrant
}

export interface ListedServeInvite extends Omit<ServeInviteRecord, 'hash' | 'token'> {
  hash?: undefined
  secret?: undefined
  invite?: undefined
}

export interface ServeInvitePayload {
  v: 1
  id: string
  secret: string
  url: string
  workspaceId: string
  workspaceName: string
  callerName: string
  namespaces: string[]
  expiresAt?: string
}

export interface CreateServeInviteOptions extends StoreOptions {
  name: string
  url: string
  workspaceId?: string
  workspaceName?: string
  namespaces?: string[]
  expiresAt?: string
  secret?: string
  token?: string
  grants?: ServeGrant
  now?: () => Date
}

export interface RedeemServeInviteOptions extends StoreOptions {
  invite: string
  now?: () => Date
}

export interface RevokeServeInviteOptions extends StoreOptions {
  id: string
  now?: () => Date
}

export interface ServeInviteResult {
  invite: string
  deepLink: string
  record: ServeInviteRecord
  storePath: string
}

export interface RedeemedServeInvite {
  callerName: string
  token: string
  sharedWorkspace: MimSharedWorkspaceConfig
}

interface StoreOptions {
  home?: string
  workspacePath: string
}

interface ServeInviteStore {
  version: 1
  invites: ServeInviteRecord[]
}

const DEFAULT_NAMESPACES = ['issues.*', 'knowledge.*', 'references.*']

export function createServeInvite(options: CreateServeInviteOptions): ServeInviteResult {
  const now = isoNow(options.now)
  const id = `invite_${randomBytes(8).toString('hex')}`
  const secret = options.secret ?? `mim_invite_${randomBytes(32).toString('base64url')}`
  const workspaceId = normalizeWorkspaceId(options.workspaceId ?? basename(resolve(options.workspacePath)))
  const workspaceName = normalizeDisplayName(options.workspaceName ?? workspaceId)
  const namespaces = normalizeNamespaces(options.namespaces ?? DEFAULT_NAMESPACES)
  const url = normalizeMcpUrl(options.url)
  const payload: ServeInvitePayload = {
    v: 1,
    id,
    secret,
    url,
    workspaceId,
    workspaceName,
    callerName: normalizeCallerName(options.name),
    namespaces,
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
  }
  const record: ServeInviteRecord = {
    id,
    name: payload.callerName,
    hash: hashInviteSecret(secret),
    url,
    workspaceId,
    workspaceName,
    namespaces,
    createdAt: now,
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    ...(options.token ? { token: options.token } : {}),
    grants: cloneGrant(options.grants ?? inviteNamespaceGrant(namespaces)),
  }

  const storePath = serveInvitesPath(options)
  const store = readStore(storePath)
  store.invites.push(record)
  writeStore(storePath, store)

  const encoded = encodeInvitePayload(payload)
  return {
    invite: `mim-invite-${encoded}`,
    deepLink: `mim://join/${encoded}`,
    record,
    storePath,
  }
}

export function inspectServeInvite(invite: string): Omit<ServeInvitePayload, 'secret' | 'v'> & { host: string } {
  const payload = decodeInvitePayload(invite)
  return {
    id: payload.id,
    url: payload.url,
    workspaceId: payload.workspaceId,
    workspaceName: payload.workspaceName,
    callerName: payload.callerName,
    namespaces: payload.namespaces,
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    host: new URL(payload.url).host,
  }
}

export function redeemServeInvite(options: RedeemServeInviteOptions): RedeemedServeInvite {
  const payload = decodeInvitePayload(options.invite)
  const storePath = serveInvitesPath(options)
  const store = readStore(storePath)
  const record = store.invites.find(item => item.id === payload.id)
  if (!record) throw new Error('Invite not found')
  if (record.revokedAt) throw new Error('Invite has been revoked')
  if (record.redeemedAt) throw new Error('Invite has already been used')
  const now = isoNow(options.now)
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.parse(now)) {
    throw new Error('Invite has expired')
  }
  if (!inviteSecretsEqual(record.hash, payload.secret)) throw new Error('Invite is invalid')

  const created = createServeToken({
    home: options.home,
    workspacePath: options.workspacePath,
    name: record.name,
    url: record.url,
    grants: cloneGrant(record.grants ?? inviteNamespaceGrant(record.namespaces)),
    ...(record.token ? { token: record.token } : {}),
  })
  record.redeemedAt = now
  record.callerId = created.record.id
  delete record.token
  writeStore(storePath, store)

  return {
    callerName: record.name,
    token: created.token,
    sharedWorkspace: {
      id: record.workspaceId,
      name: record.workspaceName,
      url: record.url,
      namespaces: [...record.namespaces],
    },
  }
}

export function listServeInvites(options: StoreOptions): ListedServeInvite[] {
  return readStore(serveInvitesPath(options)).invites.map(({ hash: _hash, token: _token, ...invite }) => ({
    ...invite,
    hash: undefined,
    secret: undefined,
    invite: undefined,
  }))
}

export function hasRedeemableServeInvites(options: StoreOptions, now: Date = new Date()): boolean {
  return readStore(serveInvitesPath(options)).invites.some(invite =>
    !invite.revokedAt &&
    !invite.redeemedAt &&
    (!invite.expiresAt || Date.parse(invite.expiresAt) > now.getTime()),
  )
}

export function revokeServeInvite(options: RevokeServeInviteOptions): boolean {
  const storePath = serveInvitesPath(options)
  const store = readStore(storePath)
  const invite = store.invites.find(record => record.id === options.id)
  if (!invite) return false
  invite.revokedAt = isoNow(options.now)
  writeStore(storePath, store)
  return true
}

export function serveInvitesPath(options: StoreOptions): string {
  return resolve(serveStateDir(options), 'invites.json')
}

export function encodeInvitePayload(payload: ServeInvitePayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url')
}

export function decodeInvitePayload(invite: string): ServeInvitePayload {
  const encoded = invitePayloadString(invite)
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'))
  } catch {
    throw new Error('Invalid shared workspace invite')
  }
  if (!isInvitePayload(parsed)) throw new Error('Invalid shared workspace invite')
  return {
    ...parsed,
    namespaces: normalizeNamespaces(parsed.namespaces),
  }
}

function invitePayloadString(invite: string): string {
  const value = invite.trim()
  if (value.startsWith('mim-invite-')) return value.slice('mim-invite-'.length)
  if (value.startsWith('mim://')) {
    try {
      const url = new URL(value)
      if (url.protocol === 'mim:' && url.hostname === 'join') {
        const payload = url.pathname.replace(/^\/+/, '')
        if (payload) return payload
      }
    } catch {
      // handled below
    }
  }
  throw new Error('Invalid shared workspace invite')
}

function isInvitePayload(value: unknown): value is ServeInvitePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as ServeInvitePayload
  return payload.v === 1
    && typeof payload.id === 'string'
    && typeof payload.secret === 'string'
    && typeof payload.url === 'string'
    && typeof payload.workspaceId === 'string'
    && typeof payload.workspaceName === 'string'
    && typeof payload.callerName === 'string'
    && Array.isArray(payload.namespaces)
    && (payload.expiresAt === undefined || typeof payload.expiresAt === 'string')
}

function readStore(path: string): ServeInviteStore {
  if (!existsSync(path)) return { version: 1, invites: [] }
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ServeInviteStore>
  return {
    version: 1,
    invites: Array.isArray(parsed.invites) ? parsed.invites.filter(isServeInviteRecord) : [],
  }
}

function writeStore(path: string, store: ServeInviteStore): void {
  atomicWriteJson(path, store)
}

function isServeInviteRecord(value: unknown): value is ServeInviteRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as ServeInviteRecord
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.hash === 'string'
    && typeof record.url === 'string'
    && typeof record.workspaceId === 'string'
    && typeof record.workspaceName === 'string'
    && Array.isArray(record.namespaces)
    && record.namespaces.every(namespace => typeof namespace === 'string')
    && typeof record.createdAt === 'string'
}

function normalizeCallerName(name: string): string {
  const clean = name.trim()
  if (!clean) throw new Error('Serve invite name is required')
  return clean.slice(0, 80)
}

function normalizeDisplayName(name: string): string {
  const clean = name.trim()
  if (!clean) throw new Error('Shared workspace name is required')
  return clean.slice(0, 80)
}

function normalizeWorkspaceId(id: string): string {
  const clean = id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!SHARED_WORKSPACE_ID_PATTERN.test(clean)) throw new Error(`Invalid shared workspace id: ${id}`)
  return clean
}

function normalizeNamespaces(namespaces: string[]): string[] {
  const clean = [...new Set(namespaces.map(item => item.trim()).filter(Boolean))].sort()
  if (clean.length === 0) throw new Error('Invite must include at least one shared workspace namespace')
  return clean
}

function normalizeMcpUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Invite URL must be http(s)')
  if (parsed.username || parsed.password) throw new Error('Invite URL must not include credentials')
  return parsed.toString()
}

function inviteNamespaceGrant(namespaces: string[]): ServeGrant {
  const base = defaultServeGrant()
  return {
    effects: ['read', 'mutate'],
    tools: [...new Set([...base.tools, ...normalizeNamespaces(namespaces)])],
    ...(base.paths ? { paths: [...base.paths] } : {}),
  }
}

function cloneGrant(grant: ServeGrant): ServeGrant {
  return {
    effects: [...grant.effects],
    tools: [...grant.tools],
    ...(grant.paths ? { paths: [...grant.paths] } : {}),
  }
}

function hashInviteSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf-8').digest('hex')
}

function inviteSecretsEqual(storedHash: string, secret: string): boolean {
  const actual = Buffer.from(hashInviteSecret(secret), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function isoNow(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString()
}
