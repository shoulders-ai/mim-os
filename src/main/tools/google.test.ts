import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createMemorySecretStore, MIM_KEYCHAIN_SERVICE } from '@main/integrations/secrets.js'
import { googleClientAccount, googleTokenAccount } from '@main/integrations/google.js'
import type { HttpClient } from '@main/integrations/http.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerGoogleTools } from '@main/tools/google.js'

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

describe('Google tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-google-tools-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('declares inputSchema on every Google tool', () => {
    registerGoogleTools(tools, { secrets: createMemorySecretStore(), http: fakeHttp([]) })
    for (const name of [
      'google.setOAuthClient',
      'google.setTokenBundle',
      'google.status',
      'google.authUrl',
      'google.exchangeCode',
      'gmail.inbox',
      'gmail.search',
      'gmail.thread',
      'gmail.send',
      'calendar.events',
      'calendar.create',
      'drive.search',
      'drive.meta',
      'docs.read',
      'sheets.read',
    ]) {
      expect(tools.get(name)?.inputSchema, name).toBeDefined()
    }
  })

  it('stores OAuth clients and token bundles without returning secrets', async () => {
    const secrets = createMemorySecretStore()
    registerGoogleTools(tools, { secrets, http: fakeHttp([]), now: () => 1_000_000 })

    expect(await tools.call('google.setOAuthClient', {
      account: 'work',
      client_id: 'client',
      client_secret: 'secret',
    }, ctx)).toEqual({ account: 'work', clientConfigured: true })
    expect(await tools.call('google.setTokenBundle', {
      account: 'work',
      access_token: 'access',
      refresh_token: 'refresh',
    }, ctx)).toEqual({ account: 'work', tokenConfigured: true })

    expect(Object.keys(secrets.dump()).sort()).toEqual([
      `${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`,
      `${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`,
    ])
  })

  it('uses mim.yaml google account by default', async () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: demo\ngoogle: work@example.com\n')
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work@example.com')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    registerGoogleTools(tools, {
      secrets,
      http: fakeHttp([{ items: [] }], calls),
      now: () => 1_000,
    })

    await tools.call('calendar.events', {
      from: '2026-06-01T00:00:00Z',
      to: '2026-06-02T00:00:00Z',
    }, ctx)

    expect(calls[0].headers).toEqual({ Authorization: 'Bearer access' })
    expect(String(calls[0].url)).toContain('/calendar/v3/calendars/primary/events')
  })

  it('builds auth URLs through the stored OAuth client', async () => {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('default')}`]: JSON.stringify({ client_id: 'client', client_secret: 'secret' }),
    })
    registerGoogleTools(tools, { secrets, http: fakeHttp([]) })

    const result = await tools.call('google.authUrl', { scopes: ['scope-a'] }, ctx) as { url: string }

    expect(result.url).toContain('client_id=client')
    expect(result.url).not.toContain('secret')
  })

  it('routes Drive, Docs, and Sheets read tools', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('default')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    registerGoogleTools(tools, {
      secrets,
      http: fakeHttp([{ files: [] }, { id: 'file-1' }, 'Doc text', { values: [] }], calls),
      now: () => 1_000,
    })

    await tools.call('drive.search', { query: 'budget' }, ctx)
    await tools.call('drive.meta', { fileId: 'file-1' }, ctx)
    await tools.call('docs.read', { fileId: 'doc-1' }, ctx)
    await tools.call('sheets.read', { spreadsheetId: 'sheet-1', range: 'A1:B2' }, ctx)

    expect(calls.map(call => String(call.url))).toEqual([
      expect.stringContaining('/drive/v3/files'),
      expect.stringContaining('/drive/v3/files/file-1'),
      expect.stringContaining('/drive/v3/files/doc-1/export'),
      expect.stringContaining('/spreadsheets/sheet-1/values/A1%3AB2'),
    ])
  })

  it('routes Gmail send and Calendar create tools', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('default')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    registerGoogleTools(tools, {
      secrets,
      http: fakeHttp([{ id: 'message-1' }, { id: 'event-1' }], calls),
      now: () => 1_000,
    })

    await tools.call('gmail.send', {
      to: 'person@example.com',
      subject: 'Hello',
      body: 'Body',
    }, ctx)
    await tools.call('calendar.create', {
      calendarId: 'team@example.com',
      summary: 'Planning',
      start: '2026-06-01T09:00:00+02:00',
      end: '2026-06-01T09:30:00+02:00',
      attendees: ['a@example.com'],
    }, ctx)

    expect(calls.map(call => String(call.url))).toEqual([
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      'https://www.googleapis.com/calendar/v3/calendars/team%40example.com/events',
    ])
    expect(JSON.parse(String(calls[1].body))).toMatchObject({
      summary: 'Planning',
      attendees: [{ email: 'a@example.com' }],
    })
  })
})
