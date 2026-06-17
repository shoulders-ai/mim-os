import { describe, expect, it } from 'vitest'
import { mapTraceToTelemetryEvent, sanitizeTelemetryEvent } from './events.js'
import type { TraceEvent } from '@main/trace/trace.js'

function trace(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    ts: '2026-06-14T12:00:00.000Z',
    traceId: 'trace-secret',
    spanId: 'span-secret',
    kind: 'tool.result',
    actor: 'ai',
    ...overrides,
  }
}

describe('telemetry event normalization', () => {
  it('keeps only allowlisted props and normalizes manual events', () => {
    const event = sanitizeTelemetryEvent('file_open', {
      ext: 'Markdown',
      surface: 'editor',
      path: 'docs/secret-client-file.md',
    })

    expect(event).toEqual({
      eventType: 'file_open',
      props: { ext: 'markdown', surface: 'editor' },
    })
  })

  it('drops unknown events', () => {
    expect(sanitizeTelemetryEvent('client_report_opened', { ext: 'md' })).toBeNull()
  })

  it('never forwards raw error messages from tool errors', () => {
    const event = mapTraceToTelemetryEvent(trace({
      kind: 'tool.error',
      actor: 'ai',
      tool: 'fs.read',
      durationMs: 420,
      summary: {
        error: 'Failed to read docs/client-acquisition-plan.md: prompt canary',
      },
      subject: 'docs/client-acquisition-plan.md',
      payloadRef: 'blobs/trace-secret/span-secret.params.json',
    }))

    expect(event).toEqual({
      eventType: 'tool_error',
      props: { tool: 'fs.read', actor: 'ai', durationBucket: '<1s' },
    })
    expect(JSON.stringify(event)).not.toContain('client-acquisition-plan')
    expect(JSON.stringify(event)).not.toContain('prompt canary')
  })

  it('never forwards captured-content payload refs from tool results', () => {
    const event = mapTraceToTelemetryEvent(trace({
      kind: 'tool.result',
      actor: 'ai',
      tool: 'fs.read',
      durationMs: 120,
      summary: { content: '[redacted]' },
      payloadRef: 'blobs/trace-1/span-1.result.json',
    }))

    expect(event).toEqual({
      eventType: 'tool_use',
      props: { tool: 'fs.read', actor: 'ai', durationBucket: '<1s' },
    })
    expect(JSON.stringify(event)).not.toContain('payloadRef')
    expect(JSON.stringify(event)).not.toContain('blobs/')
  })

  it('never forwards the model I/O payload ref from chat.turn.done', () => {
    expect(mapTraceToTelemetryEvent(trace({
      kind: 'chat.turn.done',
      actor: 'ai',
      model: 'claude-sonnet-4-6',
      data: { profile: 'chat', steps: 3 },
      payloadRef: 'blobs/trace-1/span-1.messages.json',
    }))).toBeNull()
  })

  it('maps model.call using actual trace usage fields', () => {
    const event = mapTraceToTelemetryEvent(trace({
      kind: 'model.call',
      actor: 'ai',
      model: 'claude-sonnet-4-6',
      data: {
        profile: 'chat',
        inputTokens: 1200.8,
        outputTokens: 300,
        totalTokens: 1500,
        estimatedCost: 0.012345678,
        prompt: 'never send me',
      },
    }))

    expect(event).toEqual({
      eventType: 'model_call',
      props: {
        model: 'claude-sonnet-4-6',
        profile: 'chat',
        inputTokens: 1200,
        outputTokens: 300,
        totalTokens: 1500,
        estimatedCost: 0.012346,
      },
    })
  })

  it('filters chat_send to chat profile turns only', () => {
    expect(mapTraceToTelemetryEvent(trace({
      kind: 'chat.turn',
      actor: 'ai',
      model: 'claude-sonnet-4-6',
      data: { profile: 'inline' },
    }))).toBeNull()

    expect(mapTraceToTelemetryEvent(trace({
      kind: 'chat.turn',
      actor: 'ai',
      model: 'claude-sonnet-4-6',
      data: { profile: 'chat' },
    }))).toEqual({
      eventType: 'chat_send',
      props: { model: 'claude-sonnet-4-6' },
    })
  })

  it('maps package terminal events including cancelled runs', () => {
    const done = mapTraceToTelemetryEvent(trace({
      kind: 'job.done',
      actor: 'package',
      packageId: 'slides',
      durationMs: 9000,
      subject: 'slides.render',
    }))
    const cancelled = mapTraceToTelemetryEvent(trace({
      kind: 'job.cancelled',
      actor: 'package',
      packageId: 'slides',
      durationMs: 31_000,
      subject: 'slides.render',
    }))

    expect(done).toEqual({
      eventType: 'package_run',
      props: { packageId: 'slides', status: 'completed', durationBucket: '5-30s' },
    })
    expect(cancelled).toEqual({
      eventType: 'package_run',
      props: { packageId: 'slides', status: 'cancelled', durationBucket: '>30s' },
    })
  })

  it('maps real gate decisions', () => {
    expect(mapTraceToTelemetryEvent(trace({
      kind: 'gate.decision',
      actor: 'ai',
      tool: 'terminal.run',
      data: { decision: 'requested', reason: 'This changes your workspace' },
    }))).toEqual({
      eventType: 'gate_decision',
      props: { tool: 'terminal.run', decision: 'requested' },
    })
  })

  it('maps export tool results without reading paths from summaries', () => {
    const event = mapTraceToTelemetryEvent(trace({
      kind: 'tool.result',
      actor: 'user',
      tool: 'export.pdf',
      durationMs: 6000,
      summary: { path: '/Users/me/Desktop/Client Report.pdf', format: 'pdf' },
    }))

    expect(event).toEqual({
      eventType: 'export',
      props: { format: 'pdf' },
    })
  })

  it('ignores telemetry tools so telemetry does not report itself', () => {
    expect(mapTraceToTelemetryEvent(trace({
      kind: 'tool.result',
      actor: 'user',
      tool: 'telemetry.track',
      durationMs: 2,
    }))).toBeNull()
  })
})
