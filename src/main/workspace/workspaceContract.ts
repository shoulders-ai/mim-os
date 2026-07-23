// Workspace contract: mim.yaml schema/parser, init detection, scaffold.
// No Electron imports — unit-testable.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export type MimSyncMode = 'manual' | 'managed'

export interface MimSyncConfig {
  mode?: MimSyncMode
  remote?: string
}

export interface MimConfig {
  name: string
  // Explicit Project sync mode. Omitted means infer safe defaults.
  sync?: MimSyncConfig
}

const SYNC_MODES: MimSyncMode[] = ['manual', 'managed']

export type ContractFile = 'mim.yaml' | 'AGENTS.md' | 'CLAUDE.md'

export interface WorkspaceClassification {
  initialized: boolean
  missing: ContractFile[]
  present: ContractFile[]
}

const CONTRACT_FILES: ContractFile[] = ['mim.yaml', 'AGENTS.md', 'CLAUDE.md']

export const MIM_INSTRUCTIONS_TEMPLATE = `# Agent Instructions

You are the AI agent in Mim, a workspace kernel for research teams. Mim runs as an Electron desktop app with three core surfaces: Chat (you), Editor (document viewer/editor), and Terminal (shell).

Be precise and concise. Flag uncertainty. Never fabricate citations.

Mim may show progress while you work. After finishing, progress may be collapsed. Make the final response stand on its own, including anything important the user needs to know.

Today is {{DATE_TODAY}}.

## Workspace

The workspace is a directory on the user's machine. Committed layout:
- mim.yaml — Project config (name and sync)
- AGENTS.md — the durable contract for any agent working here
- CLAUDE.md — contract pointer (usually references AGENTS.md)
- issues/ — issue records, one markdown file each (present when the issues app is enabled)
- knowledge/ — knowledge records, one markdown file each (present when the knowledge app is enabled)
- packages/ — Project apps (UI extensions)

Runtime (gitignored, not committed):
- .mim/ — runtime config, event log, chat sessions, and agent-context.md (the volatile current-state digest)

You can read, write, and manage files within the workspace. File mutation tools perform the real filesystem action after the system permission gate allows them. If approval is required, the tool call pauses until the user approves or denies it.

## Tools

{{TOOL_SET}}

## Apps

Apps are UI extensions that run in sandboxed iframes. Each app lives in packages/{id}/ and contains:
- package.json — manifest with id, name, description, icon, ui path
- ui/index.html — the UI entry point

Apps use the SDK at /sdk/mim.js to interact with the kernel:

\`\`\`html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/sdk/tokens.css">
</head>
<body>
  <script type="module">
    import { runtime } from '/sdk/mim.js'

    // Call any tool
    const files = await runtime.call('fs.list', { path: '.' })

    // Listen for events
    runtime.on('packages:changed', (data) => { /* ... */ })
  </script>
</body>
</html>
\`\`\`

When the user asks you to build a UI, create an app. Use plain HTML + JS with the SDK. The tokens.css file provides design tokens that follow the user's theme. Always use var(--color-*), var(--font-*), var(--radius-*), and var(--space-*) — never hardcode colors or fonts.

## Skills

{{SKILL_CATALOG}}

## Workspace rules

- Treat files in this folder as the shared source of truth.
- Committed contract files are \`mim.yaml\`, \`AGENTS.md\`, and \`CLAUDE.md\`. Keep them deterministic; do not write volatile state (dates, inbox/calendar summaries, secrets) into them.
- Runtime state lives in \`.mim/\` and is gitignored. Do not commit it.
- Issues live in \`issues/\` and knowledge in \`knowledge/\` when those folders exist. They are optional.
- Attached-file context blocks with a \`path\` attribute identify a workspace-relative file path; use that path with fs.* tools when you need to inspect or edit the file. Direct attachments may only have a name.

## Workspace context

{{AGENT_CONTEXT}}

## Workspace tree

{{WORKSPACE_TREE}}

## Project log

Use \`log_append\` only for durable activity notes that future work should see, such as decisions, handoffs, blockers, or commitments; do not log routine progress or implementation chatter.

{{PROJECT_LOG}}

## Conventions

- Make focused, reviewable changes.
- Prefer existing files and patterns over introducing new ones.
`

export const DEFAULT_PROJECT_AGENTS_MD = `# Project Instructions

Add durable guidance that is specific to this Project.
`

export const DEFAULT_CLAUDE_MD = '@AGENTS.md\n'
export const GITIGNORE_ENTRIES = ['.mim/']

export function parseMimYaml(text: string): MimConfig {
  const raw = (parseYaml(text) ?? {}) as Record<string, unknown>
  const config: MimConfig = { name: typeof raw.name === 'string' ? raw.name : '' }
  const sync = parseSync(raw.sync)
  if (sync) config.sync = sync
  return config
}

function parseSync(raw: unknown): MimSyncConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = raw as Record<string, unknown>
  const out: MimSyncConfig = {}
  if (SYNC_MODES.includes(source.mode as MimSyncMode)) out.mode = source.mode as MimSyncMode
  if (typeof source.remote === 'string' && source.remote.trim()) out.remote = source.remote.trim()
  return out.mode || out.remote ? out : undefined
}

export function serializeMimYaml(config: MimConfig): string {
  // Only emit known keys; omit undefined optionals. No version field.
  const out: Record<string, unknown> = { name: config.name }
  const sync = serializeSync(config.sync)
  if (sync) out.sync = sync
  return stringifyYaml(out)
}

function serializeSync(sync: MimSyncConfig | undefined): MimSyncConfig | undefined {
  if (!sync) return undefined
  const out: MimSyncConfig = {}
  if (SYNC_MODES.includes(sync.mode as MimSyncMode)) out.mode = sync.mode
  if (sync.remote !== undefined && sync.remote.trim()) out.remote = sync.remote.trim()
  return out.mode || out.remote ? out : undefined
}

export function defaultMimYaml(name: string): string {
  return serializeMimYaml({ name })
}

export function classifyWorkspace(dir: string): WorkspaceClassification {
  const present: ContractFile[] = []
  const missing: ContractFile[] = []
  for (const file of CONTRACT_FILES) {
    if (existsSync(join(dir, file))) present.push(file)
    else missing.push(file)
  }
  return { initialized: missing.length === 0, missing, present }
}

export function scaffoldWorkspace(dir: string, opts: { name: string }): { created: string[] } {
  const created: string[] = []

  const mimYamlPath = join(dir, 'mim.yaml')
  if (!existsSync(mimYamlPath)) {
    writeFileSync(mimYamlPath, defaultMimYaml(opts.name))
    created.push('mim.yaml')
  }

  const agentsPath = join(dir, 'AGENTS.md')
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, DEFAULT_PROJECT_AGENTS_MD)
    created.push('AGENTS.md')
  }

  const claudePath = join(dir, 'CLAUDE.md')
  if (!existsSync(claudePath)) {
    writeFileSync(claudePath, DEFAULT_CLAUDE_MD)
    created.push('CLAUDE.md')
  }

  const mimDir = join(dir, '.mim')
  if (!existsSync(mimDir)) {
    mkdirSync(mimDir, { recursive: true })
    created.push('.mim/')
  }

  ensureWorkspaceGitignore(dir)

  return { created }
}

export function ensureWorkspaceGitignore(dir: string): void {
  const gitignorePath = join(dir, '.gitignore')
  let lines: string[] = []
  let existed = false
  if (existsSync(gitignorePath)) {
    existed = true
    lines = readFileSync(gitignorePath, 'utf-8').split('\n')
  }
  const present = new Set(lines.map(l => l.trim()))
  let changed = false
  for (const entry of GITIGNORE_ENTRIES) {
    if (!present.has(entry)) {
      lines.push(entry)
      present.add(entry)
      changed = true
    }
  }
  if (!existed || changed) {
    // Normalize to a single trailing newline without duplicating blank lines.
    const body = lines.filter((l, i) => !(l === '' && i === lines.length - 1)).join('\n')
    writeFileSync(gitignorePath, body.endsWith('\n') ? body : body + '\n')
  }
}
