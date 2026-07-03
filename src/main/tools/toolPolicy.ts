import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'
import { loadUserConfig } from '@main/userConfig.js'
import type { ToolRegistry } from '@main/tools/registry.js'

export type ToolPolicyDomain =
  | 'files'
  | 'terminal'
  | 'git'
  | 'web'
  | 'slack'
  | 'google'
  | 'apps'
  | 'system'

export interface ToolPolicyRow {
  id: string
  domain: ToolPolicyDomain
  label: string
  description?: string
  defaultEnabled: boolean
  toolIds: string[]
  aiToolKeys?: string[]
  mcpToolNames?: string[]
  connectionKey?: 'slack' | 'google'
  risk?: 'normal' | 'sensitive' | 'outbound'
}

export interface EffectiveToolPolicy {
  rows: Array<ToolPolicyRow & { enabled: boolean }>
  enabled: string[]
  disabled: string[]
  explicit: boolean
  isEnabled(toolId: string): boolean
}

const SLACK_PUBLIC_TOOLS = ['slack.search', 'slack.history', 'slack.channels', 'slack.replies', 'slack.users']
const GOOGLE_GMAIL_READ_TOOLS = ['gmail.search', 'gmail.read']
const GOOGLE_DRIVE_READ_TOOLS = ['drive.search', 'drive.meta', 'docs.read', 'sheets.meta', 'sheets.read']

export const CORE_TOOL_POLICY_ROWS: ToolPolicyRow[] = [
  {
    id: 'files.read',
    domain: 'files',
    label: 'Read workspace files',
    description: 'Read files, local history previews, and imported document text.',
    defaultEnabled: true,
    toolIds: ['fs.read', 'fs.list', 'history.preview', 'history.list', 'comments.list', 'documents.pdf.extract', 'documents.docx.read', 'documents.docx.extract'],
    aiToolKeys: ['fs_read', 'fs_list', 'history_preview', 'history_list', 'comments_list'],
    mcpToolNames: ['fs_read', 'pdf_extract', 'history_list', 'comments_list'],
  },
  {
    id: 'files.search',
    domain: 'files',
    label: 'Search workspace and sessions',
    defaultEnabled: true,
    toolIds: ['search', 'search.files', 'search.sessions'],
    aiToolKeys: ['search'],
    mcpToolNames: ['search_files', 'search_sessions'],
  },
  {
    id: 'files.change',
    domain: 'files',
    label: 'Change files',
    defaultEnabled: true,
    toolIds: ['fs.write', 'fs.edit', 'fs.create', 'fs.mkdir', 'fs.rename', 'fs.copy', 'history.restore', 'comments.add', 'comments.reply', 'comments.resolve', 'documents.importMarkdown', 'export.pdf', 'export.docx', 'render.htmlToPdf'],
    aiToolKeys: ['fs_write', 'fs_edit', 'fs_create', 'fs_mkdir', 'fs_rename', 'history_restore', 'comments_add', 'comments_reply', 'comments_resolve'],
    mcpToolNames: ['comments_add', 'comments_reply', 'comments_resolve', 'export_pdf', 'export_docx', 'history_restore'],
  },
  {
    id: 'files.delete',
    domain: 'files',
    label: 'Delete files',
    defaultEnabled: true,
    toolIds: ['fs.delete', 'fs.trash', 'history.clear', 'history.prune'],
    aiToolKeys: ['fs_delete'],
  },
  {
    id: 'terminal.run',
    domain: 'terminal',
    label: 'Run terminal commands',
    defaultEnabled: true,
    toolIds: ['terminal.run'],
    aiToolKeys: ['terminal_run'],
    risk: 'sensitive',
  },
  {
    id: 'git.read',
    domain: 'git',
    label: 'Read repository state',
    defaultEnabled: true,
    toolIds: ['git.status', 'git.diff', 'git.log'],
    aiToolKeys: ['git_status', 'git_diff', 'git_log'],
  },
  {
    id: 'git.commit',
    domain: 'git',
    label: 'Commit changes',
    defaultEnabled: true,
    toolIds: ['git.commit'],
    aiToolKeys: ['git_commit'],
  },
  {
    id: 'git.pull',
    domain: 'git',
    label: 'Pull changes',
    defaultEnabled: true,
    toolIds: ['git.pull'],
    aiToolKeys: ['git_pull'],
  },
  {
    id: 'git.push',
    domain: 'git',
    label: 'Push changes',
    defaultEnabled: true,
    toolIds: ['git.push'],
    aiToolKeys: ['git_push'],
    risk: 'outbound',
  },
  {
    id: 'web.read',
    domain: 'web',
    label: 'Read URLs',
    defaultEnabled: true,
    toolIds: ['web.read'],
    aiToolKeys: ['web_read'],
    mcpToolNames: ['web_read'],
  },
  {
    id: 'web.search',
    domain: 'web',
    label: 'Search web',
    defaultEnabled: true,
    toolIds: ['web.search'],
    aiToolKeys: ['web_search'],
    mcpToolNames: ['web_search'],
  },
  {
    id: 'web.live',
    domain: 'web',
    label: 'Use live browser',
    defaultEnabled: true,
    toolIds: ['web.live.open', 'web.live.act'],
    aiToolKeys: ['browser_open', 'browser_act'],
    mcpToolNames: ['browser_open', 'browser_act'],
  },
  {
    id: 'slack.public',
    domain: 'slack',
    label: 'Read and search public channels',
    defaultEnabled: false,
    toolIds: SLACK_PUBLIC_TOOLS,
    aiToolKeys: ['slack_search', 'slack_history', 'slack_channels', 'slack_replies'],
    mcpToolNames: ['slack_search', 'slack_history', 'slack_channels', 'slack_replies', 'slack_users'],
    connectionKey: 'slack',
  },
  {
    id: 'slack.private',
    domain: 'slack',
    label: 'Read private channels',
    defaultEnabled: false,
    toolIds: ['slack.privateChannels'],
    connectionKey: 'slack',
    risk: 'sensitive',
  },
  {
    id: 'slack.dms',
    domain: 'slack',
    label: 'Read direct messages',
    defaultEnabled: false,
    toolIds: ['slack.dms', 'slack.directMessages'],
    mcpToolNames: ['slack_dms'],
    connectionKey: 'slack',
    risk: 'sensitive',
  },
  {
    id: 'slack.send',
    domain: 'slack',
    label: 'Send messages',
    defaultEnabled: false,
    toolIds: ['slack.send'],
    aiToolKeys: ['slack_send'],
    mcpToolNames: ['slack_send'],
    connectionKey: 'slack',
    risk: 'outbound',
  },
  {
    id: 'google.gmail.read',
    domain: 'google',
    label: 'Read Gmail',
    defaultEnabled: false,
    toolIds: GOOGLE_GMAIL_READ_TOOLS,
    aiToolKeys: ['gmail_search', 'gmail_read'],
    mcpToolNames: ['gmail_search', 'gmail_read'],
    connectionKey: 'google',
  },
  {
    id: 'google.gmail.send',
    domain: 'google',
    label: 'Send Gmail',
    defaultEnabled: false,
    toolIds: ['gmail.send'],
    aiToolKeys: ['gmail_send'],
    mcpToolNames: ['gmail_send'],
    connectionKey: 'google',
    risk: 'outbound',
  },
  {
    id: 'google.calendar.read',
    domain: 'google',
    label: 'Read Calendar',
    defaultEnabled: false,
    toolIds: ['calendar.events'],
    aiToolKeys: ['calendar_events'],
    mcpToolNames: ['calendar_events'],
    connectionKey: 'google',
  },
  {
    id: 'google.calendar.write',
    domain: 'google',
    label: 'Create Calendar events',
    defaultEnabled: false,
    toolIds: ['calendar.create'],
    aiToolKeys: ['calendar_create'],
    mcpToolNames: ['calendar_create'],
    connectionKey: 'google',
    risk: 'outbound',
  },
  {
    id: 'google.drive.read',
    domain: 'google',
    label: 'Read Drive, Docs, and Sheets',
    defaultEnabled: false,
    toolIds: GOOGLE_DRIVE_READ_TOOLS,
    aiToolKeys: ['drive_search', 'docs_read', 'sheets_meta', 'sheets_read'],
    mcpToolNames: ['drive_search', 'drive_meta', 'docs_read', 'sheets_meta', 'sheets_read'],
    connectionKey: 'google',
  },
  {
    id: 'google.sheets.write',
    domain: 'google',
    label: 'Write Sheets',
    defaultEnabled: false,
    toolIds: ['sheets.write', 'sheets.append'],
    aiToolKeys: ['sheets_write', 'sheets_append'],
    mcpToolNames: ['sheets_write', 'sheets_append'],
    connectionKey: 'google',
    risk: 'outbound',
  },
  {
    id: 'system.ui',
    domain: 'system',
    label: 'Open editor and chat UI',
    defaultEnabled: true,
    toolIds: ['editor.open', 'chat.send', 'workspace.info', 'workspace.orient', 'log.append', 'skill.get'],
    aiToolKeys: ['editor_open', 'log_append'],
    mcpToolNames: ['editor_open', 'chat_send', 'workspace_info', 'workspace_orient', 'log_append', 'skill_get'],
  },
  {
    id: 'system.settings',
    domain: 'system',
    label: 'Read and change settings',
    defaultEnabled: true,
    toolIds: ['settings.get', 'settings.set', 'toolPolicy.get', 'toolPolicy.set'],
    aiToolKeys: ['connections_configure'],
    mcpToolNames: ['settings_get', 'settings_set'],
    risk: 'sensitive',
  },
]

const WRITE_IMPLIES_READ: Array<[string, string]> = [
  ['slack.send', 'slack.public'],
  ['slack.dms', 'slack.public'],
  ['slack.private', 'slack.public'],
  ['google.gmail.send', 'google.gmail.read'],
  ['google.calendar.write', 'google.calendar.read'],
  ['google.sheets.write', 'google.drive.read'],
]

const ROWS_BY_ID = new Map(CORE_TOOL_POLICY_ROWS.map(row => [row.id, row]))

const AI_TOOL_IDS = buildKeyMap('aiToolKeys')
const MCP_TOOL_IDS = buildKeyMap('mcpToolNames')
const DEFAULTS_BY_TOOL_ID = new Map<string, boolean>()
for (const row of CORE_TOOL_POLICY_ROWS) {
  for (const id of row.toolIds) DEFAULTS_BY_TOOL_ID.set(id, row.defaultEnabled)
}

export function readToolsPolicy(
  workspacePath: string | null | undefined,
  options: { knownToolIds?: string[] } = {},
): EffectiveToolPolicy {
  const rawSettings = readWorkspaceSettings(workspacePath)
  const rawTools = objectOrNull(rawSettings.tools)
  const explicit = Boolean(rawTools && (Array.isArray(rawTools.enabled) || Array.isArray(rawTools.disabled)))
  const knownIds = knownPolicyIds(options.knownToolIds)
  const enabled = normalizeIdArray(rawTools?.enabled, knownIds, { rejectUnknown: false })
  const disabled = normalizeIdArray(rawTools?.disabled, knownIds, { rejectUnknown: false })
  const legacyEnabled = explicit ? new Set<string>() : legacyEnabledIds(rawSettings)

  const isEnabled = (toolId: string): boolean => {
    if (disabled.includes(toolId)) return false
    if (enabled.includes(toolId)) return true
    if (legacyEnabled.has(toolId)) return true
    return DEFAULTS_BY_TOOL_ID.get(toolId) ?? true
  }

  const rows = effectiveRows(isEnabled)
  return { rows, enabled, disabled, explicit, isEnabled }
}

export function aiToolKeyEnabled(policy: Pick<EffectiveToolPolicy, 'isEnabled'>, aiKey: string): boolean {
  const ids = AI_TOOL_IDS.get(aiKey)
  if (!ids?.length) return true
  return ids.every(id => policy.isEnabled(id))
}

export function registryToolEnabled(policy: Pick<EffectiveToolPolicy, 'isEnabled'>, toolId: string): boolean {
  return policy.isEnabled(toolId)
}

export function mcpToolNameEnabled(policy: Pick<EffectiveToolPolicy, 'isEnabled'>, mcpName: string, registryToolId: string): boolean {
  const ids = MCP_TOOL_IDS.get(mcpName) ?? [registryToolId]
  return ids.every(id => policy.isEnabled(id))
}

export function isToolPolicySettingWrite(params: Record<string, unknown> | undefined): boolean {
  if (!params) return false
  const key = params.key
  return key === 'tools' || key === 'tools.enabled' || key === 'tools.disabled'
    || key === 'connectors' || (typeof key === 'string' && key.startsWith('connectors.'))
}

export function registerToolPolicyTools(tools: ToolRegistry): void {
  tools.register({
    name: 'toolPolicy.get',
    description: 'Read normalized agent tool availability policy for Settings > Tools.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ policy: serializePolicy(policyForTools(tools)) }),
  })

  tools.register({
    name: 'toolPolicy.set',
    description: 'Write normalized agent tool availability policy for Settings > Tools.',
    inputSchema: {
      type: 'object',
      properties: {
        toolIds: { type: 'array', items: { type: 'string' } },
        rowId: { type: 'string' },
        enabled: { type: 'boolean' },
        policy: { type: 'object' },
      },
    },
    execute: async (params) => {
      const workspacePath = tools.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace open')
      const current = readToolsPolicy(workspacePath, { knownToolIds: tools.list().map(tool => tool.name) })
      const knownIds = knownPolicyIds(tools.list().map(tool => tool.name))
      const next = nextRawPolicy(current, params, knownIds)
      writeToolsPolicy(workspacePath, next)
      return { policy: serializePolicy(policyForTools(tools)) }
    },
  })
}

export function connectorPolicyFromTools(workspacePath: string | null | undefined): {
  explicit: boolean
  slack?: {
    aiEnabled: boolean
    sendEnabled: boolean
    privateChannels: boolean
    directMessages: boolean
  }
  google?: {
    aiEnabled: boolean
    gmailEnabled: boolean
    gmailSendEnabled: boolean
    calendarEnabled: boolean
    calendarWriteEnabled: boolean
    driveEnabled: boolean
    sheetsWriteEnabled: boolean
  }
} {
  const policy = readToolsPolicy(workspacePath)
  if (!policy.explicit) return { explicit: false }
  const slackRead = SLACK_PUBLIC_TOOLS.some(id => policy.isEnabled(id))
  const slackSend = policy.isEnabled('slack.send')
  const slackDms = policy.isEnabled('slack.dms') || policy.isEnabled('slack.directMessages')
  const googleGmail = GOOGLE_GMAIL_READ_TOOLS.some(id => policy.isEnabled(id))
  const googleSend = policy.isEnabled('gmail.send')
  const googleCalendar = policy.isEnabled('calendar.events')
  const googleCalendarWrite = policy.isEnabled('calendar.create')
  const googleDrive = GOOGLE_DRIVE_READ_TOOLS.some(id => policy.isEnabled(id))
  const googleSheetsWrite = policy.isEnabled('sheets.write') || policy.isEnabled('sheets.append')

  return {
    explicit: true,
    slack: {
      aiEnabled: slackRead || slackSend || slackDms,
      sendEnabled: slackSend,
      privateChannels: policy.isEnabled('slack.privateChannels'),
      directMessages: slackDms,
    },
    google: {
      aiEnabled: googleGmail || googleSend || googleCalendar || googleCalendarWrite || googleDrive || googleSheetsWrite,
      gmailEnabled: googleGmail || googleSend,
      gmailSendEnabled: googleSend,
      calendarEnabled: googleCalendar || googleCalendarWrite,
      calendarWriteEnabled: googleCalendarWrite,
      driveEnabled: googleDrive || googleSheetsWrite,
      sheetsWriteEnabled: googleSheetsWrite,
    },
  }
}

function policyForTools(tools: ToolRegistry) {
  return readToolsPolicy(tools.getWorkspacePath(), {
    knownToolIds: tools.list().map(tool => tool.name),
  })
}

function serializePolicy(policy: EffectiveToolPolicy): Omit<EffectiveToolPolicy, 'isEnabled'> {
  return {
    rows: policy.rows,
    enabled: policy.enabled,
    disabled: policy.disabled,
    explicit: policy.explicit,
  }
}

function buildKeyMap(field: 'aiToolKeys' | 'mcpToolNames'): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const row of CORE_TOOL_POLICY_ROWS) {
    for (const key of row[field] ?? []) {
      map.set(key, row.toolIds)
    }
  }
  return map
}

function effectiveRows(isEnabled: (toolId: string) => boolean): Array<ToolPolicyRow & { enabled: boolean }> {
  return CORE_TOOL_POLICY_ROWS.map(row => ({
    ...row,
    enabled: row.toolIds.every(id => isEnabled(id)),
  }))
}

function nextRawPolicy(
  current: EffectiveToolPolicy,
  params: Record<string, unknown>,
  knownIds: Set<string>,
): { enabled: string[]; disabled: string[] } {
  const policyParam = objectOrNull(params.policy)
  if (policyParam) {
    return {
      enabled: normalizeIdArray(policyParam.enabled, knownIds, { rejectUnknown: true }),
      disabled: normalizeIdArray(policyParam.disabled, knownIds, { rejectUnknown: true }),
    }
  }

  const toolIds = toolIdsFromParams(params, knownIds)
  const enabledParam = params.enabled
  if (typeof enabledParam !== 'boolean') throw new Error('enabled must be a boolean')
  const enabled = new Set(current.enabled)
  const disabled = new Set(current.disabled)

  if (!current.explicit) {
    for (const row of CORE_TOOL_POLICY_ROWS) {
      if (row.defaultEnabled) continue
      for (const id of row.toolIds) {
        if (current.isEnabled(id)) enabled.add(id)
      }
    }
  }

  for (const id of toolIds) {
    if (enabledParam) {
      disabled.delete(id)
      if ((DEFAULTS_BY_TOOL_ID.get(id) ?? true) === false) enabled.add(id)
    } else {
      enabled.delete(id)
      disabled.add(id)
    }
  }

  applyCascade(toolIds, enabledParam, enabled, disabled)

  return {
    enabled: [...enabled].filter(id => knownIds.has(id)).sort(),
    disabled: [...disabled].filter(id => knownIds.has(id)).sort(),
  }
}

function applyCascade(toolIds: string[], enabling: boolean, enabled: Set<string>, disabled: Set<string>): void {
  const touchedRowIds = new Set<string>()
  for (const row of CORE_TOOL_POLICY_ROWS) {
    if (row.toolIds.some(id => toolIds.includes(id))) touchedRowIds.add(row.id)
  }

  if (enabling) {
    for (const [writeRowId, readRowId] of WRITE_IMPLIES_READ) {
      if (!touchedRowIds.has(writeRowId)) continue
      const readRow = ROWS_BY_ID.get(readRowId)
      if (!readRow) continue
      for (const id of readRow.toolIds) {
        disabled.delete(id)
        if (!readRow.defaultEnabled) enabled.add(id)
      }
    }
  } else {
    for (const [writeRowId, readRowId] of WRITE_IMPLIES_READ) {
      if (!touchedRowIds.has(readRowId)) continue
      const writeRow = ROWS_BY_ID.get(writeRowId)
      if (!writeRow) continue
      for (const id of writeRow.toolIds) {
        enabled.delete(id)
        disabled.add(id)
      }
    }
  }
}

function toolIdsFromParams(params: Record<string, unknown>, knownIds: Set<string>): string[] {
  const ids = normalizeIdArray(params.toolIds, knownIds, { rejectUnknown: true })
  if (ids.length) return ids
  if (typeof params.rowId === 'string') {
    const row = CORE_TOOL_POLICY_ROWS.find(item => item.id === params.rowId)
    if (!row) throw new Error(`Unknown tool policy row: ${params.rowId}`)
    return row.toolIds
  }
  throw new Error('toolIds or rowId is required')
}

function writeToolsPolicy(workspacePath: string, policy: { enabled: string[]; disabled: string[] }): void {
  const path = settingsPath(workspacePath)
  const raw = readWorkspaceSettings(workspacePath)
  atomicWriteJson(path, {
    ...raw,
    tools: policy,
  })
}

function readWorkspaceSettings(workspacePath: string | null | undefined): Record<string, unknown> {
  if (!workspacePath) return {}
  try {
    const path = settingsPath(workspacePath)
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return objectOrNull(parsed) ?? {}
  } catch {
    return {}
  }
}

function settingsPath(workspacePath: string): string {
  return join(workspacePath, '.mim', 'settings.json')
}

function normalizeIdArray(value: unknown, knownIds: Set<string>, opts: { rejectUnknown: boolean }): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) continue
    if (!knownIds.has(item)) {
      if (opts.rejectUnknown) throw new Error(`Unknown tool policy id: ${item}`)
      continue
    }
    if (!ids.includes(item)) ids.push(item)
  }
  return ids
}

function knownPolicyIds(extra: string[] = []): Set<string> {
  const ids = new Set<string>(extra)
  for (const row of CORE_TOOL_POLICY_ROWS) {
    for (const id of row.toolIds) ids.add(id)
  }
  return ids
}

function legacyEnabledIds(settings: Record<string, unknown>): Set<string> {
  const ids = new Set<string>()
  const connectors = objectOrNull(settings.connectors)
  const userConnectors = loadUserConfig().connectors
  const slack = resolveLegacyPolicy(objectOrNull(connectors?.slack), objectOrNull(userConnectors.slack))
  const google = resolveLegacyPolicy(objectOrNull(connectors?.google), objectOrNull(userConnectors.google))

  if (slack.aiEnabled) {
    for (const id of SLACK_PUBLIC_TOOLS) ids.add(id)
  }
  if (slack.sendEnabled) ids.add('slack.send')
  if (slack.privateChannels) ids.add('slack.privateChannels')
  if (slack.directMessages) {
    ids.add('slack.dms')
    ids.add('slack.directMessages')
  }

  if (google.aiEnabled && google.gmailEnabled) {
    for (const id of GOOGLE_GMAIL_READ_TOOLS) ids.add(id)
  }
  if (google.aiEnabled && google.gmailSendEnabled) ids.add('gmail.send')
  if (google.aiEnabled && google.calendarEnabled) ids.add('calendar.events')
  if (google.aiEnabled && google.calendarWriteEnabled) ids.add('calendar.create')
  if (google.aiEnabled && google.driveEnabled) {
    for (const id of GOOGLE_DRIVE_READ_TOOLS) ids.add(id)
  }
  if (google.aiEnabled && google.sheetsWriteEnabled) {
    ids.add('sheets.write')
    ids.add('sheets.append')
  }

  return ids
}

function resolveLegacyPolicy(
  workspace: Record<string, unknown> | null,
  userGlobal: Record<string, unknown> | null,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  const keys = new Set([
    ...Object.keys(userGlobal ?? {}),
    ...Object.keys(workspace ?? {}),
  ])
  for (const key of keys) {
    const workspaceValue = workspace?.[key]
    const globalValue = userGlobal?.[key]
    if (typeof workspaceValue === 'boolean') out[key] = workspaceValue
    else if (typeof globalValue === 'boolean') out[key] = globalValue
  }
  return out
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
