import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry, type ToolRegistry } from '@main/tools/registry.js'
import { registerSyncTools } from './sync.js'

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const maybeDescribe = hasGit ? describe : describe.skip

function git(dir: string, args: string[]) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
}

function gitOutput(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' }).trim()
}

describe('sync tools', () => {
  let root: string
  let tools: ToolRegistry

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-sync-tools-'))
    writeFileSync(join(root, 'mim.yaml'), 'name: Sync Test\n')
    tools = createToolRegistry(createTraceLog({ devConsole: false }))
    tools.setWorkspacePath(root)
    registerSyncTools(tools)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reports manual mode by default and refuses sync.now', async () => {
    const status = await tools.call('sync.status', {}, { actor: 'user' }) as { mode: string; state: string; message: string }
    expect(status.mode).toBe('manual')
    expect(status.state).toBe('manual')
    expect(status.message).toContain('Manual')

    await expect(tools.call('sync.now', {}, { actor: 'user' })).rejects.toThrow('Managed sync is not enabled')
  })
})

maybeDescribe('sync tools with git', () => {
  let root: string
  let remoteRoot: string
  let tools: ToolRegistry

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-sync-git-tools-'))
    remoteRoot = mkdtempSync(join(tmpdir(), 'mim-sync-remote-'))
    writeFileSync(join(root, 'mim.yaml'), 'name: Sync Test\n')
    tools = createToolRegistry(createTraceLog({ devConsole: false }))
    tools.setWorkspacePath(root)
    registerSyncTools(tools)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(remoteRoot, { recursive: true, force: true })
  })

  it('makes managed mode explicit in mim.yaml and initializes git', async () => {
    const status = await tools.call('sync.configure', {
      mode: 'managed',
      remote: 'https://github.com/acme/work.git',
    }, { actor: 'user' }) as { mode: string; state: string; remote: string | null }

    expect(status.mode).toBe('managed')
    expect(status.remote).toBe('https://github.com/acme/work.git')
    expect(existsSync(join(root, '.git'))).toBe(true)
    expect(readFileSync(join(root, 'mim.yaml'), 'utf-8')).toContain('mode: managed')
  })

  it('sets upstream on the first managed push to an empty remote', async () => {
    execFileSync('git', ['init', '--bare', remoteRoot], { stdio: 'ignore' })

    await tools.call('sync.configure', {
      mode: 'managed',
      remote: remoteRoot,
    }, { actor: 'user' })
    git(root, ['config', 'user.name', 'Mim Test'])
    git(root, ['config', 'user.email', 'mim@example.test'])
    writeFileSync(join(root, 'draft.md'), 'hello\n')

    const status = await tools.call('sync.now', {}, { actor: 'user' }) as { state: string; ahead: boolean; behind: boolean }

    expect(status.state).toBe('synced')
    expect(status.ahead).toBe(false)
    expect(status.behind).toBe(false)
    expect(gitOutput(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).toContain('origin/')
    expect(readFileSync(join(root, '.gitignore'), 'utf-8').split('\n')).toContain('.mim/')
    expect(gitOutput(root, ['ls-files', '.mim'])).toBe('')
    expect(execFileSync('git', ['--git-dir', remoteRoot, 'log', '--oneline'], { encoding: 'utf-8' })).toContain('Mim sync')
  })

  it('fast-forwards changes from another checkout and returns to synced', async () => {
    execFileSync('git', ['init', '--bare', remoteRoot], { stdio: 'ignore' })
    await tools.call('sync.configure', {
      mode: 'managed',
      remote: remoteRoot,
    }, { actor: 'user' })
    git(root, ['config', 'user.name', 'Mim Test'])
    git(root, ['config', 'user.email', 'mim@example.test'])
    writeFileSync(join(root, 'project.md'), 'initial\n')
    await tools.call('sync.now', {}, { actor: 'user' })

    const peer = mkdtempSync(join(tmpdir(), 'mim-sync-peer-'))
    try {
      execFileSync('git', ['clone', remoteRoot, peer], { stdio: 'ignore' })
      git(peer, ['config', 'user.name', 'Mim Peer'])
      git(peer, ['config', 'user.email', 'peer@example.test'])
      writeFileSync(join(peer, 'from-peer.md'), 'shared update\n')
      git(peer, ['add', '-A'])
      git(peer, ['commit', '-m', 'Peer update'])
      git(peer, ['push'])

      const status = await tools.call('sync.now', {}, { actor: 'user' }) as {
        state: string
        dirty: boolean
        ahead: boolean
        behind: boolean
      }

      expect(status).toMatchObject({
        state: 'synced',
        dirty: false,
        ahead: false,
        behind: false,
      })
      expect(readFileSync(join(root, 'from-peer.md'), 'utf-8')).toBe('shared update\n')
      expect(gitOutput(root, ['log', '-1', '--pretty=%s'])).toBe('Peer update')
    } finally {
      rmSync(peer, { recursive: true, force: true })
    }
  })
})
