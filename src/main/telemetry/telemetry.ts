import { fetchHttpClient, type HttpClient } from '@main/integrations/http.js'
import type { TraceEvent, TraceSink } from '@main/trace/trace.js'
import {
  mapTraceToTelemetryEvent,
  sanitizeTelemetryEvent,
  type TelemetryEvent,
  type TelemetryEventOptions,
  type TelemetryEventType,
} from './events.js'
import type { TelemetryPlatform, TelemetryRuntime } from './config.js'

export interface TelemetryStatus {
  enabled: boolean
  locked: boolean
  queueSize: number
}

export interface TelemetryClient {
  track(event: TelemetryEventType, props?: Record<string, unknown>): void
  setEnabled(enabled: boolean): TelemetryStatus
  status(): TelemetryStatus
  flush(options?: { final?: boolean }): Promise<void>
  shutdown(): Promise<void>
  createTelemetrySink(): TraceSink
}

export interface CreateTelemetryOptions extends TelemetryEventOptions {
  http?: HttpClient
  appVersion: string
  platform: TelemetryPlatform
  runtime: TelemetryRuntime
  anonId: string
  enabled: boolean
  locked?: boolean
  endpoint?: string | null
  now?: () => Date
  onEnabledChange?: (enabled: boolean) => void
  flushIntervalMs?: number
  flushThreshold?: number
  batchSize?: number
  maxQueue?: number
  requestTimeoutMs?: number
  finalRequestTimeoutMs?: number
}

const DEFAULT_FLUSH_INTERVAL_MS = 60_000
const DEFAULT_FLUSH_THRESHOLD = 100
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_MAX_QUEUE = 200
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_FINAL_REQUEST_TIMEOUT_MS = 2500

export function createTelemetry(options: CreateTelemetryOptions): TelemetryClient {
  const http = options.http ?? fetchHttpClient
  const flushIntervalMs = positiveInt(options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS)
  const flushThreshold = positiveInt(options.flushThreshold, DEFAULT_FLUSH_THRESHOLD)
  const batchSize = positiveInt(options.batchSize, DEFAULT_BATCH_SIZE)
  const maxQueue = positiveInt(options.maxQueue, DEFAULT_MAX_QUEUE)
  const requestTimeoutMs = positiveInt(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS)
  const finalRequestTimeoutMs = positiveInt(options.finalRequestTimeoutMs, DEFAULT_FINAL_REQUEST_TIMEOUT_MS)

  let enabled = options.enabled === true && options.locked !== true
  const locked = options.locked === true
  let stopped = false
  let queue: TelemetryEnvelope[] = []
  let flushPromise: Promise<void> | null = null
  let interval: TimerLike | null = null

  const eventOptions: TelemetryEventOptions = {
    ...(options.knownModels ? { knownModels: options.knownModels } : {}),
  }

  function track(event: TelemetryEventType, props: Record<string, unknown> = {}): void {
    if (stopped || !enabled || locked) return
    const normalized = sanitizeTelemetryEvent(event, props, eventOptions)
    if (!normalized) return
    enqueue(normalized)
  }

  function enqueue(event: TelemetryEvent): void {
    if (stopped || !enabled || locked || !options.endpoint) return
    const envelope: TelemetryEnvelope = {
      anonId: options.anonId,
      eventType: event.eventType,
      props: event.props,
      appVersion: options.appVersion,
      platform: options.platform,
      ts: currentDate(options.now).toISOString(),
    }
    if (queue.length >= maxQueue) queue.shift()
    queue.push(envelope)
    if (queue.length >= flushThreshold) void flush()
  }

  function setEnabled(nextEnabled: boolean): TelemetryStatus {
    if (locked) {
      enabled = false
      queue = []
      stopTimer()
      return status()
    }
    options.onEnabledChange?.(nextEnabled)
    enabled = nextEnabled
    if (!enabled) {
      queue = []
      stopTimer()
    } else {
      startTimer()
    }
    return status()
  }

  function status(): TelemetryStatus {
    return { enabled: enabled && !locked, locked, queueSize: queue.length }
  }

  async function flush(flushOptions: { final?: boolean } = {}): Promise<void> {
    if (flushPromise) return flushPromise
    if (!enabled || locked || !options.endpoint || queue.length === 0) return

    flushPromise = (async () => {
      const batch = queue.splice(0, batchSize)
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        flushOptions.final ? finalRequestTimeoutMs : requestTimeoutMs,
      ) as TimerLike
      timeout.unref?.()
      try {
        const response = await http.request({
          url: options.endpoint!,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ events: batch }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Telemetry endpoint returned ${response.status}`)
      } catch {
        queue = [...batch, ...queue].slice(0, maxQueue)
      } finally {
        clearTimeout(timeout)
        flushPromise = null
      }
    })()

    return flushPromise
  }

  async function shutdown(): Promise<void> {
    stopped = true
    stopTimer()
    await flush({ final: true })
    queue = []
  }

  function createTelemetrySink(): TraceSink {
    return {
      write(event: TraceEvent) {
        if (stopped || !enabled || locked) return
        const normalized = mapTraceToTelemetryEvent(event, eventOptions)
        if (!normalized) return
        enqueue(normalized)
      },
    }
  }

  function startTimer(): void {
    if (interval || stopped || !enabled || locked || !options.endpoint) return
    interval = setInterval(() => { void flush() }, flushIntervalMs) as TimerLike
    interval.unref?.()
  }

  function stopTimer(): void {
    if (!interval) return
    clearInterval(interval)
    interval = null
  }

  startTimer()

  return {
    track,
    setEnabled,
    status,
    flush,
    shutdown,
    createTelemetrySink,
  }
}

type TimerLike = ReturnType<typeof setTimeout> & { unref?: () => void }

interface TelemetryEnvelope {
  anonId: string
  eventType: string
  props: Record<string, string | number | boolean>
  appVersion: string
  platform: TelemetryPlatform
  ts: string
}

function currentDate(now?: () => Date): Date {
  try {
    const value = now?.()
    return value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date()
  } catch {
    return new Date()
  }
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}
