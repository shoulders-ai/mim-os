import { tool } from 'ai'
import { z } from 'zod'
import {
  GOOGLE_SCOPE,
  hasAnyGoogleScope,
} from './client.js'
import type { GoogleConnectorPolicy } from './policy.js'

type AiToolCall = (name: string, params: Record<string, unknown>) => Promise<unknown>
type AiToolMap = Record<string, ReturnType<typeof tool>>

export interface GoogleAiToolState {
  policy: GoogleConnectorPolicy
  connected: boolean
  grantedScopes: string[]
}

export function buildGoogleAiTools(call: AiToolCall, state: GoogleAiToolState): AiToolMap {
  const googleTools: AiToolMap = {}
  if (!state.connected || !state.policy.aiEnabled) return googleTools

  if (state.policy.gmailEnabled && hasScope(state, [GOOGLE_SCOPE.gmailReadonly])) {
    googleTools.gmail_search = tool({
      description: 'Search Gmail using Gmail search syntax, or omit query for recent messages.',
      inputSchema: z.object({
        query: z.string().optional(),
        limit: z.number().int().positive().optional(),
        pageToken: z.string().optional(),
      }),
      execute: async (params) => call('gmail.search', params),
    })

    googleTools.gmail_read = tool({
      description: 'Read a Gmail message or thread body by messageId or threadId.',
      inputSchema: z.object({
        messageId: z.string().optional(),
        threadId: z.string().optional(),
      }),
      execute: async (params) => call('gmail.read', params),
    })
  }

  if (state.policy.gmailEnabled && state.policy.gmailSendEnabled && hasScope(state, [GOOGLE_SCOPE.gmailSend])) {
    googleTools.gmail_send = tool({
      description: 'Send a plain-text Gmail message. This is high risk and requires user approval.',
      inputSchema: z.object({
        to: z.string(),
        cc: z.string().optional(),
        bcc: z.string().optional(),
        subject: z.string().optional(),
        body: z.string(),
        threadId: z.string().optional(),
        replyToMessageId: z.string().optional(),
      }),
      execute: async (params) => call('gmail.send', params),
    })
  }

  if (state.policy.calendarEnabled && hasScope(state, [GOOGLE_SCOPE.calendarEventsReadonly, GOOGLE_SCOPE.calendarEvents])) {
    googleTools.calendar_events = tool({
      description: 'Read Google Calendar events in an ISO time range.',
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        calendarId: z.string().optional(),
        limit: z.number().int().positive().optional(),
        pageToken: z.string().optional(),
      }),
      execute: async (params) => call('calendar.events', params),
    })
  }

  if (state.policy.calendarEnabled && state.policy.calendarWriteEnabled && hasScope(state, [GOOGLE_SCOPE.calendarEvents])) {
    googleTools.calendar_create = tool({
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
    })
  }

  if (state.policy.driveEnabled && hasScope(state, [GOOGLE_SCOPE.driveReadonly, GOOGLE_SCOPE.drive])) {
    googleTools.drive_search = tool({
      description: 'Search Google Drive files for the configured workspace Google account.',
      inputSchema: z.object({
        query: z.string().optional(),
        type: z.enum(['document', 'spreadsheet', 'presentation', 'pdf', 'folder', 'image', 'any', 'all']).optional(),
        folderId: z.string().optional(),
        pageToken: z.string().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('drive.search', params),
    })

    googleTools.docs_read = tool({
      description: 'Export a Google Doc as plain text by file id.',
      inputSchema: z.object({ fileId: z.string() }),
      execute: async (params) => call('docs.read', params),
    })
  }

  if (state.policy.driveEnabled && hasScope(state, sheetsReadScopes())) {
    googleTools.sheets_meta = tool({
      description: 'Read Google Sheets spreadsheet metadata and tab names.',
      inputSchema: z.object({ spreadsheetId: z.string() }),
      execute: async (params) => call('sheets.meta', params),
    })

    googleTools.sheets_read = tool({
      description: 'Read values from a Google Sheet range.',
      inputSchema: z.object({
        spreadsheetId: z.string(),
        range: z.string(),
      }),
      execute: async (params) => call('sheets.read', params),
    })
  }

  if (state.policy.driveEnabled && state.policy.sheetsWriteEnabled && hasScope(state, [GOOGLE_SCOPE.spreadsheets])) {
    googleTools.sheets_write = tool({
      description: 'Write values into a Google Sheet range. This is high risk and requires user approval.',
      inputSchema: z.object({
        spreadsheetId: z.string(),
        range: z.string(),
        values: z.array(z.array(z.unknown())),
        majorDimension: z.enum(['ROWS', 'COLUMNS']).optional(),
      }),
      execute: async (params) => call('sheets.write', params),
    })

    googleTools.sheets_append = tool({
      description: 'Append values to a Google Sheet range. This is high risk and requires user approval.',
      inputSchema: z.object({
        spreadsheetId: z.string(),
        range: z.string(),
        values: z.array(z.array(z.unknown())),
        majorDimension: z.enum(['ROWS', 'COLUMNS']).optional(),
        insertDataOption: z.enum(['OVERWRITE', 'INSERT_ROWS']).optional(),
      }),
      execute: async (params) => call('sheets.append', params),
    })
  }

  return googleTools
}

function hasScope(state: GoogleAiToolState, requiredScopes: string[]): boolean {
  return state.grantedScopes.length > 0 && hasAnyGoogleScope(state.grantedScopes, requiredScopes)
}

function sheetsReadScopes(): string[] {
  return [
    GOOGLE_SCOPE.spreadsheetsReadonly,
    GOOGLE_SCOPE.spreadsheets,
    GOOGLE_SCOPE.driveReadonly,
    GOOGLE_SCOPE.drive,
  ]
}
