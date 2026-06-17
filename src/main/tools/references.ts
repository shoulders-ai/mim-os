import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync, statSync, type Dirent } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { parseAuthors, parseBibtex, type BibEntry } from '@main/export/citations.js'
import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import {
  DEFAULT_REFERENCES_BIB_PATH,
  readReferencesBibPath,
  readReferencesBibPathSetting,
  writeReferencesBibPath,
} from '@main/tools/settings.js'

export interface EditorReference {
  key: string
  author: string
  year: string
  title: string
  fields: Record<string, string>
  source?: string
  venue?: string
  journal?: string
  booktitle?: string
  doi?: string
  url?: string
  file?: string
  type: string
}

export interface DuplicateReferenceKey {
  key: string
  count: number
}

export interface BibliographyCandidate {
  path: string
  source: 'frontmatter' | 'saved' | 'default' | 'document' | 'references-folder' | 'workspace-root' | 'resource'
  matched: number
  total: number
  unresolvedKeys: string[]
  duplicateKeys: DuplicateReferenceKey[]
}

const BIB_CACHE = new Map<string, { size: number; mtimeMs: number; entries: BibEntry[] }>()
const MAX_RESOURCE_BIBS = 20
const MAX_RESOURCE_DIRS = 80

export function registerReferencesTools(tools: ToolRegistry): void {
  tools.register({
    name: 'references.readBib',
    description: 'Read the workspace BibTeX library and return citation rows for the editor.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative BibTeX file. Defaults to the references.bibPath workspace setting.',
        },
      },
    },
    execute: async (params) => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      const configuredPath = typeof params.path === 'string' && params.path.trim()
        ? params.path.trim()
        : readReferencesBibPath(workspace)
      const bibAbs = resolveWorkspacePath(workspace, configuredPath)
      const relPath = toSlashPath(relative(resolve(workspace), bibAbs))

      if (!existsSync(bibAbs)) {
        return {
          path: relPath,
          exists: false,
          references: [],
          duplicateKeys: [],
        }
      }
      const stat = statSync(bibAbs)
      if (!stat.isFile()) throw new Error(`BibTeX path is not a file: ${configuredPath}`)

      const entries = parseBibtex(readFileSync(bibAbs, 'utf-8'))
      return {
        path: relPath,
        exists: true,
        references: entries.map(entry => bibEntryToReference(entry)),
        duplicateKeys: duplicateKeys(entries),
      }
    },
  })

  tools.register({
    name: 'references.resolveBibliography',
    description: 'Resolve the active bibliography for a markdown document using the quiet priority order shared by editor and export.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative markdown document path.' },
        markdown: { type: 'string', description: 'Markdown content used to detect citations and frontmatter bibliography.' },
        include_candidates: { type: 'boolean', description: 'Return discovered alternative .bib files for the editor recovery popover.' },
        persist: { type: 'boolean', description: 'Persist the automatically selected bibliography path. Defaults to true for direct user calls.' },
      },
    },
    execute: async (params, ctx) => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      return resolveBibliography(workspace, params, ctx)
    },
  })

  tools.register({
    name: 'references.setBibliographyPath',
    description: 'Set the active workspace bibliography path after validating it is a workspace or mounted-resource .bib file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative or .mim/resources-mounted BibTeX file to use for editor and export citation resolution.' },
      },
      required: ['path'],
    },
    execute: async (params) => {
      const workspace = tools.getWorkspacePath()
      if (!workspace) throw new Error('No workspace open')
      const requested = typeof params.path === 'string' ? params.path.trim() : ''
      if (!requested) throw new Error('Missing required parameter: path')
      if (!/\.bib$/i.test(requested)) throw new Error(`Expected a .bib file: ${requested}`)
      const bibAbs = resolveWorkspacePath(workspace, requested)
      if (!existsSync(bibAbs)) throw new Error(`Bibliography file does not exist: ${requested}`)
      if (!statSync(bibAbs).isFile()) throw new Error(`Bibliography path is not a file: ${requested}`)
      const path = toSlashPath(relative(resolve(workspace), bibAbs))
      writeReferencesBibPath(workspace, path)
      return { path }
    },
  })
}

export function resolveBibliography(
  workspacePath: string,
  params: Record<string, unknown>,
  ctx: Pick<ToolContext, 'actor'> = { actor: 'user' },
) {
  const root = resolve(workspacePath)
  const markdown = typeof params.markdown === 'string' ? params.markdown : ''
  const documentPath = typeof params.path === 'string' && params.path ? params.path : ''
  const includeCandidates = params.include_candidates === true
  const persist = params.persist !== false && (ctx.actor === 'user' || ctx.actor === 'system')
  const citationKeys = extractCitationKeys(markdown)
  const frontmatterBib = frontmatterBibliographyPath(markdown)
  const setting = readReferencesBibPathSetting(workspacePath)

  const candidates = discoverCandidates(root, {
    documentPath,
    frontmatterBib,
    savedPath: setting.explicit ? setting.path : '',
    includeBroadDiscovery: includeCandidates || citationKeys.length > 0,
  })

  let active = candidates[0] ?? null
  if (!active && citationKeys.length === 0 && setting.path) {
    active = candidateForPath(root, setting.path, 'default')
  }

  if (!active) {
    return {
      path: setting.path,
      exists: false,
      source: 'none',
      citationKeys,
      references: [],
      duplicateKeys: [],
      candidates: scoreCandidates(candidates, citationKeys),
      unresolved_citations: citationKeys,
      citations: 0,
    }
  }

  const scored = scoreCandidate(active, citationKeys)
  const shouldPersist = persist &&
    active.source !== 'frontmatter' &&
    (!setting.explicit || setting.path !== active.path)
  if (shouldPersist) writeReferencesBibPath(workspacePath, active.path)

  return {
    path: active.path,
    exists: true,
    source: active.source,
    citationKeys,
    references: active.entries.map(entry => bibEntryToReference(entry)),
    duplicateKeys: duplicateKeys(active.entries),
    candidates: scoreCandidates(candidates, citationKeys),
    unresolved_citations: scored.unresolvedKeys,
    citations: citationKeys.length - scored.unresolvedKeys.length,
    auto_persisted: shouldPersist,
  }
}

export function bibEntryToReference(entry: BibEntry): EditorReference {
  const fields = entry.fields
  const venue = firstString(
    fields.journal,
    fields.booktitle,
    fields.publisher,
    fields.institution,
    fields.school,
    fields.organization,
    fields.howpublished,
  )
  return {
    key: entry.key,
    author: formatAuthors(firstString(fields.author, fields.director, fields.editor, fields.translator)),
    year: fields.year ?? '',
    title: fields.title ?? entry.key,
    fields: { ...fields },
    ...(venue ? { source: venue, venue } : {}),
    ...(fields.journal ? { journal: fields.journal } : {}),
    ...(fields.booktitle ? { booktitle: fields.booktitle } : {}),
    ...(fields.doi ? { doi: fields.doi } : {}),
    ...(fields.url ? { url: fields.url } : {}),
    ...(fields.file ? { file: fields.file } : {}),
    type: entry.type,
  }
}

interface CandidateWithEntries {
  path: string
  source: BibliographyCandidate['source']
  entries: BibEntry[]
}

function discoverCandidates(
  root: string,
  options: {
    documentPath: string
    frontmatterBib: string
    savedPath: string
    includeBroadDiscovery: boolean
  },
): CandidateWithEntries[] {
  const out: CandidateWithEntries[] = []
  const seen = new Set<string>()
  const docDir = options.documentPath.includes('/') ? options.documentPath.slice(0, options.documentPath.lastIndexOf('/')) : ''
  const add = (path: string, source: BibliographyCandidate['source']) => {
    if (!path || seen.has(path)) return
    const candidate = candidateForPath(root, path, source)
    if (!candidate) return
    seen.add(candidate.path)
    out.push(candidate)
  }

  if (options.frontmatterBib) {
    if (docDir) add(toSlashPath(join(docDir, options.frontmatterBib)), 'frontmatter')
    add(options.frontmatterBib, 'frontmatter')
  }
  add(options.savedPath, 'saved')
  add(DEFAULT_REFERENCES_BIB_PATH, 'default')

  if (!options.includeBroadDiscovery) return out

  for (const path of bibFilesInDir(root, docDir || '.')) add(path, 'document')
  for (const path of bibFilesInDir(root, 'references')) add(path, 'references-folder')
  for (const path of bibFilesInDir(root, '.')) add(path, 'workspace-root')
  for (const path of resourceBibFiles(root)) add(path, 'resource')

  return out
}

function candidateForPath(root: string, path: string, source: BibliographyCandidate['source']): CandidateWithEntries | null {
  try {
    if (!/\.bib$/i.test(path)) return null
    const abs = resolveWorkspacePath(root, path)
    if (!existsSync(abs)) return null
    const stat = statSync(abs)
    if (!stat.isFile()) return null
    return {
      path: toSlashPath(relative(root, abs)),
      source,
      entries: readCachedBibEntries(abs, stat.size, stat.mtimeMs),
    }
  } catch {
    return null
  }
}

function readCachedBibEntries(absPath: string, size: number, mtimeMs: number): BibEntry[] {
  const cached = BIB_CACHE.get(absPath)
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.entries
  const entries = parseBibtex(readFileSync(absPath, 'utf-8'))
  BIB_CACHE.set(absPath, { size, mtimeMs, entries })
  return entries
}

function scoreCandidates(candidates: CandidateWithEntries[], citationKeys: string[]): BibliographyCandidate[] {
  return candidates.map(candidate => scoreCandidate(candidate, citationKeys))
}

function scoreCandidate(candidate: CandidateWithEntries, citationKeys: string[]): BibliographyCandidate {
  const keys = new Set(candidate.entries.map(entry => entry.key))
  const unresolvedKeys = citationKeys.filter(key => !keys.has(key))
  return {
    path: candidate.path,
    source: candidate.source,
    matched: citationKeys.length - unresolvedKeys.length,
    total: citationKeys.length,
    unresolvedKeys,
    duplicateKeys: duplicateKeys(candidate.entries),
  }
}

function frontmatterBibliographyPath(markdown: string): string {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(markdown)
  if (!match) return ''
  const line = match[1].split('\n').find(item => /^\s*bibliography\s*:/.test(item))
  if (!line) return ''
  const raw = line.slice(line.indexOf(':') + 1).trim()
  const first = raw
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
    .find(Boolean)
  return first && /\.bib$/i.test(first) ? first : ''
}

function extractCitationKeys(markdown: string): string[] {
  const keys = new Set<string>()
  mapOutsideCode(markdown, (text) => {
    const re = /(^|[^\w])@([A-Za-z][\w:-]*)/g
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) keys.add(match[2])
  })
  return [...keys]
}

function mapOutsideCode(markdown: string, visit: (text: string) => void): void {
  const lines = markdown.split('\n')
  let fence: string | null = null
  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null
      continue
    }
    if (fenceMatch) {
      fence = fenceMatch[1]
      continue
    }
    mapOutsideInlineCode(line, visit)
  }
}

function mapOutsideInlineCode(line: string, visit: (text: string) => void): void {
  let plain = ''
  let i = 0
  while (i < line.length) {
    if (line[i] === '`') {
      let run = 1
      while (line[i + run] === '`') run++
      const ticks = '`'.repeat(run)
      const close = line.indexOf(ticks, i + run)
      if (close !== -1) {
        if (plain) visit(plain)
        plain = ''
        i = close + run
        continue
      }
    }
    plain += line[i]
    i++
  }
  if (plain) visit(plain)
}

function bibFilesInDir(root: string, relDir: string): string[] {
  try {
    const dir = resolveWorkspacePath(root, relDir)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.bib')
      .map(entry => toSlashPath(join(relDir === '.' ? '' : relDir, entry.name)))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

function resourceBibFiles(root: string): string[] {
  const resourcesDir = join(root, '.mim', 'resources')
  if (!existsSync(resourcesDir)) return []
  const out: string[] = []
  const queue = ['.mim/resources']
  let visited = 0

  while (queue.length > 0 && visited < MAX_RESOURCE_DIRS && out.length < MAX_RESOURCE_BIBS) {
    const relDir = queue.shift()!
    visited++
    let entries: Dirent[]
    try {
      entries = readdirSync(resolveWorkspacePath(root, relDir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const rel = toSlashPath(join(relDir, entry.name))
      if (entry.isFile() && extname(entry.name).toLowerCase() === '.bib') {
        out.push(rel)
        if (out.length >= MAX_RESOURCE_BIBS) break
      } else if (isDirectoryEntry(root, rel, entry)) {
        queue.push(rel)
      }
    }
  }

  return out.sort((a, b) => a.localeCompare(b))
}

function isDirectoryEntry(root: string, rel: string, entry: Dirent): boolean {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return statSync(resolveWorkspacePath(root, rel)).isDirectory()
  } catch {
    return false
  }
}

function duplicateKeys(entries: BibEntry[]): DuplicateReferenceKey[] {
  const counts = new Map<string, number>()
  for (const entry of entries) counts.set(entry.key, (counts.get(entry.key) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
}

function formatAuthors(field: string | undefined): string {
  if (!field) return ''
  return parseAuthors(field)
    .map(author => author.given ? `${author.family}, ${author.given}` : author.family)
    .join('; ')
}

function firstString(...values: Array<string | undefined>): string | undefined {
  return values.find(value => typeof value === 'string' && value.trim().length > 0)
}

function resolveWorkspacePath(workspacePath: string, path: string): string {
  if (isAbsolute(path)) throw new Error('References path must be workspace-relative')
  const root = resolve(workspacePath)
  const resolved = resolve(root, path)
  const rel = relative(root, resolved)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path traversal outside workspace is not allowed')
  }
  assertNoSymlinkEscape(resolved, root)
  return resolved
}

function assertNoSymlinkEscape(resolved: string, root: string): void {
  const rel = relative(root, resolved)
  if (rel.startsWith(join('.mim', 'resources'))) return

  let check = resolved
  while (!lexists(check)) {
    const parent = dirname(check)
    if (parent === check) return
    check = parent
  }

  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(check)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  if (!stat.isSymbolicLink() && !hasSymlinkAncestor(check, root)) return

  let real: string
  try {
    real = realpathSync(check)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    if (!stat.isSymbolicLink()) return
    real = resolve(dirname(check), readlinkSync(check))
  }
  const remainder = relative(check, resolved)
  const fullReal = canonicalizeBestEffort(remainder && remainder !== '.' ? join(real, remainder) : real)
  let canonicalRoot: string
  try { canonicalRoot = realpathSync(root) } catch { canonicalRoot = root }
  const realRel = relative(canonicalRoot, fullReal)
  if (realRel.startsWith('..') || isAbsolute(realRel)) {
    throw new Error('Path resolves outside workspace via symlink')
  }
}

function lexists(path: string): boolean {
  try { lstatSync(path); return true } catch { return false }
}

function canonicalizeBestEffort(path: string): string {
  let base = path
  const tail: string[] = []
  while (!lexists(base)) {
    const parent = dirname(base)
    if (parent === base) return path
    tail.unshift(basename(base))
    base = parent
  }
  try { return join(realpathSync(base), ...tail) } catch { return path }
}

function hasSymlinkAncestor(path: string, stopAt: string): boolean {
  let current = dirname(path)
  const stop = resolve(stopAt)
  while (current.length >= stop.length && current !== dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) return true
    } catch {
      break
    }
    current = dirname(current)
  }
  return false
}

function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}
