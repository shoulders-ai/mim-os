import { describe, expect, it } from 'vitest'
import { createMemorySecretStore, MIM_KEYCHAIN_SERVICE } from '@main/integrations/secrets.js'
import type { HttpClient } from '@main/integrations/http.js'
import { GoogleIntegration, googleClientAccount, googleTokenAccount } from './client.js'

function fakeHttp(responses: unknown[], calls: Array<Record<string, unknown>> = []): HttpClient {
  return {
    async request(input) {
      calls.push(input)
      const response = responses.shift() ?? { ok: true }
      return {
        ok: true,
        status: 200,
        async json() { return response },
        async text() { return typeof response === 'string' ? response : JSON.stringify(response) },
      }
    },
  }
}

describe('GoogleIntegration', () => {
  it('stores OAuth client and token bundles in keychain accounts', async () => {
    const secrets = createMemorySecretStore()
    const google = new GoogleIntegration({ secrets, http: fakeHttp([]), now: () => 1000 })

    await google.setOAuthClient('work@example.com', { client_id: 'client', client_secret: 'secret' })
    await google.setTokenBundle('work@example.com', {
      access_token: 'access',
      refresh_token: 'refresh',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    })

    expect(secrets.dump()).toEqual({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work@example.com')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work@example.com')}`]: JSON.stringify({
        access_token: 'access',
        refresh_token: 'refresh',
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      }),
    })
  })

  it('reports cached profile metadata and granted scopes in status', async () => {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({
        access_token: 'access',
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly',
        auth: { email: 'person@example.com', name: 'Person Example', picture: 'https://example.com/p.jpg' },
      }),
    })
    const google = new GoogleIntegration({ secrets, http: fakeHttp([]) })

    await expect(google.status('work')).resolves.toEqual({
      account: 'work',
      configured: true,
      clientConfigured: true,
      tokenConfigured: true,
      auth: { email: 'person@example.com', name: 'Person Example', picture: 'https://example.com/p.jpg' },
      grantedScopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    })
  })

  it('builds an OAuth URL from the stored client', async () => {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
    })
    const google = new GoogleIntegration({ secrets, http: fakeHttp([]) })

    const result = await google.authUrl({ account: 'work', redirectUri: 'http://127.0.0.1/callback', scopes: ['scope-a'] })

    expect(result.url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(result.url).toContain('client_id=client')
    expect(result.url).toContain('scope=scope-a')
    expect(result.url).not.toContain('secret')
  })

  it('builds OAuth URLs from selected Google capabilities', async () => {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
    })
    const google = new GoogleIntegration({ secrets, http: fakeHttp([]) })

    const result = await google.authUrl({
      account: 'work',
      capabilities: ['gmail.read', 'sheets.write'],
    })

    expect(result.scopes).toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(result.scopes).toContain('https://www.googleapis.com/auth/spreadsheets')
    expect(result.url).toContain('access_type=offline')
  })

  it('exchanges an OAuth code and stores normalized tokens', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([{ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'scope-a scope-b' }], calls),
      now: () => 1_000_000,
    })

    await google.exchangeCode({ account: 'work', code: 'code', redirectUri: 'http://127.0.0.1/callback' })

    expect(calls[0]).toMatchObject({
      url: 'https://oauth2.googleapis.com/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(String(calls[0].body)).toContain('grant_type=authorization_code')
    expect(JSON.parse(secrets.dump()[`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`])).toMatchObject({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_at: 4600,
      scope: 'scope-a scope-b',
    })
  })

  it('connect stores tokens, fetches profile metadata, and disconnect removes only the token', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([{ email: 'person@example.com', name: 'Person Example' }], calls),
      now: () => 1_000,
    })

    await expect(google.connect({
      account: 'work',
      access_token: 'access',
      refresh_token: 'refresh',
      scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly',
    })).resolves.toEqual({
      account: 'work',
      configured: true,
      auth: { email: 'person@example.com', name: 'Person Example' },
      grantedScopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
    })

    expect(String(calls[0].url)).toContain('/oauth2/v1/userinfo')
    expect(JSON.parse(secrets.dump()[`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`])).toMatchObject({
      access_token: 'access',
      refresh_token: 'refresh',
      auth: { email: 'person@example.com', name: 'Person Example' },
    })

    await expect(google.disconnect('work')).resolves.toBe(true)
    expect(secrets.dump()[`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]).toBeUndefined()
    expect(secrets.dump()[`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`]).toBeDefined()
  })

  it('refreshes expired tokens before Google API reads', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'old', refresh_token: 'refresh', expires_at: 1 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([
        { access_token: 'new', expires_in: 3600 },
        { items: [] },
      ], calls),
      now: () => 1_000_000,
    })

    await google.calendarEvents({
      account: 'work',
      from: '2026-06-01T00:00:00Z',
      to: '2026-06-02T00:00:00Z',
      pageToken: 'cal-page',
    })

    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[1].headers).toEqual({ Authorization: 'Bearer new' })
    expect(String(calls[1].url)).toContain('pageToken=cal-page')
  })

  it('summarizes recent Gmail messages through gmailSearch without a query and returns pagination', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([
        { messages: [{ id: 'm1' }], nextPageToken: 'next-1' },
        {
          id: 'm1',
          threadId: 't1',
          snippet: 'Hello',
          payload: { headers: [{ name: 'From', value: 'a@example.com' }, { name: 'Subject', value: 'Subject' }] },
        },
      ], calls),
      now: () => 1_000,
    })

    const result = await google.gmailSearch({ account: 'work', limit: 1, pageToken: 'page-1' }) as {
      messages: unknown[]
      nextPageToken?: string
    }

    expect(result.messages).toEqual([
      { id: 'm1', threadId: 't1', from: 'a@example.com', subject: 'Subject', date: undefined, snippet: 'Hello', internalDate: undefined },
    ])
    expect(result.nextPageToken).toBe('next-1')
    expect(String(calls[0].url)).not.toContain('q=')
    expect(String(calls[0].url)).toContain('pageToken=page-1')
    expect(String(calls[1].url)).toContain('/messages/m1')
  })

  it('searches Gmail with query syntax when query is provided', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([{ messages: [] }], calls),
      now: () => 1_000,
    })

    await google.gmailSearch({ account: 'work', query: 'from:rob', limit: 5 })

    expect(String(calls[0].url)).toContain('q=from%3Arob')
    expect(String(calls[0].url)).toContain('maxResults=5')
  })

  it('reads Gmail message bodies from plain text, HTML, and threads', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([
        gmailMessage('m1', 't1', 'text/plain', 'Plain body'),
        {
          id: 't1',
          messages: [
            gmailMessage('m2', 't1', 'text/html', '<p>Hello <strong>HTML</strong></p>'),
            {
              id: 'm3',
              threadId: 't1',
              payload: {
                mimeType: 'multipart/mixed',
                parts: [
                  {
                    mimeType: 'multipart/alternative',
                    parts: [
                      encodedPart('text/plain', 'Nested plain'),
                      encodedPart('text/html', '<p>Nested html</p>'),
                    ],
                  },
                  {
                    filename: 'report.pdf',
                    mimeType: 'application/pdf',
                    body: { attachmentId: 'att-1' },
                  },
                ],
              },
            },
          ],
        },
      ], calls),
      now: () => 1_000,
    })

    await expect(google.gmailRead({ account: 'work', messageId: 'm1' })).resolves.toMatchObject({
      message: { id: 'm1', body: 'Plain body', bodyMimeType: 'text/plain' },
    })
    await expect(google.gmailRead({ account: 'work', threadId: 't1' })).resolves.toMatchObject({
      threadId: 't1',
      messages: [
        { id: 'm2', body: 'Hello **HTML**', bodyMimeType: 'text/html' },
        { id: 'm3', body: 'Nested plain', bodyMimeType: 'text/plain' },
      ],
    })

    expect(String(calls[0].url)).toContain('/messages/m1')
    expect(String(calls[0].url)).toContain('format=full')
    expect(String(calls[1].url)).toContain('/threads/t1')
  })

  it('sends plain-text Gmail messages with a base64url RFC 2822 body', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([{ id: 'sent-1' }], calls),
      now: () => 1_000,
    })

    await google.gmailSend({
      account: 'work',
      to: 'person@example.com',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
      subject: 'Budget\r\nInjected: no',
      body: 'Hello\nBody',
    })

    expect(calls[0]).toMatchObject({
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      method: 'POST',
      headers: {
        Authorization: 'Bearer access',
        'Content-Type': 'application/json',
      },
    })
    const body = JSON.parse(String(calls[0].body)) as { raw: string }
    const message = decodeBase64Url(body.raw)
    expect(message).toContain('To: person@example.com\r\n')
    expect(message).toContain('Cc: cc@example.com\r\n')
    expect(message).toContain('Bcc: bcc@example.com\r\n')
    expect(message).toContain('Subject: Budget Injected: no\r\n')
    expect(message).toContain('Content-Type: text/plain; charset="UTF-8"\r\n\r\nHello\nBody')
  })

  it('sends Gmail replies with thread id and reply headers', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([
        {
          id: 'm0',
          threadId: 't1',
          payload: {
            headers: [
              { name: 'Message-ID', value: '<original@example.com>' },
              { name: 'References', value: '<root@example.com>' },
              { name: 'Subject', value: 'Original subject' },
            ],
          },
        },
        { id: 'sent-1', threadId: 't1' },
      ], calls),
      now: () => 1_000,
    })

    await google.gmailSend({
      account: 'work',
      to: 'person@example.com',
      body: 'Reply body',
      threadId: 't1',
      replyToMessageId: 'm0',
    })

    expect(String(calls[0].url)).toContain('/messages/m0')
    const body = JSON.parse(String(calls[1].body)) as { raw: string; threadId?: string }
    const message = decodeBase64Url(body.raw)
    expect(body.threadId).toBe('t1')
    expect(message).toContain('Subject: Re: Original subject\r\n')
    expect(message).toContain('In-Reply-To: <original@example.com>\r\n')
    expect(message).toContain('References: <root@example.com> <original@example.com>\r\n')
  })

  it('creates Google Calendar events', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([{ id: 'event-1' }], calls),
      now: () => 1_000,
    })

    await google.calendarCreate({
      account: 'work',
      calendarId: 'team@example.com',
      summary: 'Planning',
      start: '2026-06-01T09:00:00+02:00',
      end: '2026-06-01T09:30:00+02:00',
      attendees: ['a@example.com', 'b@example.com'],
      description: 'Notes',
    })

    expect(calls[0]).toMatchObject({
      url: 'https://www.googleapis.com/calendar/v3/calendars/team%40example.com/events',
      method: 'POST',
      headers: {
        Authorization: 'Bearer access',
        'Content-Type': 'application/json',
      },
    })
    expect(JSON.parse(String(calls[0].body))).toEqual({
      summary: 'Planning',
      description: 'Notes',
      start: { dateTime: '2026-06-01T09:00:00+02:00' },
      end: { dateTime: '2026-06-01T09:30:00+02:00' },
      attendees: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    })
  })

  it('reads Drive, Docs, and Sheets through Google APIs', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([
        { files: [] },
        { id: 'file-1', name: 'Doc' },
        'Document text',
        {
          properties: { title: 'Budget' },
          sheets: [{ properties: { sheetId: 1, title: 'Sheet1', index: 0, gridProperties: { rowCount: 100, columnCount: 8 } } }],
        },
        { values: [['A', 'B']] },
        { updatedRange: 'Sheet1!A1:B1', updatedRows: 1 },
        { tableRange: 'Sheet1!A1:B1', updates: { updatedRange: 'Sheet1!A2:B2' } },
      ], calls),
      now: () => 1_000,
    })

    await google.driveSearch({
      account: 'work',
      query: "client's report",
      type: 'spreadsheet',
      folderId: 'folder-1',
      pageToken: 'drive-page',
      limit: 5,
    })
    await google.driveMeta({ account: 'work', fileId: 'file-1' })
    await expect(google.docsRead({ account: 'work', fileId: 'doc-1' })).resolves.toEqual({
      fileId: 'doc-1',
      text: 'Document text',
    })
    await expect(google.sheetsMeta({ account: 'work', spreadsheetId: 'sheet-1' })).resolves.toEqual({
      spreadsheetId: 'sheet-1',
      title: 'Budget',
      sheets: [{ sheetId: 1, title: 'Sheet1', index: 0, rowCount: 100, columnCount: 8 }],
    })
    await google.sheetsRead({ account: 'work', spreadsheetId: 'sheet-1', range: 'Sheet1!A1:B2' })
    await google.sheetsWrite({ account: 'work', spreadsheetId: 'sheet-1', range: 'Sheet1!A1:B1', values: [['A', 'B']] })
    await google.sheetsAppend({ account: 'work', spreadsheetId: 'sheet-1', range: 'Sheet1!A:B', values: [['C', 'D']] })

    expect(String(calls[0].url)).toContain('/drive/v3/files')
    expect(String(calls[0].url)).toContain('name+contains')
    expect(String(calls[0].url)).toContain("mimeType+%3D+%27application%2Fvnd.google-apps.spreadsheet%27")
    expect(String(calls[0].url)).toContain("%27folder-1%27+in+parents")
    expect(String(calls[0].url)).toContain('pageToken=drive-page')
    expect(String(calls[1].url)).toContain('/drive/v3/files/file-1')
    expect(String(calls[2].url)).toContain('/drive/v3/files/doc-1/export')
    expect(String(calls[3].url)).toContain('/spreadsheets/sheet-1?')
    expect(String(calls[4].url)).toContain('/spreadsheets/sheet-1/values/Sheet1!A1%3AB2')
    expect(calls[5]).toMatchObject({ method: 'PUT' })
    expect(String(calls[5].url)).toContain('/spreadsheets/sheet-1/values/Sheet1!A1%3AB1')
    expect(String(calls[5].url)).toContain('valueInputOption=USER_ENTERED')
    expect(JSON.parse(String(calls[5].body))).toEqual({ values: [['A', 'B']] })
    expect(calls[6]).toMatchObject({ method: 'POST' })
    expect(String(calls[6].url)).toContain('/spreadsheets/sheet-1/values/Sheet1!A%3AB:append')
  })

  it('preserves non-JSON HTTP error bodies', async () => {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: {
        async request() {
          return new Response('bad gateway', { status: 502 })
        },
      },
      now: () => 1_000,
    })

    await expect(
      google.calendarEvents({ account: 'work', from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' }),
    ).rejects.toThrow('bad gateway')
  })
})

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf-8')
}

function gmailMessage(id: string, threadId: string, mimeType: string, body: string): Record<string, unknown> {
  return {
    id,
    threadId,
    snippet: body.slice(0, 20),
    payload: {
      mimeType,
      body: { data: encodeBase64Url(body) },
      headers: [
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'person@example.com' },
        { name: 'Subject', value: 'Subject' },
        { name: 'Date', value: 'Fri, 26 Jun 2026 09:00:00 +0200' },
      ],
    },
  }
}

function encodedPart(mimeType: string, body: string): Record<string, unknown> {
  return { mimeType, body: { data: encodeBase64Url(body) } }
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}
