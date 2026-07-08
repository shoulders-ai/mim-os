import { MIM_KEYCHAIN_SERVICE, type SecretStore } from '@main/integrations/secrets.js'
import { fetchHttpClient, readJsonResponse, type HttpClient, type HttpResponse } from '@main/integrations/http.js'

export interface SlackClientDeps {
  http?: HttpClient
  secrets: SecretStore
}

export interface SlackRequest {
  account: string
}

export interface SlackBotTokens {
  botToken: string
  appToken: string
}

export interface SlackBotTokenStatus {
  configured: boolean
  botTokenConfigured: boolean
  appTokenConfigured: boolean
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

  async setBotTokens(account: string, tokens: SlackBotTokens): Promise<void> {
    if (!account.trim()) throw new Error('Slack account is required')
    if (!tokens.botToken.trim()) throw new Error('Slack bot token is required')
    if (!tokens.appToken.trim()) throw new Error('Slack app token is required')
    await this.secrets.set(MIM_KEYCHAIN_SERVICE, slackBotSecretAccount(account), tokens.botToken.trim())
    await this.secrets.set(MIM_KEYCHAIN_SERVICE, slackAppSecretAccount(account), tokens.appToken.trim())
  }

  async deleteBotTokens(account: string): Promise<boolean> {
    const [botDeleted, appDeleted] = await Promise.all([
      this.secrets.delete(MIM_KEYCHAIN_SERVICE, slackBotSecretAccount(account)),
      this.secrets.delete(MIM_KEYCHAIN_SERVICE, slackAppSecretAccount(account)),
    ])
    return botDeleted || appDeleted
  }

  async hasBotTokens(account: string): Promise<SlackBotTokenStatus> {
    const [botToken, appToken] = await Promise.all([
      this.secrets.get(MIM_KEYCHAIN_SERVICE, slackBotSecretAccount(account)),
      this.secrets.get(MIM_KEYCHAIN_SERVICE, slackAppSecretAccount(account)),
    ])
    const botTokenConfigured = botToken !== null
    const appTokenConfigured = appToken !== null
    return {
      configured: botTokenConfigured && appTokenConfigured,
      botTokenConfigured,
      appTokenConfigured,
    }
  }

  async authTest(input: SlackRequest): Promise<unknown> {
    return this.get(input.account, 'auth.test', {})
  }

  async botAuthTest(input: SlackRequest): Promise<unknown> {
    const token = await this.requireBotToken(input.account)
    return this.getWithToken(token, 'auth.test', {})
  }

  async connectionsOpen(input: SlackRequest): Promise<string> {
    const token = await this.requireAppToken(input.account)
    const data = await this.postWithToken(token, 'apps.connections.open', {})
    const url = data && typeof data === 'object' ? (data as { url?: unknown }).url : undefined
    if (typeof url !== 'string' || !url.startsWith('wss://')) {
      throw new Error('Slack apps.connections.open did not return a websocket URL')
    }
    return url
  }

  async channels(input: SlackRequest & { limit?: number; cursor?: string; types?: string }): Promise<unknown> {
    return this.get(input.account, 'conversations.list', {
      types: input.types || 'public_channel,private_channel',
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

  async replies(input: SlackRequest & { channel: string; ts: string; limit?: number; cursor?: string }): Promise<unknown> {
    if (!input.channel) throw new Error('Slack channel is required')
    if (!input.ts) throw new Error('Slack message ts is required')
    return this.get(input.account, 'conversations.replies', {
      channel: input.channel,
      ts: input.ts,
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

  async botPostThreadReply(input: SlackRequest & { channel: string; threadTs: string; text: string }): Promise<unknown> {
    if (!input.channel) throw new Error('Slack channel is required')
    if (!input.threadTs) throw new Error('Slack thread ts is required')
    if (!input.text.trim()) throw new Error('Slack message text is required')
    const token = await this.requireBotToken(input.account)
    return this.postWithToken(token, 'chat.postMessage', {
      channel: input.channel,
      text: input.text,
      thread_ts: input.threadTs,
    })
  }

  private async get(account: string, method: string, params: Record<string, string>): Promise<unknown> {
    const token = await this.requireToken(account)
    return this.getWithToken(token, method, params)
  }

  private async getWithToken(token: string, method: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`https://slack.com/api/${method}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const doRequest = () => this.http.request({
      url: url.toString(),
      headers: { Authorization: `Bearer ${token}` },
    })
    const res = await retryOnRateLimit(method, doRequest)
    return parseSlackResponse(method, res)
  }

  private async post(account: string, method: string, body: Record<string, unknown>): Promise<unknown> {
    const token = await this.requireToken(account)
    return this.postWithToken(token, method, body)
  }

  private async postWithToken(token: string, method: string, body: Record<string, unknown>): Promise<unknown> {
    const doRequest = () => this.http.request({
      url: `https://slack.com/api/${method}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const res = await retryOnRateLimit(method, doRequest)
    return parseSlackResponse(method, res)
  }

  private async requireToken(account: string): Promise<string> {
    const token = await this.secrets.get(MIM_KEYCHAIN_SERVICE, slackSecretAccount(account))
    if (!token) throw new Error(`Slack token is not configured for account: ${account}`)
    return token
  }

  private async requireBotToken(account: string): Promise<string> {
    const token = await this.secrets.get(MIM_KEYCHAIN_SERVICE, slackBotSecretAccount(account))
    if (!token) throw new Error(`Slack bot token is not configured for account: ${account}`)
    return token
  }

  private async requireAppToken(account: string): Promise<string> {
    const token = await this.secrets.get(MIM_KEYCHAIN_SERVICE, slackAppSecretAccount(account))
    if (!token) throw new Error(`Slack app token is not configured for account: ${account}`)
    return token
  }
}

export function slackSecretAccount(account: string): string {
  return `slack:${account}`
}

export function slackBotSecretAccount(account: string): string {
  return `slack-bot:${account}`
}

export function slackAppSecretAccount(account: string): string {
  return `slack-app:${account}`
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.min(Math.max(Math.floor(value), 1), 200)
}

const MAX_RETRY_AFTER_SECONDS = 5

async function retryOnRateLimit(method: string, doRequest: () => Promise<HttpResponse>): Promise<HttpResponse> {
  const res = await doRequest()
  if (res.status !== 429) return res
  const retryAfter = parseRetryAfter(res)
  if (retryAfter > MAX_RETRY_AFTER_SECONDS) {
    throw new Error(`Slack ${method} rate limited. Retry after ${retryAfter} seconds.`)
  }
  await sleep(retryAfter * 1000)
  return doRequest()
}

function parseRetryAfter(res: HttpResponse): number {
  const header = res.headers?.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds > 0) return seconds
  }
  return 1
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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
