import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerLogbookTools } from '@main/tools/logbook.js'

const ctx = { actor: 'user' as const }

describe('logbook tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-logbook-tools-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerLogbookTools(tools, { now: () => Date.parse('2026-06-01T12:34:56.000Z') })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('declares inputSchema on every logbook tool', () => {
    for (const name of ['log.append', 'log.read']) {
      const def = tools.get(name)
      expect(def, name).toBeDefined()
      expect(def!.inputSchema, name).toBeDefined()
      expect((def as Record<string, unknown>).parameters, name).toBeUndefined()
    }
  })

  it('throws "No workspace open" when no workspace is set', async () => {
    const detached = createToolRegistry(createTraceLog())
    registerLogbookTools(detached)

    await expect(detached.call('log.append', { message: 'X' }, ctx)).rejects.toThrow('No workspace open')
    await expect(detached.call('log.read', {}, ctx)).rejects.toThrow('No workspace open')
  })

  it('log.append writes .mim/log.md for the current workspace', async () => {
    const result = await tools.call('log.append', { message: 'Finished pass' }, ctx) as {
      path: string
      entry: { actor: string; message: string }
    }

    expect(result.path).toBe(join(dir, '.mim', 'log.md'))
    expect(result.entry).toMatchObject({ actor: 'user', message: 'Finished pass' })
    expect(readFileSync(join(dir, '.mim', 'log.md'), 'utf-8')).toContain('[user] Finished pass')
  })

  it('log.append preserves package actor identity', async () => {
    await tools.call(
      'log.append',
      { message: 'Package note' },
      { actor: 'package', package_id: 'board' },
    )

    expect(readFileSync(join(dir, '.mim', 'log.md'), 'utf-8')).toContain('[package board] Package note')
  })

  it('log.read reports an absent log without creating it', async () => {
    const result = await tools.call('log.read', {}, ctx) as { exists: boolean; content: string }

    expect(result.exists).toBe(false)
    expect(result.content).toBe('')
    expect(existsSync(join(dir, '.mim', 'log.md'))).toBe(false)
  })

  it('log.read honors max_chars', async () => {
    await tools.call('log.append', { message: 'First entry' }, ctx)
    await tools.call('log.append', { message: 'Second entry' }, ctx)

    const result = await tools.call('log.read', { max_chars: 28 }, ctx) as {
      content: string
      truncated: boolean
    }
    expect(result.truncated).toBe(true)
    expect(result.content).toContain('Second entry')
    expect(result.content.length).toBeLessThanOrEqual(28)
  })
})
