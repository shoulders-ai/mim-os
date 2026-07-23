// Personal config: ~/.mim/config.yaml. Identity, preferences, model defaults,
// global skill activation, and one credential-free Team repository; never keys
// or tokens.
// No Electron imports — unit-testable.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { userHomeDir } from '@main/platform.js'

export interface UserConfig {
  user: { name?: string; email?: string; timezone?: string }
  team?: { repository: string }
  defaults: {
    google?: string
    slack?: string
    models: { chat?: string; inline?: string; ghost?: string }
  }
  preferences: {
    theme?: string
    editorFontFamily?: string
    editorFontSize?: number
    editorWordWrap?: boolean
    editorLineNumbers?: boolean
    editorSpellCheck?: boolean
    editorLivePreview?: boolean
    sidebarWidth?: number
    rightPanelWidth?: number
    terminalHeight?: number
    automationApprovalMode?: 'normal' | 'strict' | 'developer'
  }
  connectors: {
    google?: Record<string, unknown>
    slack?: Record<string, unknown>
  }
  skills: { disabled: string[] }
}

export const USER_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

let cache: { home: string; config: UserConfig } | null = null

export type PersonalSettingKey =
  | 'theme'
  | 'editorFontFamily'
  | 'editorFontSize'
  | 'editorWordWrap'
  | 'editorLineNumbers'
  | 'editorSpellCheck'
  | 'editorLivePreview'
  | 'lastChatModel'
  | 'lastInlineModel'
  | 'lastGhostModel'
  | 'sidebarWidth'
  | 'rightPanelWidth'
  | 'terminalHeight'
  | 'automationApprovalMode'

const MODEL_SETTING_FEATURES = {
  lastChatModel: 'chat',
  lastInlineModel: 'inline',
  lastGhostModel: 'ghost',
} as const

const PREFERENCE_SETTING_KEYS = new Set<PersonalSettingKey>([
  'theme',
  'editorFontFamily',
  'editorFontSize',
  'editorWordWrap',
  'editorLineNumbers',
  'editorSpellCheck',
  'editorLivePreview',
  'sidebarWidth',
  'rightPanelWidth',
  'terminalHeight',
  'automationApprovalMode',
])

function emptyConfig(): UserConfig {
  return {
    user: {},
    defaults: { models: {} },
    preferences: {},
    connectors: {},
    skills: { disabled: [] },
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function loadUserConfig(home?: string): UserConfig {
  const base = home ?? userHomeDir()
  if (cache?.home === base) return cache.config

  const config = emptyConfig()
  try {
    const path = join(base, '.mim', 'config.yaml')
    if (existsSync(path)) {
      const raw = parseYaml(readFileSync(path, 'utf-8'))
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const r = raw as Record<string, unknown>
        const user = (r.user && typeof r.user === 'object') ? r.user as Record<string, unknown> : {}
        config.user.name = str(user.name)
        config.user.email = str(user.email)
        config.user.timezone = str(user.timezone)

        const team = objectValue(r.team)
        const teamRepository = safeTeamRepository(team.repository)
        if (teamRepository) config.team = { repository: teamRepository }

        const defaults = (r.defaults && typeof r.defaults === 'object') ? r.defaults as Record<string, unknown> : {}
        config.defaults.google = str(defaults.google)
        config.defaults.slack = str(defaults.slack)
        const models = (defaults.models && typeof defaults.models === 'object') ? defaults.models as Record<string, unknown> : {}
        config.defaults.models.chat = str(models.chat)
        config.defaults.models.inline = str(models.inline)
        config.defaults.models.ghost = str(models.ghost)

        const preferences = objectValue(r.preferences)
        config.preferences.theme = str(preferences.theme)
        config.preferences.editorFontFamily = str(preferences.editorFontFamily)
        config.preferences.editorFontSize = finiteNumber(preferences.editorFontSize)
        config.preferences.editorWordWrap = bool(preferences.editorWordWrap)
        config.preferences.editorLineNumbers = bool(preferences.editorLineNumbers)
        config.preferences.editorSpellCheck = bool(preferences.editorSpellCheck)
        config.preferences.editorLivePreview = bool(preferences.editorLivePreview)
        config.preferences.sidebarWidth = finiteNumber(preferences.sidebarWidth)
        config.preferences.rightPanelWidth = finiteNumber(preferences.rightPanelWidth)
        config.preferences.terminalHeight = finiteNumber(preferences.terminalHeight)
        if (
          preferences.automationApprovalMode === 'normal' ||
          preferences.automationApprovalMode === 'strict' ||
          preferences.automationApprovalMode === 'developer'
        ) {
          config.preferences.automationApprovalMode = preferences.automationApprovalMode
        }

        const connectors = (r.connectors && typeof r.connectors === 'object' && !Array.isArray(r.connectors))
          ? r.connectors as Record<string, unknown>
          : {}
        if (connectors.slack && typeof connectors.slack === 'object' && !Array.isArray(connectors.slack)) {
          config.connectors.slack = connectors.slack as Record<string, unknown>
        }
        if (connectors.google && typeof connectors.google === 'object' && !Array.isArray(connectors.google)) {
          config.connectors.google = connectors.google as Record<string, unknown>
        }

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
  for (const k of Object.keys(config.preferences) as (keyof UserConfig['preferences'])[]) {
    if (config.preferences[k] === undefined) delete config.preferences[k]
  }
  config.skills.disabled = [...new Set(config.skills.disabled.filter(name => USER_SKILL_NAME_PATTERN.test(name)))].sort()

  const frozen = Object.freeze({
    user: Object.freeze(config.user),
    ...(config.team ? { team: Object.freeze({ ...config.team }) } : {}),
    defaults: Object.freeze({
      ...config.defaults,
      models: Object.freeze(config.defaults.models),
    }),
    preferences: Object.freeze(config.preferences),
    connectors: Object.freeze({
      ...(config.connectors.google ? { google: Object.freeze({ ...config.connectors.google }) } : {}),
      ...(config.connectors.slack ? { slack: Object.freeze({ ...config.connectors.slack }) } : {}),
    }),
    skills: Object.freeze({
      disabled: Object.freeze([...config.skills.disabled]),
    }),
  }) as UserConfig
  cache = { home: base, config: frozen }
  return frozen
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

export function setPersonalSetting(key: PersonalSettingKey, value: unknown, home?: string): void {
  const raw = readRawConfig(home)
  if (key in MODEL_SETTING_FEATURES) {
    const defaults = objectValue(raw.defaults)
    const models = objectValue(defaults.models)
    const feature = MODEL_SETTING_FEATURES[key as keyof typeof MODEL_SETTING_FEATURES]
    if (typeof value === 'string' && value.trim()) models[feature] = value.trim()
    else delete models[feature]
    if (Object.keys(models).length) defaults.models = models
    else delete defaults.models
    if (Object.keys(defaults).length) raw.defaults = defaults
    else delete raw.defaults
    writeRawConfig(raw, home)
    return
  }

  if (!PREFERENCE_SETTING_KEYS.has(key)) throw new Error(`Unknown Personal setting: ${key}`)
  const preferences = objectValue(raw.preferences)
  preferences[key] = value
  raw.preferences = preferences
  writeRawConfig(raw, home)
}

export function setUserIdentity(
  user: { name?: string; email?: string; timezone?: string },
  home?: string,
): void {
  const raw = readRawConfig(home)
  const next: Record<string, string> = {}
  for (const key of ['name', 'email', 'timezone'] as const) {
    const value = user[key]
    if (typeof value === 'string' && value.trim()) next[key] = value.trim()
  }
  if (Object.keys(next).length) raw.user = next
  else delete raw.user
  writeRawConfig(raw, home)
}

export function setTeamConnection(team: { repository: string }, home?: string): void {
  const repository = safeTeamRepository(team.repository)
  if (!repository) throw new Error('Team repository must be credential-free and non-empty')
  const raw = readRawConfig(home)
  raw.team = { repository }
  writeRawConfig(raw, home)
}

export function resolveModelDefault(
  feature: 'chat' | 'inline' | 'ghost',
  opts: { override?: string }
): string | undefined {
  if (opts.override) return opts.override
  const config = loadUserConfig()
  return config.defaults.models[feature]
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeTeamRepository(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const repository = value.trim()
  if (!repository || /[\r\n\0]/.test(repository)) return undefined
  if (/^(https?|ssh):\/\//i.test(repository)) {
    try {
      const parsed = new URL(repository)
      if (parsed.password || (/^https?:$/i.test(parsed.protocol) && parsed.username)) return undefined
    } catch {
      return undefined
    }
  }
  return repository
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
