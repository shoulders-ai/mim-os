import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createMemorySecretStore, MIM_KEYCHAIN_SERVICE } from '@main/integrations/secrets.js'
import { slackSecretAccount } from '@main/integrations/slack.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerSlackTools } from '@main/tools/slack.js'
import type { HttpClient } from '@main/integrations/http.js'

function fakeHttp(response: unknown, calls: Array<Record<string, unknown>> = []): HttpClient {
  return {
    async request(input) {
      calls.push(input)
      return {
        ok: true,
        status: 200,
        async json() { return response },
        async text() { return JSON.stringify(response) },
      }
    },
  }
}

describe('Slack tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-slack-tools-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('declares inputSchema on every Slack tool', () => {
    registerSlackTools(tools, { secrets: createMemorySecretStore(), http: fakeHttp({ ok: true }) })
    for (const name of [
      'slack.setToken',
      'slack.deleteToken',
      'slack.status',
      'slack.channels',
      'slack.users',
      'slack.dms',
      'slack.history',
      'slack.search',
      'slack.send',
    ]) {
      expect(tools.get(name)?.inputSchema, name).toBeDefined()
    }
  })

  it('stores Slack tokens without returning the secret', async () => {
    const secrets = createMemorySecretStore()
    registerSlackTools(tools, { secrets, http: fakeHttp({ ok: true }) })

    const result = await tools.call('slack.setToken', {
      account: 'dark-peak',
      token: 'xoxb-secret',
    }, ctx)

    expect(result).toEqual({ account: 'dark-peak', configured: true })
    expect(secrets.dump()).toEqual({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('dark-peak')}`]: 'xoxb-secret',
    })
  })

  it('uses the workspace mim.yaml slack account by default', async () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: demo\nslack: dark-peak\n')
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('dark-peak')}`]: 'xoxb-secret',
    })
    registerSlackTools(tools, { secrets, http: fakeHttp({ ok: true, messages: { matches: [] } }, calls) })

    await tools.call('slack.search', { query: 'budget' }, ctx)

    expect(calls).toHaveLength(1)
    expect(calls[0].headers).toEqual({ Authorization: 'Bearer xoxb-secret' })
  })

  it('status returns configured false without calling Slack when no token exists', async () => {
    const calls: Array<Record<string, unknown>> = []
    registerSlackTools(tools, { secrets: createMemorySecretStore(), http: fakeHttp({ ok: true }, calls) })

    const result = await tools.call('slack.status', {}, ctx)

    expect(result).toEqual({ account: 'default', configured: false })
    expect(calls).toEqual([])
  })

  it('sends Slack messages through chat.postMessage', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('default')}`]: 'xoxb-secret',
    })
    registerSlackTools(tools, { secrets, http: fakeHttp({ ok: true, ts: '1.2' }, calls) })

    await tools.call('slack.send', { channel: 'C1', text: 'Hello' }, ctx)

    expect(calls[0]).toMatchObject({
      url: 'https://slack.com/api/chat.postMessage',
      method: 'POST',
      body: JSON.stringify({ channel: 'C1', text: 'Hello' }),
    })
  })
})
