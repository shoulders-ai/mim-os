import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTelemetry } from './telemetry.js'
import type { HttpClient, HttpResponse } from '@main/integrations/http.js'

function response(ok = true, status = ok ? 200 : 500): HttpResponse {
  return {
    ok,
    status,
    json: async () => ({}),
    text: async () => '',
  }
}

function http(ok = true): HttpClient & { calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    request: async (input) => {
      calls.push(input)
      return response(ok)
    },
  }
}

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    http: http(),
    appVersion: '0.1.0',
    platform: 'macos' as const,
    runtime: 'headless' as const,
    anonId: 'anon-1',
    enabled: true,
    endpoint: 'https://telemetry.example/events',
    now: () => new Date('2026-06-14T12:00:00.000Z'),
    flushIntervalMs: 60_000,
    ...overrides,
  }
}

describe('telemetry client', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('posts exact v0.2-compatible batch bodies', async () => {
    const clientHttp = http()
    const telemetry = createTelemetry(baseOptions({ http: clientHttp }))

    telemetry.track('model_call', {
      model: 'claude-sonnet-4-6',
      totalTokens: 1200,
      unsafe: 'drop me',
    })
    await telemetry.flush()

    expect(clientHttp.calls).toHaveLength(1)
    expect(clientHttp.calls[0]).toMatchObject({
      url: 'https://telemetry.example/events',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    expect(JSON.parse(clientHttp.calls[0].body as string)).toEqual({
      events: [{
        anonId: 'anon-1',
        eventType: 'model_call',
        props: { model: 'claude-sonnet-4-6', totalTokens: 1200 },
        appVersion: '0.1.0',
        platform: 'macos',
        ts: '2026-06-14T12:00:00.000Z',
      }],
    })
    await telemetry.shutdown()
  })

  it('flushes when the queue reaches the threshold', async () => {
    const clientHttp = http()
    const telemetry = createTelemetry(baseOptions({
      http: clientHttp,
      flushThreshold: 2,
    }))

    telemetry.track('workspace_open')
    telemetry.track('workspace_open')
    await Promise.resolve()

    expect(clientHttp.calls).toHaveLength(1)
    await telemetry.shutdown()
  })

  it('flushes on the interval and clears the interval on shutdown', async () => {
    vi.useFakeTimers()
    const clientHttp = http()
    const telemetry = createTelemetry(baseOptions({ http: clientHttp }))

    telemetry.track('workspace_open')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(clientHttp.calls).toHaveLength(1)

    await telemetry.shutdown()
    telemetry.track('workspace_open')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(clientHttp.calls).toHaveLength(1)
  })

  it('requeues failed batches within the queue cap', async () => {
    const failingHttp = http(false)
    const telemetry = createTelemetry(baseOptions({
      http: failingHttp,
      maxQueue: 3,
      batchSize: 2,
    }))

    telemetry.track('workspace_open')
    telemetry.track('workspace_open')
    await telemetry.flush()

    expect(failingHttp.calls).toHaveLength(1)
    expect(telemetry.status().queueSize).toBe(2)

    telemetry.track('workspace_open')
    telemetry.track('workspace_open')
    expect(telemetry.status().queueSize).toBe(3)
    await telemetry.shutdown()
  })

  it('no-ops when disabled and clears queued events on disable', async () => {
    const clientHttp = http()
    const telemetry = createTelemetry(baseOptions({ http: clientHttp }))

    telemetry.track('workspace_open')
    expect(telemetry.status().queueSize).toBe(1)
    telemetry.setEnabled(false)
    expect(telemetry.status()).toMatchObject({ enabled: false, queueSize: 0 })
    telemetry.track('workspace_open')
    await telemetry.flush()

    expect(clientHttp.calls).toHaveLength(0)
    await telemetry.shutdown()
  })

  it('does not enable when locked by config', () => {
    const clientHttp = http()
    const telemetry = createTelemetry(baseOptions({
      http: clientHttp,
      enabled: false,
      locked: true,
    }))

    const status = telemetry.setEnabled(true)

    expect(status).toMatchObject({ enabled: false, locked: true })
    telemetry.track('workspace_open')
    expect(telemetry.status().queueSize).toBe(0)
  })

  it('maps trace events through the sink', async () => {
    const clientHttp = http()
    const telemetry = createTelemetry(baseOptions({ http: clientHttp }))
    const sink = telemetry.createTelemetrySink()

    sink.write({
      ts: '2026-06-14T12:00:00.000Z',
      traceId: 't',
      spanId: 's',
      kind: 'tool.result',
      actor: 'ai',
      tool: 'fs.read',
      durationMs: 300,
      summary: { path: 'docs/secret.md' },
    })
    await telemetry.flush()

    const body = JSON.parse(clientHttp.calls[0].body as string)
    expect(body.events[0].eventType).toBe('tool_use')
    expect(body.events[0].props).toEqual({
      tool: 'fs.read',
      actor: 'ai',
      durationBucket: '<1s',
    })
    await telemetry.shutdown()
  })
})
