import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { SlackIntegration } from '@main/integrations/slack.js'
import { createKeytarSecretStore, type SecretStore } from '@main/integrations/secrets.js'
import { fetchHttpClient, type HttpClient } from '@main/integrations/http.js'
import { loadUserConfig } from '@main/userConfig.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import type { ToolRegistry } from '@main/tools/registry.js'

export interface SlackToolDeps {
  secrets?: SecretStore
  http?: HttpClient
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

export function registerSlackTools(tools: ToolRegistry, deps: SlackToolDeps = {}): void {
  const slack = new SlackIntegration({
    secrets: deps.secrets ?? createKeytarSecretStore(),
    http: deps.http ?? fetchHttpClient,
  })

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
      return { account, configured: true }
    },
  })

  tools.register({
    name: 'slack.deleteToken',
    description: 'Delete a Slack token from the OS keychain for an account label.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      return { account, deleted: await slack.deleteToken(account) }
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
    execute: async (params) => slack.channels({
      account: resolveSlackAccount(tools, optionalString(params.account)),
      limit: optionalNumber(params.limit),
      cursor: optionalString(params.cursor),
    }),
  })

  tools.register({
    name: 'slack.users',
    description: 'List Slack users for the configured account.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    }),
    execute: async (params) => slack.users({
      account: resolveSlackAccount(tools, optionalString(params.account)),
      limit: optionalNumber(params.limit),
      cursor: optionalString(params.cursor),
    }),
  })

  tools.register({
    name: 'slack.dms',
    description: 'List Slack direct-message conversations for the configured account.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    }),
    execute: async (params) => slack.dms({
      account: resolveSlackAccount(tools, optionalString(params.account)),
      limit: optionalNumber(params.limit),
      cursor: optionalString(params.cursor),
    }),
  })

  tools.register({
    name: 'slack.history',
    description: 'Read Slack conversation history for a channel.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      channel: { type: 'string' },
      limit: { type: 'number' },
      cursor: { type: 'string' },
    }, ['channel']),
    execute: async (params) => slack.history({
      account: resolveSlackAccount(tools, optionalString(params.account)),
      channel: requireString(params, 'channel'),
      limit: optionalNumber(params.limit),
      cursor: optionalString(params.cursor),
    }),
  })

  tools.register({
    name: 'slack.search',
    description: 'Search Slack messages for the configured account.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      query: { type: 'string' },
      count: { type: 'number' },
    }, ['query']),
    execute: async (params) => slack.search({
      account: resolveSlackAccount(tools, optionalString(params.account)),
      query: requireString(params, 'query'),
      count: optionalNumber(params.count),
    }),
  })

  tools.register({
    name: 'slack.send',
    description: 'Post a Slack message to a channel.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      channel: { type: 'string' },
      text: { type: 'string' },
    }, ['channel', 'text']),
    execute: async (params) => slack.send({
      account: resolveSlackAccount(tools, optionalString(params.account)),
      channel: requireString(params, 'channel'),
      text: requireString(params, 'text'),
    }),
  })
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
