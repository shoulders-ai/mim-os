import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { fetchHttpClient, type HttpClient } from '@main/integrations/http.js'
import { createKeytarSecretStore, type SecretStore } from '@main/integrations/secrets.js'
import { PermissionDeniedError } from '@main/security/gate.js'
import { loadUserConfig } from '@main/userConfig.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import {
  GOOGLE_SCOPE,
  GoogleIntegration,
  hasAnyGoogleScope,
  type GoogleCapability,
} from './client.js'
import { readGooglePolicy, type GoogleConnectorPolicy } from './policy.js'

export interface GoogleToolDeps {
  secrets?: SecretStore
  http?: HttpClient
  now?: () => number
}

type GooglePolicyKey = keyof GoogleConnectorPolicy
type GoogleDriveTypeParam = 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'folder' | 'image' | 'any' | 'all'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerGoogleTools(tools: ToolRegistry, deps: GoogleToolDeps = {}): void {
  const google = new GoogleIntegration({
    secrets: deps.secrets ?? createKeytarSecretStore(),
    http: deps.http ?? fetchHttpClient,
    now: deps.now,
  })

  tools.register({
    name: 'google.setOAuthClient',
    description: 'Store a Google OAuth desktop client in the OS keychain.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      client_id: { type: 'string' },
      client_secret: { type: 'string' },
    }, ['client_id', 'client_secret']),
    execute: async (params) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await google.setOAuthClient(account, {
        client_id: requireString(params, 'client_id'),
        client_secret: requireString(params, 'client_secret'),
      })
      return { account, clientConfigured: true }
    },
  })

  tools.register({
    name: 'google.setTokenBundle',
    description: 'Store a Google OAuth token bundle in the OS keychain.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      access_token: { type: 'string' },
      refresh_token: { type: 'string' },
      expires_at: { type: 'number' },
      scope: { type: 'string' },
    }, ['access_token']),
    execute: async (params) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await google.setTokenBundle(account, {
        access_token: requireString(params, 'access_token'),
        refresh_token: optionalString(params.refresh_token),
        expires_at: optionalNumber(params.expires_at),
        scope: optionalString(params.scope),
      })
      return { account, tokenConfigured: true }
    },
  })

  tools.register({
    name: 'google.connect',
    description: 'Store a Google token bundle, verify it with userinfo, and return profile metadata.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      access_token: { type: 'string' },
      refresh_token: { type: 'string' },
      expires_at: { type: 'number' },
      scope: { type: 'string' },
    }, ['access_token']),
    execute: async (params) => google.connect({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      access_token: requireString(params, 'access_token'),
      refresh_token: optionalString(params.refresh_token),
      expires_at: optionalNumber(params.expires_at),
      scope: optionalString(params.scope),
    }),
  })

  tools.register({
    name: 'google.disconnect',
    description: 'Remove a Google token bundle from the OS keychain.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      return { account, disconnected: await google.disconnect(account) }
    },
  })

  tools.register({
    name: 'google.status',
    description: 'Report whether Google OAuth client and token are configured.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => google.status(resolveGoogleAccount(tools, optionalString(params.account))),
  })

  tools.register({
    name: 'google.authUrl',
    description: 'Build a Google OAuth consent URL for the configured OAuth client.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      redirectUri: { type: 'string' },
      scopes: { type: 'array', items: { type: 'string' } },
      capabilities: { type: 'array', items: { type: 'string' } },
    }),
    execute: async (params) => google.authUrl({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      redirectUri: optionalString(params.redirectUri),
      scopes: stringArray(params.scopes),
      capabilities: capabilityArray(params.capabilities),
    }),
  })

  tools.register({
    name: 'google.exchangeCode',
    description: 'Exchange a Google OAuth code for tokens and store them in the OS keychain.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      code: { type: 'string' },
      redirectUri: { type: 'string' },
    }, ['code']),
    execute: async (params) => google.exchangeCode({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      code: requireString(params, 'code'),
      redirectUri: optionalString(params.redirectUri),
    }),
  })

  tools.register({
    name: 'gmail.search',
    description: 'Search Gmail messages, or list recent messages when query is omitted.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'number' },
      pageToken: { type: 'string' },
    }),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [['gmailEnabled', 'Google Gmail access is disabled. Enable it in Settings > Connections.']],
        scopes: [GOOGLE_SCOPE.gmailReadonly],
      })
      return google.gmailSearch({
        account,
        query: optionalString(params.query),
        limit: optionalNumber(params.limit),
        pageToken: optionalString(params.pageToken),
      })
    },
  })

  tools.register({
    name: 'gmail.read',
    description: 'Read a Gmail message or thread body by id.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      messageId: { type: 'string' },
      threadId: { type: 'string' },
    }),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [['gmailEnabled', 'Google Gmail access is disabled. Enable it in Settings > Connections.']],
        scopes: [GOOGLE_SCOPE.gmailReadonly],
      })
      return google.gmailRead({
        account,
        messageId: optionalString(params.messageId),
        threadId: optionalString(params.threadId),
      })
    },
  })

  tools.register({
    name: 'gmail.send',
    description: 'Send a plain-text Gmail message, optionally as a threaded reply.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      to: { type: 'string' },
      cc: { type: 'string' },
      bcc: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
      threadId: { type: 'string' },
      replyToMessageId: { type: 'string' },
    }, ['to', 'body']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [
          ['gmailEnabled', 'Google Gmail access is disabled. Enable it in Settings > Connections.'],
          ['gmailSendEnabled', 'Google Gmail send is disabled. Enable it in Settings > Connections.'],
        ],
        scopes: [GOOGLE_SCOPE.gmailSend],
      })
      return google.gmailSend({
        account,
        to: requireString(params, 'to'),
        cc: optionalString(params.cc),
        bcc: optionalString(params.bcc),
        subject: optionalString(params.subject),
        body: requireString(params, 'body'),
        threadId: optionalString(params.threadId),
        replyToMessageId: optionalString(params.replyToMessageId),
      })
    },
  })

  tools.register({
    name: 'calendar.events',
    description: 'Read Google Calendar events in a time range.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      calendarId: { type: 'string' },
      limit: { type: 'number' },
      pageToken: { type: 'string' },
    }, ['from', 'to']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [['calendarEnabled', 'Google Calendar access is disabled. Enable it in Settings > Connections.']],
        scopes: [GOOGLE_SCOPE.calendarEventsReadonly, GOOGLE_SCOPE.calendarEvents],
      })
      return google.calendarEvents({
        account,
        from: requireString(params, 'from'),
        to: requireString(params, 'to'),
        calendarId: optionalString(params.calendarId),
        limit: optionalNumber(params.limit),
        pageToken: optionalString(params.pageToken),
      })
    },
  })

  tools.register({
    name: 'calendar.create',
    description: 'Create a Google Calendar event.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      summary: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      calendarId: { type: 'string' },
      attendees: { type: 'array', items: { type: 'string' } },
      description: { type: 'string' },
    }, ['summary', 'start', 'end']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [
          ['calendarEnabled', 'Google Calendar access is disabled. Enable it in Settings > Connections.'],
          ['calendarWriteEnabled', 'Google Calendar write is disabled. Enable it in Settings > Connections.'],
        ],
        scopes: [GOOGLE_SCOPE.calendarEvents],
      })
      return google.calendarCreate({
        account,
        summary: requireString(params, 'summary'),
        start: requireString(params, 'start'),
        end: requireString(params, 'end'),
        calendarId: optionalString(params.calendarId),
        attendees: stringArray(params.attendees),
        description: optionalString(params.description),
      })
    },
  })

  tools.register({
    name: 'drive.search',
    description: 'Search Google Drive files.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      query: { type: 'string' },
      type: { type: 'string' },
      folderId: { type: 'string' },
      pageToken: { type: 'string' },
      limit: { type: 'number' },
    }),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [['driveEnabled', 'Google Drive access is disabled. Enable it in Settings > Connections.']],
        scopes: [GOOGLE_SCOPE.driveReadonly, GOOGLE_SCOPE.drive],
      })
      return google.driveSearch({
        account,
        query: optionalString(params.query),
        type: driveType(params.type),
        folderId: optionalString(params.folderId),
        pageToken: optionalString(params.pageToken),
        limit: optionalNumber(params.limit),
      })
    },
  })

  tools.register({
    name: 'drive.meta',
    description: 'Read Google Drive file metadata.',
    captureResult: false,
    inputSchema: objectSchema({ account: { type: 'string' }, fileId: { type: 'string' } }, ['fileId']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [['driveEnabled', 'Google Drive access is disabled. Enable it in Settings > Connections.']],
        scopes: [GOOGLE_SCOPE.driveReadonly, GOOGLE_SCOPE.drive],
      })
      return google.driveMeta({
        account,
        fileId: requireString(params, 'fileId'),
      })
    },
  })

  tools.register({
    name: 'docs.read',
    description: 'Export a Google Doc as plain text.',
    captureResult: false,
    inputSchema: objectSchema({ account: { type: 'string' }, fileId: { type: 'string' } }, ['fileId']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [['driveEnabled', 'Google Drive access is disabled. Enable it in Settings > Connections.']],
        scopes: [GOOGLE_SCOPE.driveReadonly, GOOGLE_SCOPE.drive],
      })
      return google.docsRead({
        account,
        fileId: requireString(params, 'fileId'),
      })
    },
  })

  tools.register({
    name: 'sheets.meta',
    description: 'Read Google Sheets spreadsheet metadata and tab names.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      spreadsheetId: { type: 'string' },
    }, ['spreadsheetId']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [['driveEnabled', 'Google Drive access is disabled. Enable it in Settings > Connections.']],
        scopes: sheetsReadScopes(),
      })
      return google.sheetsMeta({
        account,
        spreadsheetId: requireString(params, 'spreadsheetId'),
      })
    },
  })

  tools.register({
    name: 'sheets.read',
    description: 'Read values from a Google Sheet range.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      spreadsheetId: { type: 'string' },
      range: { type: 'string' },
    }, ['spreadsheetId', 'range']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [['driveEnabled', 'Google Drive access is disabled. Enable it in Settings > Connections.']],
        scopes: sheetsReadScopes(),
      })
      return google.sheetsRead({
        account,
        spreadsheetId: requireString(params, 'spreadsheetId'),
        range: requireString(params, 'range'),
      })
    },
  })

  tools.register({
    name: 'sheets.write',
    description: 'Write values into a Google Sheet range.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      spreadsheetId: { type: 'string' },
      range: { type: 'string' },
      values: { type: 'array' },
      majorDimension: { type: 'string' },
    }, ['spreadsheetId', 'range', 'values']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [
          ['driveEnabled', 'Google Drive access is disabled. Enable it in Settings > Connections.'],
          ['sheetsWriteEnabled', 'Google Sheets write is disabled. Enable it in Settings > Connections.'],
        ],
        scopes: [GOOGLE_SCOPE.spreadsheets],
      })
      return google.sheetsWrite({
        account,
        spreadsheetId: requireString(params, 'spreadsheetId'),
        range: requireString(params, 'range'),
        values: valuesMatrix(params.values),
        majorDimension: majorDimension(params.majorDimension),
      })
    },
  })

  tools.register({
    name: 'sheets.append',
    description: 'Append values to a Google Sheet range.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      spreadsheetId: { type: 'string' },
      range: { type: 'string' },
      values: { type: 'array' },
      majorDimension: { type: 'string' },
      insertDataOption: { type: 'string' },
    }, ['spreadsheetId', 'range', 'values']),
    execute: async (params, ctx) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await requireGoogleAiAccess(tools, google, account, ctx, {
        flags: [
          ['driveEnabled', 'Google Drive access is disabled. Enable it in Settings > Connections.'],
          ['sheetsWriteEnabled', 'Google Sheets write is disabled. Enable it in Settings > Connections.'],
        ],
        scopes: [GOOGLE_SCOPE.spreadsheets],
      })
      return google.sheetsAppend({
        account,
        spreadsheetId: requireString(params, 'spreadsheetId'),
        range: requireString(params, 'range'),
        values: valuesMatrix(params.values),
        majorDimension: majorDimension(params.majorDimension),
        insertDataOption: insertDataOption(params.insertDataOption),
      })
    },
  })
}

async function requireGoogleAiAccess(
  tools: ToolRegistry,
  google: GoogleIntegration,
  account: string,
  ctx: ToolContext,
  opts: {
    flags?: Array<[GooglePolicyKey, string]>
    scopes?: string[]
  } = {},
): Promise<void> {
  if (ctx.actor !== 'ai') return
  const policy = readGooglePolicy(tools.getWorkspacePath())
  if (!policy.aiEnabled) {
    throw new PermissionDeniedError('Google AI access is disabled. Enable it in Settings > Connections.')
  }
  for (const [key, message] of opts.flags ?? []) {
    if (!policy[key]) throw new PermissionDeniedError(message)
  }
  const requiredScopes = opts.scopes ?? []
  if (!requiredScopes.length) return
  const status = await google.status(account)
  if (status.grantedScopes.length && !hasAnyGoogleScope(status.grantedScopes, requiredScopes)) {
    throw new PermissionDeniedError('Reconnect Google with the required capability scopes before the AI can use this tool.')
  }
}

function resolveGoogleAccount(tools: ToolRegistry, explicit?: string): string {
  if (explicit) return explicit
  const workspace = tools.getWorkspacePath()
  if (workspace) {
    const mimYamlPath = join(workspace, 'mim.yaml')
    if (existsSync(mimYamlPath)) {
      try {
        const config = parseMimYaml(readFileSync(mimYamlPath, 'utf-8'))
        if (config.google) return config.google
      } catch {
        // Fall back to user-global default below.
      }
    }
  }
  return loadUserConfig().defaults.google ?? 'default'
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing required parameter: ${key}`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : undefined
}

function capabilityArray(value: unknown): GoogleCapability[] | undefined {
  const values = stringArray(value)?.filter((item): item is GoogleCapability => [
    'profile',
    'gmail.read',
    'gmail.send',
    'calendar.read',
    'calendar.write',
    'drive.read',
    'sheets.read',
    'sheets.write',
  ].includes(item))
  return values?.length ? values : undefined
}

function driveType(value: unknown): GoogleDriveTypeParam | undefined {
  return typeof value === 'string' && ['document', 'spreadsheet', 'presentation', 'pdf', 'folder', 'image', 'any', 'all'].includes(value)
    ? value as GoogleDriveTypeParam
    : undefined
}

function valuesMatrix(value: unknown): unknown[][] {
  if (!Array.isArray(value)) throw new Error('Missing required parameter: values')
  return value.map(row => Array.isArray(row) ? row : [row])
}

function majorDimension(value: unknown): 'ROWS' | 'COLUMNS' | undefined {
  return value === 'ROWS' || value === 'COLUMNS' ? value : undefined
}

function insertDataOption(value: unknown): 'OVERWRITE' | 'INSERT_ROWS' | undefined {
  return value === 'OVERWRITE' || value === 'INSERT_ROWS' ? value : undefined
}

function sheetsReadScopes(): string[] {
  return [
    GOOGLE_SCOPE.spreadsheetsReadonly,
    GOOGLE_SCOPE.spreadsheets,
    GOOGLE_SCOPE.driveReadonly,
    GOOGLE_SCOPE.drive,
  ]
}
