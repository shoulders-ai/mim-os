import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerTelemetryTools } from './telemetry.js'
import type { TelemetryClient } from '@main/telemetry/telemetry.js'

function fakeTelemetry(): TelemetryClient {
  return {
    track: vi.fn(),
    setEnabled: vi.fn((enabled: boolean) => ({ enabled, locked: false, queueSize: 0 })),
    status: vi.fn(() => ({ enabled: true, locked: false, queueSize: 3 })),
    flush: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    createTelemetrySink: vi.fn(() => ({ write: vi.fn() })),
  }
}

describe('telemetry tools', () => {
  let tools: ReturnType<typeof createToolRegistry>
  let telemetry: TelemetryClient

  beforeEach(() => {
    tools = createToolRegistry(createTraceLog({ devConsole: false }))
    telemetry = fakeTelemetry()
    registerTelemetryTools(tools, telemetry)
  })

  it('tracks only normalized allowlisted events and props', async () => {
    const result = await tools.call('telemetry.track', {
      event: 'file_open',
      props: {
        ext: '.MD',
        surface: 'editor',
        path: 'docs/secret.md',
      },
    }, { actor: 'user' })

    expect(telemetry.track).toHaveBeenCalledWith('file_open', {
      ext: 'md',
      surface: 'editor',
    })
    expect(result).toEqual({
      tracked: true,
      event: 'file_open',
      props: {
        ext: 'md',
        surface: 'editor',
      },
    })
  })

  it('rejects unknown events', async () => {
    await expect(
      tools.call('telemetry.track', { event: 'client_path', props: { path: 'secret.md' } }, { actor: 'user' }),
    ).rejects.toThrow(/Unknown telemetry event/)
  })

  it('keeps anon id out of status results', async () => {
    const result = await tools.call('telemetry.status', {}, { actor: 'user' })

    expect(result).toEqual({ enabled: true, locked: false })
    expect(JSON.stringify(result)).not.toContain('anon')
  })

  it('persists enabled state through the client', async () => {
    const result = await tools.call('telemetry.setEnabled', { enabled: false }, { actor: 'user' })

    expect(telemetry.setEnabled).toHaveBeenCalledWith(false)
    expect(result).toEqual({ enabled: false, locked: false })
  })

  it('denies app and AI actors for tracking and settings changes', async () => {
    await expect(
      tools.call('telemetry.track', { event: 'workspace_open' }, { actor: 'ai' }),
    ).rejects.toThrow(/user-only/)
    await expect(
      tools.call('telemetry.setEnabled', { enabled: true }, { actor: 'package', package_id: 'slides' }),
    ).rejects.toThrow(/user-only/)
  })
})
