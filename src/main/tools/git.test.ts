import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry, type ToolRegistry } from '@main/tools/registry.js'
import { registerGitTools } from './git.js'

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

maybeDescribe('git tools', () => {
  let root: string
  let tools: ToolRegistry

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-git-tools-'))
    git(root, ['init'])
    git(root, ['config', 'user.name', 'Mim Test'])
    git(root, ['config', 'user.email', 'mim@example.test'])
    writeFileSync(join(root, 'README.md'), 'initial\n')
    writeFileSync(join(root, '.gitignore'), '.mim/\n')
    git(root, ['add', '-A'])
    git(root, ['commit', '-m', 'initial'])

    tools = createToolRegistry(createTraceLog({ devConsole: false }))
    tools.setWorkspacePath(root)
    registerGitTools(tools)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reports status, diff, log, and creates a commit', async () => {
    writeFileSync(join(root, 'README.md'), 'changed\n')

    const status = await tools.call('git.status', {}, { actor: 'user' }) as { status: string; clean: boolean }
    expect(status.clean).toBe(false)
    expect(status.status).toContain('README.md')

    const diff = await tools.call('git.diff', { path: 'README.md' }, { actor: 'user' }) as { diff: string }
    expect(diff.diff).toContain('-initial')
    expect(diff.diff).toContain('+changed')

    await tools.call('git.commit', { message: 'update readme' }, { actor: 'user' })
    const clean = await tools.call('git.status', {}, { actor: 'user' }) as { clean: boolean }
    expect(clean.clean).toBe(true)

    const log = await tools.call('git.log', { limit: 2 }, { actor: 'user' }) as { log: string }
    expect(log.log).toContain('update readme')
    expect(readFileSync(join(root, 'README.md'), 'utf-8')).toBe('changed\n')
  })
})
