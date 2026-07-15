import { beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import {
  readHistoryEnabled,
  readHistoryMaxBytes,
  readTracePayloadMaxBytes,
  readTracePayloadRetentionDays,
  readTraceRetentionDays,
  registerSettingsTools,
} from '@main/tools/settings.js'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('main settings tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-settings-test-'))
    tools = createToolRegistry(createTraceLog({
      devConsole: false,
      getRetentionDays: () => readTraceRetentionDays(dir),
    }))
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
    expect(result.settings.tracePayloadRetentionDays).toBe(7)
    expect(result.settings.tracePayloadMaxBytes).toBe(250 * 1024 * 1024)
    expect(result.settings.historyMaxBytes).toBe(512 * 1024 * 1024)
    expect(result.settings.historyEnabled).toBe(true)
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

  it('persists zero trace retention days as no local audit trail', async () => {
    const tracesDir = join(dir, '.mim', 'traces')
    const objectDir = join(tracesDir, 'objects', 'aa')
    mkdirSync(objectDir, { recursive: true })
    writeFileSync(join(tracesDir, '2026-06-10.jsonl'), '{}\n')
    writeFileSync(join(objectDir, `${'a'.repeat(64)}.json.gz`), 'retained content')

    await tools.call('settings.set', { key: 'traceRetentionDays', value: 0 }, ctx)

    expect(readTraceRetentionDays(dir)).toBe(0)
    expect(readdirSync(tracesDir).filter(file => file.endsWith('.jsonl'))).toHaveLength(0)
    expect(existsSync(join(tracesDir, 'objects'))).toBe(false)
  })

  it('persists the file recovery toggle', async () => {
    await tools.call('settings.set', { key: 'historyEnabled', value: false }, ctx)

    expect(readHistoryEnabled(dir)).toBe(false)
  })

  it('persists and resolves storage budgets and payload retention', async () => {
    await tools.call('settings.set', { key: 'historyMaxBytes', value: 256 * 1024 * 1024 }, ctx)
    await tools.call('settings.set', { key: 'tracePayloadRetentionDays', value: 14 }, ctx)
    await tools.call('settings.set', { key: 'tracePayloadMaxBytes', value: 100 * 1024 * 1024 }, ctx)

    expect(readHistoryMaxBytes(dir)).toBe(256 * 1024 * 1024)
    expect(readTracePayloadRetentionDays(dir)).toBe(14)
    expect(readTracePayloadMaxBytes(dir)).toBe(100 * 1024 * 1024)
  })

  it('defaults codeInterpreters to rscript, r, quarto', async () => {
    const result = await tools.call('settings.get', {}, ctx) as {
      settings: Record<string, unknown>
    }

    expect(result.settings.codeInterpreters).toEqual(['rscript', 'r', 'quarto'])
  })

  it('persists custom codeInterpreters list', async () => {
    await tools.call('settings.set', { key: 'codeInterpreters', value: ['rscript', 'python3'] }, ctx)

    const result = await tools.call('settings.get', { key: 'codeInterpreters' }, ctx) as {
      value: string[]
    }

    expect(result.value).toEqual(['rscript', 'python3'])
  })
})
