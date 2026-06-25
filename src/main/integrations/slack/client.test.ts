import { describe, expect, it } from 'vitest'
import { createMemorySecretStore, MIM_KEYCHAIN_SERVICE } from '@main/integrations/secrets.js'
import type { HttpClient } from '@main/integrations/http.js'
import { SlackIntegration, slackSecretAccount } from './client.js'

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

describe('SlackIntegration', () => {
  it('stores tokens in the Mim keychain namespace', async () => {
    const secrets = createMemorySecretStore()
    const slack = new SlackIntegration({ secrets, http: fakeHttp({ ok: true }) })

    await slack.setToken('dark-peak', 'xoxb-secret')

    expect(secrets.dump()).toEqual({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('dark-peak')}`]: 'xoxb-secret',
    })
  })

  it('builds authorized Slack GET requests', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('default')}`]: 'xoxb-secret',
    })
    const slack = new SlackIntegration({ secrets, http: fakeHttp({ ok: true, channels: [] }, calls) })

    await slack.channels({ account: 'default', limit: 25 })

    expect(calls).toHaveLength(1)
    expect(String(calls[0].url)).toContain('https://slack.com/api/conversations.list')
    expect(String(calls[0].url)).toContain('limit=25')
    expect(calls[0].headers).toEqual({ Authorization: 'Bearer xoxb-secret' })
  })

  it('builds authorized Slack POST requests for send', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('default')}`]: 'xoxb-secret',
    })
    const slack = new SlackIntegration({ secrets, http: fakeHttp({ ok: true, ts: '1.2' }, calls) })

    await slack.send({ account: 'default', channel: 'C1', text: 'Hello' })

    expect(calls[0]).toMatchObject({
      url: 'https://slack.com/api/chat.postMessage',
      method: 'POST',
      headers: {
        Authorization: 'Bearer xoxb-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: 'C1', text: 'Hello' }),
    })
  })

  it('throws when the token is absent', async () => {
    const slack = new SlackIntegration({ secrets: createMemorySecretStore(), http: fakeHttp({ ok: true }) })

    await expect(slack.search({ account: 'missing', query: 'hello' })).rejects.toThrow('not configured')
  })

  it('surfaces Slack API errors', async () => {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('default')}`]: 'xoxb-secret',
    })
    const slack = new SlackIntegration({ secrets, http: fakeHttp({ ok: false, error: 'invalid_auth' }) })

    await expect(slack.authTest({ account: 'default' })).rejects.toThrow('invalid_auth')
  })

  it('retries once on 429 with short Retry-After', async () => {
    let callCount = 0
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('default')}`]: 'xoxb-secret',
    })
    const slack = new SlackIntegration({
      secrets,
      http: {
        async request() {
          callCount++
          if (callCount === 1) {
            return {
              ok: false,
              status: 429,
              headers: { get: (name: string) => name === 'retry-after' ? '1' : null },
              async json() { return { ok: false, error: 'ratelimited' } },
              async text() { return '{"ok":false,"error":"ratelimited"}' },
            }
          }
          return {
            ok: true,
            status: 200,
            async json() { return { ok: true, channels: [] } },
            async text() { return '{"ok":true,"channels":[]}' },
          }
        },
      },
    })

    await slack.channels({ account: 'default' })
    expect(callCount).toBe(2)
  })

  it('throws on 429 when Retry-After exceeds threshold', async () => {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('default')}`]: 'xoxb-secret',
    })
    const slack = new SlackIntegration({
      secrets,
      http: {
        async request() {
          return {
            ok: false,
            status: 429,
            headers: { get: (name: string) => name === 'retry-after' ? '30' : null },
            async json() { return { ok: false, error: 'ratelimited' } },
            async text() { return '{"ok":false,"error":"ratelimited"}' },
          }
        },
      },
    })

    await expect(slack.channels({ account: 'default' })).rejects.toThrow('rate limited')
  })

  it('preserves non-JSON HTTP error bodies', async () => {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${slackSecretAccount('default')}`]: 'xoxb-secret',
    })
    const slack = new SlackIntegration({
      secrets,
      http: {
        async request() {
          return new Response('bad gateway', { status: 502 })
        },
      },
    })

    await expect(slack.authTest({ account: 'default' })).rejects.toThrow('bad gateway')
  })
})
