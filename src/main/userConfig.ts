// User-global config: ~/.mim/config.yaml. Identity + model defaults only, no keys.
// No Electron imports — unit-testable.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { userHomeDir } from '@main/platform.js'

export interface SkillSourceConfig {
  name?: string
  git?: string
  path?: string
  trusted?: boolean
}

export interface UserConfig {
  user: { name?: string; email?: string; timezone?: string }
  defaults: {
    google?: string
    slack?: string
    models: { chat?: string; ghost?: string }
  }
  connectors: {
    slack?: Record<string, unknown>
  }
  registry: { url?: string }
  skillSources: Record<string, SkillSourceConfig>
  skills: { disabled: string[] }
}

export const DEFAULT_REGISTRY_URL = 'https://github.com/shoulders-ai/mim-apps.git'
export const DEFAULT_REGISTRY_INDEX_URL = 'https://raw.githubusercontent.com/shoulders-ai/mim-apps/refs/heads/main/index.json'
export const USER_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
export const USER_SKILL_SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

let cache: UserConfig | null = null

function emptyConfig(): UserConfig {
  return { user: {}, defaults: { models: {} }, connectors: {}, registry: {}, skillSources: {}, skills: { disabled: [] } }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function loadUserConfig(home?: string): UserConfig {
  if (cache) return cache

  const config = emptyConfig()
  try {
    const base = home ?? userHomeDir()
    const path = join(base, '.mim', 'config.yaml')
    if (existsSync(path)) {
      const raw = parseYaml(readFileSync(path, 'utf-8'))
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const r = raw as Record<string, unknown>
        const user = (r.user && typeof r.user === 'object') ? r.user as Record<string, unknown> : {}
        config.user.name = str(user.name)
        config.user.email = str(user.email)
        config.user.timezone = str(user.timezone)

        const defaults = (r.defaults && typeof r.defaults === 'object') ? r.defaults as Record<string, unknown> : {}
        config.defaults.google = str(defaults.google)
        config.defaults.slack = str(defaults.slack)
        const models = (defaults.models && typeof defaults.models === 'object') ? defaults.models as Record<string, unknown> : {}
        config.defaults.models.chat = str(models.chat)
        config.defaults.models.ghost = str(models.ghost)

        const registry = (r.registry && typeof r.registry === 'object') ? r.registry as Record<string, unknown> : {}
        config.registry.url = str(registry.url)

        const connectors = (r.connectors && typeof r.connectors === 'object' && !Array.isArray(r.connectors))
          ? r.connectors as Record<string, unknown>
          : {}
        if (connectors.slack && typeof connectors.slack === 'object' && !Array.isArray(connectors.slack)) {
          config.connectors.slack = connectors.slack as Record<string, unknown>
        }

        config.skillSources = parseSkillSources(r.skillSources)
        config.skills.disabled = parseDisabledSkillNames(r.skills)
      }
    }
  } catch {
    // Malformed/unreadable config → safe empty defaults, never throw.
  }

  // Strip undefined keys so the surfaced object stays clean (no api-key-like leaks).
  for (const k of Object.keys(config.user) as (keyof UserConfig['user'])[]) {
    if (config.user[k] === undefined) delete config.user[k]
  }
  if (config.defaults.google === undefined) delete config.defaults.google
  if (config.defaults.slack === undefined) delete config.defaults.slack
  for (const k of Object.keys(config.defaults.models) as (keyof UserConfig['defaults']['models'])[]) {
    if (config.defaults.models[k] === undefined) delete config.defaults.models[k]
  }
  if (config.registry.url === undefined) delete config.registry.url

  config.skills.disabled = [...new Set(config.skills.disabled.filter(name => USER_SKILL_NAME_PATTERN.test(name)))].sort()

  cache = Object.freeze({
    user: Object.freeze(config.user),
    defaults: Object.freeze({
      ...config.defaults,
      models: Object.freeze(config.defaults.models),
    }),
    connectors: Object.freeze({
      ...(config.connectors.slack ? { slack: Object.freeze({ ...config.connectors.slack }) } : {}),
    }),
    registry: Object.freeze(config.registry),
    skillSources: Object.freeze(Object.fromEntries(
      Object.entries(config.skillSources).map(([id, source]) => [id, Object.freeze({ ...source })]),
    )),
    skills: Object.freeze({
      disabled: Object.freeze([...config.skills.disabled]),
    }),
  }) as UserConfig
  return cache
}

export function reset(): void {
  cache = null
}

export function setUserSkillDisabled(name: string, disabled: boolean, home?: string): void {
  if (!USER_SKILL_NAME_PATTERN.test(name)) throw new Error(`Invalid skill name: ${name}`)
  const raw = readRawConfig(home)
  const skills = objectValue(raw.skills)
  const disabledNames = new Set(parseDisabledSkillNames(skills))
  if (disabled) disabledNames.add(name)
  else disabledNames.delete(name)
  const next = [...disabledNames].filter(item => USER_SKILL_NAME_PATTERN.test(item)).sort()
  if (next.length) {
    raw.skills = { ...skills, disabled: next }
  } else {
    delete skills.disabled
    if (Object.keys(skills).length) raw.skills = skills
    else delete raw.skills
  }
  writeRawConfig(raw, home)
}

export function writeSkillSource(id: string, source: SkillSourceConfig, home?: string): void {
  if (!USER_SKILL_SOURCE_ID_PATTERN.test(id)) throw new Error(`Invalid skill source id: ${id}`)
  const hasGit = typeof source.git === 'string' && source.git.length > 0
  const hasPath = typeof source.path === 'string' && source.path.length > 0
  if (hasGit === hasPath) throw new Error('Skill source must specify exactly one of git or path')
  const raw = readRawConfig(home)
  const skillSources = objectValue(raw.skillSources)
  const entry: Record<string, unknown> = {}
  if (source.name !== undefined) entry.name = source.name
  if (source.git !== undefined) entry.git = source.git
  if (source.path !== undefined) entry.path = source.path
  if (source.trusted !== undefined) entry.trusted = source.trusted
  skillSources[id] = entry
  raw.skillSources = skillSources
  writeRawConfig(raw, home)
}

export function removeSkillSource(id: string, home?: string): void {
  if (!USER_SKILL_SOURCE_ID_PATTERN.test(id)) throw new Error(`Invalid skill source id: ${id}`)
  const raw = readRawConfig(home)
  const skillSources = objectValue(raw.skillSources)
  delete skillSources[id]
  if (Object.keys(skillSources).length) raw.skillSources = skillSources
  else delete raw.skillSources
  writeRawConfig(raw, home)
}

export function resolveModelDefault(
  feature: 'chat' | 'ghost',
  opts: { override?: string }
): string | undefined {
  if (opts.override) return opts.override
  const config = loadUserConfig()
  return config.defaults.models[feature]
}

export function registryUrl(): string {
  const config = loadUserConfig()
  return config.registry.url ?? DEFAULT_REGISTRY_URL
}

function configPath(home?: string): string {
  const base = home ?? userHomeDir()
  return join(base, '.mim', 'config.yaml')
}

function readRawConfig(home?: string): Record<string, unknown> {
  try {
    const path = configPath(home)
    if (!existsSync(path)) return {}
    const raw = parseYaml(readFileSync(path, 'utf-8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {}
  } catch {
    return {}
  }
}

function writeRawConfig(raw: Record<string, unknown>, home?: string): void {
  const path = configPath(home)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`
  try {
    writeFileSync(tmp, stringifyYaml(raw), 'utf-8')
    renameSync(tmp, path)
    reset()
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* temp may not exist */ }
    throw err
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

function parseDisabledSkillNames(rawSkills: unknown): string[] {
  const skills = objectValue(rawSkills)
  const disabled = Array.isArray(skills.disabled) ? skills.disabled : []
  return [...new Set(
    disabled
      .filter((item): item is string => typeof item === 'string' && USER_SKILL_NAME_PATTERN.test(item))
      .sort(),
  )]
}

function parseSkillSources(rawSources: unknown): Record<string, SkillSourceConfig> {
  const raw = objectValue(rawSources)
  const out: Record<string, SkillSourceConfig> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!USER_SKILL_SOURCE_ID_PATTERN.test(id)) continue
    const source = objectValue(value)
    const hasGit = typeof source.git === 'string' && source.git.length > 0
    const hasPath = typeof source.path === 'string' && source.path.length > 0
    if (hasGit === hasPath) continue
    const entry: SkillSourceConfig = {}
    const name = str(source.name)
    if (name !== undefined) entry.name = name
    if (hasGit) entry.git = source.git as string
    if (hasPath) entry.path = source.path as string
    const trusted = bool(source.trusted)
    if (trusted !== undefined) entry.trusted = trusted
    out[id] = entry
  }
  return out
}
