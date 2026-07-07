import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry, type ToolRegistry } from '@main/tools/registry.js'
import {
  aiToolKeyEnabled,
  connectorPolicyFromTools,
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

  it('blocks connectors key as a tool policy write', () => {
    expect(isToolPolicySettingWrite({ key: 'connectors', value: {} })).toBe(true)
    expect(isToolPolicySettingWrite({ key: 'connectors.slack', value: {} })).toBe(true)
  })

  it('covers history.restore and fs.list in their respective rows', () => {
    writeSettings({ tools: { disabled: ['history.restore', 'fs.list'] } })
    const policy = readToolsPolicy(dir)
    expect(policy.isEnabled('history.restore')).toBe(false)
    expect(policy.isEnabled('fs.list')).toBe(false)
    expect(aiToolKeyEnabled(policy, 'history_restore')).toBe(false)
    expect(aiToolKeyEnabled(policy, 'fs_list')).toBe(false)
  })

  it('applies write-implies-read cascade: enabling send auto-enables read', async () => {
    const tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerToolPolicyTools(tools)

    await tools.call('toolPolicy.set', { rowId: 'slack.send', enabled: true }, { actor: 'user' })

    const policy = readToolsPolicy(dir)
    expect(policy.isEnabled('slack.send')).toBe(true)
    expect(policy.isEnabled('slack.search')).toBe(true)
    expect(policy.isEnabled('slack.history')).toBe(true)
  })

  it('applies write-implies-read cascade: disabling read auto-disables send', async () => {
    writeSettings({ tools: { enabled: ['slack.search', 'slack.history', 'slack.channels', 'slack.replies', 'slack.users', 'slack.send'], disabled: [] } })
    const tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerToolPolicyTools(tools)

    await tools.call('toolPolicy.set', { rowId: 'slack.public', enabled: false }, { actor: 'user' })

    const policy = readToolsPolicy(dir)
    expect(policy.isEnabled('slack.search')).toBe(false)
    expect(policy.isEnabled('slack.send')).toBe(false)
  })

  it('materializes legacy connector state on first explicit write', async () => {
    writeSettings({
      connectors: {
        slack: { aiEnabled: true, sendEnabled: true },
      },
    })
    const tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerToolPolicyTools(tools)

    const before = readToolsPolicy(dir)
    expect(before.isEnabled('slack.search')).toBe(true)
    expect(before.isEnabled('slack.send')).toBe(true)

    await tools.call('toolPolicy.set', { rowId: 'git.push', enabled: false }, { actor: 'user' })

    const after = readToolsPolicy(dir)
    expect(after.isEnabled('slack.search')).toBe(true)
    expect(after.isEnabled('slack.send')).toBe(true)
    expect(after.isEnabled('git.push')).toBe(false)
  })

  it('derives gmailEnabled from read OR send tools', () => {
    writeSettings({ tools: { enabled: ['gmail.send'], disabled: [] } })
    const result = connectorPolicyFromTools(dir)
    expect(result.google?.gmailEnabled).toBe(true)
    expect(result.google?.gmailSendEnabled).toBe(true)
  })

  it('cascade + connectorPolicyFromTools: enabling gmail send also enables gmail read', async () => {
    const tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerToolPolicyTools(tools)

    await tools.call('toolPolicy.set', { rowId: 'google.gmail.send', enabled: true }, { actor: 'user' })

    const result = connectorPolicyFromTools(dir)
    expect(result.google?.gmailEnabled).toBe(true)
    expect(result.google?.gmailSendEnabled).toBe(true)
    const policy = readToolsPolicy(dir)
    expect(policy.isEnabled('gmail.search')).toBe(true)
    expect(policy.isEnabled('gmail.read')).toBe(true)
    expect(policy.isEnabled('gmail.send')).toBe(true)
  })

  it('includes code.run in a code domain row with sensitive risk', () => {
    const policy = readToolsPolicy(dir)
    expect(policy.isEnabled('code.run')).toBe(true)
    // code.run no longer has an AI key; bash is on the shell.run row
    expect(aiToolKeyEnabled(policy, 'bash')).toBe(true)
  })

  it('disabling shell.run blocks the bash AI tool key', () => {
    writeSettings({ tools: { disabled: ['shell.run'] } })
    const policy = readToolsPolicy(dir)
    expect(policy.isEnabled('shell.run')).toBe(false)
    expect(aiToolKeyEnabled(policy, 'bash')).toBe(false)
    // code.run remains enabled (Render button path)
    expect(policy.isEnabled('code.run')).toBe(true)
  })
})
