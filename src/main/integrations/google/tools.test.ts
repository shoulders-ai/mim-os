import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createMemorySecretStore, MIM_KEYCHAIN_SERVICE } from '@main/integrations/secrets.js'
import type { HttpClient } from '@main/integrations/http.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { googleClientAccount, googleTokenAccount } from './client.js'
import { registerGoogleTools } from './tools.js'

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
      'google.connect',
      'google.disconnect',
      'gmail.search',
      'gmail.read',
      'gmail.send',
      'calendar.events',
      'calendar.create',
      'drive.search',
      'drive.meta',
      'docs.read',
      'sheets.meta',
      'sheets.read',
      'sheets.write',
      'sheets.append',
    ]) {
      expect(tools.get(name)?.inputSchema, name).toBeDefined()
    }
    expect(tools.get('gmail.inbox')).toBeUndefined()
    expect(tools.get('gmail.thread')).toBeUndefined()
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
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    }, ctx)).toEqual({ account: 'work', tokenConfigured: true })

    expect(Object.keys(secrets.dump()).sort()).toEqual([
      `${MIM_KEYCHAIN_SERVICE}:${googleClientAccount('work')}`,
      `${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('work')}`,
    ])
  })

  it('connect stores Google tokens with profile metadata and disconnect removes the token', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore()
    registerGoogleTools(tools, {
      secrets,
      http: fakeHttp([{ email: 'person@example.com', name: 'Person Example' }], calls),
      now: () => 1_000,
    })

    const result = await tools.call('google.connect', {
      access_token: 'access',
      refresh_token: 'refresh',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    }, ctx) as Record<string, unknown>

    expect(result).toMatchObject({
      account: 'default',
      configured: true,
      auth: { email: 'person@example.com', name: 'Person Example' },
      grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    })
    expect(String(calls[0].url)).toContain('/oauth2/v1/userinfo')
    expect(secrets.dump()[`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('default')}`]).toContain('person@example.com')

    await expect(tools.call('google.disconnect', {}, ctx)).resolves.toEqual({
      account: 'default',
      disconnected: true,
    })
    expect(secrets.dump()[`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('default')}`]).toBeUndefined()
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

    const result = await tools.call('google.authUrl', { capabilities: ['gmail.read', 'sheets.write'] }, ctx) as { url: string; scopes: string[] }

    expect(result.url).toContain('client_id=client')
    expect(result.url).not.toContain('secret')
    expect(result.scopes).toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(result.scopes).toContain('https://www.googleapis.com/auth/spreadsheets')
  })

  it('routes Drive, Docs, and Sheets tools', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('default')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    registerGoogleTools(tools, {
      secrets,
      http: fakeHttp([
        { files: [] },
        { id: 'file-1' },
        'Doc text',
        { properties: { title: 'Budget' }, sheets: [] },
        { values: [] },
        { updatedRange: 'A1:B1' },
        { updates: { updatedRange: 'A2:B2' } },
      ], calls),
      now: () => 1_000,
    })

    await tools.call('drive.search', { query: 'budget', type: 'spreadsheet', folderId: 'folder-1', pageToken: 'page-1' }, ctx)
    await tools.call('drive.meta', { fileId: 'file-1' }, ctx)
    await tools.call('docs.read', { fileId: 'doc-1' }, ctx)
    await tools.call('sheets.meta', { spreadsheetId: 'sheet-1' }, ctx)
    await tools.call('sheets.read', { spreadsheetId: 'sheet-1', range: 'A1:B2' }, ctx)
    await tools.call('sheets.write', { spreadsheetId: 'sheet-1', range: 'A1:B1', values: [['A', 'B']] }, ctx)
    await tools.call('sheets.append', { spreadsheetId: 'sheet-1', range: 'A:B', values: [['C', 'D']] }, ctx)

    expect(calls.map(call => String(call.url))).toEqual([
      expect.stringContaining('/drive/v3/files'),
      expect.stringContaining('/drive/v3/files/file-1'),
      expect.stringContaining('/drive/v3/files/doc-1/export'),
      expect.stringContaining('/spreadsheets/sheet-1?'),
      expect.stringContaining('/spreadsheets/sheet-1/values/A1%3AB2'),
      expect.stringContaining('/spreadsheets/sheet-1/values/A1%3AB1'),
      expect.stringContaining('/spreadsheets/sheet-1/values/A%3AB:append'),
    ])
  })

  it('routes Gmail search and read tools without old aliases', async () => {
    const calls: Array<Record<string, unknown>> = []
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('default')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999 }),
    })
    registerGoogleTools(tools, {
      secrets,
      http: fakeHttp([
        { messages: [] },
        { id: 'm1', threadId: 't1', payload: { mimeType: 'text/plain', body: { data: 'SGVsbG8' } } },
      ], calls),
      now: () => 1_000,
    })

    await tools.call('gmail.search', { limit: 5, pageToken: 'page-1' }, ctx)
    await tools.call('gmail.read', { messageId: 'm1' }, ctx)

    expect(calls.map(call => String(call.url))).toEqual([
      expect.stringContaining('/gmail/v1/users/me/messages'),
      expect.stringContaining('/gmail/v1/users/me/messages/m1'),
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

describe('Google connector policy enforcement', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  const aiCtx = { actor: 'ai' as const }
  const userCtx = { actor: 'user' as const }

  function setupWithToken(scope = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
  ].join(' ')) {
    const secrets = createMemorySecretStore({
      [`${MIM_KEYCHAIN_SERVICE}:${googleTokenAccount('default')}`]: JSON.stringify({ access_token: 'access', expires_at: 999999, scope }),
    })
    const calls: Array<Record<string, unknown>> = []
    registerGoogleTools(tools, {
      secrets,
      http: fakeHttp([{ messages: [] }, { id: 'sent-1' }, { items: [] }, { updatedRange: 'A1:B1' }], calls),
      now: () => 1_000,
    })
    return calls
  }

  function writePolicy(policy: Record<string, unknown>) {
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(join(dir, '.mim', 'settings.json'), JSON.stringify({
      connectors: { google: policy },
    }))
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-google-policy-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('blocks AI actor when aiEnabled is false by default', async () => {
    setupWithToken()
    await expect(tools.call('gmail.search', {}, aiCtx))
      .rejects.toThrow('Google AI access is disabled')
  })

  it('allows user actor regardless of connector policy', async () => {
    setupWithToken()
    await expect(tools.call('gmail.search', {}, userCtx)).resolves.toBeDefined()
  })

  it('blocks AI Gmail send when gmailSendEnabled is false', async () => {
    writePolicy({ aiEnabled: true, gmailEnabled: true, gmailSendEnabled: false })
    setupWithToken()
    await expect(tools.call('gmail.send', { to: 'person@example.com', subject: 'Hi', body: 'Body' }, aiCtx))
      .rejects.toThrow('Google Gmail send is disabled')
  })

  it('blocks AI Calendar create when calendarWriteEnabled is false', async () => {
    writePolicy({ aiEnabled: true, calendarEnabled: true, calendarWriteEnabled: false })
    setupWithToken()
    await expect(tools.call('calendar.create', { summary: 'Meet', start: '2026-06-01T09:00:00Z', end: '2026-06-01T09:30:00Z' }, aiCtx))
      .rejects.toThrow('Google Calendar write is disabled')
  })

  it('blocks AI Sheets write when sheetsWriteEnabled is false', async () => {
    writePolicy({ aiEnabled: true, driveEnabled: true, sheetsWriteEnabled: false })
    setupWithToken()
    await expect(tools.call('sheets.write', { spreadsheetId: 'sheet-1', range: 'A1:B1', values: [['A']] }, aiCtx))
      .rejects.toThrow('Google Sheets write is disabled')
  })

  it('blocks AI calls when known token scopes lack the required capability', async () => {
    writePolicy({ aiEnabled: true, gmailEnabled: true })
    setupWithToken('https://www.googleapis.com/auth/drive.readonly')
    await expect(tools.call('gmail.search', {}, aiCtx))
      .rejects.toThrow('Reconnect Google')
  })

  it('allows AI calls when policy and token scopes permit them', async () => {
    writePolicy({ aiEnabled: true, gmailEnabled: true })
    setupWithToken()
    await expect(tools.call('gmail.search', {}, aiCtx)).resolves.toBeDefined()
  })
})
