export type SubagentStatus =
  | 'queued'
  | 'working'
  | 'waiting'
  | 'needs-approval'
  | 'done'
  | 'error'
  | 'interrupted'
  | 'stopped'

export interface SubagentInboxMessage {
  id: string
  message: string
  createdAt: string
  deliveredAt?: string
}

export interface SubagentSessionMetadata {
  rootSessionId: string
  parentSessionId: string
  depth: number
  status: SubagentStatus
  currentTurnId?: string
  modelId?: string
  agentId?: string
  effectiveToolAllowlist?: string[]
  approvalAllow?: string[]
  requestedGrants?: string[]
  originActor?: 'user' | 'ai' | 'system' | 'remote'
  principal?: string
  callerName?: string
  transport?: string
  inbox: SubagentInboxMessage[]
  result?: string
  resultUpdatedAt?: string
  collectedAt?: string
  error?: string
  lastActivity?: string
  lastActivityAt?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
}

const STATUSES = new Set<SubagentStatus>([
  'queued',
  'working',
  'waiting',
  'needs-approval',
  'done',
  'error',
  'interrupted',
  'stopped',
])

export function isSubagentStatus(value: unknown): value is SubagentStatus {
  return typeof value === 'string' && STATUSES.has(value as SubagentStatus)
}

export function isTerminalSubagentStatus(status: SubagentStatus): boolean {
  return status === 'done' || status === 'error' || status === 'interrupted' || status === 'stopped'
}

export function normalizeSubagentMetadata(
  raw: unknown,
  base?: SubagentSessionMetadata,
): SubagentSessionMetadata | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const value = raw as Record<string, unknown>
  const rootSessionId = stringValue(value.rootSessionId) ?? base?.rootSessionId
  const parentSessionId = stringValue(value.parentSessionId) ?? base?.parentSessionId
  const depth = nonNegativeInteger(value.depth) ?? base?.depth
  const status = isSubagentStatus(value.status) ? value.status : base?.status
  const createdAt = stringValue(value.createdAt) ?? base?.createdAt
  const updatedAt = stringValue(value.updatedAt) ?? base?.updatedAt
  if (!rootSessionId || !parentSessionId || depth === undefined || !status || !createdAt || !updatedAt) return base

  const result: SubagentSessionMetadata = {
    rootSessionId,
    parentSessionId,
    depth,
    status,
    inbox: value.inbox === undefined ? [...(base?.inbox ?? [])] : normalizeInbox(value.inbox),
    createdAt,
    updatedAt,
  }
  copyString(value, base, result, 'currentTurnId')
  copyString(value, base, result, 'modelId')
  copyString(value, base, result, 'agentId')
  copyString(value, base, result, 'principal')
  copyString(value, base, result, 'callerName')
  copyString(value, base, result, 'transport')
  copyString(value, base, result, 'result')
  copyString(value, base, result, 'resultUpdatedAt')
  copyString(value, base, result, 'collectedAt')
  copyString(value, base, result, 'error')
  copyString(value, base, result, 'lastActivity')
  copyString(value, base, result, 'lastActivityAt')
  copyString(value, base, result, 'startedAt')
  copyString(value, base, result, 'completedAt')
  copyStringArray(value, base, result, 'effectiveToolAllowlist')
  copyStringArray(value, base, result, 'approvalAllow')
  copyStringArray(value, base, result, 'requestedGrants')
  const originActor = value.originActor ?? base?.originActor
  if (originActor === 'user' || originActor === 'ai' || originActor === 'system' || originActor === 'remote') {
    result.originActor = originActor
  }
  return result
}

function normalizeInbox(value: unknown): SubagentInboxMessage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const entry = item as Record<string, unknown>
    const id = stringValue(entry.id)
    const message = stringValue(entry.message)
    const createdAt = stringValue(entry.createdAt)
    if (!id || !message || !createdAt) return []
    return [{
      id,
      message,
      createdAt,
      ...(stringValue(entry.deliveredAt) ? { deliveredAt: stringValue(entry.deliveredAt) } : {}),
    }]
  })
}

function copyString<K extends keyof SubagentSessionMetadata>(
  raw: Record<string, unknown>,
  base: SubagentSessionMetadata | undefined,
  target: SubagentSessionMetadata,
  key: K,
): void {
  const value = raw[key as string]
  const resolved = value === null || value === '' ? undefined : stringValue(value) ?? base?.[key]
  if (typeof resolved === 'string') (target as Record<string, unknown>)[key as string] = resolved
}

function copyStringArray<K extends 'effectiveToolAllowlist' | 'approvalAllow' | 'requestedGrants'>(
  raw: Record<string, unknown>,
  base: SubagentSessionMetadata | undefined,
  target: SubagentSessionMetadata,
  key: K,
): void {
  const value = raw[key]
  const resolved = value === undefined
    ? base?.[key]
    : Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      : undefined
  if (resolved) target[key] = resolved
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
