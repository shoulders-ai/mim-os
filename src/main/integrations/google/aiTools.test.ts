import { describe, expect, it } from 'vitest'
import { buildGoogleAiTools, type GoogleAiToolState } from './aiTools.js'

function callRecorder() {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = []
  const call = async (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params })
    return { ok: true }
  }
  return { call, calls }
}

function state(overrides: Partial<GoogleAiToolState> = {}): GoogleAiToolState {
  return {
    connected: true,
    grantedScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
    ],
    policy: {
      aiEnabled: true,
      gmailEnabled: true,
      gmailSendEnabled: true,
      calendarEnabled: true,
      calendarWriteEnabled: true,
      driveEnabled: true,
      sheetsWriteEnabled: true,
    },
    ...overrides,
  }
}

describe('buildGoogleAiTools', () => {
  it('returns no Google AI tools when disconnected or disabled by policy', () => {
    const { call } = callRecorder()

    expect(buildGoogleAiTools(call, state({ connected: false }))).toEqual({})
    expect(buildGoogleAiTools(call, state({
      policy: {
        ...state().policy,
        aiEnabled: false,
      },
    }))).toEqual({})
  })

  it('returns the current Google AI tool keys when policy and scopes allow', () => {
    const { call } = callRecorder()
    const tools = buildGoogleAiTools(call, state())

    expect(Object.keys(tools).sort()).toEqual([
      'calendar_create',
      'calendar_events',
      'docs_read',
      'drive_search',
      'gmail_read',
      'gmail_search',
      'gmail_send',
      'sheets_append',
      'sheets_meta',
      'sheets_read',
      'sheets_write',
    ])
    expect(tools.gmail_inbox).toBeUndefined()
  })

  it('omits service and write tools according to policy', () => {
    const { call } = callRecorder()
    const tools = buildGoogleAiTools(call, state({
      policy: {
        aiEnabled: true,
        gmailEnabled: true,
        gmailSendEnabled: false,
        calendarEnabled: true,
        calendarWriteEnabled: false,
        driveEnabled: true,
        sheetsWriteEnabled: false,
      },
    }))

    expect(tools.gmail_search).toBeDefined()
    expect(tools.gmail_send).toBeUndefined()
    expect(tools.calendar_events).toBeDefined()
    expect(tools.calendar_create).toBeUndefined()
    expect(tools.sheets_read).toBeDefined()
    expect(tools.sheets_write).toBeUndefined()
    expect(tools.sheets_append).toBeUndefined()
  })

  it('omits tools when the granted scopes do not satisfy the capability', () => {
    const { call } = callRecorder()
    const tools = buildGoogleAiTools(call, state({
      grantedScopes: ['https://www.googleapis.com/auth/drive.readonly'],
    }))

    expect(tools.drive_search).toBeDefined()
    expect(tools.gmail_search).toBeUndefined()
    expect(tools.calendar_events).toBeUndefined()
    expect(tools.sheets_write).toBeUndefined()
  })

  it('delegates Gmail and Calendar tools to the kernel tool names', async () => {
    const { call, calls } = callRecorder()
    const tools = buildGoogleAiTools(call, state())

    await tools.gmail_search.execute?.({ query: 'from:rob', limit: 5, pageToken: 'page-1' }, {})
    await tools.gmail_read.execute?.({ messageId: 'm1' }, {})
    await tools.gmail_send.execute?.({ to: 'person@example.com', subject: 'Hello', body: 'Body' }, {})
    await tools.calendar_events.execute?.({
      from: '2026-06-01T00:00:00Z',
      to: '2026-06-02T00:00:00Z',
      limit: 10,
    }, {})
    await tools.calendar_create.execute?.({
      summary: 'Planning',
      start: '2026-06-01T09:00:00+02:00',
      end: '2026-06-01T09:30:00+02:00',
      attendees: ['a@example.com'],
    }, {})

    expect(calls).toEqual([
      { name: 'gmail.search', params: { query: 'from:rob', limit: 5, pageToken: 'page-1' } },
      { name: 'gmail.read', params: { messageId: 'm1' } },
      { name: 'gmail.send', params: { to: 'person@example.com', subject: 'Hello', body: 'Body' } },
      {
        name: 'calendar.events',
        params: { from: '2026-06-01T00:00:00Z', to: '2026-06-02T00:00:00Z', limit: 10 },
      },
      {
        name: 'calendar.create',
        params: {
          summary: 'Planning',
          start: '2026-06-01T09:00:00+02:00',
          end: '2026-06-01T09:30:00+02:00',
          attendees: ['a@example.com'],
        },
      },
    ])
  })

  it('delegates Drive, Docs, and Sheets tools to the kernel tool names', async () => {
    const { call, calls } = callRecorder()
    const tools = buildGoogleAiTools(call, state())

    await tools.drive_search.execute?.({ query: 'budget', type: 'spreadsheet' }, {})
    await tools.docs_read.execute?.({ fileId: 'doc-1' }, {})
    await tools.sheets_meta.execute?.({ spreadsheetId: 'sheet-1' }, {})
    await tools.sheets_read.execute?.({ spreadsheetId: 'sheet-1', range: 'A1:B2' }, {})
    await tools.sheets_write.execute?.({ spreadsheetId: 'sheet-1', range: 'A1:B1', values: [['A']] }, {})
    await tools.sheets_append.execute?.({ spreadsheetId: 'sheet-1', range: 'A:B', values: [['B']] }, {})

    expect(calls).toEqual([
      { name: 'drive.search', params: { query: 'budget', type: 'spreadsheet' } },
      { name: 'docs.read', params: { fileId: 'doc-1' } },
      { name: 'sheets.meta', params: { spreadsheetId: 'sheet-1' } },
      { name: 'sheets.read', params: { spreadsheetId: 'sheet-1', range: 'A1:B2' } },
      { name: 'sheets.write', params: { spreadsheetId: 'sheet-1', range: 'A1:B1', values: [['A']] } },
      { name: 'sheets.append', params: { spreadsheetId: 'sheet-1', range: 'A:B', values: [['B']] } },
    ])
  })
})
