import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { createServer as createHttpServer, type Server } from 'http'
import type { AddressInfo } from 'net'
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
import type { IntegrationMcpState } from '@main/integrations/mcpState.js'
import { readGooglePolicy, type GoogleConnectorPolicy } from './policy.js'

export interface GoogleToolDeps {
  secrets?: SecretStore
  http?: HttpClient
  now?: () => number
  openExternal?: (url: string) => Promise<void> | void
  oauthTimeoutMs?: number
}

type GooglePolicyKey = keyof GoogleConnectorPolicy
type GoogleDriveTypeParam = 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'folder' | 'image' | 'any' | 'all'

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export type { IntegrationMcpState } from '@main/integrations/mcpState.js'

export function registerGoogleTools(tools: ToolRegistry, deps: GoogleToolDeps = {}): IntegrationMcpState {
  const google = new GoogleIntegration({
    secrets: deps.secrets ?? createKeytarSecretStore(),
    http: deps.http ?? fetchHttpClient,
    now: deps.now,
  })

  const mcpState: IntegrationMcpState = {
    connected: false,
    async refresh() {
      const account = resolveGoogleAccount(tools)
      const status = await google.status(account)
      mcpState.connected = status.configured === true
    },
  }

  tools.register({
    name: 'google.setOAuthClient',
    description: 'Store a Google OAuth desktop client in the OS keychain. Accepts a file path to a Google Cloud Console JSON download, or inline client_id and client_secret.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      file: { type: 'string' },
      client_id: { type: 'string' },
      client_secret: { type: 'string' },
    }),
    execute: async (params) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      const filePath = optionalString(params.file)
      const client = filePath
        ? readOAuthClientFromFile(filePath)
        : { client_id: requireString(params, 'client_id'), client_secret: requireString(params, 'client_secret') }
      await google.setOAuthClient(account, client)
      return { account, clientConfigured: true }
    },
  })

  tools.register({
    name: 'google.setTokenBundle',
    description: 'Store a Google OAuth token bundle in the OS keychain. Accepts a file path to a JSON token bundle, or inline parameters.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      file: { type: 'string' },
      access_token: { type: 'string' },
      refresh_token: { type: 'string' },
      expires_at: { type: 'number' },
      scope: { type: 'string' },
    }),
    execute: async (params) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      const filePath = optionalString(params.file)
      const bundle = filePath
        ? readTokenBundleFromFile(filePath)
        : {
            access_token: requireString(params, 'access_token'),
            refresh_token: optionalString(params.refresh_token),
            expires_at: optionalNumber(params.expires_at),
            scope: optionalString(params.scope),
          }
      await google.setTokenBundle(account, bundle)
      return { account, tokenConfigured: true }
    },
  })

  tools.register({
    name: 'google.connect',
    description: 'Connect Google through browser OAuth, or store a token bundle (inline or from file) and verify it with userinfo.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      oauth: { type: 'boolean' },
      scopes: { type: 'array', items: { type: 'string' } },
      capabilities: { type: 'array', items: { type: 'string' } },
      file: { type: 'string' },
      access_token: { type: 'string' },
      refresh_token: { type: 'string' },
      expires_at: { type: 'number' },
      scope: { type: 'string' },
    }),
    execute: async (params) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      let result
      if (params.oauth === true) {
        result = await connectGoogleWithBrowserOAuth(google, account, params, deps)
      } else {
        const filePath = optionalString(params.file)
        const bundle = filePath
          ? readTokenBundleFromFile(filePath)
          : {
              access_token: requireString(params, 'access_token'),
              refresh_token: optionalString(params.refresh_token),
              expires_at: optionalNumber(params.expires_at),
              scope: optionalString(params.scope),
            }
        result = await google.connect({ account, ...bundle })
      }
      void mcpState.refresh()
      return result
    },
  })

  tools.register({
    name: 'google.disconnect',
    description: 'Remove a Google token bundle from the OS keychain.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = resolveGoogleAccount(tools, optionalString(params.account))
      const disconnected = await google.disconnect(account)
      void mcpState.refresh()
      return { account, disconnected }
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
      state: { type: 'string' },
    }),
    execute: async (params) => google.authUrl({
      account: resolveGoogleAccount(tools, optionalString(params.account)),
      redirectUri: optionalString(params.redirectUri),
      scopes: stringArray(params.scopes),
      capabilities: capabilityArray(params.capabilities),
      state: optionalString(params.state),
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

  return mcpState
}

async function connectGoogleWithBrowserOAuth(
  google: GoogleIntegration,
  account: string,
  params: Record<string, unknown>,
  deps: GoogleToolDeps,
) {
  if (!deps.openExternal) {
    throw new Error('Google browser sign-in is only available in the Electron desktop runtime')
  }

  const state = randomBytes(16).toString('hex')
  const receiver = await createGoogleOAuthReceiver(state, deps.oauthTimeoutMs ?? 120_000)
  try {
    const auth = await google.authUrl({
      account,
      redirectUri: receiver.redirectUri,
      scopes: stringArray(params.scopes),
      capabilities: capabilityArray(params.capabilities),
      state,
    })
    await deps.openExternal(auth.url)
    const code = await receiver.code
    return google.exchangeCode({ account, code, redirectUri: receiver.redirectUri })
  } finally {
    await receiver.close()
  }
}

interface GoogleOAuthReceiver {
  redirectUri: string
  code: Promise<string>
  close: () => Promise<void>
}

async function createGoogleOAuthReceiver(expectedState: string, timeoutMs: number): Promise<GoogleOAuthReceiver> {
  let server!: Server
  let settled = false
  let closed = false
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const settle = (err: Error | null, value?: string) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    if (err) rejectCode(err)
    else resolveCode(value ?? '')
    void close()
  }

  const timeout = setTimeout(() => {
    settle(new Error(`Google sign-in timed out after ${Math.round(timeoutMs / 1000)}s`))
  }, timeoutMs)
  const unref = (timeout as { unref?: () => void }).unref
  if (typeof unref === 'function') unref.call(timeout)

  const close = async () => {
    if (closed) return
    closed = true
    clearTimeout(timeout)
    await new Promise<void>((resolve) => {
      if (!server?.listening) {
        resolve()
        return
      }
      server.close(() => resolve())
    })
  }

  server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found')
      return
    }

    const error = url.searchParams.get('error')
    const callbackState = url.searchParams.get('state')
    const callbackCode = url.searchParams.get('code')

    if (callbackState !== expectedState) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(oauthHtml('Google sign-in failed', 'The sign-in response did not match this Mim session. You can close this tab.'))
      settle(new Error('Google sign-in callback state did not match'))
      return
    }

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(oauthHtml('Google sign-in failed', 'Google did not authorize the requested access. You can close this tab.'))
      settle(new Error(`Google sign-in failed: ${error}`))
      return
    }

    if (!callbackCode) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(oauthHtml('Google sign-in failed', 'Google did not return an authorization code. You can close this tab.'))
      settle(new Error('Google sign-in callback did not include a code'))
      return
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(oauthHtml('Google connected', 'Google is connected in Mim. You can close this tab.'))
    settle(null, callbackCode)
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })

  server.on('error', err => settle(err))
  const address = server.address() as AddressInfo
  return {
    redirectUri: `http://127.0.0.1:${address.port}/callback`,
    code,
    close,
  }
}

function oauthHtml(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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

function readOAuthClientFromFile(filePath: string): { client_id: string; client_secret: string } {
  if (!existsSync(filePath)) throw new Error(`Credential file not found: ${filePath}`)
  let raw: unknown
  try { raw = JSON.parse(readFileSync(filePath, 'utf-8')) } catch { throw new Error(`Could not parse credential file: ${filePath}`) }
  const source = raw?.installed ?? raw?.web ?? raw
  const client_id = typeof source?.client_id === 'string' ? source.client_id.trim() : ''
  const client_secret = typeof source?.client_secret === 'string' ? source.client_secret.trim() : ''
  if (!client_id) throw new Error('Credential file does not contain a client_id')
  if (!client_secret) throw new Error('Credential file does not contain a client_secret')
  return { client_id, client_secret }
}

function readTokenBundleFromFile(filePath: string): { access_token: string; refresh_token?: string; expires_at?: number; scope?: string } {
  if (!existsSync(filePath)) throw new Error(`Credential file not found: ${filePath}`)
  let raw: unknown
  try { raw = JSON.parse(readFileSync(filePath, 'utf-8')) } catch { throw new Error(`Could not parse credential file: ${filePath}`) }
  const access_token = typeof raw?.access_token === 'string' ? raw.access_token.trim() : ''
  if (!access_token) throw new Error('Credential file does not contain an access_token')
  return {
    access_token,
    refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
    expires_at: typeof raw.expires_at === 'number' ? raw.expires_at : undefined,
    scope: typeof raw.scope === 'string' ? raw.scope : undefined,
  }
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
