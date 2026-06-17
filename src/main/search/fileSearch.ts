import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, extname } from 'path'
import { toSlashPath } from '@main/platform.js'

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.mim', '.DS_Store', '__pycache__',
  '.next', '.nuxt', 'dist', 'build', 'out', '.cache', 'target',
  '.venv', 'venv', '.env',
])

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.db', '.sqlite', '.sqlite3',
])

const MAX_FILE_SIZE = 1_000_000 // 1 MB
const DEFAULT_TIME_BUDGET_MS = 2000

interface FileMatch {
  path: string
  line: number
  snippet: string
  // Set when the hit lives inside a mounted resource collection.
  collection?: string
}

interface PreparedQuery {
  phrase: string
  terms: string[]
}

export interface SearchFilesOptions {
  pattern?: string
  maxResults?: number
  signal?: AbortSignal
  timeBudgetMs?: number
}

export interface SearchFilesResult {
  results: FileMatch[]
  truncated: boolean
}

export async function searchFiles(
  workspacePath: string,
  query: string,
  options: SearchFilesOptions = {}
): Promise<FileMatch[]> {
  const { pattern, maxResults = 50, signal, timeBudgetMs = DEFAULT_TIME_BUDGET_MS } = options
  if (!query.trim()) return []

  const results: FileMatch[] = []
  const preparedQuery = prepareQuery(query)
  const globRe = pattern ? globToRegex(toSlashPath(pattern)) : null
  const deadline = Date.now() + timeBudgetMs
  dirCount = 0

  await walk(workspacePath, workspacePath, preparedQuery, globRe, results, maxResults, signal, deadline)
  await searchMounts(workspacePath, preparedQuery, globRe, results, maxResults, signal, deadline)

  return results
}

// Mounted resource collections live under .mim/resources/<id> (symlinks), so
// the normal walk skips them via SKIP_DIRS. Walk each mount explicitly and tag
// hits with the collection id. Dangling symlinks are ignored; symlinked dirs
// are followed one level here while SKIP_DIRS still prunes .git/.mim inside.
async function searchMounts(
  workspacePath: string,
  query: PreparedQuery,
  globRe: RegExp | null,
  results: FileMatch[],
  max: number,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<void> {
  if (results.length >= max || (signal && signal.aborted) || Date.now() >= deadline) return
  const mountsDir = join(workspacePath, '.mim', 'resources')

  let entries
  try {
    entries = await readdir(mountsDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (results.length >= max || (signal && signal.aborted) || Date.now() >= deadline) return
    const mountPath = join(mountsDir, entry.name)
    let s
    try {
      s = await stat(mountPath) // follows the symlink
    } catch {
      continue
    }
    if (!s.isDirectory()) continue

    const before = results.length
    await walk(workspacePath, mountPath, query, globRe, results, max, signal, deadline)
    for (let i = before; i < results.length; i++) {
      results[i].collection = entry.name
    }
  }
}

let dirCount = 0

async function walk(
  base: string,
  dir: string,
  query: PreparedQuery,
  globRe: RegExp | null,
  results: FileMatch[],
  max: number,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<void> {
  if (results.length >= max || (signal && signal.aborted) || Date.now() >= deadline) return

  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  // Yield control every 10 directories so the event loop stays responsive
  dirCount++
  if (dirCount % 10 === 0) {
    await new Promise<void>(r => setImmediate(r))
  }

  for (const entry of entries) {
    if (results.length >= max || (signal && signal.aborted) || Date.now() >= deadline) return

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(base, join(dir, entry.name), query, globRe, results, max, signal, deadline)
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      if (BINARY_EXTS.has(ext)) continue

      const fullPath = join(dir, entry.name)
      const relPath = toSlashPath(relative(base, fullPath))

      if (globRe && !globRe.test(relPath)) continue

      try {
        const s = await stat(fullPath)
        if (s.size > MAX_FILE_SIZE) continue
      } catch {
        continue
      }

      await searchInFile(fullPath, relPath, query, results, max)
    }
  }
}

async function searchInFile(
  fullPath: string,
  relPath: string,
  query: PreparedQuery,
  results: FileMatch[],
  max: number
): Promise<void> {
  let content: string
  try {
    content = await readFile(fullPath, 'utf-8')
  } catch {
    return
  }

  // Quick pre-check
  const lowerContent = content.toLowerCase()
  if (!lowerContent.includes(query.phrase) && !query.terms.every(term => lowerContent.includes(term))) return

  const lines = content.split(/\r\n|\n|\r/)
  for (let i = 0; i < lines.length && results.length < max; i++) {
    const lowerLine = lines[i].toLowerCase()
    if (lineMatchesQuery(lowerLine, query)) {
      const line = lines[i]
      // Build snippet: trim to reasonable length around the match
      const matchIdx = firstMatchIndex(lowerLine, query)
      const start = Math.max(0, matchIdx - 40)
      const end = Math.min(line.length, matchIdx + matchLengthAt(lowerLine, matchIdx, query) + 40)
      let snippet = ''
      if (start > 0) snippet += '...'
      snippet += line.slice(start, end).trim()
      if (end < line.length) snippet += '...'

      results.push({
        path: relPath,
        line: i + 1,
        snippet,
      })
    }
  }
}

function prepareQuery(query: string): PreparedQuery {
  const phrase = query.trim().toLowerCase()
  const terms = phrase.split(/\s+/).filter(Boolean)
  return { phrase, terms }
}

function lineMatchesQuery(line: string, query: PreparedQuery): boolean {
  return line.includes(query.phrase) || query.terms.every(term => line.includes(term))
}

function firstMatchIndex(line: string, query: PreparedQuery): number {
  const phraseIndex = line.indexOf(query.phrase)
  if (phraseIndex >= 0) return phraseIndex
  const termIndexes = query.terms
    .map(term => line.indexOf(term))
    .filter(index => index >= 0)
  return termIndexes.length ? Math.min(...termIndexes) : 0
}

function matchLengthAt(line: string, index: number, query: PreparedQuery): number {
  if (line.slice(index, index + query.phrase.length) === query.phrase) return query.phrase.length
  const term = query.terms.find(item => line.slice(index, index + item.length) === item)
  return term?.length ?? query.phrase.length
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(escaped, 'i')
}
