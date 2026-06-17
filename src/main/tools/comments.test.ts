import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerCommentTools } from './comments.js'

describe('comment tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-comments-test-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerCommentTools(tools, {
      now: () => new Date('2026-06-13T09:30:24.000Z'),
      userName: () => 'Paul Smith',
      generateId: () => 'c001',
    })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists comment threads with raw line numbers', async () => {
    writeFileSync(join(dir, 'plan.md'), [
      '# Plan',
      '',
      'We propose <comment id="k3f9">a staged rollout<note by="paul" at="2026-06-13T09:14">Too slow</note></comment>.',
    ].join('\n'))

    const result = await tools.call('comments.list', { path: 'plan.md' }, ctx) as { threads: Array<Record<string, unknown>> }

    expect(result.threads).toHaveLength(1)
    expect(result.threads[0]).toMatchObject({
      id: 'k3f9',
      anchor: 'a staged rollout',
      line: 3,
      notes: [{ by: 'paul', at: '2026-06-13T09:14', text: 'Too slow' }],
    })
  })

  it('adds a comment by visible anchor text and writes a versioned file', async () => {
    writeFileSync(join(dir, 'plan.md'), 'Ship this paragraph.')

    const result = await tools.call('comments.add', {
      path: 'plan.md',
      anchor_text: 'this paragraph',
      text: 'Make the dependency explicit.',
    }, ctx) as Record<string, unknown>

    const raw = readFileSync(join(dir, 'plan.md'), 'utf-8')
    expect(raw).toBe('Ship <comment id="c001">this paragraph<note by="Paul-Smith" at="2026-06-13T09:30">Make the dependency explicit.</note></comment>.')
    expect(result).toMatchObject({
      path: 'plan.md',
      id: 'c001',
      hash: expect.any(String),
      version: { hash: expect.any(String), size: expect.any(Number) },
    })
  })

  it('defaults AI-authored comments to by="ai"', async () => {
    writeFileSync(join(dir, 'plan.md'), 'Review this.')

    await tools.call('comments.add', {
      path: 'plan.md',
      anchor_text: 'this',
      text: 'Tighten.',
    }, { actor: 'ai', sessionId: 's1' })

    expect(readFileSync(join(dir, 'plan.md'), 'utf-8')).toContain('<note by="ai" at="2026-06-13T09:30">Tighten.</note>')
  })

  it('refuses ambiguous anchors', async () => {
    writeFileSync(join(dir, 'plan.md'), 'same same')

    await expect(tools.call('comments.add', {
      path: 'plan.md',
      anchor_text: 'same',
      text: 'x',
    }, ctx)).rejects.toThrow(/matches 2 locations/)
  })

  it('refuses anchors that overlap existing comments', async () => {
    writeFileSync(join(dir, 'plan.md'), 'A <comment id="k3f9">target<note by="u" at="2026-06-13T09:14">x</note></comment>.')

    await expect(tools.call('comments.add', {
      path: 'plan.md',
      anchor_text: 'target',
      text: 'x',
    }, ctx)).rejects.toThrow(/intersects existing comment/)
  })

  it('appends replies', async () => {
    writeFileSync(join(dir, 'plan.md'), 'A <comment id="k3f9">target<note by="u" at="2026-06-13T09:14">x</note></comment>.')

    await tools.call('comments.reply', { path: 'plan.md', id: 'k3f9', text: 'Done <now>.' }, ctx)

    expect(readFileSync(join(dir, 'plan.md'), 'utf-8')).toContain('<note by="Paul-Smith" at="2026-06-13T09:30">Done &lt;now>.</note></comment>')
  })

  it('resolves threads by keeping anchor text', async () => {
    writeFileSync(join(dir, 'plan.md'), 'A <comment id="k3f9">target<note by="u" at="2026-06-13T09:14">x</note></comment>.')

    const result = await tools.call('comments.resolve', { path: 'plan.md', id: 'k3f9' }, ctx) as Record<string, unknown>

    expect(readFileSync(join(dir, 'plan.md'), 'utf-8')).toBe('A target.')
    expect(result).toMatchObject({ path: 'plan.md', id: 'k3f9', anchor: 'target' })
  })

  it('refuses to mutate a file with unsaved editor changes', async () => {
    const guarded = createToolRegistry(createTraceLog())
    guarded.setWorkspacePath(dir)
    registerCommentTools(guarded, {
      isDirtyOpenPath: path => path === 'plan.md',
    })
    writeFileSync(join(dir, 'plan.md'), 'Ship this.')

    await expect(guarded.call('comments.add', {
      path: 'plan.md',
      anchor_text: 'this',
      text: 'x',
    }, ctx)).rejects.toThrow('File has unsaved changes in the editor')
  })

  it('honors expected_hash when provided', async () => {
    writeFileSync(join(dir, 'plan.md'), 'Ship this.')

    await expect(tools.call('comments.add', {
      path: 'plan.md',
      anchor_text: 'this',
      text: 'x',
      expected_hash: 'stale',
    }, ctx)).rejects.toThrow(/changed on disk/)
  })

  it('requires an open workspace', async () => {
    const detached = createToolRegistry(createTraceLog())
    registerCommentTools(detached)

    await expect(detached.call('comments.list', { path: 'plan.md' }, ctx)).rejects.toThrow('No workspace open')
  })
})
