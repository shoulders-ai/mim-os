export interface AssistantPart {
  type?: string
  text?: string
  state?: string
  errorText?: string
  [key: string]: unknown
}

export interface AssistantTurnEntry {
  index: number
  part: AssistantPart
}

export interface AssistantTurnView {
  entries: AssistantTurnEntry[]
  hasDetails: boolean
  summary: string
  summarySegments: string[]
}

interface AssistantTurnOptions {
  canCollapse: boolean
  detailsExpanded: boolean
  elapsedMs?: number | null
}

const MIN_ELAPSED_VISIBLE_MS = 3000

export function buildAssistantTurnView(
  parts: AssistantPart[],
  options: AssistantTurnOptions,
): AssistantTurnView {
  const entries = parts.map((part, index) => ({ part, index }))
  if (!options.canCollapse) {
    return { entries, hasDetails: false, summary: '', summarySegments: [] }
  }

  const finalTextIndex = findFinalTextIndex(parts)
  if (finalTextIndex <= 0) {
    return { entries, hasDetails: false, summary: '', summarySegments: [] }
  }

  const detailParts = parts.slice(0, finalTextIndex)
  const stepCount = countDetailSteps(detailParts)
  if (stepCount === 0) {
    return { entries, hasDetails: false, summary: '', summarySegments: [] }
  }
  const summarySegments = detailSummarySegments(stepCount, options.elapsedMs, detailParts)

  return {
    entries: options.detailsExpanded ? entries : entries.slice(finalTextIndex),
    hasDetails: true,
    summary: summarySegments.join(' · '),
    summarySegments,
  }
}

export function formatTurnElapsed(elapsedMs?: number | null): string {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < MIN_ELAPSED_VISIBLE_MS) {
    return ''
  }

  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

export function withLastAssistantTurnElapsed<T extends { role?: string; metadata?: unknown }>(
  messages: T[],
  elapsedMs?: number | null,
): T[] {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) return messages

  const assistantIndex = findLastAssistantIndex(messages)
  if (assistantIndex < 0) return messages

  return messages.map((message, index) => {
    if (index !== assistantIndex) return message

    const metadata = isRecord(message.metadata) ? { ...message.metadata } : {}
    const mim = isRecord(metadata.mim) ? { ...metadata.mim } : {}
    return {
      ...message,
      metadata: {
        ...metadata,
        mim: {
          ...mim,
          turnElapsedMs: Math.round(elapsedMs),
        },
      },
    }
  })
}

export function getAssistantTurnElapsedMs(message: { metadata?: unknown }): number | null {
  const metadata = isRecord(message.metadata) ? message.metadata : null
  const mim = metadata && isRecord(metadata.mim) ? metadata.mim : null
  const value = mim?.turnElapsedMs
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function findFinalTextIndex(parts: AssistantPart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) return index
  }
  return -1
}

function countDetailSteps(parts: AssistantPart[]): number {
  return parts.filter(isVisibleDetailStep).length
}

function isVisibleDetailStep(part: AssistantPart): boolean {
  if (!part?.type || part.type === 'step-start') return false
  if (part.type === 'text' || part.type === 'reasoning') {
    return typeof part.text === 'string' && part.text.trim().length > 0
  }
  return true
}

function detailSummarySegments(_stepCount: number, elapsedMs?: number | null, parts: AssistantPart[] = []): string[] {
  const actionCount = parts.filter(isToolPart).length
  const fileSummary = summarizeFileActions(parts)
  const elapsed = formatTurnElapsed(elapsedMs)
  return [
    fileSummary,
    actionCount > 0 ? `${actionCount} ${actionCount === 1 ? 'action' : 'actions'}` : '',
    elapsed,
  ].filter(Boolean)
}

function isToolPart(part: AssistantPart): boolean {
  return Boolean(part?.type?.startsWith('tool-') || part?.type === 'dynamic-tool')
}

function summarizeFileActions(parts: AssistantPart[]): string {
  const fileActions = parts
    .map(fileActionForPart)
    .filter((action): action is { verb: string; path: string } => Boolean(action))

  const changed = fileActions.filter(action => action.verb !== 'checked')
  if (changed.length > 0) return summarizeFileActionGroup(changed)

  const checked = fileActions.filter(action => action.verb === 'checked')
  if (checked.length > 0) return summarizeFileActionGroup(checked)

  return ''
}

function summarizeFileActionGroup(actions: Array<{ verb: string; path: string }>): string {
  const unique = uniqueActions(actions)
  const verbs = new Set(unique.map(action => action.verb))
  if (verbs.size > 1) return `changed ${unique.length} ${unique.length === 1 ? 'file' : 'files'}`

  const verb = unique[0]?.verb || 'changed'
  if (unique.length > 2) return `${verb} ${unique.length} files`

  return `${verb} ${unique.map(action => displayPath(action.path)).join(', ')}`
}

function uniqueActions(actions: Array<{ verb: string; path: string }>): Array<{ verb: string; path: string }> {
  const seen = new Set<string>()
  return actions.filter(action => {
    const key = `${action.verb}:${action.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function fileActionForPart(part: AssistantPart): { verb: string; path: string } | null {
  if (!isToolPart(part)) return null

  const name = toolName(part)
  const input = isRecord(part.input) ? part.input : {}
  const path = stringField(input, 'path') || stringField(input, 'file')

  if (name === 'fs_edit' || name === 'fs_write' || name === 'package_edit') {
    return path ? { verb: 'edited', path } : null
  }
  if (name === 'fs_create') return path ? { verb: 'created', path } : null
  if (name === 'fs_delete') return path ? { verb: 'deleted', path } : null
  if (name === 'fs_read') return path ? { verb: 'checked', path } : null
  if (name === 'fs_rename') {
    const nextPath = stringField(input, 'new_path') || stringField(input, 'old_path')
    return nextPath ? { verb: 'moved', path: nextPath } : null
  }

  return null
}

function toolName(part: AssistantPart): string {
  if (part.type === 'dynamic-tool') return typeof part.toolName === 'string' ? part.toolName : 'tool'
  return String(part.type || '').replace(/^tool-/, '')
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function displayPath(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

function findLastAssistantIndex(messages: Array<{ role?: string }>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index
  }
  return -1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
