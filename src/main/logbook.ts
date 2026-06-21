import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ToolContext } from '@main/tools/registry.js'

export interface LogbookEntry {
  ts: string
  actor: ToolContext['actor']
  message: string
  package_id?: string
  sessionId?: string
}

export interface AppendLogbookInput {
  actor: ToolContext['actor']
  message: string
  package_id?: string
  sessionId?: string
}

export interface LogbookDeps {
  now?: () => number
}

export interface ReadLogbookOptions {
  maxChars?: number
}

export interface ReadLogbookResult {
  path: string
  exists: boolean
  content: string
  truncated: boolean
}

const LOGBOOK_HEADER = '# Log\n\n'
const DEFAULT_MAX_CHARS = 24000

export function appendLogEntry(
  workspacePath: string,
  input: AppendLogbookInput,
  deps: LogbookDeps = {},
): { path: string; entry: LogbookEntry } {
  if (!workspacePath) throw new Error('No workspace open')
  const message = normalizeMessage(input.message)
  if (!message) throw new Error('Log message is required')

  const mimDir = join(workspacePath, '.mim')
  mkdirSync(mimDir, { recursive: true })
  const path = join(mimDir, 'log.md')
  if (!existsSync(path)) writeFileSync(path, LOGBOOK_HEADER)

  const entry: LogbookEntry = {
    ts: new Date((deps.now ?? Date.now)()).toISOString(),
    actor: input.actor,
    message,
  }
  if (input.package_id) entry.package_id = input.package_id
  if (input.sessionId) entry.sessionId = input.sessionId

  appendFileSync(path, formatLogEntry(entry))
  return { path, entry }
}

export function readLogbook(
  workspacePath: string,
  options: ReadLogbookOptions = {},
): ReadLogbookResult {
  if (!workspacePath) throw new Error('No workspace open')
  const path = join(workspacePath, '.mim', 'log.md')
  if (!existsSync(path)) {
    return { path, exists: false, content: '', truncated: false }
  }

  const content = readFileSync(path, 'utf-8')
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS))
  if (content.length <= maxChars) {
    return { path, exists: true, content, truncated: false }
  }

  return {
    path,
    exists: true,
    content: content.slice(content.length - maxChars),
    truncated: true,
  }
}

function formatLogEntry(entry: LogbookEntry): string {
  return `- ${entry.ts} [${sourceLabel(entry)}] ${entry.message}\n`
}

function sourceLabel(entry: LogbookEntry): string {
  if (entry.actor === 'package' && entry.package_id) return `app ${entry.package_id}`
  return entry.actor
}

function normalizeMessage(message: string): string {
  return String(message ?? '').trim().replace(/\s+/g, ' ')
}
