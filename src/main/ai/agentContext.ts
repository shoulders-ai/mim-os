import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { detectToolchain, type ToolchainEntry } from '@main/toolchain/toolchain.js'
import { spawnSync } from 'child_process'
import { basename, join } from 'path'
import { classifyWorkspace, parseMimYaml } from '@main/workspace/workspaceContract.js'
import { computeTraceStatsSync, renderTraceHealth } from '@main/trace/query.js'

export interface AgentContextTeam {
  name: string
  filesPath: string
}

export interface AgentContextApp {
  id: string
  enabled: boolean
}

export interface AgentContextAppSection {
  appId: string
  title: string
  body: string
}

export type AgentContextContributionsProvider = (workspacePath: string) => Promise<AgentContextAppSection[]>

export interface AgentContextLocalPackage {
  id: string
  name?: string
  enabled: boolean
  loaded: boolean
  tools: number
  jobs: number
  skills: number
  diagnostics: string[]
}

export type AgentContextLocalPackagesProvider = (workspacePath: string) => Promise<AgentContextLocalPackage[]>

export interface AgentContextData {
  workspace: { name: string; path: string; initialized: boolean }
  generatedAt: string
  apps: AgentContextApp[]
  team?: AgentContextTeam
  appSections?: AgentContextAppSection[]
  localPackages?: AgentContextLocalPackage[]
  toolchain?: string[]
  traceHealth?: string[]
  recentChanges: string[]
}

export interface AgentContextDeps {
  now?: () => number
  readRecentChanges?: (cwd: string, limit: number) => string[]
  readTeam?: (workspacePath: string) => AgentContextTeam | null
  resolveApps?: (workspacePath: string) => AgentContextApp[]
  readTraceHealth?: (workspacePath: string) => string[]
  readToolchain?: () => Promise<ToolchainEntry[]>
}

let defaultReadTeam: ((workspacePath: string) => AgentContextTeam | null) | null = null

export function setAgentContextTeamReader(
  reader: ((workspacePath: string) => AgentContextTeam | null) | null,
): void {
  defaultReadTeam = reader
}

let defaultResolveApps: ((workspacePath: string) => AgentContextApp[]) | null = null

export function setAgentContextAppsResolver(
  resolver: ((workspacePath: string) => AgentContextApp[]) | null,
): void {
  defaultResolveApps = resolver
}

let defaultContributionsProvider: AgentContextContributionsProvider | null = null

export function setAgentContextContributionsProvider(
  provider: AgentContextContributionsProvider | null,
): void {
  defaultContributionsProvider = provider
}

let defaultLocalPackagesProvider: AgentContextLocalPackagesProvider | null = null

export function setAgentContextLocalPackagesProvider(
  provider: AgentContextLocalPackagesProvider | null,
): void {
  defaultLocalPackagesProvider = provider
}

const RECENT_CHANGES_LIMIT = 8
const APP_SECTION_MAX_TITLE = 80
const APP_SECTION_MAX_BODY = 1500
const APP_SECTION_MAX_COUNT = 8
const CONTRIBUTIONS_TIMEOUT_MS = 3000
const LOCAL_PACKAGE_DIAGNOSTIC_MAX = 120

function titleOf(title: string): string {
  return title.trim() === '' ? '(untitled)' : title.trim()
}

export function renderAgentContext(data: AgentContextData): string {
  const date = data.generatedAt.slice(0, 10)
  const lines: string[] = []

  lines.push('> Generated runtime context. Volatile and may be stale. Not part of the committed contract.')
  lines.push('')
  lines.push(`# Workspace context: ${data.workspace.name} (${date})`)
  lines.push('')
  const enabled = [...data.apps]
    .filter(a => a.enabled)
    .map(a => a.id)
    .sort()
  lines.push(`Apps enabled: ${enabled.length > 0 ? enabled.join(', ') : 'none'}`)

  if (data.toolchain && data.toolchain.length > 0) {
    lines.push('')
    lines.push('## Toolchain')
    for (const entry of data.toolchain) {
      lines.push(`- ${entry}`)
    }
  }

  if (data.appSections && data.appSections.length > 0) {
    const sorted = [...data.appSections].sort((a, b) => a.appId.localeCompare(b.appId))
    for (const section of sorted) {
      lines.push('')
      lines.push(`## ${section.title}`)
      lines.push(section.body)
    }
  }

  if (data.localPackages && data.localPackages.length > 0) {
    lines.push('')
    lines.push('## Local apps (development)')
    const sorted = [...data.localPackages].sort((a, b) => a.id.localeCompare(b.id))
    for (const pkg of sorted) {
      if (pkg.diagnostics.length > 0) {
        lines.push(`- ${pkg.id}: ${formatLocalPackageDiagnostic(pkg.diagnostics[0])}`)
        continue
      }
      const counts = [
        `${pkg.tools} ${pkg.tools === 1 ? 'tool' : 'tools'}`,
        `${pkg.jobs} ${pkg.jobs === 1 ? 'job' : 'jobs'}`,
        `${pkg.skills} ${pkg.skills === 1 ? 'skill' : 'skills'}`,
      ].join(', ')
      lines.push(`- ${pkg.id}: ${counts} - ${pkg.enabled ? 'enabled' : 'disabled'}, ${pkg.loaded ? 'loaded' : 'not loaded'}`)
    }
  }

  if (data.team) {
    lines.push('')
    lines.push(`## Team: ${titleOf(data.team.name)}`)
    lines.push(`Shared files are writable with normal fs.* tools at ${data.team.filesPath}.`)
  }

  if (data.traceHealth && data.traceHealth.length > 0) {
    lines.push('')
    lines.push('## Observability health')
    for (const item of data.traceHealth) {
      lines.push(`- ${item}`)
    }
  }

  lines.push('')
  lines.push('## Recent changes')
  if (data.recentChanges.length === 0) {
    lines.push('No recent commits (or not a git repo).')
  } else {
    for (const subject of data.recentChanges) {
      lines.push(`- ${subject}`)
    }
  }

  return lines.join('\n') + '\n'
}

function formatLocalPackageDiagnostic(message: string): string {
  const firstLine = message.split('\n')[0].trim()
  if (firstLine.length <= LOCAL_PACKAGE_DIAGNOSTIC_MAX) return firstLine
  return firstLine.slice(0, LOCAL_PACKAGE_DIAGNOSTIC_MAX) + '...'
}

function resolveAppsFromCommitted(workspacePath: string): AgentContextApp[] {
  const mimYamlPath = join(workspacePath, 'mim.yaml')
  if (!existsSync(mimYamlPath)) return []
  try {
    const config = parseMimYaml(readFileSync(mimYamlPath, 'utf-8'))
    if (!config.apps) return []
    return Object.keys(config.apps)
      .map((id) => ({
        id,
        enabled: false,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  } catch {
    return []
  }
}

function defaultReadRecentChanges(cwd: string, limit: number): string[] {
  try {
    const result = spawnSync(
      'git',
      ['-C', cwd, 'log', '-n', String(limit), '--format=%s'],
      { encoding: 'utf-8' },
    )
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return []
    return result.stdout
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function gatherAgentContext(workspacePath: string, deps: AgentContextDeps = {}): AgentContextData {
  const now = deps.now ?? Date.now
  const readRecentChanges = deps.readRecentChanges ?? defaultReadRecentChanges
  const nowMs = now()

  let name = basename(workspacePath)
  const mimYamlPath = join(workspacePath, 'mim.yaml')
  if (existsSync(mimYamlPath)) {
    try {
      const parsed = parseMimYaml(readFileSync(mimYamlPath, 'utf-8'))
      if (parsed.name) name = parsed.name
    } catch {
      // keep basename
    }
  }

  const resolveApps = deps.resolveApps ?? defaultResolveApps
  const apps = resolveApps
    ? resolveApps(workspacePath)
    : resolveAppsFromCommitted(workspacePath)

  const data: AgentContextData = {
    workspace: {
      name,
      path: workspacePath,
      initialized: classifyWorkspace(workspacePath).initialized,
    },
    generatedAt: new Date(nowMs).toISOString(),
    apps,
    recentChanges: readRecentChanges(workspacePath, RECENT_CHANGES_LIMIT),
  }

  const readTeam = deps.readTeam ?? defaultReadTeam
  if (readTeam) {
    try {
      data.team = readTeam(workspacePath) ?? undefined
    } catch {
      // best-effort
    }
  }

  const readTraceHealth = deps.readTraceHealth ?? defaultReadTraceHealth
  try {
    const traceHealth = readTraceHealth(workspacePath)
    if (traceHealth.length > 0) data.traceHealth = traceHealth
  } catch {
    // best-effort
  }

  return data
}

function defaultReadTraceHealth(workspacePath: string): string[] {
  const stats = computeTraceStatsSync(workspacePath, { days: 7 })
  return renderTraceHealth(stats)
}

function capSections(raw: AgentContextAppSection[]): AgentContextAppSection[] {
  const capped: AgentContextAppSection[] = []
  for (const s of raw) {
    if (capped.length >= APP_SECTION_MAX_COUNT) break
    const body = s.body?.trim() ?? ''
    if (!body) continue
    // Title: first line only, capped at 80 chars
    let title = (s.title ?? '').split('\n')[0].trim()
    if (title.length > APP_SECTION_MAX_TITLE) title = title.slice(0, APP_SECTION_MAX_TITLE)
    // Body: capped at 1500 chars with truncation marker
    const cappedBody = body.length > APP_SECTION_MAX_BODY
      ? body.slice(0, APP_SECTION_MAX_BODY) + '…'
      : body
    capped.push({ appId: s.appId, title, body: cappedBody })
  }
  return capped
}

export async function writeAgentContext(
  workspacePath: string,
  deps: AgentContextDeps = {},
): Promise<{ path: string; content: string }> {
  if (!workspacePath) throw new Error('No workspace open')
  const data = gatherAgentContext(workspacePath, deps)

  // Gather app-contributed sections under a timeout; best-effort only. The
  // timer is cleared so a fast provider doesn't hold the event loop open
  // (matters for headless CLI process exit).
  const provider = defaultContributionsProvider
  if (provider) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CONTRIBUTIONS_TIMEOUT_MS)
      })
      const sections = await Promise.race([provider(workspacePath), timeout])
      if (Array.isArray(sections)) {
        data.appSections = capSections(sections)
      }
    } catch {
      // best-effort: proceed without sections
    } finally {
      clearTimeout(timer)
    }
  }

  const localPackagesProvider = defaultLocalPackagesProvider
  if (localPackagesProvider) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CONTRIBUTIONS_TIMEOUT_MS)
      })
      const localPackages = await Promise.race([localPackagesProvider(workspacePath), timeout])
      if (Array.isArray(localPackages) && localPackages.length > 0) {
        data.localPackages = localPackages
      }
    } catch {
      // best-effort: proceed without development app status
    } finally {
      clearTimeout(timer)
    }
  }

  // Populate toolchain detection lines (promise-cached, cheap after first call).
  try {
    const readToolchain = deps.readToolchain ?? (() => detectToolchain())
    const entries = await readToolchain()
    const lines: string[] = []
    for (const entry of entries) {
      if (entry.installed) {
        if (entry.version) {
          lines.push(`${entry.bin} ${entry.version} - ${entry.binPath}`)
        } else {
          lines.push(`${entry.bin} - ${entry.binPath}`)
        }
      } else {
        lines.push(`${entry.bin} - not found`)
      }
    }
    if (existsSync(join(workspacePath, 'renv.lock'))) {
      lines.push('renv.lock present')
    }
    if (lines.length > 0) {
      data.toolchain = lines
    }
  } catch {
    // best-effort: proceed without toolchain section
  }

  const content = renderAgentContext(data)
  const mimDir = join(workspacePath, '.mim')
  mkdirSync(mimDir, { recursive: true })
  const path = join(mimDir, 'agent-context.md')
  writeFileSync(path, content)
  return { path, content }
}
