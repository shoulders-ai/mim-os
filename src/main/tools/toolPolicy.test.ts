import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry, type ToolRegistry } from '@main/tools/registry.js'
import {
  aiToolKeyEnabled,
  isToolPolicySettingWrite,
  readToolsPolicy,
  registerToolPolicyTools,
} from '@main/tools/toolPolicy.js'

describe('tool availability policy', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-tool-policy-'))
    mkdirSync(join(dir, '.mim'), { recursive: true })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeSettings(settings: Record<string, unknown>) {
    writeFileSync(join(dir, '.mim', 'settings.json'), JSON.stringify(settings))
  }

  it('keeps core tools on and third-party data tools off by default', () => {
    const policy = readToolsPolicy(dir)

    expect(policy.isEnabled('git.push')).toBe(true)
    expect(policy.isEnabled('terminal.run')).toBe(true)
    expect(policy.isEnabled('web.read')).toBe(true)
    expect(policy.isEnabled('slack.search')).toBe(false)
    expect(policy.isEnabled('gmail.search')).toBe(false)
    expect(policy.isEnabled('gmail.send')).toBe(false)
  })

  it('uses explicit enabled and disabled arrays, with disabled winning', () => {
    writeSettings({
      tools: {
        enabled: ['slack.search', 'slack.history', 'git.push'],
        disabled: ['git.push', 'terminal.run'],
      },
    })

    const policy = readToolsPolicy(dir)

    expect(policy.enabled).toEqual(['slack.search', 'slack.history', 'git.push'])
    expect(policy.disabled).toEqual(['git.push', 'terminal.run'])
    expect(policy.isEnabled('slack.search')).toBe(true)
    expect(policy.isEnabled('git.push')).toBe(false)
    expect(policy.isEnabled('terminal.run')).toBe(false)
  })

  it('derives Slack and Google rows from legacy connector settings until tools policy exists', () => {
    writeSettings({
      connectors: {
        slack: { aiEnabled: true, sendEnabled: true, directMessages: false },
        google: { aiEnabled: true, gmailEnabled: true, gmailSendEnabled: false, driveEnabled: true },
      },
    })

    const policy = readToolsPolicy(dir)

    expect(policy.isEnabled('slack.search')).toBe(true)
    expect(policy.isEnabled('slack.send')).toBe(true)
    expect(policy.isEnabled('slack.dms')).toBe(false)
    expect(policy.isEnabled('gmail.search')).toBe(true)
    expect(policy.isEnabled('gmail.send')).toBe(false)
    expect(policy.isEnabled('drive.search')).toBe(true)
  })

  it('maps registry ids to AI SDK tool keys', () => {
    writeSettings({ tools: { disabled: ['git.push', 'web.live.open', 'web.live.act', 'settings.set'] } })

    const policy = readToolsPolicy(dir)

    expect(aiToolKeyEnabled(policy, 'git_push')).toBe(false)
    expect(aiToolKeyEnabled(policy, 'browser_open')).toBe(false)
    expect(aiToolKeyEnabled(policy, 'browser_act')).toBe(false)
    expect(aiToolKeyEnabled(policy, 'connections_configure')).toBe(false)
    expect(aiToolKeyEnabled(policy, 'connections_status')).toBe(true)
    expect(aiToolKeyEnabled(policy, 'web_read')).toBe(true)
  })

  it('exposes get/set tools that normalize writes and reject unknown ids', async () => {
    const tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    tools.register({
      name: 'git.push',
      description: 'Push',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ ok: true }),
    })
    registerToolPolicyTools(tools)

    const set = await tools.call('toolPolicy.set', {
      toolIds: ['git.push'],
      enabled: false,
    }, { actor: 'user' }) as { policy: { disabled: string[] } }

    expect(set.policy.disabled).toEqual(['git.push'])
    const raw = JSON.parse(readFileSync(join(dir, '.mim', 'settings.json'), 'utf-8'))
    expect(raw.tools.disabled).toEqual(['git.push'])

    await expect(tools.call('toolPolicy.set', {
      toolIds: ['not.a.tool'],
      enabled: false,
    }, { actor: 'user' })).rejects.toThrow(/Unknown tool policy id/)
  })

  it('detects settings.set writes that would change tool policy', () => {
    expect(isToolPolicySettingWrite({ key: 'tools', value: {} })).toBe(true)
    expect(isToolPolicySettingWrite({ key: 'tools.enabled', value: [] })).toBe(true)
    expect(isToolPolicySettingWrite({ key: 'theme', value: 'sage' })).toBe(false)
  })
})
