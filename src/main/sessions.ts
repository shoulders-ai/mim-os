import { readFileSync, readdirSync, unlinkSync, existsSync, mkdirSync, renameSync } from 'fs'
import { dirname, join } from 'path'
import type { ToolRegistry } from '@main/tools/registry.js'
import { indexSession, removeSessionFromIndex } from '@main/search/search.js'
import { writeAgentContext } from '@main/ai/agentContext.js'
import { atomicWriteJson } from '@main/atomicJson.js'
import { loadManifest, upsertManifestEntry, removeManifestEntry, extractManifestEntry } from '@main/sessionManifest.js'
import type { ContextCompactionRecord } from '@main/ai/compaction.js'

export interface Session {
  id: string
  label: string
  modelId: string
  controlId: string
  messages: SessionMessage[]
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number }
  lastContextTokens: number
  lastInputTokens: number
  archived: boolean
  sortOrder?: number
  taskLabelGenerated?: boolean
  agentId?: string
  routineId?: string
  routineRunId?: string
  routineStatus?: RoutineRunStatus
  routineError?: string
  routineFiredAt?: string
  routineCompletedAt?: string
  compactions: ContextCompactionRecord[]
  createdAt: string
  updatedAt: string
}

export type RoutineRunStatus = 'working' | 'needs-approval' | 'done' | 'error' | 'stopped'

interface SessionMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  parts?: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
  createdAt?: string
}

export interface SessionToolOptions {
  onDeleted?: (id: string) => void
}

function normalizeSession(raw: Session): Session {
  const session: Session = {
    id: raw.id,
    label: raw.label,
    modelId: raw.modelId,
    controlId: raw.controlId,
    messages: raw.messages,
    usage: raw.usage,
    lastContextTokens: typeof raw.lastContextTokens === 'number' ? raw.lastContextTokens : 0,
    lastInputTokens: typeof raw.lastInputTokens === 'number' ? raw.lastInputTokens : 0,
    archived: raw.archived,
    compactions: normalizeCompactions(raw.compactions),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  }
  if (typeof raw.sortOrder === 'number') session.sortOrder = raw.sortOrder
  if (raw.taskLabelGenerated === true) session.taskLabelGenerated = true
  if (typeof raw.agentId === 'string') session.agentId = raw.agentId
  if (typeof raw.routineId === 'string') session.routineId = raw.routineId
  if (typeof raw.routineRunId === 'string') session.routineRunId = raw.routineRunId
  if (isRoutineRunStatus(raw.routineStatus)) session.routineStatus = raw.routineStatus
  if (typeof raw.routineError === 'string') session.routineError = raw.routineError
  if (typeof raw.routineFiredAt === 'string') session.routineFiredAt = raw.routineFiredAt
  if (typeof raw.routineCompletedAt === 'string') session.routineCompletedAt = raw.routineCompletedAt
  return session
}

function compareSessions(a: Session, b: Session): number {
  if (a.sortOrder !== undefined && b.sortOrder !== undefined) return a.sortOrder - b.sortOrder
  if (a.sortOrder !== undefined) return -1
  if (b.sortOrder !== undefined) return 1
  return b.updatedAt.localeCompare(a.updatedAt)
}

export function registerSessionTools(tools: ToolRegistry, options: SessionToolOptions = {}): void {
  tools.register({
    name: 'session.create',
    description: 'Create a new chat session',
    execute: async (params) => {
      const ws = tools.getWorkspacePath()
      if (!ws) throw new Error('No workspace open')

      const id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const agentId = typeof params.agentId === 'string' && params.agentId.length > 0 ? params.agentId : undefined
      const routineId = typeof params.routineId === 'string' && params.routineId.length > 0 ? params.routineId : undefined
      const routineRunId = typeof params.routineRunId === 'string' && params.routineRunId.length > 0 ? params.routineRunId : undefined
      const routineStatus = isRoutineRunStatus(params.routineStatus) ? params.routineStatus : undefined
      const routineError = typeof params.routineError === 'string' && params.routineError.length > 0 ? params.routineError : undefined
      const routineFiredAt = typeof params.routineFiredAt === 'string' && params.routineFiredAt.length > 0 ? params.routineFiredAt : undefined
      const routineCompletedAt = typeof params.routineCompletedAt === 'string' && params.routineCompletedAt.length > 0 ? params.routineCompletedAt : undefined
      const session: Session = {
        id,
        label: (params.label as string) || 'New chat',
        modelId: (params.modelId as string) || '',
        controlId: (params.controlId as string) || '',
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
        lastContextTokens: 0,
        lastInputTokens: 0,
        archived: false,
        compactions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      if (agentId) session.agentId = agentId
      if (routineId) session.routineId = routineId
      if (routineRunId) session.routineRunId = routineRunId
      if (routineStatus) session.routineStatus = routineStatus
      if (routineError) session.routineError = routineError
      if (routineFiredAt) session.routineFiredAt = routineFiredAt
      if (routineCompletedAt) session.routineCompletedAt = routineCompletedAt

      const dir = join(ws, '.mim', 'sessions')
      mkdirSync(dir, { recursive: true })
      atomicWriteJson(join(dir, `${id}.json`), session)
      upsertManifestEntry(dir, id, extractManifestEntry(session))
      indexSession(id, session.label, session.messages)

      // Regenerate the volatile runtime context when a new chat starts. The chat
      // system prompt reads it. Fire-and-forget; never block session creation.
      void writeAgentContext(ws).catch(() => {})

      return session
    }
  })

  tools.register({
    name: 'session.list',
    description: 'List all sessions',
    execute: async () => {
      const ws = tools.getWorkspacePath()
      if (!ws) return { sessions: [] }

      const dir = join(ws, '.mim', 'sessions')
      if (!existsSync(dir)) return { sessions: [] }

      // Quarantine any corrupt session files before reading the manifest.
      // The manifest self-heals from individual files, so we need corrupt
      // files renamed first so rebuildManifest does not encounter them.
      const jsonFiles = readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_manifest.json')
      for (const file of jsonFiles) {
        const filePath = join(dir, file)
        try {
          const raw = readFileSync(filePath, 'utf-8')
          JSON.parse(raw)
        } catch (err) {
          try {
            renameSync(filePath, `${filePath}.corrupt`)
            console.error(`Corrupt session file renamed: ${file} -> ${file}.corrupt`)
          } catch {
            console.error(`Corrupt session file could not be renamed: ${file}`, err)
          }
        }
      }

      const manifest = loadManifest(dir)
      const sessions: Session[] = Object.values(manifest).map(entry => ({
        ...entry,
        messages: [],
      }))

      sessions.sort(compareSessions)
      return { sessions }
    }
  })

  tools.register({
    name: 'session.get',
    description: 'Get a session with full messages',
    execute: async (params) => {
      const ws = tools.getWorkspacePath()
      if (!ws) throw new Error('No workspace open')

      const id = params.id as string
      const path = join(ws, '.mim', 'sessions', `${id}.json`)
      if (!existsSync(path)) throw new Error(`Session not found: ${id}`)

      return normalizeSession(JSON.parse(readFileSync(path, 'utf-8')) as Session)
    }
  })

  tools.register({
    name: 'session.update',
    description: 'Update a session (label, messages, usage, etc.)',
    execute: async (params) => {
      const ws = tools.getWorkspacePath()
      if (!ws) throw new Error('No workspace open')

      const id = params.id as string
      const path = join(ws, '.mim', 'sessions', `${id}.json`)
      if (!existsSync(path)) throw new Error(`Session not found: ${id}`)

      const session = normalizeSession(JSON.parse(readFileSync(path, 'utf-8')) as Session)

      if (params.label !== undefined) session.label = params.label as string
      if (params.modelId !== undefined) session.modelId = params.modelId as string
      if (params.controlId !== undefined) session.controlId = params.controlId as string
      if (params.messages !== undefined) session.messages = params.messages as SessionMessage[]
      if (params.usage !== undefined) Object.assign(session.usage, params.usage)
      if (params.lastContextTokens !== undefined) session.lastContextTokens = params.lastContextTokens as number
      if (params.lastInputTokens !== undefined) session.lastInputTokens = params.lastInputTokens as number
      if (params.archived !== undefined) session.archived = params.archived as boolean
      if (params.taskLabelGenerated !== undefined) session.taskLabelGenerated = params.taskLabelGenerated as boolean
      if (isRoutineRunStatus(params.routineStatus)) session.routineStatus = params.routineStatus
      if (params.routineError !== undefined) {
        if (typeof params.routineError === 'string' && params.routineError.length > 0) session.routineError = params.routineError
        else delete session.routineError
      }
      if (params.routineFiredAt !== undefined) {
        if (typeof params.routineFiredAt === 'string' && params.routineFiredAt.length > 0) session.routineFiredAt = params.routineFiredAt
        else delete session.routineFiredAt
      }
      if (params.routineCompletedAt !== undefined) {
        if (typeof params.routineCompletedAt === 'string' && params.routineCompletedAt.length > 0) session.routineCompletedAt = params.routineCompletedAt
        else delete session.routineCompletedAt
      }
      session.updatedAt = new Date().toISOString()

      atomicWriteJson(path, session)
      upsertManifestEntry(dirname(path), id, extractManifestEntry(session))
      indexSession(id, session.label, session.messages)
      return session
    }
  })

  tools.register({
    name: 'session.reorder',
    description: 'Persist manual session ordering',
    execute: async (params) => {
      const ws = tools.getWorkspacePath()
      if (!ws) throw new Error('No workspace open')

      const ids = Array.isArray(params.ids) ? params.ids.filter(id => typeof id === 'string') as string[] : []
      const dir = join(ws, '.mim', 'sessions')
      for (const [sortOrder, id] of ids.entries()) {
        const path = join(dir, `${id}.json`)
        if (!existsSync(path)) continue
        const session = normalizeSession(JSON.parse(readFileSync(path, 'utf-8')) as Session)
        session.sortOrder = sortOrder
        atomicWriteJson(path, session)
        upsertManifestEntry(dir, id, extractManifestEntry(session))
      }

      return { ok: true, ids }
    }
  })

  tools.register({
    name: 'session.delete',
    description: 'Permanently delete a session',
    execute: async (params) => {
      const ws = tools.getWorkspacePath()
      if (!ws) throw new Error('No workspace open')

      const id = params.id as string
      const dir = join(ws, '.mim', 'sessions')
      const path = join(dir, `${id}.json`)
      if (existsSync(path)) unlinkSync(path)
      removeManifestEntry(dir, id)
      options.onDeleted?.(id)
      removeSessionFromIndex(id)
      return { deleted: id }
    }
  })
}

export function appendSessionCompaction(
  workspacePath: string,
  sessionId: string,
  record: ContextCompactionRecord,
): ContextCompactionRecord {
  const dir = join(workspacePath, '.mim', 'sessions')
  const path = join(dir, `${sessionId}.json`)
  if (!existsSync(path)) throw new Error(`Session not found: ${sessionId}`)

  const session = normalizeSession(JSON.parse(readFileSync(path, 'utf-8')) as Session)
  const normalizedRecord = normalizeCompactionRecord(record)
  const nextSession: Session = {
    ...session,
    compactions: [...session.compactions, normalizedRecord],
  }
  atomicWriteJson(path, nextSession)
  upsertManifestEntry(dir, sessionId, extractManifestEntry(nextSession))
  return normalizedRecord
}

function isRoutineRunStatus(value: unknown): value is RoutineRunStatus {
  return value === 'working' ||
    value === 'needs-approval' ||
    value === 'done' ||
    value === 'error' ||
    value === 'stopped'
}

function normalizeCompactions(value: unknown): ContextCompactionRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    try {
      return [normalizeCompactionRecord(item as ContextCompactionRecord)]
    } catch {
      return []
    }
  })
}

function normalizeCompactionRecord(value: ContextCompactionRecord): ContextCompactionRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid compaction record')
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : ''
  const summary = typeof record.summary === 'string' && record.summary.trim().length > 0 ? record.summary : ''
  const createdAt = typeof record.createdAt === 'string' && record.createdAt.length > 0 ? record.createdAt : ''
  if (!id || !summary || !createdAt) throw new Error('Invalid compaction record')

  return {
    id,
    ...(typeof record.firstKeptMessageId === 'string' ? { firstKeptMessageId: record.firstKeptMessageId } : {}),
    ...(typeof record.firstKeptMessageIndex === 'number' ? { firstKeptMessageIndex: Math.floor(record.firstKeptMessageIndex) } : {}),
    ...(typeof record.summarizedMessageCount === 'number' ? { summarizedMessageCount: Math.floor(record.summarizedMessageCount) } : {}),
    summary,
    ...(typeof record.tokensBefore === 'number' ? { tokensBefore: Math.floor(record.tokensBefore) } : {}),
    ...(typeof record.tokensAfter === 'number' ? { tokensAfter: Math.floor(record.tokensAfter) } : {}),
    ...(typeof record.savedRatio === 'number' ? { savedRatio: record.savedRatio } : {}),
    ...(typeof record.modelId === 'string' ? { modelId: record.modelId } : {}),
    ...(isCompactionTrigger(record.trigger) ? { trigger: record.trigger } : {}),
    createdAt,
  }
}

function isCompactionTrigger(value: unknown): value is ContextCompactionRecord['trigger'] {
  return value === 'post_turn' || value === 'pre_turn' || value === 'overflow'
}
