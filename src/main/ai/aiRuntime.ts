import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { Buffer } from 'buffer'
import {
  convertToModelMessages,
  generateObject,
  jsonSchema,
  stepCountIs,
  tool,
  ToolLoopAgent,
  validateUIMessages,
  type UIMessage,
} from 'ai'
import { z } from 'zod'
import { loadRegistry, resolveKey } from '@main/ai/ai.js'
import { buildProviderOptions, type ModelConfig } from '@main/ai/providerOptions.js'
import { formatSkillCatalogSection, getSystemPrompt } from '@main/ai/systemPrompt.js'
import type { SkillLoader } from '@main/skills.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import { newSpanId, newTraceId } from '@main/trace/trace.js'

export type AiProfile = 'chat' | 'inline' | 'ghost'

interface ModelRegistry {
  providers?: Record<string, { url: string; apiKeyEnv: string }>
  defaults?: Record<string, string[]>
  models?: ModelConfig[]
}

interface PackageToolSummary {
  name: string
  id?: string
  packageId?: string
  packageName?: string
  label?: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface ActivatedSkill {
  name: string
  description?: string
  body?: string
  tools: string[]
  unlocks: string[]
}

interface SkillCatalogSummary {
  id?: string
  name: string
  description: string
  tools: string[]
  unlocks: string[]
  packageName?: string
}

interface AiRuntimeOptions {
  tools: ToolRegistry
}

interface StreamRequest {
  id?: string
  messages: UIMessage[]
  modelId?: string
  controlId?: string
  skills?: string[]
  selection?: {
    text?: string
    contextBefore?: string
    contextAfter?: string
  }
  abortSignal?: AbortSignal
}

interface GhostRequest {
  before: string
  after: string
  fallback?: string[]
  modelId?: string
}

interface TaskLabelRequest {
  userText: string
  contextLabels?: string[]
  modelId?: string
}

interface SummaryRequest {
  messages: Array<{ role: string; content?: string; parts?: Array<Record<string, unknown>> }>
  modelId?: string
}

export const MAX_TOOL_OUTPUT_CHARS = 24000
const MAX_TASK_LABEL_CHARS = 40
const MAX_TASK_LABEL_WORDS = 4
// Anthropic tool names must match [A-Za-z0-9_-]+; normalize dotted/other names for SDK keys
export function aiToolKey(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

const contextDataSchema = z.object({
  filename: z.string(),
  mediaType: z.string().optional(),
  content: z.string(),
  size: z.number().optional(),
}).passthrough()

type MimContextData = z.infer<typeof contextDataSchema>

const looseObjectSchema = z.object({}).catchall(z.unknown())
const packageViewInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  src: z.string(),
  role: z.enum(['work', 'artifact', 'either']),
})
const packageSkillInputSchema = z.object({
  name: z.string(),
  content: z.string(),
})
const packageCreateInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  html: z.string().optional(),
  js: z.string().optional(),
  backend: z.string().optional(),
  skill: z.union([z.string(), packageSkillInputSchema]).optional(),
  skills: z.array(packageSkillInputSchema).optional(),
  readme: z.string().optional(),
  permissions: looseObjectSchema.optional(),
  provides: looseObjectSchema.optional(),
  dataFolder: z.string().optional(),
  views: z.array(packageViewInputSchema).optional(),
  override: z.boolean().optional(),
})

export function createAiRuntime({ tools }: AiRuntimeOptions) {
  return {
    streamChatResponse: (request: StreamRequest) =>
      streamProfileResponse({ profile: 'chat', tools, request }),
    streamInlineResponse: (request: StreamRequest) =>
      streamProfileResponse({ profile: 'inline', tools, request }),
    generateGhostSuggestions: (request: GhostRequest) =>
      generateGhostSuggestions({ tools, request }),
    generateTaskLabel: (request: TaskLabelRequest) =>
      generateTaskLabel({ tools, request }),
    generateSummary: (request: SummaryRequest) =>
      generateSummary({ tools, request }),
  }
}

export function createAiSdkTools({
  tools,
  profile,
  sessionId,
  packageTools = [],
  onSkillActivated,
  trace,
}: {
  tools: ToolRegistry
  profile: AiProfile
  sessionId?: string
  packageTools?: PackageToolSummary[]
  onSkillActivated?: (skill: ActivatedSkill) => void
  // Trace context of the chat turn, so every tool call this agent makes
  // nests under the turn span in the trace stream.
  trace?: { traceId: string; spanId: string }
}) {
  if (profile === 'ghost') return {}

  const ctx = {
    actor: 'ai' as const,
    ...(sessionId ? { sessionId } : {}),
    ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
  }
  const call = (name: string, params: Record<string, unknown> = {}) => tools.call(name, params, ctx)

  const readTools = {
    fs_read: tool({
      description: 'Returns total_lines, total_chars, and truncated. Use start_line/limit for large files.',
      inputSchema: z.object({
        path: z.string(),
        start_line: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
        max_chars: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('fs.read', {
        ...params,
        max_chars: params.max_chars ?? MAX_TOOL_OUTPUT_CHARS,
      }),
    }),

    search: tool({
      description: 'Search workspace files and/or session history. scope: "files", "sessions", or "all" (default).',
      inputSchema: z.object({
        query: z.string(),
        scope: z.enum(['files', 'sessions', 'all']).optional(),
        file_pattern: z.string().optional(),
        max_results: z.number().optional(),
      }),
      execute: async (params) => call('search', params),
    }),

    slack_search: tool({
      description: 'Search Slack messages for the configured workspace Slack account.',
      inputSchema: z.object({
        query: z.string(),
        count: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('slack.search', params),
    }),

    slack_history: tool({
      description: 'Read recent Slack messages from a channel id.',
      inputSchema: z.object({
        channel: z.string(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('slack.history', params),
    }),

    slack_channels: tool({
      description: 'List Slack channels for the configured workspace Slack account.',
      inputSchema: z.object({
        limit: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('slack.channels', params),
    }),

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

  if (profile === 'inline') {
    return {
      ...readTools,
      suggest_edit: tool({
        description: 'Suggest replacement text for the selected text.',
        inputSchema: z.object({
          replacement: z.string().describe('The full replacement text for the selection'),
        }),
        execute: async ({ replacement }) => ({ replacement }),
      }),
    }
  }

  const dynamicPackageTools: Record<string, ReturnType<typeof tool>> = {}
  for (const packageTool of packageTools) {
    const key = aiToolKey(packageTool.name)
    // execute uses the ORIGINAL name so the package runtime resolves it
    const originalName = packageTool.name
    dynamicPackageTools[key] = tool({
      description: `${packageTool.description || packageTool.label || packageTool.name} Provided by ${packageTool.packageName || packageTool.packageId || 'package'}.`,
      inputSchema: jsonSchema(packageTool.inputSchema || { type: 'object', properties: {} }),
      execute: async (input) => call('package.tools.execute', {
        name: originalName,
        input,
      }),
    })
  }

  const skillTools = {
    skill: tool({
      description: 'Activate a skill by authored name or package-qualified id when the user request matches its catalog description. Returns the skill instructions and unlocks its declared tools for this run.',
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const result = await call('skill.get', { name }) as { skill?: unknown }
        const skill = normalizeActivatedSkill(result.skill)
        onSkillActivated?.(skill)
        return { skill }
      },
    }),

  }

  // Security property: static tools win over dynamic package tools. A package cannot
  // shadow a core SDK tool (e.g. fs_write) by registering a tool with the same sanitized key.
  const staticTools = {
    ...readTools,
    ...skillTools,

    trace_query: tool({
      description: 'Query recent trace digest events for debugging agent actions. Returns redacted summaries and payload refs only.',
      inputSchema: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().positive().optional(),
        kind: z.string().optional(),
        actor: z.enum(['user', 'ai', 'package', 'system']).optional(),
        tool: z.string().optional(),
        packageId: z.string().optional(),
        sessionId: z.string().optional(),
        runId: z.string().optional(),
        traceId: z.string().optional(),
        status: z.enum(['ok', 'error']).optional(),
        order: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().positive().max(500).optional(),
      }),
      execute: async (params) => call('trace.query', params),
    }),

    trace_stats: tool({
      description: 'Aggregate trace health by tool, package, model, day, gate decision, job, and post-AI edit outcomes.',
      inputSchema: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
        days: z.number().int().positive().optional(),
        kind: z.string().optional(),
        actor: z.enum(['user', 'ai', 'package', 'system']).optional(),
        tool: z.string().optional(),
        packageId: z.string().optional(),
        sessionId: z.string().optional(),
        runId: z.string().optional(),
        traceId: z.string().optional(),
        status: z.enum(['ok', 'error']).optional(),
      }),
      execute: async (params) => call('trace.stats', params),
    }),

    history_list: tool({
      description: 'List recoverable local versions for one workspace file. Default output is folded to useful recovery moments.',
      inputSchema: z.object({
        path: z.string(),
        include_folded: z.boolean().optional(),
      }),
      execute: async (params) => call('history.list', params),
    }),

    history_preview: tool({
      description: 'Preview a local recovery version. Text versions include content; binary versions return metadata.',
      inputSchema: z.object({
        path: z.string(),
        version_id: z.string(),
      }),
      execute: async (params) => call('history.preview', params),
    }),

    history_restore: tool({
      description: 'Restore a workspace file to a local recovery version. The restore is itself captured so it is undoable.',
      inputSchema: z.object({
        path: z.string(),
        version_id: z.string(),
      }),
      execute: async (params) => call('history.restore', params),
    }),

    sync_status: tool({
      description: 'Report plain-language workspace backup/sync status without using git terms.',
      inputSchema: z.object({}),
      execute: async () => call('sync.status', {}),
    }),

    sync_now: tool({
      description: 'Run managed workspace sync. Refuses manual mode and stops on conflicts instead of resolving silently.',
      inputSchema: z.object({}),
      execute: async () => call('sync.now', {}),
    }),

    git_status: tool({
      description: 'Read concise git status for advanced repository questions.',
      inputSchema: z.object({}),
      execute: async () => call('git.status', {}),
    }),

    git_diff: tool({
      description: 'Read git diff for the workspace or a path.',
      inputSchema: z.object({
        path: z.string().optional(),
        staged: z.boolean().optional(),
      }),
      execute: async (params) => call('git.diff', params),
    }),

    git_log: tool({
      description: 'Read recent git commits for the workspace.',
      inputSchema: z.object({
        limit: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('git.log', params),
    }),

    git_commit: tool({
      description: 'Stage all workspace changes and create a git commit. Requires approval when policy requires it.',
      inputSchema: z.object({ message: z.string().min(1) }),
      execute: async (params) => call('git.commit', params),
    }),

    git_pull: tool({
      description: 'Pull the current branch with --ff-only. Requires approval when policy requires it.',
      inputSchema: z.object({}),
      execute: async () => call('git.pull', {}),
    }),

    git_push: tool({
      description: 'Push the current branch to its upstream. Requires approval when policy requires it.',
      inputSchema: z.object({}),
      execute: async () => call('git.push', {}),
    }),

    fs_write: tool({
      description: 'Overwrite an entire workspace file. The permission gate pauses for user approval when policy requires it.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => call('fs.write', { path, content }),
    }),

    comments_list: tool({
      description: 'List inline review comment threads in a markdown file. Use before working through existing document review comments.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => call('comments.list', { path }),
    }),

    comments_add: tool({
      description: 'Add an inline review comment anchored to exact visible text. Use this when reviewing a document; do not hand-edit comment tags.',
      inputSchema: z.object({
        path: z.string(),
        anchor_text: z.string().min(1),
        text: z.string(),
      }),
      execute: async ({ path, anchor_text, text }) => call('comments.add', { path, anchor_text, text }),
    }),

    comments_reply: tool({
      description: 'Reply to an existing inline review comment thread. Use this for discussion or to explain a document change.',
      inputSchema: z.object({
        path: z.string(),
        id: z.string().min(1),
        text: z.string(),
      }),
      execute: async ({ path, id, text }) => call('comments.reply', { path, id, text }),
    }),

    comments_resolve: tool({
      description: 'Resolve an inline review comment. This removes the comment wrapper and notes while keeping the anchored text.',
      inputSchema: z.object({
        path: z.string(),
        id: z.string().min(1),
      }),
      execute: async ({ path, id }) => call('comments.resolve', { path, id }),
    }),

    fs_edit: tool({
      description: 'Edit a workspace file with search-and-replace. Exactly 1 match required. The permission gate pauses for user approval when policy requires it.',
      inputSchema: z.object({
        path: z.string(),
        old_text: z.string().min(1),
        new_text: z.string(),
      }),
      execute: async ({ path, old_text, new_text }) => call('fs.edit', { path, old_text, new_text }),
    }),

    fs_create: tool({
      description: 'Create a workspace file. Fails if the file exists. The permission gate pauses for user approval when policy requires it.',
      inputSchema: z.object({ path: z.string(), content: z.string().optional() }),
      execute: async ({ path, content }) => call('fs.create', { path, content: content ?? '' }),
    }),

    fs_delete: tool({
      description: 'Delete a workspace file. Directories are refused. The permission gate pauses for user approval when policy requires it.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => call('fs.delete', { path }),
    }),

    log_append: tool({
      description: 'Append a short activity note to the optional workspace logbook at .mim/log.md.',
      inputSchema: z.object({ message: z.string().min(1) }),
      execute: async ({ message }) => call('log.append', { message }),
    }),

    fs_list: tool({
      description: 'Capped result set. Recursive mode skips heavy/generated directories.',
      inputSchema: z.object({
        path: z.string().optional(),
        recursive: z.boolean().optional(),
        pattern: z.string().optional(),
        max_entries: z.number().int().positive().optional(),
      }),
      execute: async (params) => call('fs.list', params),
    }),

    fs_mkdir: tool({
      description: 'Recursive. No error if directory already exists.',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => call('fs.mkdir', { path }),
    }),

    fs_rename: tool({
      description: 'Fails if destination exists.',
      inputSchema: z.object({ old_path: z.string(), new_path: z.string() }),
      execute: async ({ old_path, new_path }) => call('fs.rename', { old_path, new_path }),
    }),

    editor_open: tool({
      description: 'Open a file in the Editor',
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => call('editor.open', { path }),
    }),

    terminal_run: tool({
      description: 'Run a shell command in the Terminal',
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => call('terminal.run', { command }),
    }),

    package_create: tool({
      description: 'Create a new workspace package, including headless packages with backend tools/jobs and optional package skills. html is optional; omit it for tools-only packages.',
      inputSchema: packageCreateInputSchema,
      execute: async (params) => call('package.create', params),
    }),

    package_validate: tool({
      description: 'Validate a workspace package and return structured errors/warnings for manifest, backend exports, named tools, skills, and permission hints.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => call('package.validate', { id }),
    }),

    package_reload: tool({
      description: 'Rescan packages and reload backend capabilities so edits take effect without restarting Mim. Use after package.create or package.edit before testing.',
      inputSchema: z.object({ id: z.string().optional() }),
      execute: async (params) => call('package.reload', params),
    }),

    package_edit: tool({
      description: 'Edit a package file',
      inputSchema: z.object({
        id: z.string(),
        file: z.string(),
        content: z.string(),
      }),
      execute: async (params) => call('package.edit', params),
    }),

    package_delete: tool({
      description: 'Remove a package',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => call('package.delete', { id }),
    }),

    package_list: tool({
      description: 'List installed packages',
      inputSchema: z.object({}),
      execute: async () => call('package.list', {}),
    }),

    app_status: tool({
      description: 'Read resolved app/package state: installed, enabled, trust-needed, install-needed, source, and data-folder presence.',
      inputSchema: z.object({}),
      execute: async () => call('app.status', {}),
    }),

    app_enable: tool({
      description: 'Enable an installed package for this workspace. Does not acknowledge trust; if trust is needed, tell the user to review and trust it in Settings > Apps.',
      inputSchema: z.object({
        id: z.string(),
        layer: z.enum(['workspace', 'local']).optional(),
      }),
      execute: async (params) => call('app.enable', params),
    }),

    package_readme: tool({
      description: 'Read the README.md documentation for an installed package by package id.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => call('package.readme', { id }),
    }),

    package_capabilities_list: tool({
      description: 'List enabled package jobs, tools, skills, and runtime diagnostics. Use after enabling/reloading to verify what Mim can see.',
      inputSchema: z.object({}),
      execute: async () => call('package.capabilities.list', {}),
    }),

    package_tools_execute: tool({
      description: 'Execute an enabled package AI tool by public name for testing during package authoring.',
      inputSchema: z.object({
        name: z.string(),
        input: looseObjectSchema.optional(),
      }),
      execute: async ({ name, input }) => call('package.tools.execute', { name, input: input ?? {} }),
    }),

    package_jobs_start: tool({
      description: 'Start an enabled package backend job by packageId and jobId for testing during package authoring.',
      inputSchema: z.object({
        packageId: z.string().optional(),
        jobId: z.string(),
        inputs: looseObjectSchema.optional(),
      }),
      execute: async (params) => call('package.jobs.start', params),
    }),

    registry_list: tool({
      description: 'List packages available in the registry, with install state for this workspace.',
      inputSchema: z.object({}),
      execute: async () => call('registry.list', {}),
    }),

    package_install: tool({
      description: 'Install a package globally, by registry id or direct repo URL. The permission gate pauses for user approval when policy requires it.',
      inputSchema: z.object({
        id: z.string().optional(),
        version: z.string().optional(),
        repo: z.string().optional(),
        ref: z.string().optional(),
      }),
      execute: async (params) => call('package.install', params),
    }),

    package_update: tool({
      description: 'Update an installed package to the latest registry version, repointing the workspace pin if one exists.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => call('package.update', { id }),
    }),

    package_uninstall: tool({
      description: 'Remove an installed package version from the global install dir.',
      inputSchema: z.object({ id: z.string(), version: z.string() }),
      execute: async (params) => call('package.uninstall', params),
    }),

  }

  // Dynamic entries only added when their key is not already present (static wins)
  for (const [key, value] of Object.entries(dynamicPackageTools)) {
    if (!(key in staticTools)) {
      (staticTools as Record<string, unknown>)[key] = value
    }
  }

  return staticTools
}

export function createSkillActiveToolPolicy(
  allToolNames: string[],
  activatedSkillTools: Set<string>,
  gatedToolNames: Set<string>,
) {
  // Normalize through aiToolKey so dotted unlock names match sanitized SDK keys
  const gated = new Set([...gatedToolNames].map(aiToolKey))
  // The activation tool must always stay visible, whatever a skill declares.
  gated.delete('skill')
  const allNormalized = allToolNames.map(aiToolKey)
  const allSet = new Set(allNormalized)
  const baseTools = allToolNames.filter(name => !gated.has(aiToolKey(name)))
  const activeTools = () => [
    ...baseTools,
    ...[...activatedSkillTools]
      .map(aiToolKey)
      .filter(key => gated.has(key) && allSet.has(key))
      .map(key => allToolNames[allNormalized.indexOf(key)])
      .filter(Boolean),
  ]

  return {
    activeTools: activeTools(),
    prepareStep: () => ({ activeTools: activeTools() }),
  }
}

// Deterministic activation for composer-selected skill chips: the bodies are
// injected into the system prompt and the declared tools unlock from step one,
// instead of hoping the model calls skill() first.
export function activateSelectedSkills(
  loader: Pick<SkillLoader, 'get'>,
  names: string[] | undefined,
): { promptSection: string | null; toolNames: string[] } {
  const requested = [...new Set(
    (names ?? []).map(name => typeof name === 'string' ? name.trim() : '').filter(Boolean),
  )]
  if (!requested.length) return { promptSection: null, toolNames: [] }

  const bodies: string[] = []
  const missing: string[] = []
  const toolNames: string[] = []
  for (const name of requested) {
    const skill = loader.get(name)
    if (!skill) {
      missing.push(name)
      continue
    }
    for (const toolName of [...skill.tools, ...skill.unlocks]) {
      if (!toolNames.includes(toolName)) toolNames.push(toolName)
    }
    bodies.push(`## ${skill.name}\n\n${skill.body}`)
  }

  const lines = [
    '# ACTIVE SKILLS',
    '',
    'The user selected these skills for this request. Their instructions are already active and their tools are unlocked; do not call skill() for them again.',
  ]
  if (bodies.length) lines.push('', bodies.join('\n\n'))
  if (missing.length) lines.push('', `These selected skills are unavailable and were not activated: ${missing.join(', ')}. Mention this if it affects the task.`)

  return { promptSection: lines.join('\n'), toolNames }
}

async function activateSelectedSkillsFromRegistry(
  tools: ToolRegistry,
  names: string[] | undefined,
  ctx: { sessionId?: string; traceId?: string; spanId?: string } = {},
): Promise<{ promptSection: string | null; toolNames: string[] }> {
  const requested = [...new Set(
    (names ?? []).map(name => typeof name === 'string' ? name.trim() : '').filter(Boolean),
  )]
  if (!requested.length) return { promptSection: null, toolNames: [] }

  const bodies: string[] = []
  const missing: string[] = []
  const toolNames: string[] = []

  for (const name of requested) {
    try {
      const result = await tools.call('skill.get', { name }, {
        actor: 'ai',
        ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
        ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
        ...(ctx.spanId ? { spanId: ctx.spanId } : {}),
      }) as { skill?: unknown }
      const skill = normalizeActivatedSkill(result.skill)
      for (const toolName of [...skill.tools, ...skill.unlocks]) {
        if (!toolNames.includes(toolName)) toolNames.push(toolName)
      }
      bodies.push(`## ${skill.name}\n\n${skill.body ?? ''}`.trim())
    } catch {
      missing.push(name)
    }
  }

  const lines = [
    '# ACTIVE SKILLS',
    '',
    'The user selected these skills for this request. Their instructions are already active and their tools are unlocked; do not call skill() for them again.',
  ]
  if (bodies.length) lines.push('', bodies.join('\n\n'))
  if (missing.length) lines.push('', `These selected skills are unavailable and were not activated: ${missing.join(', ')}. Mention this if it affects the task.`)

  return { promptSection: lines.join('\n'), toolNames }
}

function normalizeActivatedSkill(raw: unknown): ActivatedSkill {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid skill result')
  }
  const item = raw as Record<string, unknown>
  const name = typeof item.name === 'string' ? item.name : ''
  if (!name) throw new Error('Invalid skill result')
  return {
    name,
    description: typeof item.description === 'string' ? item.description : undefined,
    body: typeof item.body === 'string' ? item.body : undefined,
    tools: Array.isArray(item.tools) ? item.tools.filter((toolName): toolName is string => typeof toolName === 'string') : [],
    unlocks: Array.isArray(item.unlocks) ? item.unlocks.filter((toolName): toolName is string => typeof toolName === 'string') : [],
  }
}

async function streamProfileResponse({
  profile,
  tools,
  request,
}: {
  profile: 'chat' | 'inline'
  tools: ToolRegistry
  request: StreamRequest
}): Promise<Response> {
  const registry = loadRegistry()
  const modelConfig = resolveRequestModel(registry, profile, request.modelId)
  const { key } = resolveKey(modelConfig.provider)
  if (!key) throw new Error(`No API key configured for ${modelConfig.provider}`)
  const { model } = await createSdkModel({ registry, modelConfig, apiKey: key })
  const sessionId = request.id
  // The turn is the trace: model calls, the pre-flight skill/package listing,
  // tool calls, and the closing persistence all nest under this root span, so
  // one chat send is one run in the Activity feed (not a scatter of orphan
  // traces). Created up front so the listing below can parent to it.
  const turnTraceId = newTraceId()
  const turnSpanId = newSpanId()
  const turnStartedAt = Date.now()
  const turnTrace = { traceId: turnTraceId, spanId: turnSpanId }
  tools.trace.append({
    kind: 'chat.turn',
    actor: 'ai',
    traceId: turnTraceId,
    spanId: turnSpanId,
    ...(sessionId ? { sessionId } : {}),
    model: modelConfig.model,
    data: { profile },
  })
  const [packageTools, skillCatalog] = profile === 'chat'
    ? await Promise.all([listPackageTools(tools, sessionId, turnTrace), listSkillCatalog(tools, sessionId, turnTrace)])
    : [[], []] as const
  const gatedToolNames = skillUnlocksFromCatalog(skillCatalog)
  const activatedSkillTools = new Set<string>()
  const aiTools = createAiSdkTools({
    tools,
    profile,
    sessionId,
    packageTools,
    onSkillActivated: skill => {
      for (const name of skill.tools) activatedSkillTools.add(name)
      for (const name of skill.unlocks) activatedSkillTools.add(name)
    },
    trace: { traceId: turnTraceId, spanId: turnSpanId },
  })
  const selectedSkills = profile === 'chat'
    ? await activateSelectedSkillsFromRegistry(tools, request.skills, {
        sessionId,
        traceId: turnTraceId,
        spanId: turnSpanId,
      })
    : { promptSection: null, toolNames: [] }
  // Pre-activated tools must land in the set before the policy snapshots its
  // initial activeTools, so composer-selected skills are usable from step one.
  selectedSkills.toolNames.forEach(toolName => activatedSkillTools.add(toolName))
  const activeToolPolicy = profile === 'chat'
    ? createSkillActiveToolPolicy(Object.keys(aiTools), activatedSkillTools, gatedToolNames)
    : null
  const uiMessages = await validateUIMessages({
    messages: normalizeFileUIParts(request.messages || []),
    tools: aiTools,
    dataSchemas: { context: contextDataSchema },
  })
  const modelMessages = await convertToModelMessages(uiMessages, {
    tools: aiTools,
    convertDataPart: convertMimDataPart,
  })
  const turnUsageSteps: UsageSummary[] = []

  const agent = new ToolLoopAgent({
    model,
    instructions: profile === 'chat'
      ? [
          getSystemPrompt(tools.getWorkspacePath() ?? undefined, { includeSkillCatalog: false }),
          formatSkillCatalogSection(skillCatalog),
          selectedSkills.promptSection,
        ]
        .filter(Boolean).join('\n\n\n')
      : buildInlineSystemPrompt(request.selection || {}),
    tools: aiTools,
    activeTools: activeToolPolicy?.activeTools as any,
    prepareStep: activeToolPolicy?.prepareStep as any,
    // Chat cap is a runaway backstop, not a task limit — the renderer shows a
    // Continue notice when it's hit (ChatView step-cap notice tracks this number).
    stopWhen: stepCountIs(profile === 'chat' ? 100 : 4),
    maxOutputTokens: profile === 'chat' ? undefined : 2000,
    temperature: profile === 'chat' ? undefined : 0.3,
    providerOptions: buildProviderOptions(modelConfig, request.controlId),
    onStepFinish(event) {
      if (event.usage) {
        const usage = normalizeSdkUsage(event.usage, modelConfig)
        turnUsageSteps.push(usage)
        tools.trace.append({
          kind: 'model.call',
          actor: 'ai',
          traceId: turnTraceId,
          parentSpanId: turnSpanId,
          ...(sessionId ? { sessionId } : {}),
          model: modelConfig.model,
          data: { profile, ...usage },
        })
      }
    },
  })

  const result = await agent.stream({
    prompt: modelMessages,
    abortSignal: request.abortSignal,
  })

  return result.toUIMessageStreamResponse({
    originalMessages: uiMessages,
    sendReasoning: profile === 'chat',
    onFinish: async ({ messages }) => {
      // Capture the turn's full message array (input + assistant output + tool
      // calls/results) as a payload blob so the Activity Story can show what the
      // AI said. Content already lives in the session DB; this makes it
      // reachable by payloadRef. Off when content capture is disabled.
      const messagesRef = tools.shouldCaptureContent()
        ? tools.trace.writePayload(turnTraceId, turnSpanId, 'messages', messages)
        : null
      tools.trace.append({
        kind: 'chat.turn.done',
        actor: 'ai',
        traceId: turnTraceId,
        spanId: turnSpanId,
        status: 'ok',
        durationMs: Date.now() - turnStartedAt,
        ...(sessionId ? { sessionId } : {}),
        model: modelConfig.model,
        data: { profile, steps: turnUsageSteps.length },
        ...(messagesRef ? { payloadRef: messagesRef } : {}),
      })
      if (profile !== 'chat' || !sessionId) return
      const turnUsage = summarizeTurnUsage(turnUsageSteps)
      await persistChatSession(tools, sessionId, messages, turnUsage.usage, turnUsage.contextTokens, turnTrace)
    },
    onError: (error) => error instanceof Error ? error.message : 'AI request failed',
  })
}

export function convertMimDataPart(part: { type: string; data: unknown }) {
  if (part.type !== 'data-context') return undefined
  const data = contextDataSchema.parse(part.data)
  return {
    type: 'text' as const,
    text: formatContextForModel(data),
  }
}

function formatContextForModel(data: MimContextData): string {
  const filename = escapeXmlAttribute(data.filename || 'attachment.txt')
  const mediaType = escapeXmlAttribute(data.mediaType || 'text/plain')
  if ((data as Record<string, unknown>).kind === 'comments') {
    const path = escapeXmlAttribute(typeof (data as Record<string, unknown>).path === 'string' ? (data as Record<string, string>).path : data.filename)
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse(data.content) } catch { /* use raw content below */ }
    const doc = typeof parsed.document === 'string' ? parsed.document : null
    const instruction = typeof parsed.instruction === 'string' ? parsed.instruction : ''
    const parts = [
      `<attached-comments path="${path}" name="${filename}">`,
    ]
    if (instruction) parts.push(`<instruction>${instruction}</instruction>`)
    if (doc) {
      parts.push(`<document path="${path}">`)
      parts.push(doc)
      parts.push('</document>')
    } else {
      parts.push(data.content)
    }
    parts.push('</attached-comments>')
    return parts.join('\n')
  }
  return [
    `<attached-file name="${filename}" media-type="${mediaType}">`,
    data.content,
    '</attached-file>',
  ].join('\n')
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function normalizeFileUIParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    const parts = (message as { parts?: unknown[] }).parts
    if (!Array.isArray(parts)) return message

    let changed = false
    const nextParts = parts.map((part) => {
      if (!part || typeof part !== 'object') return part
      const item = part as Record<string, unknown>
      if (item.type !== 'file') return part

      const mediaType = typeof item.mediaType === 'string' ? item.mediaType : 'text/plain'
      if (isTextFileMediaType(mediaType)) {
        changed = true
        return {
          type: 'data-context',
          data: {
            filename: typeof item.filename === 'string' && item.filename
              ? item.filename
              : 'attachment.txt',
            mediaType,
            content: textFileContent(item),
          },
        }
      }

      if (item.data == null) return part

      changed = true
      const { data: rawData, ...withoutData } = item
      return {
        ...withoutData,
        url: typeof withoutData.url === 'string' && withoutData.url
          ? withoutData.url
          : textDataUrl(typeof item.mediaType === 'string' ? item.mediaType : 'text/plain', rawData),
      }
    })

    return changed ? { ...message, parts: nextParts } : message
  })
}

function isTextFileMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/') || mediaType === 'application/json'
}

function textFileContent(part: Record<string, unknown>): string {
  if (part.data != null) return String(part.data)
  if (part.content != null) return String(part.content)
  if (typeof part.url === 'string') return textFromDataUrl(part.url)
  return ''
}

function textFromDataUrl(url: string): string {
  const match = /^data:[^;,]+(?:;charset=[^;,]+)?;base64,(.*)$/i.exec(url)
  if (!match) return ''
  try {
    return Buffer.from(match[1], 'base64').toString('utf-8')
  } catch {
    return ''
  }
}

function textDataUrl(mediaType: string, data: unknown): string {
  return `data:${mediaType};base64,${Buffer.from(String(data ?? ''), 'utf-8').toString('base64')}`
}

async function generateGhostSuggestions({
  request,
}: {
  tools: ToolRegistry
  request: GhostRequest
}): Promise<{ suggestions: string[] }> {
  const registry = loadRegistry()
  const modelConfig = resolveRequestModel(registry, 'ghost', request.modelId)
  const { key } = resolveKey(modelConfig.provider)
  if (!key) throw new Error(`No API key configured for ${modelConfig.provider}`)
  const { model } = await createSdkModel({ registry, modelConfig, apiKey: key })
  const startedAt = Date.now()
  const result = await generateObject({
    model,
    schema: z.object({
      suggestions: z.array(z.string()).min(0).max(5),
    }),
    system: buildGhostSystemPrompt(request.before),
    prompt: `<prefix>${escapePromptXml(request.before)}</prefix>\n<cursor/>\n<suffix>${escapePromptXml(request.after)}</suffix>`,
    maxOutputTokens: 700,
    temperature: 0.35,
    providerOptions: buildProviderOptions(modelConfig),
  })

  traceModelCall(tools, 'ghost', modelConfig, result.usage, Date.now() - startedAt)
  const suggestions = cleanSuggestions(result.object?.suggestions)
  return { suggestions: suggestions.length ? suggestions : cleanSuggestions(request.fallback || []) }
}

async function generateTaskLabel({
  tools,
  request,
}: {
  tools: ToolRegistry
  request: TaskLabelRequest
}): Promise<{ label: string }> {
  const userText = String(request.userText || '').trim()
  if (!userText) return { label: '' }

  const registry = loadRegistry()
  const modelConfig = resolveRequestModel(registry, 'extract', request.modelId)
  const { key } = resolveKey(modelConfig.provider)
  if (!key) throw new Error(`No API key configured for ${modelConfig.provider}`)
  const { model } = await createSdkModel({ registry, modelConfig, apiKey: key })
  const startedAt = Date.now()
  const result = await generateObject({
    model,
    schema: z.object({
      label: z.string().describe('Compact sidebar task label, 2-4 words, target 3 words, no trailing punctuation'),
    }),
    system: buildTaskLabelSystemPrompt(),
    prompt: buildTaskLabelPrompt({
      userText,
      contextLabels: request.contextLabels || [],
    }),
    maxOutputTokens: 120,
    temperature: 0.2,
    providerOptions: buildProviderOptions(modelConfig),
  })

  traceModelCall(tools, 'task-label', modelConfig, result.usage, Date.now() - startedAt)
  return { label: cleanTaskLabel(result.object?.label) }
}

const MAX_SUMMARY_INPUT_CHARS = 60000

async function generateSummary({
  tools,
  request,
}: {
  tools: ToolRegistry
  request: SummaryRequest
}): Promise<{ summary: string }> {
  const messages = request.messages || []
  if (!messages.length) return { summary: '' }

  // Build a compact transcript from messages (text parts only)
  const lines: string[] = []
  let charCount = 0
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'Assistant' : msg.role === 'user' ? 'User' : 'System'
    let text = ''
    if (typeof msg.content === 'string') {
      text = msg.content
    } else if (Array.isArray(msg.parts)) {
      text = msg.parts
        .filter((p: Record<string, unknown>) => p.type === 'text' && typeof p.text === 'string')
        .map((p: Record<string, unknown>) => p.text as string)
        .join('\n')
    }
    if (!text.trim()) continue
    const line = `${role}: ${text.trim()}`
    if (charCount + line.length > MAX_SUMMARY_INPUT_CHARS) break
    lines.push(line)
    charCount += line.length
  }

  if (!lines.length) return { summary: '' }

  const registry = loadRegistry()
  const modelConfig = resolveRequestModel(registry, 'extract', request.modelId)
  const { key } = resolveKey(modelConfig.provider)
  if (!key) throw new Error(`No API key configured for ${modelConfig.provider}`)
  const { model } = await createSdkModel({ registry, modelConfig, apiKey: key })

  const startedAt = Date.now()
  const result = await generateObject({
    model,
    schema: z.object({
      summary: z.string().describe('A concise summary of the conversation so far: key decisions, findings, and open threads. 3-8 sentences.'),
    }),
    system: 'You summarize conversations. Write a concise summary capturing the key topics discussed, decisions made, findings, and any open questions or next steps. Be factual and specific. Do not editorialize.',
    prompt: lines.join('\n\n'),
    maxOutputTokens: 800,
    temperature: 0.2,
    providerOptions: buildProviderOptions(modelConfig),
  })

  traceModelCall(tools, 'summary', modelConfig, result.usage, Date.now() - startedAt)
  return { summary: result.object?.summary || '' }
}

async function persistChatSession(
  tools: ToolRegistry,
  sessionId: string,
  messages: UIMessage[],
  requestUsage: UsageSummary,
  lastContextTokens: number,
  trace?: { traceId: string; spanId: string },
) {
  const ctx = {
    actor: 'system' as const,
    ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
  }
  let usage = requestUsage
  try {
    const current = await tools.call('session.get', { id: sessionId }, ctx) as { usage?: UsageSummary }
    usage = addUsage(current.usage, requestUsage)
  } catch {
    usage = requestUsage
  }
  await tools.call('session.update', {
    id: sessionId,
    messages,
    usage,
    lastContextTokens,
  }, ctx)
}

export async function listSkillUnlocks(tools: ToolRegistry, sessionId?: string): Promise<Set<string>> {
  return skillUnlocksFromCatalog(await listSkillCatalog(tools, sessionId))
}

async function listSkillCatalog(
  tools: ToolRegistry,
  sessionId?: string,
  trace?: { traceId: string; spanId: string },
): Promise<SkillCatalogSummary[]> {
  try {
    const result = await tools.call('skill.list', {}, {
      actor: 'ai',
      ...(sessionId ? { sessionId } : {}),
      ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
    }) as { skills?: Array<{ id?: string; name?: string; description?: string; tools?: string[]; unlocks?: string[]; packageName?: string }> }
    return (result.skills || [])
      .filter(skill => typeof skill.name === 'string')
      .map(skill => ({
        id: typeof skill.id === 'string' ? skill.id : skill.name!,
        name: skill.name!,
        description: typeof skill.description === 'string' ? skill.description : '',
        tools: Array.isArray(skill.tools) ? skill.tools.filter((name): name is string => typeof name === 'string') : [],
        unlocks: Array.isArray(skill.unlocks) ? skill.unlocks.filter((name): name is string => typeof name === 'string') : [],
        ...(typeof skill.packageName === 'string' ? { packageName: skill.packageName } : {}),
      }))
  } catch {
    return []
  }
}

function skillUnlocksFromCatalog(skills: SkillCatalogSummary[]): Set<string> {
  const unlocks = new Set<string>()
  for (const skill of skills) {
    for (const name of skill.unlocks) unlocks.add(name)
  }
  return unlocks
}

async function listPackageTools(
  tools: ToolRegistry,
  sessionId?: string,
  trace?: { traceId: string; spanId: string },
): Promise<PackageToolSummary[]> {
  try {
    const result = await tools.call('package.tools.list', {}, {
      actor: 'ai',
      ...(sessionId ? { sessionId } : {}),
      ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
    }) as { tools?: PackageToolSummary[] }
    return result.tools || []
  } catch {
    return []
  }
}

async function createSdkModel({
  registry,
  modelConfig,
  apiKey,
}: {
  registry: ModelRegistry
  modelConfig: ModelConfig
  apiKey: string
}) {
  const providerConfig = registry.providers?.[modelConfig.provider]
  if (!providerConfig) throw new Error(`Missing provider config for ${modelConfig.provider}`)
  const createFn = providerFactory(modelConfig.provider)
  const baseURL = providerBaseUrl(modelConfig.provider, providerConfig.url)
  return {
    model: createFn({ apiKey, baseURL })(modelConfig.model),
    modelConfig,
    providerConfig,
  }
}

function providerFactory(provider: string) {
  switch (provider) {
    case 'anthropic':
      return createAnthropic
    case 'openai':
      return createOpenAI
    case 'google':
      return createGoogleGenerativeAI
    default:
      throw new Error(`Unsupported AI provider: ${provider}`)
  }
}

export function providerBaseUrl(provider: string, rawUrl: unknown): string {
  const url = String(rawUrl || '').replace(/\/+$/, '')
  if (provider === 'anthropic') return url.replace(/\/messages$/, '')
  if (provider === 'openai') return url.replace(/\/responses$/, '').replace(/\/chat\/completions$/, '')
  if (provider === 'google') return url.replace(/\/models$/, '')
  return url
}

function resolveRequestModel(registry: ModelRegistry, feature: string, modelId?: string): ModelConfig {
  const explicit = normalizeModelId(modelId)
  if (explicit) {
    const model = findModel(registry, explicit)
    if (!model) throw new Error(`Unknown AI model id: ${explicit}`)
    return model
  }

  const order = registry.defaults?.[feature] || []
  for (const id of order) {
    const model = findModel(registry, id)
    if (!model) continue
    if (resolveKey(model.provider).key) return model
  }

  const configured = (registry.models || []).find(model => resolveKey(model.provider).key)
  if (configured) return configured
  throw new Error('No AI model available. Check your API keys in Settings.')
}

function findModel(registry: ModelRegistry, modelId?: string): ModelConfig | null {
  const normalized = normalizeModelId(modelId)
  if (!normalized) return null
  return registry.models?.find(model => model.id === normalized || model.model === normalized) || null
}

function normalizeModelId(modelId: string | undefined): string | null {
  return modelId || null
}

// buildProviderOptions / controlForModel moved to ./providerOptions.ts to avoid
// an ai.ts -> aiRuntime.ts import cycle. Re-exported so existing callers that
// import it from this module keep working.
export { buildProviderOptions }

function buildInlineSystemPrompt({ text = '', contextBefore = '', contextAfter = '' }) {
  return [
    'You are an inline writing assistant in Mim Editor, used by senior research professionals.',
    '',
    'The user selected text in their document. Here is the selection and surrounding context:',
    '',
    `<context-before>${escapePromptXml(contextBefore)}</context-before>`,
    text
      ? `<selection>${escapePromptXml(text)}</selection>`
      : '<cursor-position>The cursor is here. No text is selected.</cursor-position>',
    `<context-after>${escapePromptXml(contextAfter)}</context-after>`,
    '',
    'Guidelines:',
    '- When asked to modify text, call suggest_edit with the replacement. Then explain what you changed in 1-2 sentences.',
    '- When asked to insert text with no selection, call suggest_edit with the text to insert.',
    '- When asked a question, answer directly. Use fs_read if you need more document context.',
    '- Be precise and concise. These are senior researchers.',
  ].join('\n')
}

function buildGhostSystemPrompt(before: string) {
  const citationHint = detectCitationContext(before)
    ? '\n- The user appears to be citing. Suggest a citation in [@key] format if appropriate.'
    : ''

  return `You are an inline completion engine for a markdown editor.
Return JSON only: { "suggestions": ["...", "...", "..."] }
Rules:
- Predict text at <cursor/> that fits naturally between prefix and suffix.
- Match the writer's style. Include leading whitespace/newlines when needed.
- Return 3 to 5 suggestions, each 1 word to 3 sentences.
- Do not repeat text from suffix. Use placeholders like [citation] when needed.${citationHint}`
}

export function buildTaskLabelSystemPrompt() {
  return [
    'Generate a compact task label for a sidebar tab in Mim.',
    '',
    'The label helps a non-technical user distinguish this active task from other parallel tasks.',
    'Optimize for recognition in a work queue, not for an article headline.',
    '',
    'Rules:',
    '- Use 2 to 4 words. Target 3 words when natural.',
    '- Prefer a compact noun phrase with the distinguishing object. Use an action verb only when it is essential.',
    '- For option, comparison, or recommendation questions, use the object plus "options"; e.g. "Weather API options", not "Evaluate weather API options".',
    '- Preserve specific nouns, document names, file names, app names, train lines, issue IDs, invoice numbers, people, organizations, dates, routes, and model names when they help recognition.',
    '- Use the user\'s language.',
    '- Avoid filler verbs like Evaluate, Investigate, Explore, Discuss, Determine, and Help.',
    '- Do not use generic words like Chat, Task, Help, Question, Conversation, or Discussion.',
    '- Do not mention AI, assistant, or model unless the user is explicitly working on those things.',
    '- No quotes. No trailing punctuation.',
    '',
    'Good labels:',
    '- Manuscript comments',
    '- Donor update draft',
    '- Supplier quote comparison',
    '- Interview notes summary',
    '- RB24 disruptions',
    '- Board agenda',
    '- Survey responses',
    '- Weather API options',
    '- Session labels',
    '- Export failure',
  ].join('\n')
}

export function buildTaskLabelPrompt({
  userText,
  contextLabels = [],
}: {
  userText: string
  contextLabels?: string[]
}) {
  const labels = cleanContextLabels(contextLabels)
  return [
    `<user-request>${escapePromptXml(String(userText || '').slice(0, 600))}</user-request>`,
    labels.length
      ? `<context-labels>\n${labels.map(label => `- ${escapePromptXml(label)}`).join('\n')}\n</context-labels>`
      : '<context-labels />',
  ].join('\n\n')
}

export function cleanTaskLabel(value: unknown): string {
  const text = String(value || '')
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/^(task|label|title)\s*:\s*/i, '')
    .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
    .replace(/[.!?:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text) return ''
  if (/^(chat|task|help|question|conversation|discussion)$/i.test(text)) return ''
  return truncateTaskLabel(text)
}

function truncateTaskLabel(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TASK_LABEL_WORDS)
    .join(' ')
    .slice(0, MAX_TASK_LABEL_CHARS)
    .trim()
}

function cleanContextLabels(labels: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of labels) {
    const label = String(raw || '').replace(/\s+/g, ' ').trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label.slice(0, 120))
    if (out.length >= 8) break
  }
  return out
}

const CITATION_TRIGGERS = [
  'as shown by', 'according to', 'demonstrated by', 'as described by',
  'as reported by', 'as noted by', 'building on', 'consistent with',
  'in line with', 'as proposed by', 'previous work', 'prior work',
  'recent work', 'has been shown', 'et al.',
]

function detectCitationContext(text: string) {
  const tail = String(text || '').slice(-120).toLowerCase()
  return CITATION_TRIGGERS.some(trigger => tail.includes(trigger))
}

function escapePromptXml(text: string) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function cleanSuggestions(suggestions: unknown): string[] {
  if (!Array.isArray(suggestions)) return []
  const seen = new Set<string>()
  const clean: string[] = []
  for (const item of suggestions) {
    if (typeof item !== 'string') continue
    const normalized = item.replace(/\r\n/g, '\n')
    if (!normalized.trim()) continue
    const key = normalized.trim()
    if (seen.has(key)) continue
    seen.add(key)
    clean.push(normalized)
  }
  return clean.slice(0, 5)
}

export interface UsageSummary {
  inputTokens: number
  inputNoCacheTokens: number
  cachedInputTokens: number
  cacheReadInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  estimatedCost: number
}

function emptyUsage(): UsageSummary {
  return {
    inputTokens: 0,
    inputNoCacheTokens: 0,
    cachedInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  }
}

// One trace event per single-shot model call (ghost, task-label, summary).
// Chat/inline turns emit per-step model.call events from onStepFinish instead.
function traceModelCall(
  tools: ToolRegistry,
  profile: string,
  modelConfig: ModelConfig,
  usage: unknown,
  durationMs: number,
): void {
  tools.trace.append({
    kind: 'model.call',
    actor: 'ai',
    model: modelConfig.model,
    durationMs,
    data: { profile, ...normalizeSdkUsage(usage, modelConfig) },
  })
}

export function normalizeSdkUsage(usage: unknown, modelConfig: ModelConfig): UsageSummary {
  const record = (usage || {}) as Record<string, unknown>
  const input = normalizeInputTokens(record)
  const output = normalizeOutputTokens(record)
  const totalTokens = numberOrZero(record.totalTokens) || input.total + output.total
  const pricing = modelConfig.pricing || {}
  const estimatedCost =
    (input.noCache / 1_000_000) * inputPrice(modelConfig) +
    (input.cacheRead / 1_000_000) * cacheReadPrice(modelConfig) +
    (input.cacheWrite / 1_000_000) * cacheWritePrice(modelConfig) +
    (output.total / 1_000_000) * numberOrZero(pricing.outputPerMillion)

  return {
    inputTokens: input.total,
    inputNoCacheTokens: input.noCache,
    cachedInputTokens: input.cacheRead,
    cacheReadInputTokens: input.cacheRead,
    cacheWriteInputTokens: input.cacheWrite,
    outputTokens: output.total,
    reasoningTokens: output.reasoning,
    totalTokens,
    estimatedCost,
  }
}

export function addUsage(a?: Partial<UsageSummary> | null, b?: Partial<UsageSummary> | null): UsageSummary {
  return {
    inputTokens: numberOrZero(a?.inputTokens) + numberOrZero(b?.inputTokens),
    inputNoCacheTokens: numberOrZero(a?.inputNoCacheTokens) + numberOrZero(b?.inputNoCacheTokens),
    cachedInputTokens: numberOrZero(a?.cachedInputTokens) + numberOrZero(b?.cachedInputTokens),
    cacheReadInputTokens: numberOrZero(a?.cacheReadInputTokens) + numberOrZero(b?.cacheReadInputTokens),
    cacheWriteInputTokens: numberOrZero(a?.cacheWriteInputTokens) + numberOrZero(b?.cacheWriteInputTokens),
    outputTokens: numberOrZero(a?.outputTokens) + numberOrZero(b?.outputTokens),
    reasoningTokens: numberOrZero(a?.reasoningTokens) + numberOrZero(b?.reasoningTokens),
    totalTokens: numberOrZero(a?.totalTokens) + numberOrZero(b?.totalTokens),
    estimatedCost: numberOrZero(a?.estimatedCost) + numberOrZero(b?.estimatedCost),
  }
}

export function summarizeTurnUsage(steps: Array<Partial<UsageSummary>>): { usage: UsageSummary; contextTokens: number } {
  let usage = emptyUsage()
  let contextTokens = 0
  for (const step of steps) {
    usage = addUsage(usage, step)
    contextTokens = Math.max(contextTokens, numberOrZero(step.inputTokens))
  }
  return { usage, contextTokens }
}

function normalizeInputTokens(usage: Record<string, unknown>) {
  const source = usage.inputTokens ?? usage.promptTokens
  const total = tokenNumber(source, 'total')
  const cacheRead = firstNumber(
    tokenNumber(source, 'cacheRead'),
    (usage.inputTokenDetails as Record<string, unknown> | undefined)?.cacheReadTokens,
    (usage.inputTokenDetails as Record<string, unknown> | undefined)?.cachedTokens,
    usage.cachedInputTokens,
  )
  const cacheWrite = firstNumber(
    tokenNumber(source, 'cacheWrite'),
    (usage.inputTokenDetails as Record<string, unknown> | undefined)?.cacheWriteTokens,
    usage.cacheCreationInputTokens,
  )
  const noCache = firstNumber(
    tokenNumber(source, 'noCache'),
    usage.inputNoCacheTokens,
    Math.max(0, total - cacheRead - cacheWrite),
  )

  return { total, noCache, cacheRead, cacheWrite }
}

function normalizeOutputTokens(usage: Record<string, unknown>) {
  const source = usage.outputTokens ?? usage.completionTokens
  const total = tokenNumber(source, 'total')
  const reasoning = firstNumber(
    tokenNumber(source, 'reasoning'),
    (usage.outputTokenDetails as Record<string, unknown> | undefined)?.reasoningTokens,
    usage.reasoningTokens,
  )

  return { total, reasoning }
}

function tokenNumber(value: unknown, key: string) {
  if (value && typeof value === 'object') return numberOrZero((value as Record<string, unknown>)[key])
  if (key === 'total') return numberOrZero(value)
  return 0
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const number = numberOrZero(value)
    if (number > 0) return number
  }
  return 0
}

function inputPrice(modelConfig: ModelConfig) {
  return numberOrZero(modelConfig.pricing?.inputPerMillion)
}

function cacheReadPrice(modelConfig: ModelConfig) {
  const explicit = numberOrZero(modelConfig.pricing?.cacheReadInputPerMillion)
  if (explicit > 0) return explicit
  if (modelConfig.provider === 'anthropic') return inputPrice(modelConfig) * 0.1
  return inputPrice(modelConfig)
}

function cacheWritePrice(modelConfig: ModelConfig) {
  const explicit = numberOrZero(modelConfig.pricing?.cacheWriteInputPerMillion)
  if (explicit > 0) return explicit
  if (modelConfig.provider === 'anthropic') return inputPrice(modelConfig) * 1.25
  return inputPrice(modelConfig)
}

function numberOrZero(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}
