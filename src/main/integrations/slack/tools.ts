import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { stringify as stringifyYaml } from 'yaml'
import { createKeytarSecretStore, type SecretStore } from '@main/integrations/secrets.js'
import { fetchHttpClient, type HttpClient } from '@main/integrations/http.js'
import { loadUserConfig } from '@main/userConfig.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import type { IntegrationMcpState } from '@main/integrations/mcpState.js'
import { loadRoutineCatalog, resumeRoutine, routineSlackTrigger, type RoutineDefinition, type RoutineSlackTriggerMode } from '@main/routines/routines.js'
import { SlackIntegration, type SlackBotTokens } from './client.js'
import { readSlackPolicy } from './policy.js'
import type { SlackListenerStatus } from './listener.js'

export interface SlackToolDeps {
  secrets?: SecretStore
  http?: HttpClient
  listener?: {
    refresh(): Promise<void>
    status(): SlackListenerStatus
  }
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

const DEFAULT_BOT_ACCOUNT = 'bot'
const DEFAULT_BOT_ROUTINE = 'channel-bot'
const DEFAULT_BOT_TOOLS = ['fs.read', 'search.files']
const DEFAULT_BOT_PROMPT = [
  'Answer Slack questions using this workspace as your source of truth.',
  '',
  'Keep replies concise. If you cannot answer from the workspace, say what is missing instead of guessing.',
].join('\n')

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
    name: 'slack.bot.status',
    description: 'Check whether Slack bot and Socket Mode credentials are configured for an account.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      const status = await slack.hasBotTokens(account)
      if (!status.botTokenConfigured) return { account, ...status }
      const auth = await slack.botAuthTest({ account })
      return { account, ...status, auth }
    },
  })

  tools.register({
    name: 'slack.bot.connect',
    description: 'Store Slack bot and app-level Socket Mode tokens and verify both. Accepts a JSON file with bot_token and app_token, or inline token fields.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      file: { type: 'string' },
      bot_token: { type: 'string' },
      app_token: { type: 'string' },
    }),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      const filePath = optionalString(params.file)
      const tokens = filePath
        ? readSlackBotTokensFromFile(filePath)
        : {
            botToken: requireString(params, 'bot_token'),
            appToken: requireString(params, 'app_token'),
          }
      await slack.setBotTokens(account, tokens)
      try {
        const auth = await slack.botAuthTest({ account })
        await slack.connectionsOpen({ account })
        return {
          account,
          configured: true,
          botConfigured: true,
          socketModeConfigured: true,
          auth,
        }
      } catch (err) {
        await slack.deleteBotTokens(account)
        throw new Error(`Slack bot verification failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  })

  tools.register({
    name: 'slack.bot.disconnect',
    description: 'Remove Slack bot and app-level Socket Mode tokens from the OS keychain.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = resolveSlackAccount(tools, optionalString(params.account))
      const deleted = await slack.deleteBotTokens(account)
      return { account, disconnected: deleted }
    },
  })

  tools.register({
    name: 'slack.bot.setup',
    description: 'Set up a workspace Slack bot in one step: optionally store bot credentials, create/update the Slack routine, and enable it on this machine.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      file: { type: 'string' },
      bot_token: { type: 'string' },
      app_token: { type: 'string' },
      channel: { type: 'string' },
      mode: { type: 'string', enum: ['mention', 'always'] },
      name: { type: 'string' },
      description: { type: 'string' },
      body: { type: 'string' },
      tools: { type: 'array', items: { type: 'string' } },
      approvalAllow: { type: 'array', items: { type: 'string' } },
    }, ['channel']),
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const account = resolveSlackBotAccount(params.account)
      const tokens = optionalSlackBotTokens(params)
      const credentials = tokens
        ? await connectSlackBot(slack, account, tokens)
        : await slackBotCredentialStatus(slack, account)
      const routine = writeSlackBotRoutine(workspace, {
        account,
        channel: requireString(params, 'channel'),
        mode: optionalSlackMode(params.mode),
        name: optionalString(params.name) ?? DEFAULT_BOT_ROUTINE,
        description: optionalString(params.description) ?? 'Answer mentions in my Slack channel.',
        body: optionalString(params.body) ?? DEFAULT_BOT_PROMPT,
        tools: optionalStringArray(params.tools) ?? DEFAULT_BOT_TOOLS,
        approvalAllow: optionalStringArray(params.approvalAllow),
      })
      await deps.listener?.refresh()
      return slackBotReadiness({
        account,
        routine,
        credentials,
        listener: deps.listener?.status(),
      })
    },
  })

  tools.register({
    name: 'slack.bot.check',
    description: 'Return one workspace Slack bot readiness checklist: routine binding, local enablement, credentials, and live listener availability.',
    inputSchema: objectSchema({
      account: { type: 'string' },
      channel: { type: 'string' },
      name: { type: 'string' },
    }),
    execute: async (params) => {
      const workspace = requireWorkspace(tools)
      const routine = findSlackBotRoutine(workspace, {
        name: optionalString(params.name),
        channel: optionalString(params.channel),
      })
      const trigger = routine ? routineSlackTrigger(routine) : null
      const account = optionalString(params.account) ?? trigger?.account ?? DEFAULT_BOT_ACCOUNT
      const credentials = await slackBotCredentialStatus(slack, account)
      return slackBotReadiness({
        account,
        routine,
        credentials,
        listener: deps.listener?.status(),
        diagnostics: routine ? [] : loadRoutineCatalog(workspace).diagnostics.map(item => item.message),
      })
    },
  })

  tools.register({
    name: 'slack.listener.status',
    description: 'Check the local Slack Socket Mode listener runtime.',
    inputSchema: objectSchema({ account: { type: 'string' } }),
    execute: async (params) => {
      const account = optionalString(params.account)
      const status = deps.listener?.status() ?? {
        implemented: false,
        running: false,
        live: false,
        accounts: [],
      }
      if (!account) return status
      return {
        ...status,
        accounts: status.accounts.filter(item => item.account === account),
      }
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

function readSlackBotTokensFromFile(filePath: string): { botToken: string; appToken: string } {
  if (!existsSync(filePath)) throw new Error(`Token file not found: ${filePath}`)
  const raw = readFileSync(filePath, 'utf-8').trim()
  if (!raw) throw new Error('Token file is empty')
  try {
    const parsed = JSON.parse(raw)
    const botToken = stringFrom(parsed, 'bot_token') ?? stringFrom(parsed, 'botToken')
    const appToken = stringFrom(parsed, 'app_token') ?? stringFrom(parsed, 'appToken')
    if (botToken && appToken) return { botToken, appToken }
  } catch {
    // Fall through to the uniform validation message below.
  }
  throw new Error('Slack bot token file must include bot_token and app_token')
}

function stringFrom(object: unknown, key: string): string | undefined {
  if (!object || typeof object !== 'object') return undefined
  const value = (object as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function optionalSlackBotTokens(params: Record<string, unknown>): SlackBotTokens | null {
  const filePath = optionalString(params.file)
  if (filePath) return readSlackBotTokensFromFile(filePath)
  const botToken = optionalString(params.bot_token)
  const appToken = optionalString(params.app_token)
  if (!botToken && !appToken) return null
  if (!botToken || !appToken) throw new Error('Slack bot setup requires both bot_token and app_token')
  return { botToken, appToken }
}

async function connectSlackBot(slack: SlackIntegration, account: string, tokens: SlackBotTokens): Promise<Record<string, unknown>> {
  await slack.setBotTokens(account, tokens)
  try {
    const auth = await slack.botAuthTest({ account })
    await slack.connectionsOpen({ account })
    return {
      configured: true,
      botTokenConfigured: true,
      appTokenConfigured: true,
      botConfigured: true,
      socketModeConfigured: true,
      auth,
    }
  } catch (err) {
    await slack.deleteBotTokens(account)
    throw new Error(`Slack bot verification failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function slackBotCredentialStatus(slack: SlackIntegration, account: string): Promise<Record<string, unknown>> {
  const status = await slack.hasBotTokens(account)
  if (!status.botTokenConfigured) return status
  try {
    const auth = await slack.botAuthTest({ account })
    return {
      ...status,
      botConfigured: status.botTokenConfigured,
      socketModeConfigured: status.appTokenConfigured,
      auth,
    }
  } catch (err) {
    return {
      ...status,
      botConfigured: false,
      socketModeConfigured: status.appTokenConfigured,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

interface SlackBotRoutineInput {
  account: string
  channel: string
  mode: RoutineSlackTriggerMode
  name: string
  description: string
  body: string
  tools: string[]
  approvalAllow?: string[]
}

function writeSlackBotRoutine(workspace: string, input: SlackBotRoutineInput): RoutineDefinition {
  const name = routineName(input.name)
  const channel = input.channel.trim()
  if (!channel) throw new Error('Slack channel is required')
  const tools = input.tools.length ? [...new Set(input.tools)] : DEFAULT_BOT_TOOLS
  const approvalAllow = input.approvalAllow ?? tools
  const routinesDir = join(workspace, 'routines')
  const filePath = join(routinesDir, `${name}.md`)
  const previous = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null
  const frontmatter: Record<string, unknown> = {
    name,
    description: input.description,
    trigger: {
      slack: {
        account: input.account,
        channels: [{ id: channel, mode: input.mode }],
      },
    },
    tools,
    approval: { allow: approvalAllow },
  }
  const content = `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${input.body.trim()}\n`

  mkdirSync(routinesDir, { recursive: true })
  writeFileSync(filePath, content)
  const routine = loadRoutineCatalog(workspace).routines.find(item => item.id === name)
  if (!routine) {
    if (previous !== null) writeFileSync(filePath, previous)
    else {
      try { unlinkSync(filePath) } catch { /* best effort rollback */ }
    }
    throw new Error(`Slack bot routine could not be written: ${name}`)
  }
  resumeRoutine(workspace, routine)
  return loadRoutineCatalog(workspace).routines.find(item => item.id === name) ?? routine
}

function findSlackBotRoutine(workspace: string, filter: { name?: string; channel?: string }): RoutineDefinition | null {
  const catalog = loadRoutineCatalog(workspace)
  const routines = catalog.routines.filter(routine => routineSlackTrigger(routine))
  if (filter.name) {
    const byName = routines.find(routine => routine.id === filter.name || routine.name === filter.name)
    if (byName) return byName
  }
  if (filter.channel) {
    const byChannel = routines.find(routine =>
      routineSlackTrigger(routine)?.channels.some(channel => channel.id === filter.channel),
    )
    if (byChannel) return byChannel
  }
  return routines[0] ?? null
}

function slackBotReadiness(input: {
  account: string
  routine: RoutineDefinition | null
  credentials: Record<string, unknown>
  listener?: SlackListenerStatus
  diagnostics?: string[]
}): Record<string, unknown> {
  const trigger = input.routine ? routineSlackTrigger(input.routine) : null
  const channel = trigger?.channels[0]
  const routineReady = Boolean(input.routine?.enabled && !input.routine.paused && !input.routine.needsEnablement)
  const credentialsReady = input.credentials.configured === true && !input.credentials.error
  const listener = slackBotListenerReadiness(input.account, input.listener)
  const listenerReady = listener.implemented === true && listener.connected === true
  const configured = routineReady && credentialsReady
  const nextActions: string[] = []
  if (!configured) nextActions.push('Run slack_bot_setup to connect credentials and enable the workspace routine.')
  if (!listener.implemented) nextActions.push('Open the Mim desktop app to run the local Slack listener.')
  else if (!listenerReady) nextActions.push('Keep Mim open while the Slack listener connects, then run slack_bot_check again.')

  return {
    account: input.account,
    ...(channel ? { channel: channel.id, mode: channel.mode } : {}),
    configured,
    live: listenerReady,
    ready: configured && listenerReady,
    routine: input.routine
      ? {
          exists: true,
          id: input.routine.id,
          path: input.routine.path,
          enabled: input.routine.enabled,
          paused: input.routine.paused,
          needsEnablement: input.routine.needsEnablement,
          ...(trigger ? { account: trigger.account } : {}),
          ...(channel ? { channel: channel.id, mode: channel.mode } : {}),
        }
      : {
          exists: false,
          diagnostics: input.diagnostics ?? [],
        },
    credentials: input.credentials,
    listener,
    nextActions,
  }
}

function slackBotListenerReadiness(account: string, status?: SlackListenerStatus): Record<string, unknown> {
  if (!status) {
    return {
      implemented: false,
      running: false,
      connected: false,
      status: 'unavailable',
      message: 'The Slack listener is only available in the desktop runtime.',
    }
  }
  const accountStatus = status.accounts.find(item => item.account === account)
  if (!accountStatus) {
    return {
      implemented: true,
      running: status.running,
      connected: false,
      status: 'stopped',
      account,
      message: 'No enabled Slack routine is currently bound to this account.',
    }
  }
  return {
    implemented: true,
    running: accountStatus.state === 'connecting' || accountStatus.state === 'open' || accountStatus.state === 'reconnecting',
    connected: accountStatus.connected,
    status: accountStatus.state,
    account: accountStatus.account,
    ...(accountStatus.botUserId ? { botUserId: accountStatus.botUserId } : {}),
    ...(accountStatus.teamId ? { teamId: accountStatus.teamId } : {}),
    ...(accountStatus.lastStartedAt ? { lastStartedAt: accountStatus.lastStartedAt } : {}),
    ...(accountStatus.lastConnectedAt ? { lastConnectedAt: accountStatus.lastConnectedAt } : {}),
    ...(accountStatus.lastEventAt ? { lastEventAt: accountStatus.lastEventAt } : {}),
    ...(accountStatus.lastError ? { lastError: accountStatus.lastError } : {}),
  }
}

function resolveSlackBotAccount(value: unknown): string {
  return optionalString(value) ?? DEFAULT_BOT_ACCOUNT
}

function routineName(value: string): string {
  const name = value.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('Slack bot routine name may contain only letters, numbers, dots, underscores, and hyphens')
  }
  return name
}

function optionalSlackMode(value: unknown): RoutineSlackTriggerMode {
  if (value === undefined || value === null || value === '') return 'mention'
  if (value === 'mention' || value === 'always') return value
  throw new Error('Slack bot mode must be mention or always')
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('Expected a string list')
  const strings = value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
  if (strings.length !== value.length) throw new Error('Expected a string list')
  return [...new Set(strings)]
}

function requireWorkspace(tools: ToolRegistry): string {
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  return workspace
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Missing required parameter: ${key}`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}
