import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createKeytarSecretStore, type SecretStore } from '@main/integrations/secrets.js'
import { fetchHttpClient, type HttpClient } from '@main/integrations/http.js'
import { loadUserConfig } from '@main/userConfig.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import type { IntegrationMcpState } from '@main/integrations/mcpState.js'
import { SlackIntegration } from './client.js'
import { readSlackPolicy } from './policy.js'

export interface SlackToolDeps {
  secrets?: SecretStore
  http?: HttpClient
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function requireSlackAiAccess(tools: ToolRegistry, ctx: ToolContext): void {
  if (ctx.actor !== 'ai') return
  const policy = readSlackPolicy(tools.getWorkspacePath())
  if (!policy.aiEnabled) throw new Error('Slack AI access is disabled. Enable it in Settings > Integrations.')
}

function requireSlackSendAccess(tools: ToolRegistry, ctx: ToolContext): void {
  requireSlackAiAccess(tools, ctx)
  if (ctx.actor !== 'ai') return
  const policy = readSlackPolicy(tools.getWorkspacePath())
  if (!policy.sendEnabled) throw new Error('Slack send is disabled. Enable it in Settings > Integrations.')
}

function slackChannelTypes(tools: ToolRegistry, ctx: ToolContext): string {
  if (ctx.actor !== 'ai') return 'public_channel,private_channel'
  const policy = readSlackPolicy(tools.getWorkspacePath())
  const types = ['public_channel']
  if (policy.privateChannels) types.push('private_channel')
  return types.join(',')
}

function requireSlackDmAccess(tools: ToolRegistry, ctx: ToolContext): void {
  requireSlackAiAccess(tools, ctx)
  if (ctx.actor !== 'ai') return
  const policy = readSlackPolicy(tools.getWorkspacePath())
  if (!policy.directMessages) throw new Error('Slack DM access is disabled. Enable it in Settings > Integrations.')
}

export type { IntegrationMcpState } from '@main/integrations/mcpState.js'

export function registerSlackTools(tools: ToolRegistry, deps: SlackToolDeps = {}): IntegrationMcpState {
  const slack = new SlackIntegration({
    secrets: deps.secrets ?? createKeytarSecretStore(),
    http: deps.http ?? fetchHttpClient,
  })

  const mcpState: IntegrationMcpState = {
    connected: false,
    async refresh() {
      const account = resolveSlackAccount(tools)
      mcpState.connected = await slack.hasToken(account)
    },
  }

  tools.register({
    name: 'slack.setToken',
    description: 'Store a Slack token in the OS keychain for an account label.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      token: { type: 'string' },
    }, ['token']),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      await slack.setToken(account, requireString(params, 'token'))
      void mcpState.refresh()
      return { account, configured: true }
    },
  })

  tools.register({
    name: 'slack.deleteToken',
    description: 'Delete a Slack token from the OS keychain for an account label.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      const deleted = await slack.deleteToken(account)
      void mcpState.refresh()
      return { account, deleted }
    },
  })

  tools.register({
    name: 'slack.status',
    description: 'Check whether Slack is configured and, when configured, verify the token with Slack auth.test.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      if (!(await slack.hasToken(account))) return { account, configured: false }
      const auth = await slack.authTest({ account })
      return { account, configured: true, auth }
    },
  })

  tools.register({
    name: 'slack.channels',
    description: 'List Slack public and private channels for the configured account.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    }),
    execute: async (params, ctx) => {
      requireSlackAiAccess(tools, ctx)
      return slack.channels({
        account: resolveSlackAccount(tools, optionalString(params.account)),
        limit: optionalNumber(params.limit),
        cursor: optionalString(params.cursor),
        types: slackChannelTypes(tools, ctx),
      })
    },
  })

  tools.register({
    name: 'slack.users',
    description: 'List Slack users for the configured account.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    }),
    execute: async (params, ctx) => {
      requireSlackAiAccess(tools, ctx)
      return slack.users({
        account: resolveSlackAccount(tools, optionalString(params.account)),
        limit: optionalNumber(params.limit),
        cursor: optionalString(params.cursor),
      })
    },
  })

  tools.register({
    name: 'slack.dms',
    description: 'List Slack direct-message conversations for the configured account.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    }),
    execute: async (params, ctx) => {
      requireSlackDmAccess(tools, ctx)
      return slack.dms({
        account: resolveSlackAccount(tools, optionalString(params.account)),
        limit: optionalNumber(params.limit),
        cursor: optionalString(params.cursor),
      })
    },
  })

  tools.register({
    name: 'slack.history',
    description: 'Read Slack conversation history for a channel.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      channel: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    }, ['channel']),
    execute: async (params, ctx) => {
      requireSlackAiAccess(tools, ctx)
      return slack.history({
        account: resolveSlackAccount(tools, optionalString(params.account)),
        channel: requireString(params, 'channel'),
        limit: optionalNumber(params.limit),
        cursor: optionalString(params.cursor),
      })
    },
  })

  tools.register({
    name: 'slack.search',
    description: 'Search Slack messages for the configured account.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      query: { type: 'string' },
      count: { type: 'number' },
    }, ['query']),
    execute: async (params, ctx) => {
      requireSlackAiAccess(tools, ctx)
      return slack.search({
        account: resolveSlackAccount(tools, optionalString(params.account)),
        query: requireString(params, 'query'),
        count: optionalNumber(params.count),
      })
    },
  })

  tools.register({
    name: 'slack.send',
    description: 'Post a Slack message to a channel.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      channel: { type: 'string' },
      text: { type: 'string' },
    }, ['channel', 'text']),
    execute: async (params, ctx) => {
      requireSlackSendAccess(tools, ctx)
      return slack.send({
        account: resolveSlackAccount(tools, optionalString(params.account)),
        channel: requireString(params, 'channel'),
        text: requireString(params, 'text'),
      })
    },
  })

  tools.register({
    name: 'slack.connect',
    description: 'Store a Slack token and verify it. Accepts a file path to a token file (plain text or JSON with token field), or an inline token.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      file: { type: 'string' },
      token: { type: 'string' },
    }),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      const filePath = optionalString(params.file)
      const token = filePath ? readSlackTokenFromFile(filePath) : requireString(params, 'token')
      await slack.setToken(account, token)
      try {
        const auth = await slack.authTest({ account })
        void mcpState.refresh()
        return { account, configured: true, auth }
      } catch (err) {
        await slack.deleteToken(account)
        void mcpState.refresh()
        throw new Error(`Slack token verification failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  })

  tools.register({
    name: 'slack.disconnect',
    description: 'Remove a Slack token from the OS keychain.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      const deleted = await slack.deleteToken(account)
      void mcpState.refresh()
      return { account, disconnected: deleted }
    },
  })

  tools.register({
    name: 'slack.replies',
    description: 'Read threaded Slack replies for a message.',
    captureResult: false,
    inputSchema: objectSchema({
      account: { type: 'string' },
      channel: { type: 'string' },
      ts: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    }, ['channel', 'ts']),
    execute: async (params, ctx) => {
      requireSlackAiAccess(tools, ctx)
      return slack.replies({
        account: resolveSlackAccount(tools, optionalString(params.account)),
        channel: requireString(params, 'channel'),
        ts: requireString(params, 'ts'),
        limit: optionalNumber(params.limit),
        cursor: optionalString(params.cursor),
      })
    },
  })

  return mcpState
}

function resolveSlackAccount(tools: ToolRegistry, explicit?: string): string {
  if (explicit) return explicit
  const workspace = tools.getWorkspacePath()
  if (workspace) {
    const mimYamlPath = join(workspace, 'mim.yaml')
    if (existsSync(mimYamlPath)) {
      try {
        const config = parseMimYaml(readFileSync(mimYamlPath, 'utf-8'))
        if (config.slack) return config.slack
      } catch {
        // Fall back to user-global default below.
      }
    }
  }
  return loadUserConfig().defaults.slack ?? 'default'
}

function readSlackTokenFromFile(filePath: string): string {
  if (!existsSync(filePath)) throw new Error(`Token file not found: ${filePath}`)
  const raw = readFileSync(filePath, 'utf-8').trim()
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      const token = typeof parsed?.token === 'string' ? parsed.token.trim() : ''
      if (token) return token
    } catch { /* fall through to use raw content */ }
  }
  if (!raw) throw new Error('Token file is empty')
  return raw
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
