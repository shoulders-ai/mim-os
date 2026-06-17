import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  resolveBootWorkspace,
  recordLastWorkspace,
  lastWorkspaceFile,
  isDefaultWorkspace,
  defaultWorkspacePath,
} from '@main/workspace/workspaceBoot.js'

describe('workspace boot resolution', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-home-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('creates and returns the default workspace when nothing was opened before', () => {
    const resolved = resolveBootWorkspace(home)
    expect(resolved).toBe(join(home, 'mim-workspace'))
    // The whole point: the directory must actually exist so workspace.open succeeds.
    expect(existsSync(resolved)).toBe(true)
  })

  it('restores the last-opened workspace when it still exists', () => {
    const prev = join(home, 'projects', 'alpha')
    mkdirSync(prev, { recursive: true })
    recordLastWorkspace(home, prev)

    expect(resolveBootWorkspace(home)).toBe(prev)
  })

  it('falls back to the default when the last workspace was deleted', () => {
    const prev = join(home, 'projects', 'gone')
    mkdirSync(prev, { recursive: true })
    recordLastWorkspace(home, prev)
    rmSync(prev, { recursive: true, force: true })

    const resolved = resolveBootWorkspace(home)
    expect(resolved).toBe(join(home, 'mim-workspace'))
    expect(existsSync(resolved)).toBe(true)
  })

  it('round-trips the recorded workspace path through disk', () => {
    const ws = join(home, 'projects', 'beta')
    mkdirSync(ws, { recursive: true })
    recordLastWorkspace(home, ws)

    expect(existsSync(lastWorkspaceFile(home))).toBe(true)
    expect(readFileSync(lastWorkspaceFile(home), 'utf-8').trim()).toBe(ws)
  })

  it('ignores a blank last-workspace file', () => {
    mkdirSync(join(home, '.mim'), { recursive: true })
    writeFileSync(lastWorkspaceFile(home), '   \n')

    expect(resolveBootWorkspace(home)).toBe(join(home, 'mim-workspace'))
  })
})

describe('isDefaultWorkspace', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-home-'))
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('returns true for the app-created default workspace path', () => {
    expect(isDefaultWorkspace(home, join(home, 'mim-workspace'))).toBe(true)
  })

  it('returns false for a user-opened workspace', () => {
    expect(isDefaultWorkspace(home, join(home, 'projects', 'my-app'))).toBe(false)
  })

  it('returns false for a path that looks similar but is not exact', () => {
    expect(isDefaultWorkspace(home, join(home, 'mim-workspace-2'))).toBe(false)
  })
})

describe('defaultWorkspacePath', () => {
  it('returns ~/mim-workspace for a given home directory', () => {
    expect(defaultWorkspacePath('/Users/test')).toBe('/Users/test/mim-workspace')
  })
})
