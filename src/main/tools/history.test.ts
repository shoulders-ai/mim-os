import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry, type ToolRegistry } from '@main/tools/registry.js'
import { registerFileTools } from '@main/tools/fs.js'
import { createHistoryStore } from '@main/history/history.js'
import { registerHistoryTools } from './history.js'

describe('history tools', () => {
  let root: string
  let tools: ToolRegistry

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-history-tools-'))
    const trace = createTraceLog({ devConsole: false })
    trace.setWorkspacePath(root)
    const history = createHistoryStore({ getWorkspacePath: () => tools.getWorkspacePath() })
    tools = createToolRegistry(trace, undefined, { history: history.toolObserver() })
    tools.setWorkspacePath(root)
    registerFileTools(tools)
    registerHistoryTools(tools, history)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('lists versions captured from fs.write and restores a previous version', async () => {
    await tools.call('fs.write', { path: 'paper.md', content: 'first' }, { actor: 'ai', sessionId: 's1' })
    await tools.call('fs.write', { path: 'paper.md', content: 'second' }, { actor: 'ai', sessionId: 's1' })

    const list = await tools.call('history.list', { path: 'paper.md' }, { actor: 'user' }) as {
      versions: Array<{ id: string; event: string; actor: string }>
    }
    expect(list.versions.some(version => version.actor === 'agent')).toBe(true)
    const first = list.versions.find(version => version.event === 'before-write')
    expect(first).toBeDefined()

    const preview = await tools.call('history.preview', {
      path: 'paper.md',
      version_id: first!.id,
    }, { actor: 'user' }) as { kind: string; content: string }
    expect(preview).toMatchObject({ kind: 'text', content: 'first' })

    await tools.call('history.restore', {
      path: 'paper.md',
      version_id: first!.id,
    }, { actor: 'user' })
    expect(readFileSync(join(root, 'paper.md'), 'utf-8')).toBe('first')
  })

  it('captures hard deletes before removal and can restore the file', async () => {
    writeFileSync(join(root, 'notes.md'), 'important')
    await tools.call('history.baseline', {}, { actor: 'system' })
    await tools.call('fs.delete', { path: 'notes.md' }, { actor: 'ai', sessionId: 's1' })
    expect(existsSync(join(root, 'notes.md'))).toBe(false)

    const list = await tools.call('history.list', { path: 'notes.md', include_folded: true }, { actor: 'user' }) as {
      current: { deleted: boolean }
      versions: Array<{ id: string; event: string }>
    }
    expect(list.current.deleted).toBe(true)
    const preDelete = list.versions.find(version => version.event === 'before-delete')
    expect(preDelete).toBeDefined()

    await tools.call('history.restore', { path: 'notes.md', version_id: preDelete!.id }, { actor: 'user' })
    expect(readFileSync(join(root, 'notes.md'), 'utf-8')).toBe('important')
  })

  it('reports storage stats and clears only recovery points', async () => {
    await tools.call('fs.write', { path: 'paper.md', content: 'draft' }, { actor: 'user' })
    await tools.call('fs.write', { path: 'paper.md', content: 'revised' }, { actor: 'user' })

    const stats = await tools.call('history.stats', {}, { actor: 'user' }) as { versionCount: number; bytes: number }
    expect(stats.versionCount).toBeGreaterThan(0)
    expect(stats.bytes).toBeGreaterThan(0)

    await tools.call('history.clear', {}, { actor: 'user' })
    expect(readFileSync(join(root, 'paper.md'), 'utf-8')).toBe('revised')
    const after = await tools.call('history.stats', {}, { actor: 'user' }) as { versionCount: number }
    expect(after.versionCount).toBe(0)
  })

  it('opens a recovery version as a temp file and prunes folded history', async () => {
    await tools.call('fs.write', { path: 'paper.md', content: 'first' }, { actor: 'user' })
    await tools.call('fs.write', { path: 'paper.md', content: 'second' }, { actor: 'user' })

    const list = await tools.call('history.list', { path: 'paper.md', include_folded: true }, { actor: 'user' }) as {
      versions: Array<{ id: string; event: string }>
    }
    const first = list.versions.find(version => version.event === 'before-write')
    const temp = await tools.call('history.openVersion', {
      path: 'paper.md',
      version_id: first!.id,
    }, { actor: 'user' }) as { path: string }

    expect(readFileSync(temp.path, 'utf-8')).toBe('first')

    const result = await tools.call('history.prune', {}, { actor: 'user' }) as { beforeVersions: number; afterVersions: number }
    expect(result.afterVersions).toBeLessThanOrEqual(result.beforeVersions)
  })
})
