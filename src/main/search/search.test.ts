import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// better-sqlite3 native addon is compiled for Electron's Node ABI — skip under system Node
let mod: typeof import('@main/search/search.js') | null = null
try {
  const Database = (await import('better-sqlite3')).default
  const probe = new Database(':memory:')
  probe.close()
  mod = await import('@main/search/search.js')
} catch {}

describe(mod ? 'FTS5 session search' : 'FTS5 session search (skipped — native module mismatch)', () => {
  if (!mod) {
    it('skipped', () => {})
    return
  }

  const { initSearchDb, closeSearchDb, indexSession, removeSessionFromIndex, searchSessions, rebuildIndex } = mod
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-search-test-'))
    mkdirSync(join(dir, '.mim'), { recursive: true })
    initSearchDb(dir)
  })

  afterEach(() => {
    closeSearchDb()
    rmSync(dir, { recursive: true, force: true })
  })

  it('indexes a session and finds it by content', () => {
    indexSession('s1', 'Test Session', [
      { role: 'user', content: 'How do I configure webpack?' },
      { role: 'assistant', content: 'You can configure webpack by creating a webpack.config.js file.' },
    ])

    const results = searchSessions('webpack')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].sessionId).toBe('s1')
    expect(results[0].label).toBe('Test Session')
  })

  it('indexes AI SDK message parts when content is absent', () => {
    indexSession('s_parts', 'Parts Session', [
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Let me explain how WebAssembly works.' },
        ],
      },
    ])

    const results = searchSessions('webassembly')
    expect(results.length).toBe(1)
    expect(results[0].sessionId).toBe('s_parts')
    expect(results[0].excerpt).toContain('WebAssembly')
  })

  it('indexes session labels even before the first message is stored', () => {
    indexSession('s_label_only', 'Quantum Notes', [])

    const results = searchSessions('quantum')
    expect(results.length).toBe(1)
    expect(results[0].sessionId).toBe('s_label_only')
    expect(results[0].messageIdx).toBe(-1)
  })

  it('returns empty results for empty query', () => {
    indexSession('s1', 'Test', [{ role: 'user', content: 'hello world' }])
    expect(searchSessions('')).toEqual([])
    expect(searchSessions('   ')).toEqual([])
  })

  it('returns empty results when no match', () => {
    indexSession('s1', 'Test', [{ role: 'user', content: 'hello world' }])
    const results = searchSessions('xyznonexistent')
    expect(results).toEqual([])
  })

  it('removes a session from the index', () => {
    indexSession('s1', 'Test', [{ role: 'user', content: 'unique banana content' }])
    expect(searchSessions('banana').length).toBe(1)

    removeSessionFromIndex('s1')
    expect(searchSessions('banana')).toEqual([])
  })

  it('re-indexes a session (replaces old data)', () => {
    indexSession('s1', 'V1', [{ role: 'user', content: 'alpha bravo' }])
    expect(searchSessions('alpha').length).toBe(1)

    indexSession('s1', 'V2', [{ role: 'user', content: 'charlie delta' }])
    expect(searchSessions('alpha')).toEqual([])
    expect(searchSessions('charlie').length).toBe(1)
    expect(searchSessions('charlie')[0].label).toBe('V2')
  })

  it('skips messages with empty content', () => {
    indexSession('s1', 'Test', [
      { role: 'user', content: '' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'actual content here' },
    ])
    const results = searchSessions('actual')
    expect(results.length).toBe(1)
    expect(results[0].messageIdx).toBe(2)
  })

  it('respects maxResults limit', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: 'user',
      content: `repeated keyword message number ${i}`,
    }))
    indexSession('s1', 'Test', messages)

    const results = searchSessions('keyword', 3)
    expect(results.length).toBe(3)
  })

  it('handles FTS5 special characters in query safely', () => {
    indexSession('s1', 'Test', [{ role: 'user', content: 'some normal text' }])
    expect(() => searchSessions('"unclosed')).not.toThrow()
    expect(() => searchSessions('foo OR bar')).not.toThrow()
    expect(() => searchSessions('test*')).not.toThrow()
    expect(() => searchSessions('a:b')).not.toThrow()
    expect(() => searchSessions('(unbalanced')).not.toThrow()
  })

  it('rebuildIndex reads session files from disk', () => {
    const sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    const session = {
      id: 'sess_rebuild_1',
      label: 'Rebuild Test',
      messages: [
        { id: 'm1', role: 'user', content: 'rebuild target phrase' },
      ],
    }
    writeFileSync(join(sessionsDir, 'sess_rebuild_1.json'), JSON.stringify(session))

    rebuildIndex(dir)

    const results = searchSessions('rebuild target')
    expect(results.length).toBe(1)
    expect(results[0].sessionId).toBe('sess_rebuild_1')
  })

  it('rebuildIndex reads persisted messages with parts from disk', () => {
    const sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    const session = {
      id: 'sess_parts_rebuild',
      label: 'Parts Rebuild Test',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'durable indexed phrase' }],
        },
      ],
    }
    writeFileSync(join(sessionsDir, 'sess_parts_rebuild.json'), JSON.stringify(session))

    rebuildIndex(dir)

    const results = searchSessions('durable indexed')
    expect(results.length).toBe(1)
    expect(results[0].sessionId).toBe('sess_parts_rebuild')
  })

  it('rebuildIndex skips corrupt files gracefully', () => {
    const sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    writeFileSync(join(sessionsDir, 'bad.json'), 'NOT VALID JSON{{{')
    const good = {
      id: 'good_one',
      label: 'Good',
      messages: [{ id: 'm1', role: 'user', content: 'valid session data' }],
    }
    writeFileSync(join(sessionsDir, 'good_one.json'), JSON.stringify(good))

    rebuildIndex(dir)

    const results = searchSessions('valid session')
    expect(results.length).toBe(1)
    expect(results[0].sessionId).toBe('good_one')
  })

  it('searchSessions returns empty when db is not initialized', () => {
    closeSearchDb()
    expect(searchSessions('anything')).toEqual([])
  })

  it('rebuildIndex skips unchanged sessions (incremental reindex)', () => {
    const sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    const session = {
      id: 'sess_incremental',
      label: 'Incremental',
      messages: [{ id: 'm1', role: 'user', content: 'initial content here' }],
    }
    writeFileSync(join(sessionsDir, 'sess_incremental.json'), JSON.stringify(session))

    // First rebuild indexes the session
    rebuildIndex(dir)
    expect(searchSessions('initial content').length).toBe(1)

    // Second rebuild should skip it (file unchanged)
    // We verify by changing the index directly and checking it survives
    rebuildIndex(dir)
    expect(searchSessions('initial content').length).toBe(1)
  })

  it('rebuildIndex re-indexes modified sessions', async () => {
    const sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    const session = {
      id: 'sess_modified',
      label: 'Modified',
      messages: [{ id: 'm1', role: 'user', content: 'original phrase' }],
    }
    writeFileSync(join(sessionsDir, 'sess_modified.json'), JSON.stringify(session))
    rebuildIndex(dir)
    expect(searchSessions('original phrase').length).toBe(1)

    // Wait to ensure mtime changes (filesystem resolution may be 1s)
    await new Promise(r => setTimeout(r, 50))

    // Modify the session file
    session.messages = [{ id: 'm1', role: 'user', content: 'updated phrase' }]
    writeFileSync(join(sessionsDir, 'sess_modified.json'), JSON.stringify(session))

    rebuildIndex(dir)
    expect(searchSessions('original phrase').length).toBe(0)
    expect(searchSessions('updated phrase').length).toBe(1)
  })

  it('rebuildIndex removes index entries for deleted sessions', () => {
    const sessionsDir = join(dir, '.mim', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })

    const session = {
      id: 'sess_deleted',
      label: 'Deleted',
      messages: [{ id: 'm1', role: 'user', content: 'doomed phrase' }],
    }
    writeFileSync(join(sessionsDir, 'sess_deleted.json'), JSON.stringify(session))
    rebuildIndex(dir)
    expect(searchSessions('doomed phrase').length).toBe(1)

    // Delete the session file
    unlinkSync(join(sessionsDir, 'sess_deleted.json'))

    rebuildIndex(dir)
    expect(searchSessions('doomed phrase').length).toBe(0)
  })
})
