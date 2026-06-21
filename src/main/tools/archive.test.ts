import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerSessionTools } from '@main/sessions.js'
import { registerArchiveTools, buildArchivePreview, filterArchivedMatches } from '@main/tools/archive.js'

const ctx = { actor: 'user' as const }

function writeSession(dir: string, session: Record<string, unknown>) {
  writeFileSync(join(dir, `${session.id}.json`), JSON.stringify(session, null, 2))
}

function baseSession(overrides: Record<string, unknown>) {
  return {
    modelId: '',
    controlId: '',
    usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
    lastContextTokens: 0,
    lastInputTokens: 0,
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    ...overrides,
  }
}

describe('buildArchivePreview', () => {
  it('returns the first non-empty user/assistant text, skipping system messages', () => {
    const preview = buildArchivePreview([
      { role: 'system', content: 'you are a helpful agent' },
      { role: 'user', content: 'Refactor the auth flow\nsplit the login handler' },
    ])
    expect(preview).toBe('Refactor the auth flow split the login handler')
  })

  it('reads AI SDK message parts when there is no plain content', () => {
    const preview = buildArchivePreview([
      { role: 'user', parts: [{ type: 'text', text: 'hello from parts' }] },
    ])
    expect(preview).toBe('hello from parts')
  })

  it('is empty when there is no conversation text', () => {
    expect(buildArchivePreview([])).toBe('')
    expect(buildArchivePreview([{ role: 'system', content: 'sys' }])).toBe('')
  })

  it('truncates long previews', () => {
    const long = 'x'.repeat(500)
    const preview = buildArchivePreview([{ role: 'user', content: long }])
    expect(preview.length).toBeLessThanOrEqual(241)
    expect(preview.endsWith('…')).toBe(true)
  })
})

describe('filterArchivedMatches', () => {
  const archived = new Map([
    ['arch1', { label: 'Archived one', updatedAt: '2026-01-02T00:00:00.000Z' }],
    ['arch2', { label: 'Archived two', updatedAt: '2026-01-03T00:00:00.000Z' }],
  ])
  const hit = (sessionId: string, extra: Partial<{ label: string; excerpt: string; messageIdx: number }> = {}) =>
    ({ sessionId, label: '', excerpt: 'x', messageIdx: 0, ...extra })

  it('keeps only archived sessions, dropping active matches', () => {
    const out = filterArchivedMatches([hit('arch1'), hit('active1'), hit('arch2')], archived, 30)
    expect(out.map(r => r.sessionId)).toEqual(['arch1', 'arch2'])
  })

  it('returns one row per session even when a session matches multiple times', () => {
    const out = filterArchivedMatches([hit('arch1'), hit('arch1', { messageIdx: 3 })], archived, 30)
    expect(out).toHaveLength(1)
    expect(out[0].messageIdx).toBe(0) // first hit wins
  })

  it('caps at maxResults', () => {
    const out = filterArchivedMatches([hit('arch1'), hit('arch2')], archived, 1)
    expect(out).toHaveLength(1)
  })

  it('enriches with the archived date and falls back to the stored label', () => {
    const out = filterArchivedMatches([hit('arch1', { excerpt: 'match here' })], archived, 30)
    expect(out[0]).toMatchObject({ label: 'Archived one', updatedAt: '2026-01-02T00:00:00.000Z', excerpt: 'match here' })
  })

  it('prefers the hit label when present', () => {
    const out = filterArchivedMatches([hit('arch1', { label: 'Fresh label' })], archived, 30)
    expect(out[0].label).toBe('Fresh label')
  })
})

describe('archive.list tool', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  let sessionsDir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-archive-test-'))
    sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerSessionTools(tools)
    registerArchiveTools(tools)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns only archived sessions, newest first, with preview and count', async () => {
    writeSession(sessionsDir, baseSession({
      id: 'a', label: 'Active one', archived: false, updatedAt: '2026-01-05T00:00:00.000Z',
      messages: [{ id: 'm', role: 'user', content: 'still going' }],
    }))
    writeSession(sessionsDir, baseSession({
      id: 'old', label: 'Older archived', archived: true, updatedAt: '2026-01-02T00:00:00.000Z',
      messages: [{ id: 'm', role: 'user', content: 'first question' }, { id: 'm2', role: 'assistant', content: 'answer' }],
    }))
    writeSession(sessionsDir, baseSession({
      id: 'new', label: 'Newer archived', archived: true, updatedAt: '2026-01-04T00:00:00.000Z',
      messages: [{ id: 'm', role: 'user', content: 'newer question' }],
    }))

    const result = await tools.call('archive.list', {}, ctx) as { sessions: Array<Record<string, unknown>> }

    expect(result.sessions.map(s => s.id)).toEqual(['new', 'old'])
    expect(result.sessions[0]).toMatchObject({ id: 'new', label: 'Newer archived', messageCount: 1, preview: 'newer question' })
    expect(result.sessions[1]).toMatchObject({ id: 'old', messageCount: 2, preview: 'first question' })
  })

  it('returns an empty list when nothing is archived', async () => {
    writeSession(sessionsDir, baseSession({ id: 'a', label: 'Active', archived: false }))
    const result = await tools.call('archive.list', {}, ctx) as { sessions: unknown[] }
    expect(result.sessions).toEqual([])
  })

  it('returns an empty list when the sessions dir is absent', async () => {
    rmSync(sessionsDir, { recursive: true, force: true })
    const result = await tools.call('archive.list', {}, ctx) as { sessions: unknown[]; agentSessions: unknown[] }
    expect(result.sessions).toEqual([])
    // No .mim/agent-sessions dir either — both sources degrade to empty.
    expect(result.agentSessions).toEqual([])
  })

  it('includes archived agent sessions read from .mim/agent-sessions, newest first', async () => {
    const agentDir = join(dir, '.mim', 'agent-sessions')
    mkdirSync(agentDir, { recursive: true })
    const writeAgentSession = (record: Record<string, unknown>) =>
      writeFileSync(join(agentDir, `${record.sessionId}.json`), JSON.stringify(record, null, 2))

    writeAgentSession({
      sessionId: 'as-running', agentId: 'claude-code', title: 'Claude Code',
      command: '/usr/local/bin/claude', cwd: dir, status: 'running',
      startedAt: '2026-01-05T00:00:00.000Z',
    })
    writeAgentSession({
      sessionId: 'as-old', agentId: 'claude-code', title: 'Claude Code 2',
      command: '/usr/local/bin/claude', cwd: dir, status: 'done', archived: true,
      startedAt: '2026-01-02T00:00:00.000Z', endedAt: '2026-01-02T00:05:00.000Z',
      titleHint: 'refactor auth',
    })
    writeAgentSession({
      sessionId: 'as-new', agentId: 'codex', title: 'Codex', archived: true,
      command: '/usr/local/bin/codex', cwd: dir, status: 'error',
      startedAt: '2026-01-04T00:00:00.000Z', endedAt: '2026-01-04T00:01:00.000Z',
    })

    const result = await tools.call('archive.list', {}, ctx) as {
      agentSessions: Array<Record<string, unknown>>
    }

    expect(result.agentSessions.map(s => s.id)).toEqual(['as-new', 'as-old'])
    expect(result.agentSessions[0]).toMatchObject({
      id: 'as-new', agentId: 'codex', label: 'Codex',
      updatedAt: '2026-01-04T00:01:00.000Z', status: 'error', preview: '',
    })
    expect(result.agentSessions[1]).toMatchObject({
      id: 'as-old', agentId: 'claude-code', label: 'Claude Code 2',
      updatedAt: '2026-01-02T00:05:00.000Z', status: 'done', preview: 'refactor auth',
    })
  })

  it('includes archived app runs when an app job runner is registered', async () => {
    const jobs = {
      list: () => [{
        runId: 'run-1',
        packageId: 'doc-review',
        jobId: 'review',
        label: 'Renamed review document',
        status: 'completed',
        inputs: {},
        startedAt: '2026-01-02T00:00:00.000Z',
        completedAt: '2026-01-02T00:01:00.000Z',
        archived: true,
        events: [
          {
            type: 'job.started',
            packageId: 'doc-review',
            jobId: 'review',
            runId: 'run-1',
            ts: '2026-01-02T00:00:00.000Z',
            sequence: 1,
            data: { label: 'Review document' },
          },
          {
            type: 'job.step',
            packageId: 'doc-review',
            jobId: 'review',
            runId: 'run-1',
            ts: '2026-01-02T00:00:10.000Z',
            sequence: 2,
            data: { name: 'Reading document' },
          },
        ],
      }],
    }
    const trace = createTraceLog()
    const archiveTools = createToolRegistry(trace)
    archiveTools.setWorkspacePath(dir)
    registerArchiveTools(archiveTools, jobs as any)

    const result = await archiveTools.call('archive.list', {}, ctx) as {
      packageRuns: Array<Record<string, unknown>>
    }

    expect(result.packageRuns).toEqual([
      expect.objectContaining({
        id: 'run-1',
        packageId: 'doc-review',
        label: 'Renamed review document',
        eventCount: 2,
        status: 'completed',
        preview: 'Reading document',
      }),
    ])
  })
})

// archive.search is backed by FTS5 (better-sqlite3). The native addon is built for
// Electron's Node ABI, so skip under system Node — same probe as search.test.ts.
let searchMod: typeof import('@main/search/search.js') | null = null
try {
  const Database = (await import('better-sqlite3')).default
  const probe = new Database(':memory:')
  probe.close()
  searchMod = await import('@main/search/search.js')
} catch { /* native ABI mismatch — skip */ }

describe(searchMod ? 'archive.search tool' : 'archive.search tool (skipped — native module mismatch)', () => {
  if (!searchMod) {
    it('skipped', () => {})
    return
  }

  const { initSearchDb, closeSearchDb, rebuildIndex } = searchMod
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  let sessionsDir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-archive-search-'))
    sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    // One archived session (keyword in two messages → exercises dedup) and one
    // active session matching the same keyword (must NOT appear in archive results).
    writeSession(sessionsDir, baseSession({
      id: 'arch1', label: 'Archived auth work', archived: true, updatedAt: '2026-01-02T00:00:00.000Z',
      messages: [
        { id: 'm1', role: 'user', content: 'auth refactor token flow' },
        { id: 'm2', role: 'assistant', content: 'the refactor splits the login handler' },
      ],
    }))
    writeSession(sessionsDir, baseSession({
      id: 'act1', label: 'Active auth work', archived: false, updatedAt: '2026-01-05T00:00:00.000Z',
      messages: [{ id: 'm1', role: 'user', content: 'auth refactor token flow' }],
    }))
    writeSession(sessionsDir, baseSession({
      id: 'arch2', label: 'Other archived', archived: true, updatedAt: '2026-01-03T00:00:00.000Z',
      messages: [{ id: 'm1', role: 'user', content: 'unrelated refactor of the parser' }],
    }))

    initSearchDb(dir)
    rebuildIndex(dir)
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerSessionTools(tools)
    registerArchiveTools(tools)
  })

  afterEach(() => {
    closeSearchDb()
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns only archived matches, one row per session, with date and excerpt', async () => {
    const result = await tools.call('archive.search', { query: 'refactor' }, ctx) as {
      results: Array<{ sessionId: string; label: string; excerpt: string; updatedAt: string }>
    }

    const ids = result.results.map(r => r.sessionId)
    expect(ids).toContain('arch1')
    expect(ids).toContain('arch2')
    expect(ids).not.toContain('act1') // active session excluded even though it matches
    // dedup: arch1 matched in two messages but appears once
    expect(ids.filter(id => id === 'arch1')).toHaveLength(1)

    const arch1 = result.results.find(r => r.sessionId === 'arch1')!
    expect(arch1.updatedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(arch1.label).toBe('Archived auth work')
    expect(arch1.excerpt.toLowerCase()).toContain('refactor')
  })

  it('returns no results for a term only present in an active session', async () => {
    // 'token' appears only in arch1 too, so use a term unique to the active session
    writeSession(sessionsDir, baseSession({
      id: 'act2', label: 'Active only', archived: false,
      messages: [{ id: 'm1', role: 'user', content: 'pineapple deployment pipeline' }],
    }))
    rebuildIndex(dir)

    const result = await tools.call('archive.search', { query: 'pineapple' }, ctx) as { results: unknown[] }
    expect(result.results).toEqual([])
  })

  it('returns an empty result for a blank query', async () => {
    const result = await tools.call('archive.search', { query: '   ' }, ctx) as { results: unknown[] }
    expect(result.results).toEqual([])
  })

  it('respects maxResults across archived matches', async () => {
    const result = await tools.call('archive.search', { query: 'refactor', maxResults: 1 }, ctx) as { results: unknown[] }
    expect(result.results).toHaveLength(1)
  })
})
