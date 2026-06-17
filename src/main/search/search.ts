import Database from 'better-sqlite3'
import { join } from 'path'
import { readdirSync, readFileSync, statSync } from 'fs'
import { buildSessionIndexRows, type SearchIndexMessage } from '@main/search/searchText.js'

let db: Database.Database | null = null

export function initSearchDb(workspacePath: string): void {
  const dbPath = join(workspacePath, '.mim', 'search.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      session_id UNINDEXED,
      message_idx UNINDEXED,
      role,
      content,
      label,
      tokenize='unicode61'
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_meta (
      session_id TEXT PRIMARY KEY,
      indexed_at_ms INTEGER NOT NULL
    )
  `)
}

export function closeSearchDb(): void {
  db?.close()
  db = null
}

export function indexSession(sessionId: string, label: string, messages: SearchIndexMessage[]): void {
  if (!db) return
  const del = db.prepare('DELETE FROM messages_fts WHERE session_id = ?')
  const ins = db.prepare('INSERT INTO messages_fts (session_id, message_idx, role, content, label) VALUES (?, ?, ?, ?, ?)')
  const meta = db.prepare('INSERT OR REPLACE INTO search_meta (session_id, indexed_at_ms) VALUES (?, ?)')

  const tx = db.transaction(() => {
    del.run(sessionId)
    buildSessionIndexRows(sessionId, label, messages).forEach((row) => {
      ins.run(row.sessionId, row.messageIdx, row.role, row.content, row.label)
    })
    meta.run(sessionId, Date.now())
  })
  tx()
}

export function removeSessionFromIndex(sessionId: string): void {
  if (!db) return
  db.prepare('DELETE FROM messages_fts WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM search_meta WHERE session_id = ?').run(sessionId)
}

export function rebuildIndex(workspacePath: string): void {
  if (!db) return

  const sessionsDir = join(workspacePath, '.mim', 'sessions')
  let files: string[]
  try {
    files = readdirSync(sessionsDir).filter(f => f.endsWith('.json') && f !== '_manifest.json')
  } catch {
    return // no sessions directory
  }

  // Build a set of session ids currently on disk
  const onDisk = new Set<string>()
  for (const file of files) {
    onDisk.add(file.replace(/\.json$/, ''))
  }

  // Get the indexed-at timestamps from search_meta
  const indexed = new Map<string, number>()
  try {
    const rows = db.prepare('SELECT session_id, indexed_at_ms FROM search_meta').all() as Array<{ session_id: string; indexed_at_ms: number }>
    for (const row of rows) {
      indexed.set(row.session_id, row.indexed_at_ms)
    }
  } catch {
    // If search_meta does not exist yet (old db), fall through to full reindex
  }

  // Remove index entries for sessions no longer on disk
  for (const sessionId of indexed.keys()) {
    if (!onDisk.has(sessionId)) {
      removeSessionFromIndex(sessionId)
    }
  }

  // Index sessions whose file mtime is newer than indexed_at_ms
  for (const file of files) {
    try {
      const filePath = join(sessionsDir, file)
      const mtimeMs = statSync(filePath).mtimeMs
      const sessionId = file.replace(/\.json$/, '')
      const indexedAt = indexed.get(sessionId)

      // Skip if the file has not changed since last index
      if (indexedAt !== undefined && mtimeMs <= indexedAt) continue

      const raw = readFileSync(filePath, 'utf-8')
      const session = JSON.parse(raw)
      if (session.id && Array.isArray(session.messages)) {
        indexSession(session.id, session.label || '', session.messages)
      }
    } catch {
      // skip corrupt files
    }
  }
}

export function searchSessions(query: string, maxResults: number = 30): Array<{
  sessionId: string
  label: string
  messageIdx: number
  role: string
  excerpt: string
}> {
  if (!db || !query.trim()) return []

  const sanitized = sanitizeFtsQuery(query)

  try {
    const rows = db.prepare(`
      SELECT session_id, message_idx, role,
             snippet(messages_fts, 3, '<<', '>>', '...', 40) as excerpt,
             label
      FROM messages_fts
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(sanitized, maxResults)

    return rows.map((r: any) => ({
      sessionId: r.session_id,
      label: r.label,
      messageIdx: r.message_idx,
      role: r.role,
      excerpt: r.excerpt,
    }))
  } catch {
    return []
  }
}

function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special characters to prevent syntax errors
  const cleaned = query.replace(/['"(){}[\]*:^~@#]/g, ' ').trim()
  if (!cleaned) return '""'
  // Split into terms, wrap each in double quotes for safe matching
  const terms = cleaned.split(/\s+/).filter(Boolean)
  return terms.map(t => `"${t}"`).join(' ')
}
