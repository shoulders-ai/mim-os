import { beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { readTraceRetentionDays, registerSettingsTools } from '@main/tools/settings.js'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('main settings tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-settings-test-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerSettingsTools(tools)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('includes Workbench and automation defaults', async () => {
    const result = await tools.call('settings.get', {}, ctx) as {
      settings: Record<string, unknown>
    }

    expect(result.settings.automationApprovalMode).toBe('normal')
    expect(result.settings.traceRetentionDays).toBe(90)
    expect(result.settings['references.bibPath']).toBe('references/references.bib')
  })

  it('defaults enabledAgents to an empty opt-in list', async () => {
    const result = await tools.call('settings.get', {}, ctx) as {
      settings: Record<string, unknown>
    }

    expect(result.settings.enabledAgents).toEqual([])
  })

  it('persists the enabled coding agents list', async () => {
    await tools.call('settings.set', { key: 'enabledAgents', value: ['claude-code'] }, ctx)

    const result = await tools.call('settings.get', { key: 'enabledAgents' }, ctx) as {
      value: string[]
    }

    expect(result.value).toEqual(['claude-code'])
  })

  it('defaults agentFlags to an empty map', async () => {
    const result = await tools.call('settings.get', {}, ctx) as {
      settings: Record<string, unknown>
    }

    expect(result.settings.agentFlags).toEqual({})
  })

  it('persists custom agent flags per agent id', async () => {
    await tools.call('settings.set', {
      key: 'agentFlags',
      value: { 'claude-code': '--dangerously-skip-permissions' },
    }, ctx)

    const result = await tools.call('settings.get', { key: 'agentFlags' }, ctx) as {
      value: Record<string, string>
    }

    expect(result.value).toEqual({ 'claude-code': '--dangerously-skip-permissions' })
  })

  it('persists the automation approval mode', async () => {
    await tools.call('settings.set', { key: 'automationApprovalMode', value: 'developer' }, ctx)

    const result = await tools.call('settings.get', { key: 'automationApprovalMode' }, ctx) as {
      value: string
    }

    expect(result.value).toBe('developer')
  })

  it('persists the trace retention window', async () => {
    await tools.call('settings.set', { key: 'traceRetentionDays', value: 14 }, ctx)

    const result = await tools.call('settings.get', { key: 'traceRetentionDays' }, ctx) as {
      value: number
    }

    expect(result.value).toBe(14)
    expect(readTraceRetentionDays(dir)).toBe(14)
  })

  it('treats zero trace retention days as disabled', async () => {
    await tools.call('settings.set', { key: 'traceRetentionDays', value: 0 }, ctx)

    expect(readTraceRetentionDays(dir)).toBeUndefined()
  })
})
