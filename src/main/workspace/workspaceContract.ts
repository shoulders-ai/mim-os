// Workspace contract: mim.yaml schema/parser, init detection, scaffold.
// No Electron imports — unit-testable.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export interface MimAppEntry {
  source?: string
  /** Repo-relative subdirectory holding the package; repo root when absent. */
  path?: string
  version?: string
  enabled?: boolean
}

export type MimAppsConfig = Record<string, boolean | MimAppEntry>

export interface MimSkillsConfig {
  disabled?: string[]
}

export type CollectionWritePolicy = 'readonly' | 'direct'

// One committed shared-resource collection. `git` makes it a portable git
// source; without `git` it is an expectation each machine satisfies with a
// local path binding in .mim/resources.json. Local paths never belong here —
// they do not travel between machines. See docs/resources.md.
export interface MimCollectionConfig {
  name?: string
  git?: string
  write?: CollectionWritePolicy
}

// One committed registry source. Exactly one of `git` (HTTPS, credential-free),
// `path` (workspace-relative dir containing index.json), or `url` (direct HTTPS
// URL to an index.json file) must be present. Reserved ids: `default`, `user`.
export interface MimRegistryConfig {
  name?: string
  git?: string
  path?: string
  url?: string
}

export type MimSyncMode = 'manual' | 'managed'

export interface MimSyncConfig {
  mode?: MimSyncMode
  remote?: string
}

export interface MimConfig {
  name: string
  google?: string
  slack?: string
  apps?: MimAppsConfig
  skills?: MimSkillsConfig
  // Committed shared-resource collections, keyed by kebab-case slug id.
  collections?: Record<string, MimCollectionConfig>
  // Committed registry sources, keyed by kebab-case slug id.
  registries?: Record<string, MimRegistryConfig>
  // Explicit workspace sync mode. Omitted means infer safe defaults.
  sync?: MimSyncConfig
}

const COLLECTION_WRITE_POLICIES: CollectionWritePolicy[] = ['readonly', 'direct']
const SYNC_MODES: MimSyncMode[] = ['manual', 'managed']
export const COLLECTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
export const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,59}$/
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

const RESERVED_REGISTRY_IDS = new Set(['default', 'user'])

// Mirrors isValidPackagePath in registryIndex.ts (duplicated to avoid a
// workspace → packages import cycle).
const REGISTRY_PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
function isValidRegistryPath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false
  return path.split('/').every(segment => REGISTRY_PATH_SEGMENT_RE.test(segment))
}

export type ContractFile = 'mim.yaml' | 'AGENTS.md' | 'CLAUDE.md'

export interface WorkspaceClassification {
  initialized: boolean
  missing: ContractFile[]
  present: ContractFile[]
}

const CONTRACT_FILES: ContractFile[] = ['mim.yaml', 'AGENTS.md', 'CLAUDE.md']

export const DEFAULT_AGENTS_MD = `# Agent Instructions

You are the AI agent in Mim, a workspace kernel for research teams. Mim runs as an Electron desktop app with three core surfaces: Chat (you), Editor (document viewer/editor), and Terminal (shell).

Be precise and concise. Flag uncertainty. Never fabricate citations.

Mim may show progress while you work. After finishing, progress may be collapsed. Make the final response stand on its own, including anything important the user needs to know.

Today is {{DATE_TODAY}}.

## Workspace

The workspace is a directory on the user's machine. Committed layout:
- mim.yaml — workspace config (name, enabled core apps)
- AGENTS.md — the durable contract for any agent working here
- CLAUDE.md — contract pointer (usually references AGENTS.md)
- issues/ — issue records, one markdown file each (present when the issues app is enabled)
- knowledge/ — knowledge records, one markdown file each (present when the knowledge app is enabled)
- packages/ — installed apps (UI extensions)

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

When the user asks you to build a UI, create an app. Use plain HTML + JS with the SDK. The tokens.css file provides design tokens (--color-ink, --color-accent, --font-sans, etc.) so apps match the Mim aesthetic.

## Skills

{{SKILL_CATALOG}}

## Workspace rules

- Treat files in this folder as the shared source of truth.
- Committed contract files are \`mim.yaml\`, \`AGENTS.md\`, and \`CLAUDE.md\`. Keep them deterministic; do not write volatile state (dates, inbox/calendar summaries, secrets) into them.
- Runtime state lives in \`.mim/\` and is gitignored. Do not commit it.
- Issues live in \`issues/\` and knowledge in \`knowledge/\` when those folders exist. They are optional.

## Workspace context

{{AGENT_CONTEXT}}

## Conventions

- Make focused, reviewable changes.
- Prefer existing files and patterns over introducing new ones.
`

export const DEFAULT_CLAUDE_MD = '@AGENTS.md\n'
export const GITIGNORE_ENTRIES = ['.mim/']

export function parseMimYaml(text: string): MimConfig {
  const raw = (parseYaml(text) ?? {}) as Record<string, unknown>
  const config: MimConfig = { name: typeof raw.name === 'string' ? raw.name : '' }
  if (typeof raw.google === 'string') config.google = raw.google
  if (typeof raw.slack === 'string') config.slack = raw.slack
  const apps = parseApps(raw.apps)
  if (apps) config.apps = apps
  const skills = parseSkills(raw.skills)
  if (skills) config.skills = skills
  const collections = parseCollections(raw.collections)
  if (collections) config.collections = collections
  const registries = parseRegistries(raw.registries)
  if (registries) config.registries = registries
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

function parseSkills(raw: unknown): MimSkillsConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const source = raw as Record<string, unknown>
  const disabled = Array.isArray(source.disabled)
    ? [...new Set(source.disabled
        .filter((item): item is string => typeof item === 'string' && SKILL_NAME_PATTERN.test(item))
        .sort())]
    : []
  return disabled.length > 0 ? { disabled } : undefined
}

// Tolerant: invalid ids, non-object entries, unknown entry keys, and invalid
// write policies are dropped rather than failing the whole file.
function parseCollections(raw: unknown): Record<string, MimCollectionConfig> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, MimCollectionConfig> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!COLLECTION_ID_PATTERN.test(id)) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const source = value as Record<string, unknown>
    const entry: MimCollectionConfig = {}
    if (typeof source.name === 'string') entry.name = source.name
    if (typeof source.git === 'string') entry.git = source.git
    if (COLLECTION_WRITE_POLICIES.includes(source.write as CollectionWritePolicy)) {
      entry.write = source.write as CollectionWritePolicy
    }
    out[id] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

// Tolerant: invalid ids, reserved ids, non-object entries, entries with
// both/neither git+path, credential URLs, absolute/traversal paths are
// dropped rather than failing the whole file.
function parseRegistries(raw: unknown): Record<string, MimRegistryConfig> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, MimRegistryConfig> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!COLLECTION_ID_PATTERN.test(id)) continue
    if (RESERVED_REGISTRY_IDS.has(id)) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const source = value as Record<string, unknown>
    const hasGit = typeof source.git === 'string'
    const hasPath = typeof source.path === 'string'
    const hasUrl = typeof source.url === 'string'
    // Exactly one of git | path | url required.
    const kindCount = Number(hasGit) + Number(hasPath) + Number(hasUrl)
    if (kindCount !== 1) continue
    const entry: MimRegistryConfig = {}
    if (typeof source.name === 'string') entry.name = source.name
    if (hasGit) {
      const git = source.git as string
      // Must be https:// and credential-free.
      try {
        const u = new URL(git)
        if (u.protocol !== 'https:') continue
        if (u.username || u.password) continue
      } catch {
        continue
      }
      entry.git = git
    }
    if (hasPath) {
      const path = source.path as string
      // Must be relative, no backslashes, traversal-safe.
      if (/\\/.test(path)) continue
      if (!isValidRegistryPath(path)) continue
      entry.path = path
    }
    if (hasUrl) {
      const url = source.url as string
      // Must be https:// and credential-free.
      try {
        const u = new URL(url)
        if (u.protocol !== 'https:') continue
        if (u.username || u.password) continue
      } catch {
        continue
      }
      entry.url = url
    }
    out[id] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export const LEGACY_APP_KEYS = ['issues'] as const

function parseApps(raw: unknown): MimAppsConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const apps: MimAppsConfig = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if ((LEGACY_APP_KEYS as readonly string[]).includes(id)) continue
    if (!PACKAGE_ID_PATTERN.test(id)) continue
    if (typeof value === 'boolean') {
      apps[id] = value
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const source = value as Record<string, unknown>
    const entry: MimAppEntry = {}
    if (typeof source.source === 'string') entry.source = source.source
    if (typeof source.path === 'string') entry.path = source.path
    if (typeof source.version === 'string') entry.version = source.version
    if (typeof source.enabled === 'boolean') entry.enabled = source.enabled
    apps[id] = entry
  }
  return Object.keys(apps).length > 0 ? apps : undefined
}

export function serializeMimYaml(config: MimConfig): string {
  // Only emit known keys; omit undefined optionals. No version field.
  const out: Record<string, unknown> = { name: config.name }
  if (config.google !== undefined) out.google = config.google
  if (config.slack !== undefined) out.slack = config.slack
  const apps = serializeApps(config.apps)
  if (apps) out.apps = apps
  const skills = serializeSkills(config.skills)
  if (skills) out.skills = skills
  const collections = serializeCollections(config.collections)
  if (collections) out.collections = collections
  const registries = serializeRegistries(config.registries)
  if (registries) out.registries = registries
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

function serializeSkills(skills: MimSkillsConfig | undefined): MimSkillsConfig | undefined {
  if (!skills) return undefined
  const disabled = Array.isArray(skills.disabled)
    ? [...new Set(skills.disabled.filter(name => SKILL_NAME_PATTERN.test(name)).sort())]
    : []
  return disabled.length > 0 ? { disabled } : undefined
}

function serializeCollections(
  collections: Record<string, MimCollectionConfig> | undefined,
): Record<string, MimCollectionConfig> | undefined {
  if (!collections) return undefined
  const out: Record<string, MimCollectionConfig> = {}
  for (const [id, entry] of Object.entries(collections)) {
    if (!COLLECTION_ID_PATTERN.test(id)) continue
    const clean: MimCollectionConfig = {}
    if (entry.name !== undefined) clean.name = entry.name
    if (entry.git !== undefined) clean.git = entry.git
    if (entry.write !== undefined) clean.write = entry.write
    out[id] = clean
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function serializeRegistries(
  registries: Record<string, MimRegistryConfig> | undefined,
): Record<string, MimRegistryConfig> | undefined {
  if (!registries) return undefined
  const out: Record<string, MimRegistryConfig> = {}
  for (const [id, entry] of Object.entries(registries)) {
    if (!COLLECTION_ID_PATTERN.test(id)) continue
    if (RESERVED_REGISTRY_IDS.has(id)) continue
    const clean: MimRegistryConfig = {}
    if (entry.name !== undefined) clean.name = entry.name
    if (entry.git !== undefined) clean.git = entry.git
    if (entry.path !== undefined) clean.path = entry.path
    if (entry.url !== undefined) clean.url = entry.url
    out[id] = clean
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function serializeApps(apps: MimAppsConfig | undefined): MimAppsConfig | undefined {
  if (!apps) return undefined
  const out: MimAppsConfig = {}
  for (const [id, value] of Object.entries(apps)) {
    if (!PACKAGE_ID_PATTERN.test(id)) continue
    if (typeof value === 'boolean') {
      out[id] = value
      continue
    }
    const entry: MimAppEntry = {}
    if (value.source !== undefined) entry.source = value.source
    if (value.path !== undefined) entry.path = value.path
    if (value.version !== undefined) entry.version = value.version
    if (value.enabled !== undefined) entry.enabled = value.enabled
    out[id] = entry
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function defaultMimYaml(name: string): string {
  return serializeMimYaml({ name })
}

export interface CommittedApp {
  enabled: boolean
  source?: string
  path?: string
  version?: string
}

function normalizeAppEntry(entry: boolean | MimAppEntry): CommittedApp {
  if (typeof entry === 'boolean') return { enabled: entry }
  const normalized: CommittedApp = { enabled: entry.enabled !== false }
  if (entry.source !== undefined) normalized.source = entry.source
  if (entry.path !== undefined) normalized.path = entry.path
  if (entry.version !== undefined) normalized.version = entry.version
  return normalized
}

export function readCommittedApp(dir: string, id: string): CommittedApp | null {
  const path = join(dir, 'mim.yaml')
  if (!existsSync(path)) return null
  try {
    const entry = parseMimYaml(readFileSync(path, 'utf-8')).apps?.[id]
    return entry === undefined ? null : normalizeAppEntry(entry)
  } catch {
    return null
  }
}

export function readAppEnabled(dir: string, id: string): boolean {
  return readCommittedApp(dir, id)?.enabled === true
}

export function setAppEnabled(dir: string, id: string, enabled: boolean): void {
  if (!PACKAGE_ID_PATTERN.test(id)) throw new Error(`Invalid app id: ${id}`)
  const path = join(dir, 'mim.yaml')
  let config: MimConfig
  if (existsSync(path)) {
    config = parseMimYaml(readFileSync(path, 'utf-8'))
  } else {
    config = { name: '' }
  }
  const apps: MimAppsConfig = { ...(config.apps ?? {}) }
  const existing = apps[id]
  if (existing !== undefined && typeof existing !== 'boolean') {
    apps[id] = { ...existing, enabled }
  } else {
    apps[id] = enabled
  }
  config.apps = apps
  writeFileSync(path, serializeMimYaml(config))
}

/**
 * Write (or update) the committed source pin for an app in mim.yaml.
 * Preserves an existing entry's enabled flag; enablement itself goes through
 * setAppEnabled so the add flow stays on the standard path.
 */
export function writeAppPin(
  dir: string,
  id: string,
  pin: { source: string; path?: string; version: string },
): void {
  if (!PACKAGE_ID_PATTERN.test(id)) throw new Error(`Invalid app id: ${id}`)
  const filePath = join(dir, 'mim.yaml')
  const config: MimConfig = existsSync(filePath)
    ? parseMimYaml(readFileSync(filePath, 'utf-8'))
    : { name: '' }
  const apps: MimAppsConfig = { ...(config.apps ?? {}) }
  const existing = apps[id]
  const entry: MimAppEntry = typeof existing === 'object' && existing !== null ? { ...existing } : {}
  if (typeof existing === 'boolean') entry.enabled = existing
  entry.source = pin.source
  if (pin.path !== undefined) entry.path = pin.path
  else delete entry.path
  entry.version = pin.version
  apps[id] = entry
  config.apps = apps
  writeFileSync(filePath, serializeMimYaml(config))
}

/**
 * Remove the committed app pin from mim.yaml.
 * Handles both boolean-form (`board: true`) and object-form entries.
 * No-op when the id is absent from the apps map.
 */
export function removeApp(dir: string, id: string): void {
  if (!PACKAGE_ID_PATTERN.test(id)) throw new Error(`Invalid app id: ${id}`)
  const path = join(dir, 'mim.yaml')
  if (!existsSync(path)) return
  const config = parseMimYaml(readFileSync(path, 'utf-8'))
  if (!config.apps || !(id in config.apps)) return
  const apps: MimAppsConfig = { ...config.apps }
  delete apps[id]
  config.apps = apps
  writeFileSync(path, serializeMimYaml(config))
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
    writeFileSync(agentsPath, DEFAULT_AGENTS_MD)
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

  mergeGitignore(dir)

  return { created }
}

function mergeGitignore(dir: string): void {
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
