import { createHmac, timingSafeEqual } from 'crypto'
import { isAbsolute, relative as pathRelative, resolve } from 'path'
import { watch as chokidarWatch } from 'chokidar'
import {
  loadRoutineCatalog,
  readRoutineState,
  recordRoutineAutomationState,
  routineEveryMs,
  routineFileTrigger,
  routineScheduleExpression,
  routineWebhookSecretAccount,
  routineWebhookTrigger,
  writeRoutineState,
  type RoutineDefinition,
  type RoutineFileTriggerEvent,
  type RoutineRunContext,
  type RoutineRunStatus,
} from './routines.js'
import { MIM_KEYCHAIN_SERVICE, type SecretStore } from '@main/integrations/secrets.js'

export interface RoutineRunResult {
  sessionId: string
  routineRunId: string
  status: RoutineRunStatus
}

export interface RoutineFileChange {
  path: string
  kind: RoutineFileTriggerEvent
}

export interface RoutineWebhookDelivery {
  rawBody: Buffer
  body: unknown
  headers: Record<string, string | string[] | undefined>
}

export interface RoutineWebhookResult {
  status: number
  ok: boolean
  duplicate?: boolean
  error?: string
}

interface WatcherHandle {
  on(event: 'all', cb: (event: string, path: string) => void): unknown
  close(): Promise<unknown> | unknown
}

type WatchFn = (path: string, options: { ignoreInitial: boolean }) => WatcherHandle

export interface RoutineAutomationOptions {
  getWorkspacePath(): string | null
  runRoutine(routine: RoutineDefinition, context: RoutineRunContext): Promise<RoutineRunResult>
  knownTools?: () => Set<string>
  secrets?: SecretStore
  now?: () => Date
  watch?: WatchFn
  trace?: {
    append(event: Record<string, unknown>): void
  }
}

const WEBHOOK_TOLERANCE_MS = 5 * 60_000
const WEBHOOK_DELIVERY_TTL_MS = 24 * 60 * 60_000

export function createRoutineAutomation(options: RoutineAutomationOptions) {
  const now = options.now ?? (() => new Date())
  const watch = options.watch ?? (chokidarWatch as unknown as WatchFn)
  const running = new Set<string>()
  const watchers = new Map<string, WatcherHandle>()
  let watchedWorkspace: string | null = null

  function catalog() {
    const workspace = options.getWorkspacePath()
    if (!workspace) return null
    return {
      workspace,
      catalog: loadRoutineCatalog(workspace, options.knownTools ? { knownTools: options.knownTools() } : {}),
    }
  }

  async function tick(at: Date = now()): Promise<void> {
    const loaded = catalog()
    if (!loaded) return
    const state = readRoutineState(loaded.workspace)
    state.scheduler = { ...(state.scheduler ?? {}), heartbeatAt: at.toISOString() }
    writeRoutineState(loaded.workspace, state)

    for (const routine of loaded.catalog.routines) {
      if (!routine.enabled) continue
      if (!routineEveryMs(routine) && !routineScheduleExpression(routine)) continue
      const next = routine.nextRunAt ? parseDate(routine.nextRunAt) : null
      if (!next) {
        recordRoutineAutomationState(loaded.workspace, routine.id, {
          nextRunAt: nextFireAfter(routine, at)?.toISOString(),
        })
        continue
      }
      if (next.getTime() > at.getTime()) continue
      await fireRoutine(loaded.workspace, routine, { trigger: 'schedule' }, at)
      recordRoutineAutomationState(loaded.workspace, routine.id, {
        nextRunAt: nextFireAfter(routine, at)?.toISOString(),
      })
    }
  }

  async function handleFileChanges(changes: RoutineFileChange[]): Promise<void> {
    if (!changes.length) return
    const loaded = catalog()
    if (!loaded) return
    const at = now()
    for (const routine of loaded.catalog.routines) {
      if (!routine.enabled) continue
      const trigger = routineFileTrigger(routine)
      if (!trigger) continue
      const matches = changes.filter(change =>
        trigger.events.includes(change.kind) && pathMatchesTrigger(trigger.path, change.path),
      )
      if (!matches.length) continue
      await fireRoutine(loaded.workspace, routine, {
        trigger: 'files',
        payload: { files: matches },
      }, at)
    }
  }

  async function handleWebhook(name: string, delivery: RoutineWebhookDelivery): Promise<RoutineWebhookResult> {
    const loaded = catalog()
    if (!loaded) return { status: 404, ok: false, error: 'No workspace open' }
    const routine = loaded.catalog.routines.find(item => item.id === name || item.name === name)
    if (!routine) return { status: 404, ok: false, error: 'Routine not found' }
    if (!routine.enabled) return { status: 409, ok: false, error: 'Routine is not enabled on this machine' }
    const trigger = routineWebhookTrigger(routine)
    if (!trigger) return { status: 404, ok: false, error: 'Routine has no webhook trigger' }

    const secret = await options.secrets?.get(MIM_KEYCHAIN_SERVICE, routineWebhookSecretAccount(trigger.secret))
    if (!secret) return { status: 401, ok: false, error: 'Webhook secret is not configured' }

    const timestamp = header(delivery.headers, 'x-mim-timestamp')
    const signature = header(delivery.headers, 'x-mim-signature')
    if (!timestamp || !signature || !signatureValid(secret, timestamp, delivery.rawBody, signature)) {
      return { status: 401, ok: false, error: 'Invalid webhook signature' }
    }
    const timestampMs = Number(timestamp) * 1000
    if (!Number.isFinite(timestampMs) || Math.abs(now().getTime() - timestampMs) > WEBHOOK_TOLERANCE_MS) {
      return { status: 401, ok: false, error: 'Webhook timestamp is outside the allowed window' }
    }

    const deliveryId = header(delivery.headers, 'x-mim-delivery')
    if (deliveryId && markWebhookDelivery(loaded.workspace, routine.id, deliveryId, now())) {
      return { status: 202, ok: true, duplicate: true }
    }

    await fireRoutine(loaded.workspace, routine, {
      trigger: 'webhook',
      payload: {
        body: delivery.body,
        ...(deliveryId ? { deliveryId } : {}),
      },
    }, now())
    return { status: 202, ok: true }
  }

  async function start(): Promise<void> {
    const workspace = options.getWorkspacePath()
    await stop()
    if (!workspace) return
    watchedWorkspace = workspace
    const loaded = catalog()
    if (!loaded) return
    for (const routine of loaded.catalog.routines) {
      if (!routine.enabled) continue
      const trigger = routineFileTrigger(routine)
      if (!trigger) continue
      const watchPath = watchRootForTrigger(workspace, trigger.path)
      const watcher = watch(watchPath, { ignoreInitial: true })
      watcher.on('all', (event, changedPath) => {
        if (!isRoutineFileTriggerEvent(event)) return
        void handleFileChanges([{ path: relativeToWorkspace(workspace, changedPath), kind: event }])
      })
      watchers.set(routine.id, watcher)
    }
  }

  async function stop(): Promise<void> {
    watchedWorkspace = null
    const current = [...watchers.values()]
    watchers.clear()
    await Promise.all(current.map(item => item.close()))
  }

  async function refresh(): Promise<void> {
    if (!watchedWorkspace) return
    await start()
  }

  async function fireRoutine(
    workspace: string,
    routine: RoutineDefinition,
    context: RoutineRunContext,
    at: Date,
  ): Promise<void> {
    if (running.has(routine.id)) {
      options.trace?.append({
        kind: 'routine.skipped',
        actor: 'system',
        status: 'ok',
        data: { routineId: routine.id, reason: 'already-running', trigger: context.trigger },
      })
      return
    }
    running.add(routine.id)
    try {
      const result = await options.runRoutine(routine, context)
      recordRoutineAutomationState(workspace, routine.id, {
        lastRunId: result.routineRunId,
        lastSuccessAt: result.status === 'done' ? at.toISOString() : undefined,
      })
    } catch (err) {
      recordRoutineAutomationState(workspace, routine.id, {
        lastErrorAt: at.toISOString(),
      })
      throw err
    } finally {
      running.delete(routine.id)
    }
  }

  return {
    tick,
    handleFileChanges,
    handleWebhook,
    start,
    stop,
    refresh,
  }
}

export function nextFireAfter(routine: Pick<RoutineDefinition, 'trigger'>, after: Date): Date | null {
  const everyMs = routineEveryMs(routine)
  if (everyMs != null) return new Date(after.getTime() + everyMs)
  const expression = routineScheduleExpression(routine)
  if (!expression) return null
  return nextCronOccurrence(expression, after)
}

function nextCronOccurrence(expression: string, after: Date): Date | null {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const parsed = [
    cronValues(fields[0], 0, 59),
    cronValues(fields[1], 0, 23),
    cronValues(fields[2], 1, 31),
    cronValues(fields[3], 1, 12),
    cronValues(fields[4], 0, 7),
  ]
  if (parsed.some(values => values === false)) return null

  const candidate = new Date(after)
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatches(candidate, parsed as Array<Set<number> | null>)) return new Date(candidate)
    candidate.setMinutes(candidate.getMinutes() + 1)
  }
  return null
}

function cronValues(field: string, min: number, max: number): Set<number> | null | false {
  if (field === '*') return null
  const values = new Set<number>()
  for (const token of field.split(',')) {
    if (!/^[0-9]+$/.test(token)) return false
    const value = Number(token)
    if (value < min || value > max) return false
    values.add(max === 7 && value === 7 ? 0 : value)
  }
  return values
}

function cronMatches(date: Date, fields: Array<Set<number> | null>): boolean {
  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ]
  return fields.every((allowed, index) => !allowed || allowed.has(values[index]))
}

function pathMatchesTrigger(triggerPath: string, changedPath: string): boolean {
  const normalizedTrigger = slash(triggerPath)
  const normalizedPath = slash(changedPath)
  if (normalizedTrigger.endsWith('/')) return normalizedPath.startsWith(normalizedTrigger)
  if (normalizedTrigger.includes('*')) return globRegex(normalizedTrigger).test(normalizedPath)
  return normalizedPath === normalizedTrigger || normalizedPath.startsWith(`${normalizedTrigger}/`)
}

function globRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

function slash(path: string): string {
  return path.split('\\').join('/')
}

function watchRootForTrigger(workspace: string, triggerPath: string): string {
  const normalized = slash(triggerPath)
  if (!normalized.includes('*')) return resolve(workspace, normalized)
  const prefix = normalized.slice(0, normalized.indexOf('*'))
  const lastSlash = prefix.lastIndexOf('/')
  const root = lastSlash >= 0 ? prefix.slice(0, lastSlash) : '.'
  return resolve(workspace, root || '.')
}

function relativeToWorkspace(workspace: string, path: string): string {
  const resolvedWorkspace = resolve(workspace)
  const resolvedPath = resolve(path)
  const relativePath = pathRelative(resolvedWorkspace, resolvedPath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return slash(path)
  return slash(relativePath)
}

function isRoutineFileTriggerEvent(value: string): value is RoutineFileTriggerEvent {
  return value === 'add' || value === 'change' || value === 'unlink'
}

function parseDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function header(headers: RoutineWebhookDelivery['headers'], name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0] ?? ''
  return typeof value === 'string' ? value : ''
}

function signatureValid(secret: string, timestamp: string, rawBody: Buffer, signature: string): boolean {
  const expected = createHmac('sha256', secret)
  expected.update(timestamp)
  expected.update('.')
  expected.update(rawBody)
  const expectedValue = `sha256=${expected.digest('hex')}`
  const actual = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedValue)
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
}

function markWebhookDelivery(workspace: string, routineId: string, deliveryId: string, at: Date): boolean {
  const state = readRoutineState(workspace)
  const deliveries = { ...(state.webhookDeliveries ?? {}) }
  const key = `${routineId}:${deliveryId}`
  const previous = deliveries[key]
  if (previous && at.getTime() - Date.parse(previous) < WEBHOOK_DELIVERY_TTL_MS) return true
  const cutoff = at.getTime() - WEBHOOK_DELIVERY_TTL_MS
  for (const [deliveryKey, timestamp] of Object.entries(deliveries)) {
    if (Date.parse(timestamp) < cutoff) delete deliveries[deliveryKey]
  }
  deliveries[key] = at.toISOString()
  writeRoutineState(workspace, { ...state, webhookDeliveries: deliveries })
  return false
}
