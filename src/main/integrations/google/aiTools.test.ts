import { describe, expect, it } from 'vitest'
import { buildGoogleAiTools } from './aiTools.js'

function callRecorder() {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = []
  const call = async (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params })
    return { ok: true }
  }
  return { call, calls }
}

describe('buildGoogleAiTools', () => {
  it('returns the current Google AI tool keys', () => {
    const { call } = callRecorder()
    const tools = buildGoogleAiTools(call)

    expect(Object.keys(tools).sort()).toEqual([
      'calendar_create',
      'calendar_events',
      'docs_read',
      'drive_search',
      'gmail_inbox',
      'gmail_search',
      'gmail_send',
      'sheets_read',
    ])
  })

  it('delegates Gmail and Calendar tools to the existing kernel tool names', async () => {
    const { call, calls } = callRecorder()
    const tools = buildGoogleAiTools(call)

    await tools.gmail_inbox.execute?.({ limit: 3 }, {})
    await tools.gmail_search.execute?.({ query: 'from:rob', limit: 5 }, {})
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
      { name: 'gmail.inbox', params: { limit: 3 } },
      { name: 'gmail.search', params: { query: 'from:rob', limit: 5 } },
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

  it('delegates Drive, Docs, and Sheets tools to the existing kernel tool names', async () => {
    const { call, calls } = callRecorder()
    const tools = buildGoogleAiTools(call)

    await tools.drive_search.execute?.({ query: 'budget' }, {})
    await tools.docs_read.execute?.({ fileId: 'doc-1' }, {})
    await tools.sheets_read.execute?.({ spreadsheetId: 'sheet-1', range: 'A1:B2' }, {})

    expect(calls).toEqual([
      { name: 'drive.search', params: { query: 'budget' } },
      { name: 'docs.read', params: { fileId: 'doc-1' } },
      { name: 'sheets.read', params: { spreadsheetId: 'sheet-1', range: 'A1:B2' } },
    ])
  })
})
