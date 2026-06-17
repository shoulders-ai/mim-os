import type {
  AgentSessionEvent,
  PackageRunEvent,
} from '../../stores/runs.js'

export function isPackageViewBridgePayload(
  data: unknown,
): data is { kind: 'package-view'; packageId: string; viewId?: string } {
  if (!isRecord(data)) return false
  return data.kind === 'package-view'
    && typeof data.packageId === 'string'
    && data.packageId.length > 0
    && (data.viewId === undefined || typeof data.viewId === 'string')
}

export function isPackageRunBridgePayload(
  data: unknown,
): data is { kind: 'package-run'; packageId: string; runId: string } {
  if (!isRecord(data)) return false
  return data.kind === 'package-run'
    && typeof data.packageId === 'string'
    && data.packageId.length > 0
    && typeof data.runId === 'string'
    && data.runId.length > 0
}

export function isAgentSessionEventPayload(payload: unknown): payload is AgentSessionEvent {
  if (!isRecord(payload)) return false
  const session = payload.session
  return typeof payload.type === 'string'
    && isRecord(session)
    && typeof session.sessionId === 'string'
    && typeof session.agentId === 'string'
}

export function isPackageJobEventPayload(payload: unknown): payload is PackageRunEvent {
  if (!isRecord(payload)) return false
  return typeof payload.type === 'string'
    && typeof payload.packageId === 'string'
    && typeof payload.jobId === 'string'
    && typeof payload.runId === 'string'
    && typeof payload.ts === 'string'
    && typeof payload.sequence === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
