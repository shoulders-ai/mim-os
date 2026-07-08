import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { randomUUID } from 'crypto'
import type { PermissionDecisionEvent } from '@main/security/gate.js'
import { serveStateDir } from '@main/serve/tokens.js'

export interface ServeDeniedRequest {
  id: string
  createdAt: string
  principal?: string
  callerName?: string
  transport?: string
  tool: string
  reason: string
  target?: string
  pathKind?: string
  category: string
  risk: string
  params?: Record<string, unknown>
  traceId?: string
  parentSpanId?: string
  sessionId?: string
}

interface DenialOptions {
  home?: string
  workspacePath: string
}

export interface RecordServeDeniedRequestOptions extends DenialOptions {
  event: PermissionDecisionEvent
  now?: () => Date
}

export function recordServeDeniedRequest(options: RecordServeDeniedRequestOptions): ServeDeniedRequest | null {
  if (options.event.actor !== 'remote' || options.event.decision !== 'denied') return null
  const entry: ServeDeniedRequest = {
    id: randomUUID(),
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    principal: options.event.principal,
    callerName: options.event.callerName,
    transport: options.event.transport,
    tool: options.event.tool,
    reason: options.event.reason,
    target: options.event.target,
    pathKind: options.event.pathKind,
    category: options.event.category,
    risk: options.event.risk,
    params: options.event.params,
    traceId: options.event.traceId,
    parentSpanId: options.event.parentSpanId,
    sessionId: options.event.sessionId,
  }
  const path = serveDenialsPath(options)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf-8')
  return entry
}

export function listServeDeniedRequests(options: DenialOptions): ServeDeniedRequest[] {
  const path = serveDenialsPath(options)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as ServeDeniedRequest)
}

export function serveDenialsPath(options: DenialOptions): string {
  return resolve(serveStateDir(options), 'denied-requests.jsonl')
}
