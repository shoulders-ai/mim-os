import { MIM_KEYCHAIN_SERVICE, type SecretStore } from '@main/integrations/secrets.js'
import { fetchHttpClient, readJsonResponse, type HttpClient, type HttpResponse } from '@main/integrations/http.js'

export interface SlackClientDeps {
  http?: HttpClient
  secrets: SecretStore
}

export interface SlackRequest {
  account: string
}

export class SlackIntegration {
  private http: HttpClient
  private secrets: SecretStore

  constructor(deps: SlackClientDeps) {
    this.http = deps.http ?? fetchHttpClient
    this.secrets = deps.secrets
  }

  async setToken(account: string, token: string): Promise<void> {
    if (!account.trim()) throw new Error('Slack account is required')
    if (!token.trim()) throw new Error('Slack token is required')
    await this.secrets.set(MIM_KEYCHAIN_SERVICE, slackSecretAccount(account), token.trim())
  }

  async deleteToken(account: string): Promise<boolean> {
    return this.secrets.delete(MIM_KEYCHAIN_SERVICE, slackSecretAccount(account))
  }

  async hasToken(account: string): Promise<boolean> {
    return (await this.secrets.get(MIM_KEYCHAIN_SERVICE, slackSecretAccount(account))) !== null
  }

  async authTest(input: SlackRequest): Promise<unknown> {
    return this.get(input.account, 'auth.test', {})
  }

  async channels(input: SlackRequest & { limit?: number; cursor?: string }): Promise<unknown> {
    return this.get(input.account, 'conversations.list', {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: String(clampLimit(input.limit, 100)),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    })
  }

  async users(input: SlackRequest & { limit?: number; cursor?: string }): Promise<unknown> {
    return this.get(input.account, 'users.list', {
      limit: String(clampLimit(input.limit, 100)),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    })
  }

  async dms(input: SlackRequest & { limit?: number; cursor?: string }): Promise<unknown> {
    return this.get(input.account, 'conversations.list', {
      types: 'im,mpim',
      limit: String(clampLimit(input.limit, 100)),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    })
  }

  async history(input: SlackRequest & { channel: string; limit?: number; cursor?: string }): Promise<unknown> {
    if (!input.channel) throw new Error('Slack channel is required')
    return this.get(input.account, 'conversations.history', {
      channel: input.channel,
      limit: String(clampLimit(input.limit, 50)),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    })
  }

  async search(input: SlackRequest & { query: string; count?: number }): Promise<unknown> {
    if (!input.query.trim()) throw new Error('Slack search query is required')
    return this.get(input.account, 'search.messages', {
      query: input.query,
      count: String(clampLimit(input.count, 20)),
    })
  }

  async send(input: SlackRequest & { channel: string; text: string }): Promise<unknown> {
    if (!input.channel) throw new Error('Slack channel is required')
    if (!input.text.trim()) throw new Error('Slack message text is required')
    return this.post(input.account, 'chat.postMessage', {
      channel: input.channel,
      text: input.text,
    })
  }

  private async get(account: string, method: string, params: Record<string, string>): Promise<unknown> {
    const token = await this.requireToken(account)
    const url = new URL(`https://slack.com/api/${method}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const res = await this.http.request({
      url: url.toString(),
      headers: { Authorization: `Bearer ${token}` },
    })
    return parseSlackResponse(method, res)
  }

  private async post(account: string, method: string, body: Record<string, unknown>): Promise<unknown> {
    const token = await this.requireToken(account)
    const res = await this.http.request({
      url: `https://slack.com/api/${method}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return parseSlackResponse(method, res)
  }

  private async requireToken(account: string): Promise<string> {
    const token = await this.secrets.get(MIM_KEYCHAIN_SERVICE, slackSecretAccount(account))
    if (!token) throw new Error(`Slack token is not configured for account: ${account}`)
    return token
  }
}

export function slackSecretAccount(account: string): string {
  return `slack:${account}`
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.min(Math.max(Math.floor(value), 1), 200)
}

async function parseSlackResponse(method: string, res: HttpResponse): Promise<unknown> {
  const data = await readJsonResponse(`Slack ${method}`, res)
  if (!res.ok) throw new Error(`Slack ${method} failed with HTTP ${res.status}`)
  if (data && typeof data === 'object' && (data as { ok?: unknown }).ok === false) {
    const error = (data as { error?: unknown }).error
    throw new Error(`Slack ${method}: ${typeof error === 'string' ? error : 'unknown_error'}`)
  }
  return data
}
