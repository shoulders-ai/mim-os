import { htmlToMarkdown } from '@main/html/markdown.js'
import { MIM_KEYCHAIN_SERVICE, type SecretStore } from '@main/integrations/secrets.js'
import { fetchHttpClient, readJsonResponse, readTextResponse, type HttpClient, type HttpResponse } from '@main/integrations/http.js'

export interface GoogleOAuthClient {
  client_id: string
  client_secret: string
}

export interface GoogleProfile {
  email?: string
  name?: string
  picture?: string
}

export interface GoogleTokenBundle {
  access_token: string
  refresh_token?: string
  expires_at?: number
  scope?: string
  auth?: GoogleProfile
}

export interface GoogleIntegrationDeps {
  secrets: SecretStore
  http?: HttpClient
  now?: () => number
}

export type GoogleCapability =
  | 'profile'
  | 'gmail.read'
  | 'gmail.send'
  | 'calendar.read'
  | 'calendar.write'
  | 'drive.read'
  | 'sheets.read'
  | 'sheets.write'

export const GOOGLE_SCOPE = {
  userinfoEmail: 'https://www.googleapis.com/auth/userinfo.email',
  userinfoProfile: 'https://www.googleapis.com/auth/userinfo.profile',
  gmailReadonly: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  calendarEventsReadonly: 'https://www.googleapis.com/auth/calendar.events.readonly',
  calendarEvents: 'https://www.googleapis.com/auth/calendar.events',
  driveReadonly: 'https://www.googleapis.com/auth/drive.readonly',
  drive: 'https://www.googleapis.com/auth/drive',
  spreadsheetsReadonly: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  spreadsheets: 'https://www.googleapis.com/auth/spreadsheets',
} as const

export const GOOGLE_CAPABILITY_SCOPES: Record<GoogleCapability, readonly string[]> = {
  profile: [GOOGLE_SCOPE.userinfoEmail, GOOGLE_SCOPE.userinfoProfile],
  'gmail.read': [GOOGLE_SCOPE.gmailReadonly],
  'gmail.send': [GOOGLE_SCOPE.gmailSend],
  'calendar.read': [GOOGLE_SCOPE.calendarEventsReadonly],
  'calendar.write': [GOOGLE_SCOPE.calendarEvents],
  'drive.read': [GOOGLE_SCOPE.driveReadonly],
  'sheets.read': [GOOGLE_SCOPE.spreadsheetsReadonly],
  'sheets.write': [GOOGLE_SCOPE.spreadsheets],
}

const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:9599/callback'
const DEFAULT_CAPABILITIES: GoogleCapability[] = [
  'profile',
  'gmail.read',
  'gmail.send',
  'calendar.read',
  'calendar.write',
  'drive.read',
  'sheets.read',
]

export type GoogleDriveType = 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'folder' | 'image' | 'any' | 'all'

interface GmailPayload {
  mimeType?: string
  filename?: string
  body?: { data?: string; attachmentId?: string }
  headers?: Array<{ name?: string; value?: string }>
  parts?: GmailPayload[]
}

interface GmailMessage {
  id?: string
  threadId?: string
  snippet?: string
  internalDate?: string
  payload?: GmailPayload
}

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
    await this.secrets.set(MIM_KEYCHAIN_SERVICE, googleTokenAccount(account), JSON.stringify(cleanTokenBundle(bundle)))
  }

  async connect(input: GoogleTokenBundle & { account: string }): Promise<{
    account: string
    configured: true
    auth?: GoogleProfile
    grantedScopes: string[]
  }> {
    const bundle = cleanTokenBundle(input)
    let auth: GoogleProfile | undefined
    try {
      auth = await this.userProfile(bundle.access_token)
    } catch {
      // Profile lookup is a convenience; a valid token is still worth storing.
    }
    const stored = hasGoogleProfileMetadata(auth) ? { ...bundle, auth } : bundle
    await this.setTokenBundle(input.account, stored)
    return {
      account: input.account,
      configured: true,
      ...(hasGoogleProfileMetadata(auth) ? { auth } : {}),
      grantedScopes: grantedScopesFromBundle(stored),
    }
  }

  async disconnect(account: string): Promise<boolean> {
    return this.secrets.delete(MIM_KEYCHAIN_SERVICE, googleTokenAccount(account))
  }

  async status(account: string): Promise<{
    account: string
    configured: boolean
    clientConfigured: boolean
    tokenConfigured: boolean
    auth?: GoogleProfile
    grantedScopes: string[]
  }> {
    const [clientRaw, tokenRaw] = await Promise.all([
      this.secrets.get(MIM_KEYCHAIN_SERVICE, googleClientAccount(account)),
      this.secrets.get(MIM_KEYCHAIN_SERVICE, googleTokenAccount(account)),
    ])
    const bundle = parseTokenBundle(tokenRaw)
    return {
      account,
      configured: bundle !== null,
      clientConfigured: clientRaw !== null || googleOAuthClientFromEnv() !== null,
      tokenConfigured: bundle !== null,
      ...(bundle?.auth ? { auth: bundle.auth } : {}),
      grantedScopes: bundle ? grantedScopesFromBundle(bundle) : [],
    }
  }

  async authUrl(input: {
    account: string
    redirectUri?: string
    scopes?: string[]
    capabilities?: GoogleCapability[]
    state?: string
  }): Promise<{ account: string; url: string; redirectUri: string; scopes: string[] }> {
    const client = await this.requireClient(input.account)
    const redirectUri = input.redirectUri ?? DEFAULT_REDIRECT_URI
    const scopes = input.scopes?.length
      ? unique(input.scopes)
      : scopesForCapabilities(input.capabilities?.length ? input.capabilities : DEFAULT_CAPABILITIES)
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', client.client_id)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', scopes.join(' '))
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    if (input.state?.trim()) url.searchParams.set('state', input.state.trim())
    return { account: input.account, url: url.toString(), redirectUri, scopes }
  }

  async exchangeCode(input: { account: string; code: string; redirectUri?: string }): Promise<{
    account: string
    configured: true
    tokenConfigured: true
    auth?: GoogleProfile
    grantedScopes: string[]
  }> {
    if (!input.code.trim()) throw new Error('Google OAuth code is required')
    const client = await this.requireClient(input.account)
    const data = await this.tokenRequest({
      code: input.code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: input.redirectUri ?? DEFAULT_REDIRECT_URI,
      grant_type: 'authorization_code',
    })
    const bundle = normalizeTokenResponse(data, this.now())
    let auth: GoogleProfile | undefined
    try {
      auth = await this.userProfile(bundle.access_token)
    } catch {
      // Profile lookup is a convenience; the token exchange is still complete.
    }
    const stored = hasGoogleProfileMetadata(auth) ? { ...bundle, auth } : bundle
    await this.setTokenBundle(input.account, stored)
    return {
      account: input.account,
      configured: true,
      tokenConfigured: true,
      ...(hasGoogleProfileMetadata(auth) ? { auth } : {}),
      grantedScopes: grantedScopesFromBundle(stored),
    }
  }

  async gmailSearch(input: {
    account: string
    query?: string
    limit?: number
    pageToken?: string
  }): Promise<unknown> {
    const query = input.query?.trim()
    const list = await this.googleJson(input.account, 'https://gmail.googleapis.com/gmail/v1/users/me/messages', dropUndefined({
      q: query || undefined,
      maxResults: String(clampLimit(input.limit, 10, 50)),
      pageToken: input.pageToken,
    })) as { messages?: Array<{ id?: string }>; nextPageToken?: string; resultSizeEstimate?: number }
    const messages = await this.fetchMessageSummaries(input.account, list.messages ?? [])
    return dropUndefined({
      messages,
      nextPageToken: list.nextPageToken,
      resultSizeEstimate: list.resultSizeEstimate,
    })
  }

  async gmailRead(input: { account: string; messageId?: string; threadId?: string }): Promise<unknown> {
    const messageId = input.messageId?.trim()
    const threadId = input.threadId?.trim()
    if (!messageId && !threadId) throw new Error('Gmail messageId or threadId is required')

    if (messageId) {
      const message = await this.googleJson(
        input.account,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`,
        { format: 'full' },
      )
      return { message: await readGmailMessage(message) }
    }

    const thread = await this.googleJson(
      input.account,
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId!)}`,
      { format: 'full' },
    ) as { id?: string; messages?: unknown[] }
    return {
      threadId: thread.id ?? threadId,
      messages: await Promise.all((thread.messages ?? []).map(readGmailMessage)),
    }
  }

  async gmailSend(input: {
    account: string
    to: string
    body: string
    subject?: string
    cc?: string
    bcc?: string
    threadId?: string
    replyToMessageId?: string
  }): Promise<unknown> {
    if (!input.to.trim()) throw new Error('Gmail recipient is required')
    if (!input.body.trim()) throw new Error('Gmail body is required')

    let subject = input.subject?.trim()
    let threadId = input.threadId?.trim()
    let inReplyTo: string | undefined
    let references: string | undefined

    if (input.replyToMessageId?.trim()) {
      const original = await this.googleJson(
        input.account,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.replyToMessageId)}`,
        {
          format: 'metadata',
          metadataHeaders: 'Message-ID',
          metadataHeaders2: 'References',
          metadataHeaders3: 'Subject',
        },
      ) as GmailMessage
      const headers = headersFromPayload(original.payload)
      inReplyTo = headers['message-id']
      references = joinReferences(headers.references, inReplyTo)
      threadId = threadId || original.threadId
      subject = subject || replySubject(headers.subject)
    }

    if (!subject) throw new Error('Gmail subject is required')
    const raw = encodeRfc2822({
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject,
      body: input.body,
      inReplyTo,
      references,
    })
    return this.googleJsonPost(input.account, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      raw,
      threadId,
    })
  }

  async calendarEvents(input: {
    account: string
    from: string
    to: string
    calendarId?: string
    limit?: number
    pageToken?: string
  }): Promise<unknown> {
    if (!input.from.trim()) throw new Error('Calendar from is required')
    if (!input.to.trim()) throw new Error('Calendar to is required')
    const calendarId = encodeURIComponent(input.calendarId || 'primary')
    return this.googleJson(input.account, `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, dropUndefined({
      timeMin: input.from,
      timeMax: input.to,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(clampLimit(input.limit, 20, 100)),
      pageToken: input.pageToken,
    }))
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

  async driveSearch(input: {
    account: string
    query?: string
    type?: GoogleDriveType
    folderId?: string
    limit?: number
    pageToken?: string
  }): Promise<unknown> {
    return this.googleJson(input.account, 'https://www.googleapis.com/drive/v3/files', dropUndefined({
      q: buildDriveQuery(input),
      pageSize: String(clampLimit(input.limit, 20, 100)),
      pageToken: input.pageToken,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress,displayName),size)',
    }))
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

  async sheetsMeta(input: { account: string; spreadsheetId: string }): Promise<unknown> {
    if (!input.spreadsheetId.trim()) throw new Error('Google Sheets spreadsheet id is required')
    const raw = await this.googleJson(input.account, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}`, {
      fields: 'spreadsheetId,properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))',
    }) as {
      spreadsheetId?: string
      properties?: { title?: string }
      sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number; gridProperties?: { rowCount?: number; columnCount?: number } } }>
    }
    return {
      spreadsheetId: raw.spreadsheetId ?? input.spreadsheetId,
      title: raw.properties?.title,
      sheets: (raw.sheets ?? []).map(sheet => ({
        sheetId: sheet.properties?.sheetId,
        title: sheet.properties?.title,
        index: sheet.properties?.index,
        rowCount: sheet.properties?.gridProperties?.rowCount,
        columnCount: sheet.properties?.gridProperties?.columnCount,
      })),
    }
  }

  async sheetsRead(input: { account: string; spreadsheetId: string; range: string }): Promise<unknown> {
    if (!input.spreadsheetId.trim()) throw new Error('Google Sheets spreadsheet id is required')
    if (!input.range.trim()) throw new Error('Google Sheets range is required')
    return this.googleJson(input.account, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}`, {})
  }

  async sheetsWrite(input: {
    account: string
    spreadsheetId: string
    range: string
    values: unknown[][]
    majorDimension?: 'ROWS' | 'COLUMNS'
  }): Promise<unknown> {
    if (!input.spreadsheetId.trim()) throw new Error('Google Sheets spreadsheet id is required')
    if (!input.range.trim()) throw new Error('Google Sheets range is required')
    if (!Array.isArray(input.values)) throw new Error('Google Sheets values are required')
    return this.googleJsonPut(
      input.account,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}`,
      { valueInputOption: 'USER_ENTERED' },
      {
        values: input.values,
        majorDimension: input.majorDimension,
      },
    )
  }

  async sheetsAppend(input: {
    account: string
    spreadsheetId: string
    range: string
    values: unknown[][]
    majorDimension?: 'ROWS' | 'COLUMNS'
    insertDataOption?: 'OVERWRITE' | 'INSERT_ROWS'
  }): Promise<unknown> {
    if (!input.spreadsheetId.trim()) throw new Error('Google Sheets spreadsheet id is required')
    if (!input.range.trim()) throw new Error('Google Sheets range is required')
    if (!Array.isArray(input.values)) throw new Error('Google Sheets values are required')
    return this.googleJsonPost(
      input.account,
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}:append`,
      {
        values: input.values,
        majorDimension: input.majorDimension,
      },
      {
        valueInputOption: 'USER_ENTERED',
        insertDataOption: input.insertDataOption ?? 'INSERT_ROWS',
      },
    )
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

  private async googleJson(account: string, baseUrl: string, params: Record<string, unknown>): Promise<unknown> {
    const token = await this.accessToken(account)
    const url = new URL(baseUrl)
    appendSearchParams(url, params)
    const res = await this.requestWithRetry({
      url: url.toString(),
      headers: { Authorization: `Bearer ${token}` },
    })
    return parseGoogleResponse(url.pathname, res)
  }

  private async googleJsonPost(
    account: string,
    baseUrl: string,
    body: Record<string, unknown>,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.googleJsonWithBody(account, 'POST', baseUrl, params, body)
  }

  private async googleJsonPut(
    account: string,
    baseUrl: string,
    params: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.googleJsonWithBody(account, 'PUT', baseUrl, params, body)
  }

  private async googleJsonWithBody(
    account: string,
    method: 'POST' | 'PUT',
    baseUrl: string,
    params: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const token = await this.accessToken(account)
    const url = new URL(baseUrl)
    appendSearchParams(url, params)
    const res = await this.requestWithRetry({
      url: url.toString(),
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dropUndefined(body)),
    })
    return parseGoogleResponse(url.pathname, res)
  }

  private async googleText(account: string, baseUrl: string, params: Record<string, unknown>): Promise<string> {
    const token = await this.accessToken(account)
    const url = new URL(baseUrl)
    appendSearchParams(url, params)
    const res = await this.requestWithRetry({
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
    const refreshed = normalizeTokenResponse({
      ...data,
      refresh_token: (data as { refresh_token?: string }).refresh_token ?? bundle.refresh_token,
      scope: (data as { scope?: string }).scope ?? bundle.scope,
      auth: bundle.auth,
    }, this.now())
    await this.setTokenBundle(account, refreshed)
    return refreshed.access_token
  }

  private async requireClient(account: string): Promise<GoogleOAuthClient> {
    const raw = await this.secrets.get(MIM_KEYCHAIN_SERVICE, googleClientAccount(account))
    if (!raw) {
      const envClient = googleOAuthClientFromEnv()
      if (envClient) return envClient
      throw new Error(`Google OAuth client is not configured for account: ${account}`)
    }
    return JSON.parse(raw) as GoogleOAuthClient
  }

  private async requireTokenBundle(account: string): Promise<GoogleTokenBundle> {
    const raw = await this.secrets.get(MIM_KEYCHAIN_SERVICE, googleTokenAccount(account))
    const bundle = parseTokenBundle(raw)
    if (!bundle) throw new Error(`Google token is not configured for account: ${account}`)
    return bundle
  }

  private async tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.requestWithRetry({
      url: 'https://oauth2.googleapis.com/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
    return parseGoogleResponse('/token', res) as Promise<Record<string, unknown>>
  }

  private async userProfile(accessToken: string): Promise<GoogleProfile> {
    const res = await this.requestWithRetry({
      url: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const raw = await parseGoogleResponse('/oauth2/v1/userinfo', res)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const obj = raw as Record<string, unknown>
    return dropUndefined({
      email: typeof obj.email === 'string' ? obj.email : undefined,
      name: typeof obj.name === 'string' ? obj.name : undefined,
      picture: typeof obj.picture === 'string' ? obj.picture : undefined,
    }) as GoogleProfile
  }

  private async requestWithRetry(input: Parameters<HttpClient['request']>[0]): Promise<HttpResponse> {
    const first = await this.http.request(input)
    if (first.status !== 429) return first
    const retryMs = retryAfterMs(first.headers?.get('Retry-After'))
    if (retryMs === null || retryMs > 5_000) return first
    await new Promise(resolve => setTimeout(resolve, retryMs))
    return this.http.request(input)
  }
}

export function googleClientAccount(account: string): string {
  return `google-client:${account}`
}

export function googleTokenAccount(account: string): string {
  return `google:${account}`
}

export function grantedScopesFromBundle(bundle: Pick<GoogleTokenBundle, 'scope'>): string[] {
  return typeof bundle.scope === 'string'
    ? unique(bundle.scope.split(/\s+/).map(scope => scope.trim()).filter(Boolean))
    : []
}

export function hasAnyGoogleScope(grantedScopes: readonly string[], requiredScopes: readonly string[]): boolean {
  if (!requiredScopes.length) return true
  const granted = new Set(grantedScopes)
  return requiredScopes.some(scope => {
    if (granted.has(scope)) return true
    if (scope === GOOGLE_SCOPE.calendarEventsReadonly && granted.has(GOOGLE_SCOPE.calendarEvents)) return true
    if (scope === GOOGLE_SCOPE.driveReadonly && granted.has(GOOGLE_SCOPE.drive)) return true
    if (scope === GOOGLE_SCOPE.spreadsheetsReadonly && granted.has(GOOGLE_SCOPE.spreadsheets)) return true
    return false
  })
}

export function scopesForCapabilities(capabilities: readonly GoogleCapability[]): string[] {
  return unique(capabilities.flatMap(capability => [...(GOOGLE_CAPABILITY_SCOPES[capability] ?? [])]))
}

function normalizeTokenResponse(data: Record<string, unknown>, nowMs: number): GoogleTokenBundle {
  const accessToken = data.access_token
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Google token response missing access_token')
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  return cleanTokenBundle({
    access_token: accessToken,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_at: Math.floor(nowMs / 1000) + expiresIn,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
    auth: isGoogleProfile(data.auth) ? data.auth : undefined,
  })
}

function cleanTokenBundle(bundle: GoogleTokenBundle): GoogleTokenBundle {
  if (!bundle.access_token.trim()) throw new Error('Google access_token is required')
  return dropUndefined({
    access_token: bundle.access_token,
    refresh_token: cleanString(bundle.refresh_token),
    expires_at: typeof bundle.expires_at === 'number' ? bundle.expires_at : undefined,
    scope: cleanString(bundle.scope),
    auth: isGoogleProfile(bundle.auth) ? bundle.auth : undefined,
  }) as GoogleTokenBundle
}

function parseTokenBundle(raw: string | null): GoogleTokenBundle | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return cleanTokenBundle(parsed as GoogleTokenBundle)
  } catch {
    return null
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
  const msg = value as GmailMessage
  const headers = headersFromPayload(msg.payload)
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

async function readGmailMessage(value: unknown): Promise<unknown> {
  if (!value || typeof value !== 'object') return value
  const msg = value as GmailMessage
  const headers = headersFromPayload(msg.payload)
  const body = await extractBodyText(msg.payload)
  return dropUndefined({
    id: msg.id,
    threadId: msg.threadId,
    from: headers.from,
    to: headers.to,
    cc: headers.cc,
    subject: headers.subject,
    date: headers.date,
    snippet: msg.snippet,
    internalDate: msg.internalDate,
    body: body.text,
    bodyMimeType: body.mimeType,
  })
}

async function extractBodyText(payload: GmailPayload | undefined): Promise<{ text: string; mimeType?: string }> {
  if (!payload || payload.filename) return { text: '' }
  const mimeType = (payload.mimeType ?? '').toLowerCase()

  if (mimeType.startsWith('multipart/')) {
    const children = payload.parts ?? []
    const extracted = await Promise.all(children.map(extractBodyText))
    const candidates = extracted.filter(item => item.text.trim())
    if (!candidates.length) return { text: '' }
    if (mimeType === 'multipart/alternative') {
      return candidates.find(item => item.mimeType === 'text/plain')
        ?? candidates.find(item => item.mimeType === 'text/html')
        ?? candidates[0]
    }
    return {
      text: candidates.map(item => item.text).join('\n\n').trim(),
      mimeType: candidates[0]?.mimeType,
    }
  }

  const data = payload.body?.data
  if (!data) return { text: '' }
  const decoded = decodeBase64Url(data).trim()
  if (mimeType === 'text/html') {
    const converted = await htmlToMarkdown(decoded)
    return { text: converted.markdown.trim(), mimeType: 'text/html' }
  }
  if (mimeType === 'text/plain' || mimeType.startsWith('text/')) {
    return { text: decoded, mimeType: 'text/plain' }
  }
  return { text: '' }
}

function headersFromPayload(payload: GmailPayload | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const header of payload?.headers ?? []) {
    if (header.name && header.value) headers[header.name.toLowerCase()] = header.value
  }
  return headers
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback
  return Math.min(Math.max(Math.floor(value), 1), max)
}

function buildDriveQuery(input: { query?: string; type?: GoogleDriveType; folderId?: string }): string {
  const parts = ['trashed = false']
  const q = input.query?.trim()
  if (q) parts.push(`name contains '${escapeDriveQuery(q)}'`)
  const folderId = input.folderId?.trim()
  if (folderId) parts.push(`'${escapeDriveQuery(folderId)}' in parents`)
  const typeQuery = driveTypeQuery(input.type)
  if (typeQuery) parts.push(typeQuery)
  return parts.join(' and ')
}

function driveTypeQuery(type: GoogleDriveType | undefined): string | null {
  switch (type) {
    case 'document':
      return "mimeType = 'application/vnd.google-apps.document'"
    case 'spreadsheet':
      return "mimeType = 'application/vnd.google-apps.spreadsheet'"
    case 'presentation':
      return "mimeType = 'application/vnd.google-apps.presentation'"
    case 'pdf':
      return "mimeType = 'application/pdf'"
    case 'folder':
      return "mimeType = 'application/vnd.google-apps.folder'"
    case 'image':
      return "mimeType contains 'image/'"
    default:
      return null
  }
}

function escapeDriveQuery(query: string): string {
  return query.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function encodeRfc2822(input: {
  to: string
  cc?: string
  bcc?: string
  subject: string
  body: string
  inReplyTo?: string
  references?: string
}): string {
  const lines = [`To: ${sanitizeHeader(input.to)}`]
  if (input.cc) lines.push(`Cc: ${sanitizeHeader(input.cc)}`)
  if (input.bcc) lines.push(`Bcc: ${sanitizeHeader(input.bcc)}`)
  lines.push(`Subject: ${sanitizeHeader(input.subject)}`)
  if (input.inReplyTo) lines.push(`In-Reply-To: ${sanitizeHeader(input.inReplyTo)}`)
  if (input.references) lines.push(`References: ${sanitizeHeader(input.references)}`)
  lines.push(
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

function replySubject(subject: string | undefined): string | undefined {
  const clean = subject?.trim()
  if (!clean) return undefined
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`
}

function joinReferences(existing: string | undefined, messageId: string | undefined): string | undefined {
  return [existing, messageId].map(item => item?.trim()).filter(Boolean).join(' ') || undefined
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function appendSearchParams(url: URL, params: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string') continue
    if (key.startsWith('metadataHeaders')) url.searchParams.append('metadataHeaders', value)
    else url.searchParams.set(key, value)
  }
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue
    out[key] = child
  }
  return out
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf-8')
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function isGoogleProfile(value: unknown): value is GoogleProfile {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasGoogleProfileMetadata(value: GoogleProfile | undefined): value is GoogleProfile {
  return Boolean(value?.email || value?.name || value?.picture)
}

function googleOAuthClientFromEnv(): GoogleOAuthClient | null {
  const client_id = process.env.MIM_GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID
  const client_secret = process.env.MIM_GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!client_id?.trim() || !client_secret?.trim()) return null
  return { client_id: client_id.trim(), client_secret: client_secret.trim() }
}

function retryAfterMs(value: string | null | undefined): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return null
  return Math.max(0, at - Date.now())
}
