import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerAwarenessTools } from './awareness.js'

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

describe('Git-derived awareness', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('shows fetched changes and their author on a second client', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'mim-awareness-remote-'))
    const clientA = mkdtempSync(join(tmpdir(), 'mim-awareness-a-'))
    const clientB = mkdtempSync(join(tmpdir(), 'mim-awareness-b-'))
    roots.push(remote, clientA, clientB)
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' })
    git(clientA, ['init'])
    git(clientA, ['config', 'user.name', 'Initial Author'])
    git(clientA, ['config', 'user.email', 'initial@example.test'])
    git(clientA, ['remote', 'add', 'origin', remote])
    writeFileSync(join(clientA, 'report.md'), 'initial\n')
    git(clientA, ['add', '-A'])
    git(clientA, ['commit', '-m', 'Initial report'])
    git(clientA, ['push', '-u', 'origin', 'HEAD'])
    execFileSync('git', ['clone', remote, clientB], { stdio: 'ignore' })

    git(clientA, ['config', 'user.name', 'Ada Lovelace'])
    writeFileSync(join(clientA, 'report.md'), 'peer update\n')
    git(clientA, ['add', '-A'])
    git(clientA, ['commit', '-m', 'Refresh findings'])
    git(clientA, ['push'])
    git(clientB, ['pull', '--ff-only'])

    const tools = createToolRegistry(createTraceLog({ devConsole: false }))
    tools.setWorkspacePath(clientB)
    registerAwarenessTools(tools)
    const result = await tools.call('awareness.recent', { limit: 10 }, { actor: 'user' }) as {
      changes: Array<Record<string, unknown>>
    }

    expect(result.changes[0]).toMatchObject({
      origin: 'project',
      path: 'report.md',
      author: 'Ada Lovelace',
      summary: 'Refresh findings',
    })
  })
})
