import { describe, expect, it } from 'vitest'
import {
  isAgentSessionEventPayload,
  isPackageJobEventPayload,
  isPackageRunBridgePayload,
  isPackageViewBridgePayload,
} from './payloads.js'

describe('app shell payload guards', () => {
  it('accepts valid app view bridge payloads only', () => {
    expect(isPackageViewBridgePayload({
      kind: 'package-view',
      packageId: 'references',
      viewId: 'main',
    })).toBe(true)
    expect(isPackageViewBridgePayload({
      kind: 'package-view',
      packageId: 'references',
    })).toBe(true)
    expect(isPackageViewBridgePayload({
      kind: 'package-view',
      packageId: '',
    })).toBe(false)
    expect(isPackageViewBridgePayload({
      kind: 'package-view',
      packageId: 'references',
      viewId: 12,
    })).toBe(false)
  })

  it('accepts valid app run bridge payloads only', () => {
    expect(isPackageRunBridgePayload({
      kind: 'package-run',
      packageId: 'scholar',
      runId: 'run-1',
    })).toBe(true)
    expect(isPackageRunBridgePayload({
      kind: 'package-run',
      packageId: 'scholar',
      runId: '',
    })).toBe(false)
    expect(isPackageRunBridgePayload(null)).toBe(false)
  })

  it('accepts app job events with required identity and ordering fields', () => {
    expect(isPackageJobEventPayload({
      type: 'job.started',
      packageId: 'slides',
      jobId: 'build',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
      sequence: 1,
      ephemeral: true,
    })).toBe(true)
    expect(isPackageJobEventPayload({
      type: 'job.started',
      packageId: 'slides',
      jobId: 'build',
      runId: 'run-1',
      ts: '2026-01-01T00:00:00.000Z',
    })).toBe(false)
  })

  it('accepts agent session events carrying a full session record', () => {
    expect(isAgentSessionEventPayload({
      type: 'session.started',
      session: {
        sessionId: 'sess-1',
        agentId: 'codex',
      },
    })).toBe(true)
    expect(isAgentSessionEventPayload({
      type: 'session.started',
      session: { sessionId: 'sess-1' },
    })).toBe(false)
    expect(isAgentSessionEventPayload([])).toBe(false)
  })
})
