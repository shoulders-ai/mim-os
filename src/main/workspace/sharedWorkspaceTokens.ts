import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { userHomeDir } from '@main/platform.js'
import { SHARED_WORKSPACE_ID_PATTERN } from './workspaceContract.js'

export interface SharedWorkspaceTokenOptions {
  home?: string
}

function keysPath(home?: string): string {
  return join(home ?? userHomeDir(), '.mim', 'keys.env')
}

function assertSharedWorkspaceId(id: string): void {
  if (!SHARED_WORKSPACE_ID_PATTERN.test(id)) throw new Error(`Invalid shared workspace id: ${id}`)
}

export function sharedWorkspaceTokenEnvKey(id: string): string {
  assertSharedWorkspaceId(id)
  return `MIM_SHARED_WORKSPACE_${id.replace(/-/g, '_').toUpperCase()}_TOKEN`
}

export function readSharedWorkspaceToken(
  id: string,
  opts?: SharedWorkspaceTokenOptions,
): string | null {
  const key = sharedWorkspaceTokenEnvKey(id)
  const path = keysPath(opts?.home)
  if (!existsSync(path)) return null

  const content = readFileSync(path, 'utf-8')
  for (const line of content.split(/\r\n|\n|\r/)) {
    const [rawKey, ...rest] = line.split('=')
    if (rawKey?.trim() === key && rest.length) {
      const value = rest.join('=').trim().replace(/^["']|["']$/g, '')
      return value || null
    }
  }
  return null
}

export function writeSharedWorkspaceToken(
  id: string,
  token: string,
  opts?: SharedWorkspaceTokenOptions,
): void {
  if (!token || typeof token !== 'string') throw new Error('Missing required token')
  const key = sharedWorkspaceTokenEnvKey(id)
  const dir = join(opts?.home ?? userHomeDir(), '.mim')
  const path = join(dir, 'keys.env')
  mkdirSync(dir, { recursive: true })

  let content = ''
  if (existsSync(path)) {
    content = readFileSync(path, 'utf-8')
      .split(/\r\n|\n|\r/)
      .filter(line => !line.startsWith(`${key}=`))
      .join('\n')
  }

  content = `${content.trimEnd()}\n${key}=${token}\n`
  writeFileSync(path, content, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export function clearSharedWorkspaceToken(
  id: string,
  opts?: SharedWorkspaceTokenOptions,
): void {
  const key = sharedWorkspaceTokenEnvKey(id)
  const path = keysPath(opts?.home)
  if (!existsSync(path)) return
  const remaining = readFileSync(path, 'utf-8')
    .split(/\r\n|\n|\r/)
    .filter(line => !line.startsWith(`${key}=`) && line.length > 0)
  const content = remaining.length > 0 ? `${remaining.join('\n')}\n` : ''
  writeFileSync(path, content, { mode: 0o600 })
  chmodSync(path, 0o600)
}
