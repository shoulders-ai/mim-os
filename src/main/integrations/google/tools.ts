import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { fetchHttpClient, type HttpClient } from '@main/integrations/http.js'
import { createKeytarSecretStore, type SecretStore } from '@main/integrations/secrets.js'
import { loadUserConfig } from '@main/userConfig.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import { GoogleIntegration } from './client.js'

export interface GoogleToolDeps {
  secrets?: SecretStore
  http?: HttpClient
  now?: () => number
}

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
    }, ['access_token']),
    execute: async (params) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      await google.setTokenBundle(account, {
        access_token: requireString(params, 'access_token'),
        refresh_token: optionalString(params.refresh_token),
        expires_at: optionalNumber(params.expires_at),
      })
      return { account, tokenConfigured: true }
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
    }),
    execute: async (params) => google.authUrl({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      redirectUri: optionalString(params.redirectUri),
      scopes: Array.isArray(params.scopes) ? params.scopes.filter((s): s is string => typeof s === 'string') : undefined,
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
    name: 'gmail.inbox',
    description: 'Read recent Gmail inbox message summaries.',
    inputSchema: objectSchema({ account: { type: 'string' }, limit: { type: 'number' } }),
    execute: async (params) => google.gmailInbox({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      limit: optionalNumber(params.limit),
    }),
  })

  tools.register({
    name: 'gmail.search',
    description: 'Search Gmail messages using Gmail search syntax.',
    inputSchema: objectSchema({ account: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } }, ['query']),
    execute: async (params) => google.gmailSearch({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      query: requireString(params, 'query'),
      limit: optionalNumber(params.limit),
    }),
  })

  tools.register({
    name: 'gmail.thread',
    description: 'Read a Gmail thread by id.',
    inputSchema: objectSchema({ account: { type: 'string' }, id: { type: 'string' } }, ['id']),
    execute: async (params) => google.gmailThread({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      id: requireString(params, 'id'),
    }),
  })

  tools.register({
    name: 'gmail.send',
    description: 'Send a plain-text Gmail message.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      to: { type: 'string' },
      cc: { type: 'string' },
      bcc: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
    }, ['to', 'subject', 'body']),
    execute: async (params) => google.gmailSend({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      to: requireString(params, 'to'),
      cc: optionalString(params.cc),
      bcc: optionalString(params.bcc),
      subject: requireString(params, 'subject'),
      body: requireString(params, 'body'),
    }),
  })

  tools.register({
    name: 'calendar.events',
    description: 'Read Google Calendar events in a time range.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      calendarId: { type: 'string' },
      limit: { type: 'number' },
    }, ['from', 'to']),
    execute: async (params) => google.calendarEvents({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      from: requireString(params, 'from'),
      to: requireString(params, 'to'),
      calendarId: optionalString(params.calendarId),
      limit: optionalNumber(params.limit),
    }),
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
    execute: async (params) => google.calendarCreate({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      summary: requireString(params, 'summary'),
      start: requireString(params, 'start'),
      end: requireString(params, 'end'),
      calendarId: optionalString(params.calendarId),
      attendees: Array.isArray(params.attendees) ? params.attendees.filter((item): item is string => typeof item === 'string') : undefined,
      description: optionalString(params.description),
    }),
  })

  tools.register({
    name: 'drive.search',
    description: 'Search Google Drive files by name.',
    inputSchema: objectSchema({ account: { type: 'string' }, query: { type: 'string' }, limit: { type: 'number' } }),
    execute: async (params) => google.driveSearch({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      query: optionalString(params.query),
      limit: optionalNumber(params.limit),
    }),
  })

  tools.register({
    name: 'drive.meta',
    description: 'Read Google Drive file metadata.',
    inputSchema: objectSchema({ account: { type: 'string' }, fileId: { type: 'string' } }, ['fileId']),
    execute: async (params) => google.driveMeta({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      fileId: requireString(params, 'fileId'),
    }),
  })

  tools.register({
    name: 'docs.read',
    description: 'Export a Google Doc as plain text.',
    inputSchema: objectSchema({ account: { type: 'string' }, fileId: { type: 'string' } }, ['fileId']),
    execute: async (params) => google.docsRead({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      fileId: requireString(params, 'fileId'),
    }),
  })

  tools.register({
    name: 'sheets.read',
    description: 'Read values from a Google Sheet range.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      spreadsheetId: { type: 'string' },
      range: { type: 'string' },
    }, ['spreadsheetId', 'range']),
    execute: async (params) => google.sheetsRead({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      spreadsheetId: requireString(params, 'spreadsheetId'),
      range: requireString(params, 'range'),
    }),
  })
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
