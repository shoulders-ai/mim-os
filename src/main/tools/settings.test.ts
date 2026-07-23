import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import {
  readHistoryEnabled,
  readHistoryMaxBytes,
  readTracePayloadMaxBytes,
  readTracePayloadRetentionDays,
  readTraceRetentionDays,
  readPersonalApprovalMode,
  registerSettingsTools,
} from '@main/tools/settings.js'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadUserConfig, reset as resetUserConfig } from '@main/userConfig.js'

describe('main settings tools', () => {
  let dir: string
  let home: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    resetUserConfig()
    dir = mkdtempSync(join(tmpdir(), 'mim-settings-test-'))
    home = mkdtempSync(join(tmpdir(), 'mim-settings-home-'))
    tools = createToolRegistry(createTraceLog({
      devConsole: false,
      getRetentionDays: () => readTraceRetentionDays(dir),
    }))
    tools.setWorkspacePath(dir)
    registerSettingsTools(tools, { homeDir: home })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
    resetUserConfig()
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
    expect(readPersonalApprovalMode(home)).toBe('developer')
    expect(existsSync(join(dir, '.mim', 'settings.json'))).toBe(false)
  })

  it('updates Personal identity without writing Project settings', async () => {
    await tools.call('config.setUser', {
      name: 'Waqr',
      email: 'waqr@example.com',
      timezone: 'Europe/Berlin',
    }, ctx)

    const config = loadUserConfig(home)
    expect(config.user).toEqual({
      name: 'Waqr',
      email: 'waqr@example.com',
      timezone: 'Europe/Berlin',
    })
    expect(existsSync(join(dir, '.mim', 'settings.json'))).toBe(false)
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

  it('keeps Personal preferences stable when the current Project changes', async () => {
    const first = join(dir, 'first-project')
    const second = join(dir, 'second-project')
    mkdirSync(first)
    mkdirSync(second)

    tools.setWorkspacePath(first)
    await tools.call('settings.set', { key: 'theme', value: 'sage' }, ctx)
    await tools.call('settings.set', { key: 'editorFontSize', value: 19 }, ctx)
    await tools.call('settings.set', { key: 'lastInlineModel', value: 'gpt-5.4' }, ctx)
    await tools.call('settings.set', { key: 'automationApprovalMode', value: 'strict' }, ctx)

    tools.setWorkspacePath(second)
    expect(await tools.call('settings.get', { key: 'theme' }, ctx)).toEqual({ value: 'sage' })
    expect(await tools.call('settings.get', { key: 'editorFontSize' }, ctx)).toEqual({ value: 19 })
    expect(await tools.call('settings.get', { key: 'lastInlineModel' }, ctx)).toEqual({ value: 'gpt-5.4' })
    expect(await tools.call('settings.get', { key: 'automationApprovalMode' }, ctx)).toEqual({ value: 'strict' })

    tools.setWorkspacePath(first)
    expect(await tools.call('settings.get', { key: 'theme' }, ctx)).toEqual({ value: 'sage' })
    expect(existsSync(join(first, '.mim', 'settings.json'))).toBe(false)
    expect(existsSync(join(second, '.mim', 'settings.json'))).toBe(false)
    expect(readFileSync(join(home, '.mim', 'config.yaml'), 'utf-8')).toContain('theme: sage')
  })

  it('keeps Project runtime settings isolated between checkouts', async () => {
    const first = join(dir, 'first-project')
    const second = join(dir, 'second-project')
    mkdirSync(first)
    mkdirSync(second)

    tools.setWorkspacePath(first)
    await tools.call('settings.set', { key: 'traceRetentionDays', value: 14 }, ctx)
    await tools.call('settings.set', { key: 'enabledAgents', value: ['codex'] }, ctx)

    tools.setWorkspacePath(second)
    expect(await tools.call('settings.get', { key: 'traceRetentionDays' }, ctx)).toEqual({ value: 90 })
    expect(await tools.call('settings.get', { key: 'enabledAgents' }, ctx)).toEqual({ value: [] })

    tools.setWorkspacePath(first)
    expect(await tools.call('settings.get', { key: 'traceRetentionDays' }, ctx)).toEqual({ value: 14 })
    expect(await tools.call('settings.get', { key: 'enabledAgents' }, ctx)).toEqual({ value: ['codex'] })
  })

  it('ignores superseded Personal keys in Project settings without a compatibility reader', async () => {
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(join(dir, '.mim', 'settings.json'), JSON.stringify({
      theme: 'dracula',
      editorFontSize: 24,
      lastChatModel: 'legacy-project-model',
      automationApprovalMode: 'developer',
      historyEnabled: false,
    }))

    const result = await tools.call('settings.get', {}, ctx) as { settings: Record<string, unknown> }

    expect(result.settings.theme).toBe('white')
    expect(result.settings.editorFontSize).toBe(16)
    expect(result.settings.lastChatModel).toBe('')
    expect(result.settings.automationApprovalMode).toBe('normal')
    expect(result.settings.historyEnabled).toBe(false)
  })
})
