import { describe, expect, it } from 'vitest'
import { GoogleIntegration, googleClientAccount, googleTokenAccount } from '@main/integrations/google.js'
import { createMemorySecretStore, MIM_KEYCHAIN_SERVICE } from '@main/integrations/secrets.js'
import type { HttpClient } from '@main/integrations/http.js'

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
    await google.setTokenBundle('work@example.com', { access_token: 'access', refresh_token: 'refresh' })

    expect(secrets.dump()).toEqual({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work@example.com')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work@example.com')}`]: JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }),
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

  it('exchanges an OAuth code and stores normalized tokens', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([{ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }], calls),
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
    })
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

    await google.calendarEvents({ account: 'work', from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z' })

    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[1].headers).toEqual({ Authorization: 'Bearer new' })
  })

  it('summarizes Gmail inbox messages', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    const google = new GoogleIntegration({
      secrets,
      http: fakeHttp([
        { messages: [{ id: 'm1' }] },
        {
          id: 'm1',
          threadId: 't1',
          snippet: 'Hello',
          payload: { headers: [{ name: 'From', value: 'a@example.com' }, { name: 'Subject', value: 'Subject' }] },
        },
      ], calls),
      now: () => 1_000,
    })

    const result = await google.gmailInbox({ account: 'work', limit: 1 }) as { messages: unknown[] }

    expect(result.messages).toEqual([
      { id: 'm1', threadId: 't1', from: 'a@example.com', subject: 'Subject', date: undefined, snippet: 'Hello', internalDate: undefined },
    ])
    expect(String(calls[0].url)).toContain('labelIds=INBOX')
    expect(String(calls[1].url)).toContain('/messages/m1')
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
        { values: [['A', 'B']] },
      ], calls),
      now: () => 1_000,
    })

    await google.driveSearch({ account: 'work', query: "client's report", limit: 5 })
    await google.driveMeta({ account: 'work', fileId: 'file-1' })
    await expect(google.docsRead({ account: 'work', fileId: 'doc-1' })).resolves.toEqual({
      fileId: 'doc-1',
      text: 'Document text',
    })
    await google.sheetsRead({ account: 'work', spreadsheetId: 'sheet-1', range: 'Sheet1!A1:B2' })

    expect(String(calls[0].url)).toContain('/drive/v3/files')
    expect(String(calls[0].url)).toContain('name+contains')
    expect(String(calls[1].url)).toContain('/drive/v3/files/file-1')
    expect(String(calls[2].url)).toContain('/drive/v3/files/doc-1/export')
    expect(String(calls[3].url)).toContain('/spreadsheets/sheet-1/values/Sheet1!A1%3AB2')
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
