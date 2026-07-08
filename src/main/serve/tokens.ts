import { existsSync, readFileSync } from 'fs'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { isAbsolute, relative, resolve, sep } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'
import type { ToolEffect, RemoteGrantRequest, RemoteGrantDecision } from '@main/security/gate.js'
import { userHomeDir } from '@main/platform.js'

export interface ServeGrant {
  effects: ToolEffect[]
  tools: string[]
  paths?: string[]
}

export interface ServeCallerRecord {
  id: string
  name: string
  hash: string
  grants: ServeGrant
  createdAt: string
  lastSeenAt?: string
  revokedAt?: string
}

export interface ListedServeCaller extends Omit<ServeCallerRecord, 'hash'> {
  hash?: undefined
}

export interface ServeCallerIdentity {
  actor: 'remote'
  principal: string
  callerName: string
  transport: 'mcp-http'
  grants: ServeGrant
}

export interface ServeTokenResult {
  token: string
  record: ServeCallerRecord
  snippets: ServeSetupSnippets
  storePath: string
}

export interface ServeSetupSnippets {
  claude: string
  codex: string
  gemini: string
  curl: string
}

interface ServeCallerStore {
  version: 1
  callers: ServeCallerRecord[]
}

interface StoreOptions {
  home?: string
  workspacePath: string
}

interface TokenMutationOptions extends StoreOptions {
  now?: () => Date
}

export interface CreateServeTokenOptions extends TokenMutationOptions {
  name: string
  token?: string
  grants?: ServeGrant
  url?: string
}

export interface RotateServeTokenOptions extends TokenMutationOptions {
  id: string
  token?: string
  url?: string
}

export interface RevokeServeTokenOptions extends TokenMutationOptions {
  id: string
}

export interface ValidateServeTokenOptions extends TokenMutationOptions {
  token: string
}

const DEFAULT_GRANT: ServeGrant = {
  effects: ['read'],
  tools: [
    'workspace.info',
    'fs.read',
    'fs.list',
    'fs.exists',
    'search.files',
    'skill.list',
    'skill.get',
    'log.read',
    'trace.query',
  ],
  paths: ['.'],
}

const DEFAULT_MCP_URL = 'http://127.0.0.1:4780/mcp'

export function createServeToken(options: CreateServeTokenOptions): ServeTokenResult {
  const token = options.token ?? mintServeToken()
  const now = isoNow(options.now)
  const storePath = serveCallersPath(options)
  const store = readStore(storePath)
  const record: ServeCallerRecord = {
    id: `caller_${randomBytes(8).toString('hex')}`,
    name: normalizeCallerName(options.name),
    hash: hashServeToken(token),
    grants: cloneGrant(options.grants ?? DEFAULT_GRANT),
    createdAt: now,
  }
  store.callers.push(record)
  writeStore(storePath, store)
  return {
    token,
    record,
    snippets: createServeSnippets({ token, url: options.url }),
    storePath,
  }
}

export function defaultServeGrant(): ServeGrant {
  return cloneGrant(DEFAULT_GRANT)
}

export function listServeCallers(options: StoreOptions): ListedServeCaller[] {
  return readStore(serveCallersPath(options)).callers.map(({ hash: _hash, ...caller }) => ({
    ...caller,
    hash: undefined,
  }))
}

export function validateServeToken(options: ValidateServeTokenOptions): ServeCallerIdentity | null {
  const storePath = serveCallersPath(options)
  const store = readStore(storePath)
  const caller = store.callers.find(record => !record.revokedAt && tokenHashesEqual(record.hash, options.token))
  if (!caller) return null

  caller.lastSeenAt = isoNow(options.now)
  writeStore(storePath, store)
  return {
    actor: 'remote',
    principal: caller.id,
    callerName: caller.name,
    transport: 'mcp-http',
    grants: cloneGrant(caller.grants),
  }
}

export function rotateServeToken(options: RotateServeTokenOptions): ServeTokenResult {
  const token = options.token ?? mintServeToken()
  const storePath = serveCallersPath(options)
  const store = readStore(storePath)
  const caller = store.callers.find(record => record.id === options.id)
  if (!caller) throw new Error(`Unknown serve caller: ${options.id}`)

  caller.hash = hashServeToken(token)
  caller.revokedAt = undefined
  writeStore(storePath, store)
  return {
    token,
    record: caller,
    snippets: createServeSnippets({ token, url: options.url }),
    storePath,
  }
}

export function revokeServeToken(options: RevokeServeTokenOptions): boolean {
  const storePath = serveCallersPath(options)
  const store = readStore(storePath)
  const caller = store.callers.find(record => record.id === options.id)
  if (!caller) return false
  caller.revokedAt = isoNow(options.now)
  writeStore(storePath, store)
  return true
}

export function hasActiveServeCallers(options: StoreOptions): boolean {
  return readStore(serveCallersPath(options)).callers.some(caller => !caller.revokedAt)
}

export function createServeRemoteGrantResolver(options: StoreOptions) {
  return (request: RemoteGrantRequest): RemoteGrantDecision => {
    const principal = request.ctx.principal
    if (!principal) return { allowed: false, reason: 'Missing remote principal' }

    const caller = readStore(serveCallersPath(options)).callers.find(record => record.id === principal)
    if (!caller || caller.revokedAt) return { allowed: false, reason: 'Serve caller is not active' }

    const grant = caller.grants
    if (isServeExecutableWorkspaceTool(request.toolName)) {
      return { allowed: false, reason: 'Remote callers cannot change executable or prompt-bearing workspace surfaces' }
    }
    if (!grant.effects.includes(request.effect)) {
      return { allowed: false, reason: `Grant does not include ${request.effect} effects` }
    }
    if (!toolGranted(grant.tools, request.toolName)) {
      return { allowed: false, reason: `Grant does not include ${request.toolName}` }
    }

    for (const path of request.paths) {
      if (!path.absolutePath) continue
      if (path.kind === 'sensitive' || path.kind === 'outside-workspace' || path.kind === 'invalid') {
        return { allowed: false, reason: path.reason }
      }
      if (request.effect === 'mutate' && isServeExecutableWorkspacePath(options.workspacePath, path.absolutePath)) {
        return { allowed: false, reason: 'Remote callers cannot write executable or prompt-bearing workspace paths' }
      }
      if (grant.paths && !pathGranted(options.workspacePath, grant.paths, path.absolutePath)) {
        return { allowed: false, reason: 'Grant path scope does not include requested path' }
      }
    }

    return { allowed: true, reason: 'serve grant', grantId: caller.id }
  }
}

export function serveCallersPath(options: StoreOptions): string {
  return resolve(serveStateDir(options), 'callers.json')
}

export function serveStateDir(options: StoreOptions): string {
  const home = options.home ?? userHomeDir()
  return resolve(home, '.mim', 'serve', workspaceKey(options.workspacePath))
}

export function createServeSnippets(options: { token: string; url?: string }): ServeSetupSnippets {
  const url = options.url ?? DEFAULT_MCP_URL
  const escapedUrl = shellQuote(url)
  return {
    claude: `claude mcp add mim ${escapedUrl} --header "Authorization: Bearer ${options.token}"`,
    codex: `[mcp_servers.mim]\nurl = "${url}"\nheaders = { Authorization = "Bearer ${options.token}" }`,
    gemini: `{"mcpServers":{"mim":{"httpUrl":"${url}","headers":{"Authorization":"Bearer ${options.token}"}}}}`,
    curl: `curl -s ${escapedUrl} -H ${shellQuote(`Authorization: Bearer ${options.token}`)} -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  }
}

function readStore(path: string): ServeCallerStore {
  if (!existsSync(path)) return { version: 1, callers: [] }
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ServeCallerStore>
  return {
    version: 1,
    callers: Array.isArray(parsed.callers) ? parsed.callers.filter(isServeCallerRecord) : [],
  }
}

function writeStore(path: string, store: ServeCallerStore): void {
  atomicWriteJson(path, store)
}

function normalizeCallerName(name: string): string {
  const clean = name.trim()
  if (!clean) throw new Error('Serve token name is required')
  return clean.slice(0, 80)
}

function mintServeToken(): string {
  return `mim_serve_${randomBytes(32).toString('base64url')}`
}

function hashServeToken(token: string): string {
  return createHash('sha256').update(token, 'utf-8').digest('hex')
}

function tokenHashesEqual(storedHash: string, token: string): boolean {
  const actual = Buffer.from(hashServeToken(token), 'hex')
  const expected = Buffer.from(storedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function workspaceKey(workspacePath: string): string {
  return createHash('sha256').update(resolve(workspacePath), 'utf-8').digest('hex').slice(0, 24)
}

function isoNow(now?: () => Date): string {
  return (now?.() ?? new Date()).toISOString()
}

function cloneGrant(grant: ServeGrant): ServeGrant {
  return {
    effects: [...grant.effects],
    tools: [...grant.tools],
    ...(grant.paths ? { paths: [...grant.paths] } : {}),
  }
}

function toolGranted(granted: string[], toolName: string): boolean {
  return granted.some(entry => entry === toolName || (entry.endsWith('.*') && toolName.startsWith(entry.slice(0, -1))))
}

function pathGranted(workspacePath: string, scopes: string[], absolutePath: string): boolean {
  const target = resolve(absolutePath)
  return scopes.some(scope => {
    const root = isAbsolute(scope) ? resolve(scope) : resolve(workspacePath, scope)
    return target === root || target.startsWith(`${root}${sep}`)
  })
}

function isServeExecutableWorkspacePath(workspacePath: string, absolutePath: string): boolean {
  const rel = relative(resolve(workspacePath), resolve(absolutePath))
  if (rel.startsWith('..') || isAbsolute(rel)) return false
  const segments = rel.split(/[\\/]+/)
  const first = segments[0]
  const basename = segments[segments.length - 1]
  if (rel === 'AGENTS.md' || rel === 'CLAUDE.md' || rel === 'mim.yaml') return true
  if (first === 'skills' || first === 'routines' || first === 'packages') return true
  return basename === 'package.json' && segments.includes('packages')
}

function isServeExecutableWorkspaceTool(toolName: string): boolean {
  return EXECUTABLE_WORKSPACE_TOOLS.has(toolName)
}

const EXECUTABLE_WORKSPACE_TOOLS = new Set([
  'app.add',
  'app.share',
  'app.enable',
  'app.disable',
  'app.trust',
  'app.remove',
  'package.create',
  'package.edit',
  'package.delete',
  'package.install',
  'package.update',
  'package.uninstall',
  'registry.trust',
  'registry.addSource',
  'registry.removeSource',
  'skill.create',
  'skill.import',
  'skill.delete',
  'skill.setDisabled',
  'routine.create',
  'routine.pause',
  'routine.resume',
  'routine.run',
])

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function isServeCallerRecord(value: unknown): value is ServeCallerRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as ServeCallerRecord
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.hash === 'string'
    && typeof record.createdAt === 'string'
    && isGrant(record.grants)
}

function isGrant(value: unknown): value is ServeGrant {
  if (!value || typeof value !== 'object') return false
  const grant = value as ServeGrant
  return Array.isArray(grant.effects)
    && grant.effects.every(effect => effect === 'read' || effect === 'mutate' || effect === 'external')
    && Array.isArray(grant.tools)
    && grant.tools.every(tool => typeof tool === 'string')
    && (grant.paths === undefined || (Array.isArray(grant.paths) && grant.paths.every(path => typeof path === 'string')))
}
