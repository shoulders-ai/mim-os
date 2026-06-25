import { tool } from 'ai'
import { z } from 'zod'

type AiToolCall = (name: string, params: Record<string, unknown>) => Promise<unknown>
type AiToolMap = Record<string, ReturnType<typeof tool>>

export function buildGoogleAiTools(call: AiToolCall): AiToolMap {
  return {
    gmail_inbox: tool({
      description: 'Read recent Gmail inbox message summaries for the configured workspace Google account.',
      inputSchema: z.object({
        limit: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('gmail.inbox', params),
    }),

    gmail_search: tool({
      description: 'Search Gmail using Gmail search syntax for the configured workspace Google account.',
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('gmail.search', params),
    }),

    gmail_send: tool({
      description: 'Send a plain-text Gmail message. This is high risk and requires user approval.',
      inputSchema: z.object({
        to: z.string(),
        cc: z.string().optional(),
        bcc: z.string().optional(),
        subject: z.string(),
        body: z.string(),
      }),
      execute: async (params) => call('gmail.send', params),
    }),

    calendar_events: tool({
      description: 'Read Google Calendar events in an ISO time range.',
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        calendarId: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('calendar.events', params),
    }),

    calendar_create: tool({
      description: 'Create a Google Calendar event. This is high risk and requires user approval.',
      inputSchema: z.object({
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        calendarId: z.string().optional(),
        attendees: z.array(z.string()).optional(),
        description: z.string().optional(),
      }),
      execute: async (params) => call('calendar.create', params),
    }),

    drive_search: tool({
      description: 'Search Google Drive files by name for the configured workspace Google account.',
      inputSchema: z.object({
        query: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('drive.search', params),
    }),

    docs_read: tool({
      description: 'Export a Google Doc as plain text by file id.',
      inputSchema: z.object({ fileId: z.string() }),
      execute: async (params) => call('docs.read', params),
    }),

    sheets_read: tool({
      description: 'Read values from a Google Sheet range.',
      inputSchema: z.object({
        spreadsheetId: z.string(),
        range: z.string(),
      }),
      execute: async (params) => call('sheets.read', params),
    }),
  }
}
