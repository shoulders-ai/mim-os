import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearSharedWorkspaceToken,
  readSharedWorkspaceToken,
  sharedWorkspaceTokenEnvKey,
  writeSharedWorkspaceToken,
} from './sharedWorkspaceTokens.js'

let tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs = []
})

function makeHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mim-shared-workspace-token-'))
  tempDirs.push(dir)
  return dir
}

describe('sharedWorkspaceTokens', () => {
  it('derives a deterministic env key from the shared workspace id', () => {
    expect(sharedWorkspaceTokenEnvKey('team-server')).toBe('MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN')
  })

  it('reads null when keys.env is missing', () => {
    expect(readSharedWorkspaceToken('team-server', { home: makeHome() })).toBeNull()
  })

  it('reads a stored token and strips simple quotes', () => {
    const home = makeHome()
    const dir = join(home, '.mim')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'keys.env'), 'MIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN="tok_abc=123"\n')

    expect(readSharedWorkspaceToken('team-server', { home })).toBe('tok_abc=123')
  })

  it('writes a token to keys.env with owner-only file permissions', () => {
    const home = makeHome()
    writeSharedWorkspaceToken('team-server', 'tok_new', { home })

    const keysPath = join(home, '.mim', 'keys.env')
    expect(readFileSync(keysPath, 'utf-8')).toBe('\nMIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN=tok_new\n')
    expect(statSync(keysPath).mode & 0o777).toBe(0o600)
  })

  it('replaces an existing token while preserving unrelated keys', () => {
    const home = makeHome()
    const dir = join(home, '.mim')
    mkdirSync(dir, { recursive: true })
    const keysPath = join(dir, 'keys.env')
    writeFileSync(keysPath, 'OTHER_KEY=keep\nMIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN=old\n')
    chmodSync(keysPath, 0o644)

    writeSharedWorkspaceToken('team-server', 'tok_replaced', { home })

    expect(readFileSync(keysPath, 'utf-8')).toBe('OTHER_KEY=keep\nMIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN=tok_replaced\n')
    expect(statSync(keysPath).mode & 0o777).toBe(0o600)
  })

  it('clears a stored token and leaves the file in place for other keys', () => {
    const home = makeHome()
    const dir = join(home, '.mim')
    mkdirSync(dir, { recursive: true })
    const keysPath = join(dir, 'keys.env')
    writeFileSync(keysPath, 'OTHER_KEY=keep\nMIM_SHARED_WORKSPACE_TEAM_SERVER_TOKEN=tok_old\n')

    clearSharedWorkspaceToken('team-server', { home })

    expect(readFileSync(keysPath, 'utf-8')).toBe('OTHER_KEY=keep\n')
    expect(statSync(keysPath).mode & 0o777).toBe(0o600)
  })

  it('accepts clearing a missing token file', () => {
    const home = makeHome()

    clearSharedWorkspaceToken('team-server', { home })

    expect(existsSync(join(home, '.mim', 'keys.env'))).toBe(false)
  })

  it('rejects invalid shared workspace ids', () => {
    expect(() => sharedWorkspaceTokenEnvKey('Bad Name')).toThrow(/Invalid shared workspace id/)
    expect(() => writeSharedWorkspaceToken('Bad Name', 'tok', { home: makeHome() })).toThrow(/Invalid shared workspace id/)
  })
})
