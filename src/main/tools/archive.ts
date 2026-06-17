import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { ToolRegistry } from '@main/tools/registry.js'
import { extractMessageText, type SearchIndexMessage } from '@main/search/searchText.js'
import { searchSessions } from '@main/search/search.js'
import type { PackageJobRunner, PackageRunRecord } from '@main/packages/packageJobs.js'

const PREVIEW_MAX = 240

interface ArchivedMeta {
  id: string
  label: string
  updatedAt: string
  messages: SearchIndexMessage[]
}

// First non-empty user/assistant text in a conversation, collapsed to a single line
// and truncated — the card subtitle for browse mode.
export function buildArchivePreview(messages: SearchIndexMessage[]): string {
  let text = ''
  for (const message of messages) {
    if (message.role === 'system') continue
    const candidate = extractMessageText(message).trim()
    if (candidate) { text = candidate; break }
  }
  if (!text) return ''

  const collapsed = text.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 3).join(' ')
  return collapsed.length > PREVIEW_MAX ? collapsed.slice(0, PREVIEW_MAX).trimEnd() + '…' : collapsed
}

interface SearchHit {
  sessionId: string
  label: string
  excerpt: string
  messageIdx: number
}

export interface ArchiveSearchResult {
  sessionId: string
  label: string
  excerpt: string
  updatedAt: string
  messageIdx: number
}

interface ArchivedPackageRunItem {
  id: string
  packageId: string
  jobId: string
  label: string
  updatedAt: string
  eventCount: number
  status: string
  preview: string
}

interface ArchivedAgentSessionItem {
  id: string
  agentId: string
  label: string
  updatedAt: string
  status: string
  preview: string
}

// Keep only hits whose session is archived, one row per session, capped at
// maxResults, enriched with the archived session's date. Pure so it is tested
// without the FTS native module.
export function filterArchivedMatches(
  hits: SearchHit[],
  archived: Map<string, { label: string; updatedAt: string }>,
  maxResults: number,
): ArchiveSearchResult[] {
  const seen = new Set<string>()
  const results: ArchiveSearchResult[] = []
  for (const hit of hits) {
    const meta = archived.get(hit.sessionId)
    if (!meta || seen.has(hit.sessionId)) continue
    seen.add(hit.sessionId)
    results.push({
      sessionId: hit.sessionId,
      label: hit.label || meta.label,
      excerpt: hit.excerpt,
      updatedAt: meta.updatedAt,
      messageIdx: hit.messageIdx,
    })
    if (results.length >= maxResults) break
  }
  return results
}

function readArchived(workspacePath: string): ArchivedMeta[] {
  const dir = join(workspacePath, '.mim', 'sessions')
  if (!existsSync(dir)) return []

  const archived: ArchivedMeta[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8'))
      if (!raw?.archived) continue
      archived.push({
        id: raw.id,
        label: raw.label ?? 'Untitled',
        updatedAt: raw.updatedAt ?? '',
        messages: Array.isArray(raw.messages) ? raw.messages : [],
      })
    } catch { /* skip corrupt files */ }
  }
  return archived
}

// Archived agent sessions are read straight from their record files, the same
// way archived chats are — the tool stays registrable without the live
// AgentSessions service (headless registers it with no deps at all).
function readArchivedAgentSessions(workspacePath: string): ArchivedAgentSessionItem[] {
  const dir = join(workspacePath, '.mim', 'agent-sessions')
  if (!existsSync(dir)) return []

  const archived: ArchivedAgentSessionItem[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8'))
      if (raw?.archived !== true) continue
      archived.push({
        id: raw.sessionId,
        agentId: raw.agentId ?? '',
        label: raw.title ?? 'Agent session',
        updatedAt: raw.endedAt ?? raw.startedAt ?? '',
        status: raw.status ?? '',
        preview: typeof raw.titleHint === 'string' ? raw.titleHint : '',
      })
    } catch { /* skip corrupt files */ }
  }
  return archived
}

function packageRunLabel(run: PackageRunRecord): string {
  if (typeof run.label === 'string' && run.label.trim().length > 0) return run.label
  const started = run.events.find(event => event.type === 'job.started')
  const label = started?.data?.label
  if (typeof label === 'string' && label.length > 0) return label
  return `${run.packageId} / ${run.jobId}`
}

function packageRunPreview(run: PackageRunRecord): string {
  const latest = [...(run.events ?? [])].reverse().find(event => {
    const data = event.data ?? {}
    return typeof data.label === 'string'
      || typeof data.name === 'string'
      || typeof data.message === 'string'
      || typeof data.error === 'string'
  })
  if (!latest) return ''
  const data = latest.data ?? {}
  const value = data.label ?? data.name ?? data.message ?? data.error
  return typeof value === 'string' ? value : ''
}

function archivedPackageRuns(jobs?: PackageJobRunner): ArchivedPackageRunItem[] {
  if (!jobs) return []
  return jobs.list(undefined, { archived: true }).map(run => ({
    id: run.runId,
    packageId: run.packageId,
    jobId: run.jobId,
    label: packageRunLabel(run),
    updatedAt: run.completedAt ?? run.startedAt,
    eventCount: run.events.length,
    status: run.status,
    preview: packageRunPreview(run),
  }))
}

export function registerArchiveTools(tools: ToolRegistry, jobs?: PackageJobRunner): void {
  // Browse: every archived session with a short content preview, newest first.
  tools.register({
    name: 'archive.list',
    description: 'List archived sessions, package runs, and agent sessions with a content preview',
    execute: async () => {
      const ws = tools.getWorkspacePath()
      if (!ws) return { sessions: [], packageRuns: [], agentSessions: [] }

      const sessions = readArchived(ws)
        .map(s => ({
          id: s.id,
          label: s.label,
          updatedAt: s.updatedAt,
          messageCount: s.messages.length,
          preview: buildArchivePreview(s.messages),
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

      const packageRuns = archivedPackageRuns(jobs)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

      const agentSessions = readArchivedAgentSessions(ws)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

      return { sessions, packageRuns, agentSessions }
    }
  })

  // Content search restricted to archived sessions, returning title + excerpt + date.
  // Post-filters the FTS index against the archived set so no schema migration is needed.
  tools.register({
    name: 'archive.search',
    description: 'Full-text search within archived sessions',
    execute: async (params) => {
      const ws = tools.getWorkspacePath()
      if (!ws) return { results: [] }

      const query = String(params.query ?? '').trim()
      if (!query) return { results: [] }
      const maxResults = typeof params.maxResults === 'number' ? params.maxResults : 30

      const meta = new Map(readArchived(ws).map(s => [s.id, { label: s.label, updatedAt: s.updatedAt }]))
      const hits = searchSessions(query, maxResults * 3)
      return { results: filterArchivedMatches(hits, meta, maxResults) }
    }
  })
}
