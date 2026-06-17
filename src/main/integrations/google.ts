import { MIM_KEYCHAIN_SERVICE, type SecretStore } from '@main/integrations/secrets.js'
import { fetchHttpClient, readJsonResponse, readTextResponse, type HttpClient, type HttpResponse } from '@main/integrations/http.js'

export interface GoogleOAuthClient {
  client_id: string
  client_secret: string
}

export interface GoogleTokenBundle {
  access_token: string
  refresh_token?: string
  expires_at?: number
  scope?: string
}

export interface GoogleIntegrationDeps {
  secrets: SecretStore
  http?: HttpClient
  now?: () => number
}

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:9599/callback'
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
]

export class GoogleIntegration {
  private secrets: SecretStore
  private http: HttpClient
  private now: () => number

  constructor(deps: GoogleIntegrationDeps) {
    this.secrets = deps.secrets
    this.http = deps.http ?? fetchHttpClient
    this.now = deps.now ?? Date.now
  }

  async setOAuthClient(account: string, client: GoogleOAuthClient): Promise<void> {
    if (!client.client_id.trim()) throw new Error('Google OAuth client_id is required')
    if (!client.client_secret.trim()) throw new Error('Google OAuth client_secret is required')
    await this.secrets.set(MIM_KEYCHAIN_SERVICE, googleClientAccount(account), JSON.stringify(client))
  }

  async setTokenBundle(account: string, bundle: GoogleTokenBundle): Promise<void> {
    if (!bundle.access_token.trim()) throw new Error('Google access_token is required')
    await this.secrets.set(MIM_KEYCHAIN_SERVICE, googleTokenAccount(account), JSON.stringify(bundle))
  }

  async status(account: string): Promise<{ account: string; clientConfigured: boolean; tokenConfigured: boolean }> {
    return {
      account,
      clientConfigured: (await this.secrets.get(MIM_KEYCHAIN_SERVICE, googleClientAccount(account))) !== null,
      tokenConfigured: (await this.secrets.get(MIM_KEYCHAIN_SERVICE, googleTokenAccount(account))) !== null,
    }
  }

  async authUrl(input: { account: string; redirectUri?: string; scopes?: string[] }): Promise<{ account: string; url: string; redirectUri: string; scopes: string[] }> {
    const client = await this.requireClient(input.account)
    const redirectUri = input.redirectUri ?? DEFAULT_REDIRECT_URI
    const scopes = input.scopes?.length ? input.scopes : DEFAULT_SCOPES
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', client.client_id)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', scopes.join(' '))
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    return { account: input.account, url: url.toString(), redirectUri, scopes }
  }

  async exchangeCode(input: { account: string; code: string; redirectUri?: string }): Promise<{ account: string; tokenConfigured: true }> {
    if (!input.code.trim()) throw new Error('Google OAuth code is required')
    const client = await this.requireClient(input.account)
    const data = await this.tokenRequest({
      code: input.code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: input.redirectUri ?? DEFAULT_REDIRECT_URI,
      grant_type: 'authorization_code',
    })
    await this.setTokenBundle(input.account, normalizeTokenBundle(data, this.now()))
    return { account: input.account, tokenConfigured: true }
  }

  async gmailInbox(input: { account: string; limit?: number }): Promise<unknown> {
    const list = await this.googleJson(input.account, 'https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      labelIds: 'INBOX',
      maxResults: String(clampLimit(input.limit, 10, 50)),
    }) as { messages?: Array<{ id?: string }> }
    const messages = await this.fetchMessageSummaries(input.account, list.messages ?? [])
    return { messages }
  }

  async gmailSearch(input: { account: string; query: string; limit?: number }): Promise<unknown> {
    if (!input.query.trim()) throw new Error('Gmail search query is required')
    const list = await this.googleJson(input.account, 'https://gmail.googleapis.com/gmail/v1/users/me/messages', {
      q: input.query,
      maxResults: String(clampLimit(input.limit, 10, 50)),
    }) as { messages?: Array<{ id?: string }> }
    const messages = await this.fetchMessageSummaries(input.account, list.messages ?? [])
    return { messages }
  }

  async gmailThread(input: { account: string; id: string }): Promise<unknown> {
    if (!input.id.trim()) throw new Error('Gmail thread id is required')
    return this.googleJson(input.account, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(input.id)}`, {
      format: 'metadata',
      metadataHeaders: 'From',
      metadataHeaders2: 'Subject',
    })
  }

  async gmailSend(input: { account: string; to: string; subject: string; body: string; cc?: string; bcc?: string }): Promise<unknown> {
    if (!input.to.trim()) throw new Error('Gmail recipient is required')
    if (!input.subject.trim()) throw new Error('Gmail subject is required')
    if (!input.body.trim()) throw new Error('Gmail body is required')
    const raw = encodeRfc2822({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body: input.body,
    })
    return this.googleJsonPost(input.account, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      raw,
    })
  }

  async calendarEvents(input: { account: string; from: string; to: string; calendarId?: string; limit?: number }): Promise<unknown> {
    if (!input.from.trim()) throw new Error('Calendar from is required')
    if (!input.to.trim()) throw new Error('Calendar to is required')
    const calendarId = encodeURIComponent(input.calendarId || 'primary')
    return this.googleJson(input.account, `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
      timeMin: input.from,
      timeMax: input.to,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(clampLimit(input.limit, 20, 100)),
    })
  }

  async calendarCreate(input: {
    account: string
    summary: string
    start: string
    end: string
    calendarId?: string
    attendees?: string[]
    description?: string
  }): Promise<unknown> {
    if (!input.summary.trim()) throw new Error('Calendar event summary is required')
    if (!input.start.trim()) throw new Error('Calendar event start is required')
    if (!input.end.trim()) throw new Error('Calendar event end is required')
    const calendarId = encodeURIComponent(input.calendarId || 'primary')
    return this.googleJsonPost(
      input.account,
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
      {
        summary: input.summary,
        description: input.description,
        start: { dateTime: input.start },
        end: { dateTime: input.end },
        attendees: input.attendees?.map(email => ({ email })),
      },
    )
  }

  async driveSearch(input: { account: string; query?: string; limit?: number }): Promise<unknown> {
    const q = input.query?.trim()
    return this.googleJson(input.account, 'https://www.googleapis.com/drive/v3/files', {
      ...(q ? { q: `name contains '${escapeDriveQuery(q)}' and trashed = false` } : { q: 'trashed = false' }),
      pageSize: String(clampLimit(input.limit, 20, 100)),
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress,displayName))',
    })
  }

  async driveMeta(input: { account: string; fileId: string }): Promise<unknown> {
    if (!input.fileId.trim()) throw new Error('Drive file id is required')
    return this.googleJson(input.account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}`, {
      fields: 'id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress,displayName),size',
    })
  }

  async docsRead(input: { account: string; fileId: string }): Promise<unknown> {
    if (!input.fileId.trim()) throw new Error('Google Docs file id is required')
    const text = await this.googleText(
      input.account,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/export`,
      { mimeType: 'text/plain' },
    )
    return { fileId: input.fileId, text }
  }

  async sheetsRead(input: { account: string; spreadsheetId: string; range: string }): Promise<unknown> {
    if (!input.spreadsheetId.trim()) throw new Error('Google Sheets spreadsheet id is required')
    if (!input.range.trim()) throw new Error('Google Sheets range is required')
    return this.googleJson(input.account, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}`, {})
  }

  private async fetchMessageSummaries(account: string, messages: Array<{ id?: string }>): Promise<unknown[]> {
    const out: unknown[] = []
    for (const message of messages) {
      if (!message.id) continue
      const detail = await this.googleJson(account, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}`, {
        format: 'metadata',
        metadataHeaders: 'From',
        metadataHeaders2: 'Subject',
        metadataHeaders3: 'Date',
      })
      out.push(summarizeGmailMessage(detail))
    }
    return out
  }

  private async googleJson(account: string, baseUrl: string, params: Record<string, string>): Promise<unknown> {
    const token = await this.accessToken(account)
    const url = new URL(baseUrl)
    for (const [key, value] of Object.entries(params)) {
      if (key.startsWith('metadataHeaders')) url.searchParams.append('metadataHeaders', value)
      else url.searchParams.set(key, value)
    }
    const res = await this.http.request({
      url: url.toString(),
      headers: { Authorization: `Bearer ${token}` },
    })
    return parseGoogleResponse(url.pathname, res)
  }

  private async googleJsonPost(account: string, url: string, body: Record<string, unknown>): Promise<unknown> {
    const token = await this.accessToken(account)
    const res = await this.http.request({
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dropUndefined(body)),
    })
    return parseGoogleResponse(new URL(url).pathname, res)
  }

  private async googleText(account: string, baseUrl: string, params: Record<string, string>): Promise<string> {
    const token = await this.accessToken(account)
    const url = new URL(baseUrl)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const res = await this.http.request({
      url: url.toString(),
      headers: { Authorization: `Bearer ${token}` },
    })
    const text = await readTextResponse(res)
    if (!res.ok) {
      throw new Error(`Google ${url.pathname} failed with HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`)
    }
    return text
  }

  private async accessToken(account: string): Promise<string> {
    const bundle = await this.requireTokenBundle(account)
    if (!bundle.expires_at || bundle.expires_at > Math.floor(this.now() / 1000) + 60) {
      return bundle.access_token
    }
    if (!bundle.refresh_token) return bundle.access_token

    const client = await this.requireClient(account)
    const data = await this.tokenRequest({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: bundle.refresh_token,
      grant_type: 'refresh_token',
    })
    const refreshed = normalizeTokenBundle({
      ...data,
      refresh_token: (data as { refresh_token?: string }).refresh_token ?? bundle.refresh_token,
    }, this.now())
    await this.setTokenBundle(account, refreshed)
    return refreshed.access_token
  }

  private async requireClient(account: string): Promise<GoogleOAuthClient> {
    const raw = await this.secrets.get(MIM_KEYCHAIN_SERVICE, googleClientAccount(account))
    if (!raw) throw new Error(`Google OAuth client is not configured for account: ${account}`)
    return JSON.parse(raw) as GoogleOAuthClient
  }

  private async requireTokenBundle(account: string): Promise<GoogleTokenBundle> {
    const raw = await this.secrets.get(MIM_KEYCHAIN_SERVICE, googleTokenAccount(account))
    if (!raw) throw new Error(`Google token is not configured for account: ${account}`)
    return JSON.parse(raw) as GoogleTokenBundle
  }

  private async tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.http.request({
      url: 'https://oauth2.googleapis.com/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
    return parseGoogleResponse('/token', res) as Promise<Record<string, unknown>>
  }
}

export function googleClientAccount(account: string): string {
  return `google-client:${account}`
}

export function googleTokenAccount(account: string): string {
  return `google:${account}`
}

function normalizeTokenBundle(data: Record<string, unknown>, nowMs: number): GoogleTokenBundle {
  const accessToken = data.access_token
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Google token response missing access_token')
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return {
    access_token: accessToken,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_at: Math.floor(nowMs / 1000) + expiresIn,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
  }
}

async function parseGoogleResponse(label: string, res: HttpResponse): Promise<unknown> {
  const data = await readJsonResponse(`Google ${label}`, res)
  if (!res.ok) {
    const message = data && typeof data === 'object'
      ? (data as { error_description?: string; error?: { message?: string } }).error_description
        ?? (data as { error?: { message?: string } }).error?.message
      : undefined
    throw new Error(`Google ${label} failed with HTTP ${res.status}${message ? `: ${message}` : ''}`)
  }
  return data
}

function summarizeGmailMessage(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const msg = value as {
    id?: string
    threadId?: string
    snippet?: string
    internalDate?: string
    payload?: { headers?: Array<{ name?: string; value?: string }> }
  }
  const headers: Record<string, string> = {}
  for (const header of msg.payload?.headers ?? []) {
    if (header.name && header.value) headers[header.name.toLowerCase()] = header.value
  }
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: headers.from,
    subject: headers.subject,
    date: headers.date,
    snippet: msg.snippet,
    internalDate: msg.internalDate,
  }
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.min(Math.max(Math.floor(value), 1), max)
}

function escapeDriveQuery(query: string): string {
  return query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function encodeRfc2822(input: { to: string; cc?: string; bcc?: string; subject: string; body: string }): string {
  const lines = [`To: ${sanitizeHeader(input.to)}`]
  if (input.cc) lines.push(`Cc: ${sanitizeHeader(input.cc)}`)
  if (input.bcc) lines.push(`Bcc: ${sanitizeHeader(input.bcc)}`)
  lines.push(
    `Subject: ${sanitizeHeader(input.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    input.body,
  )
  return Buffer.from(lines.join('\r\n'), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue
    out[key] = child
  }
  return out
}
