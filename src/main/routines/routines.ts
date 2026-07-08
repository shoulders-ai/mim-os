import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { atomicWriteJson } from '@main/atomicJson.js'

export type RoutineRunStatus = 'working' | 'needs-approval' | 'done' | 'error' | 'stopped'
export type RoutineSlackTriggerMode = 'mention' | 'always'
export type RoutineFileTriggerEvent = 'add' | 'change' | 'unlink'

export interface RoutineRunContext {
  trigger: 'manual' | 'schedule' | 'files' | 'webhook' | 'slack'
  payload?: Record<string, unknown>
}

export interface RoutineFileTrigger {
  path: string
  events: RoutineFileTriggerEvent[]
}

export interface RoutineWebhookTrigger {
  secret: string
}

export interface RoutineSlackTrigger {
  account: string
  channels: Array<{
    id: string
    mode: RoutineSlackTriggerMode
  }>
}

export interface RoutineDefinition {
  id: string
  path: string
  name: string
  description?: string
  trigger?: Record<string, unknown>
  agent?: string
  model?: string
  tools: string[]
  approvalAllow: string[]
  steps?: number
  missed?: 'skip' | 'once'
  body: string
  authorityHash: string
  enabled: boolean
  paused: boolean
  needsEnablement: boolean
  nextRunAt?: string
  lastRunId?: string
  lastSuccessAt?: string
  lastErrorAt?: string
}

export interface RoutineDiagnostic {
  path: string
  routineId?: string
  severity: 'error' | 'warning'
  message: string
}

export interface RoutineCatalog {
  routines: RoutineDefinition[]
  diagnostics: RoutineDiagnostic[]
}

export interface RoutineAutomationStatePatch {
  nextRunAt?: string
  lastRunId?: string
  lastSuccessAt?: string
  lastErrorAt?: string
}

export interface LoadRoutineCatalogOptions {
  knownTools?: Set<string>
}

export interface CreateRoutineInput {
  name: string
  description?: string
  trigger?: Record<string, unknown>
  agent?: string
  model?: string
  tools?: string[]
  approvalAllow?: string[]
  approval?: { allow?: string[] }
  steps?: number
  missed?: 'skip' | 'once'
  body: string
  knownTools?: Set<string>
}

export interface ParsedRoutine {
  id: string
  path: string
  name: string
  description?: string
  trigger?: Record<string, unknown>
  agent?: string
  model?: string
  tools: string[]
  approvalAllow: string[]
  steps?: number
  missed?: 'skip' | 'once'
  body: string
  authorityHash: string
}

export interface RoutineState {
  enabled?: boolean
  paused?: boolean
  authorityHash?: string
  updatedAt?: string
  nextRunAt?: string
  lastRunId?: string
  lastSuccessAt?: string
  lastErrorAt?: string
}

export interface RoutineSchedulerState {
  heartbeatAt?: string
}

export interface RoutineStateFile {
  routines?: Record<string, RoutineState>
  scheduler?: RoutineSchedulerState
  webhookDeliveries?: Record<string, string>
}

const STATE_PATH = join('.mim', 'routines', 'state.json')
const ROUTINE_TRIGGER_KINDS = ['schedule', 'every', 'files', 'webhook', 'slack'] as const

export function loadRoutineCatalog(workspacePath: string, options: LoadRoutineCatalogOptions = {}): RoutineCatalog {
  const routinesDir = join(workspacePath, 'routines')
  if (!existsSync(routinesDir)) return { routines: [], diagnostics: [] }

  const routines: RoutineDefinition[] = []
  const diagnostics: RoutineDiagnostic[] = []
  const seenNames = new Set<string>()
  const state = readRoutineState(workspacePath)
  const files = readdirSync(routinesDir)
    .filter(file => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))

  for (const file of files) {
    const absolutePath = join(routinesDir, file)
    if (!statSync(absolutePath).isFile()) continue
    const relPath = `routines/${file}`
    try {
      const parsed = parseRoutineDefinition(relPath, readFileSync(absolutePath, 'utf-8'))
      const fileId = basename(file, '.md')
      if (parsed.name !== fileId) {
        diagnostics.push({
          path: relPath,
          routineId: parsed.name,
          severity: 'error',
          message: `Routine name must match filename: ${fileId}`,
        })
        continue
      }
      if (seenNames.has(parsed.name)) {
        diagnostics.push({
          path: relPath,
          routineId: parsed.name,
          severity: 'error',
          message: `Duplicate routine name: ${parsed.name}`,
        })
        continue
      }

      const routineDiagnostics = validateRoutine(parsed, options.knownTools)
      if (routineDiagnostics.length) {
        diagnostics.push(...routineDiagnostics.map(message => ({
          path: relPath,
          routineId: parsed.name,
          severity: 'error' as const,
          message,
        })))
        continue
      }

      seenNames.add(parsed.name)
      routines.push(applyRoutineState(parsed, state.routines?.[parsed.id]))
    } catch (err) {
      diagnostics.push({
        path: relPath,
        severity: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const duplicateSlack = duplicateSlackBindingDiagnostics(routines)
  if (duplicateSlack.length) {
    const duplicateRoutineIds = new Set(duplicateSlack.map(item => item.routineId).filter(Boolean) as string[])
    diagnostics.push(...duplicateSlack)
    return {
      routines: routines.filter(routine => !duplicateRoutineIds.has(routine.id)),
      diagnostics,
    }
  }

  return { routines, diagnostics }
}

export function loadRoutineDefinitions(workspacePath: string): RoutineCatalog {
  return loadRoutineCatalog(workspacePath)
}

export function parseRoutineDefinition(path: string, content: string): ParsedRoutine {
  const { frontmatter, body } = splitFrontmatter(content)
  const raw = parseYaml(frontmatter) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Routine frontmatter must be a mapping')
  }

  const data = raw as Record<string, unknown>
  const name = requiredString(data.name, 'name')
  const tools = stringArray(data.tools, 'tools')
  const approvalAllow = approvalAllowList(data.approval)
  const steps = optionalPositiveInteger(data.steps, 'steps')
  const missed = optionalEnum(data.missed, 'missed', ['skip', 'once'])
  const description = optionalString(data.description)
  const agent = optionalString(data.agent)
  const model = optionalString(data.model)
  const trigger = optionalObject(data.trigger, 'trigger')
  const prompt = body.trim()
  if (!prompt) throw new Error('Routine body is required')

  const parsed: ParsedRoutine = {
    id: name,
    path,
    name,
    tools,
    approvalAllow,
    body: prompt,
    authorityHash: '',
  }
  if (description) parsed.description = description
  if (trigger) parsed.trigger = trigger
  if (agent) parsed.agent = agent
  if (model) parsed.model = model
  if (steps !== undefined) parsed.steps = steps
  if (missed) parsed.missed = missed
  parsed.authorityHash = routineAuthorityHash(parsed)
  return parsed
}

export function createRoutineFile(workspacePath: string, input: CreateRoutineInput): RoutineDefinition {
  const name = requiredString(input.name, 'name')
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('Routine name may contain only letters, numbers, dots, underscores, and hyphens')
  }
  const body = requiredString(input.body, 'body')
  const routinesDir = join(workspacePath, 'routines')
  const path = join(routinesDir, `${name}.md`)
  if (existsSync(path)) throw new Error(`Routine already exists: ${name}`)

  const approvalAllow = input.approvalAllow ?? input.approval?.allow ?? []
  const frontmatter: Record<string, unknown> = { name }
  if (input.description) frontmatter.description = input.description
  if (input.trigger) frontmatter.trigger = input.trigger
  if (input.agent) frontmatter.agent = input.agent
  if (input.model) frontmatter.model = input.model
  if (input.tools?.length) frontmatter.tools = input.tools
  if (approvalAllow.length) frontmatter.approval = { allow: approvalAllow }
  if (input.steps !== undefined) frontmatter.steps = input.steps
  if (input.missed) frontmatter.missed = input.missed

  mkdirSync(routinesDir, { recursive: true })
  const content = `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`
  writeFileSync(path, content)

  const catalog = loadRoutineCatalog(workspacePath, { knownTools: input.knownTools })
  const created = catalog.routines.find(routine => routine.id === name)
  if (!created) {
    try { unlinkSync(path) } catch { /* best effort rollback */ }
    const messages = catalog.diagnostics
      .filter(diagnostic => diagnostic.routineId === name || diagnostic.path === `routines/${name}.md`)
      .map(diagnostic => diagnostic.message)
    throw new Error(messages[0] ?? `Routine could not be created: ${name}`)
  }
  return created
}

export function resumeRoutine(workspacePath: string, routine: Pick<RoutineDefinition, 'id' | 'authorityHash'>): void {
  const state = readRoutineState(workspacePath)
  state.routines ??= {}
  state.routines[routine.id] = {
    ...(state.routines[routine.id] ?? {}),
    enabled: true,
    paused: false,
    authorityHash: routine.authorityHash,
    updatedAt: new Date().toISOString(),
  }
  writeRoutineState(workspacePath, state)
}

export function pauseRoutine(workspacePath: string, routineId: string): void {
  const state = readRoutineState(workspacePath)
  state.routines ??= {}
  state.routines[routineId] = {
    ...(state.routines[routineId] ?? {}),
    paused: true,
    updatedAt: new Date().toISOString(),
  }
  writeRoutineState(workspacePath, state)
}

export function recordRoutineAutomationState(
  workspacePath: string,
  routineId: string,
  patch: RoutineAutomationStatePatch,
): void {
  const state = readRoutineState(workspacePath)
  state.routines ??= {}
  const existing = state.routines[routineId] ?? {}
  state.routines[routineId] = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  writeRoutineState(workspacePath, state)
}

export function routineLabel(routine: Pick<RoutineDefinition, 'name' | 'path'>): string {
  return routine.name || basename(routine.path, '.md')
}

export function routineWebhookSecretAccount(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Routine webhook secret name is required')
  return `routine:webhook:${trimmed}`
}

export function routineSlackTrigger(routine: Pick<RoutineDefinition, 'trigger'>): RoutineSlackTrigger | null {
  const normalized = normalizeSlackTrigger(routine.trigger?.slack)
  return normalized.trigger
}

export function routineFileTrigger(routine: Pick<RoutineDefinition, 'trigger'>): RoutineFileTrigger | null {
  const normalized = normalizeFileTrigger(routine.trigger?.files)
  return normalized.trigger
}

export function routineWebhookTrigger(routine: Pick<RoutineDefinition, 'trigger'>): RoutineWebhookTrigger | null {
  const normalized = normalizeWebhookTrigger(routine.trigger?.webhook)
  return normalized.trigger
}

export function routineEveryMs(routine: Pick<RoutineDefinition, 'trigger'>): number | null {
  const value = routine.trigger?.every
  return typeof value === 'string' ? parseIntervalMs(value) : null
}

export function routineScheduleExpression(routine: Pick<RoutineDefinition, 'trigger'>): string | null {
  const value = routine.trigger?.schedule
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function applyRoutineState(routine: ParsedRoutine, state: RoutineState | undefined): RoutineDefinition {
  const needsEnablement = state?.enabled !== true || state.authorityHash !== routine.authorityHash
  const paused = state?.paused === true
  return {
    ...routine,
    enabled: state?.enabled === true && !paused && !needsEnablement,
    paused,
    needsEnablement,
    ...(state?.nextRunAt ? { nextRunAt: state.nextRunAt } : {}),
    ...(state?.lastRunId ? { lastRunId: state.lastRunId } : {}),
    ...(state?.lastSuccessAt ? { lastSuccessAt: state.lastSuccessAt } : {}),
    ...(state?.lastErrorAt ? { lastErrorAt: state.lastErrorAt } : {}),
  }
}

function validateRoutine(routine: ParsedRoutine, knownTools: Set<string> | undefined): string[] {
  const diagnostics: string[] = []
  const visible = new Set(routine.tools)
  if (routine.tools.length > 0) {
    const grantsOutsideTools = routine.approvalAllow.filter(toolName => !visible.has(toolName))
    if (grantsOutsideTools.length) {
      diagnostics.push(`approval.allow must be a subset of tools: ${grantsOutsideTools.join(', ')}`)
    }
  }

  if (knownTools) {
    for (const toolName of new Set([...routine.tools, ...routine.approvalAllow])) {
      if (!knownTools.has(toolName)) diagnostics.push(`Unknown tool id: ${toolName}`)
    }
  }

  diagnostics.push(...validateRoutineTrigger(routine.trigger))

  return diagnostics
}

function validateRoutineTrigger(trigger: Record<string, unknown> | undefined): string[] {
  if (!trigger) return []
  const diagnostics: string[] = []
  const declared = ROUTINE_TRIGGER_KINDS.filter(kind => trigger[kind] !== undefined)
  const unknown = Object.keys(trigger).filter(key => !(ROUTINE_TRIGGER_KINDS as readonly string[]).includes(key))
  if (declared.length !== 1) {
    diagnostics.push(`Routine trigger must declare exactly one of: ${ROUTINE_TRIGGER_KINDS.join(', ')}`)
  }
  for (const key of unknown) diagnostics.push(`Unknown routine trigger: ${key}`)

  if (trigger.schedule !== undefined && (!nonEmptyString(trigger.schedule) || !isValidCronExpression(trigger.schedule))) {
    diagnostics.push('Routine trigger.schedule must be a five-field cron expression')
  }
  if (trigger.every !== undefined && (!nonEmptyString(trigger.every) || parseIntervalMs(trigger.every) == null)) {
    diagnostics.push('Routine trigger.every must be an interval like 15m, 4h, or 1d')
  }
  diagnostics.push(...normalizeFileTrigger(trigger.files).diagnostics)
  diagnostics.push(...normalizeWebhookTrigger(trigger.webhook).diagnostics)
  diagnostics.push(...normalizeSlackTrigger(trigger.slack).diagnostics)
  return diagnostics
}

function normalizeFileTrigger(value: unknown): { trigger: RoutineFileTrigger | null; diagnostics: string[] } {
  if (value === undefined) return { trigger: null, diagnostics: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { trigger: null, diagnostics: ['Routine trigger.files must be a mapping'] }
  }
  const files = value as Record<string, unknown>
  const diagnostics: string[] = []
  const path = nonEmptyString(files.path) ? files.path.trim() : ''
  if (!path) diagnostics.push('Routine trigger.files.path is required')
  if (path.startsWith('/') || path.split('/').includes('..')) {
    diagnostics.push('Routine trigger.files.path must be workspace-relative')
  }

  const events = files.events === undefined
    ? ['add', 'change'] as RoutineFileTriggerEvent[]
    : Array.isArray(files.events)
      ? [...new Set(files.events.filter(isRoutineFileTriggerEvent))]
      : []
  if (files.events !== undefined && (!Array.isArray(files.events) || events.length !== files.events.length)) {
    diagnostics.push('Routine trigger.files.events must contain only add, change, or unlink')
  }
  if (!events.length) diagnostics.push('Routine trigger.files.events must contain add, change, or unlink')
  if (diagnostics.length) return { trigger: null, diagnostics }
  return { trigger: { path, events }, diagnostics: [] }
}

function normalizeWebhookTrigger(value: unknown): { trigger: RoutineWebhookTrigger | null; diagnostics: string[] } {
  if (value === undefined) return { trigger: null, diagnostics: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { trigger: null, diagnostics: ['Routine trigger.webhook must be a mapping'] }
  }
  const webhook = value as Record<string, unknown>
  const secret = nonEmptyString(webhook.secret) ? webhook.secret.trim() : ''
  if (!/^[A-Za-z0-9._:-]+$/.test(secret)) {
    return { trigger: null, diagnostics: ['Routine trigger.webhook.secret is required and may contain letters, numbers, dots, underscores, colons, or hyphens'] }
  }
  return { trigger: { secret }, diagnostics: [] }
}

function duplicateSlackBindingDiagnostics(routines: RoutineDefinition[]): RoutineDiagnostic[] {
  const byKey = new Map<string, RoutineDefinition[]>()
  for (const routine of routines) {
    const slack = routineSlackTrigger(routine)
    if (!slack) continue
    for (const channel of slack.channels) {
      const key = `${slack.account}:${channel.id}`
      const existing = byKey.get(key) ?? []
      existing.push(routine)
      byKey.set(key, existing)
    }
  }

  const diagnostics: RoutineDiagnostic[] = []
  for (const [key, matches] of byKey) {
    if (matches.length < 2) continue
    const names = matches.map(routine => routine.id).sort((a, b) => a.localeCompare(b))
    for (const routine of matches) {
      diagnostics.push({
        path: routine.path,
        routineId: routine.id,
        severity: 'error',
        message: `Duplicate Slack trigger binding for ${key}: ${names.join(', ')}`,
      })
    }
  }
  return diagnostics.sort((a, b) => a.path.localeCompare(b.path))
}

function normalizeSlackTrigger(value: unknown): { trigger: RoutineSlackTrigger | null; diagnostics: string[] } {
  if (value === undefined) return { trigger: null, diagnostics: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { trigger: null, diagnostics: ['Routine trigger.slack must be a mapping'] }
  }

  const raw = value as Record<string, unknown>
  const account = typeof raw.account === 'string' && raw.account.trim() !== ''
    ? raw.account.trim()
    : 'default'
  if (!Array.isArray(raw.channels) || raw.channels.length === 0) {
    return { trigger: null, diagnostics: ['Slack trigger channels must be a non-empty list'] }
  }

  const channels: RoutineSlackTrigger['channels'] = []
  const diagnostics: string[] = []
  const seen = new Set<string>()
  for (const item of raw.channels) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      diagnostics.push('Slack trigger channel must be a mapping')
      continue
    }
    const channel = item as Record<string, unknown>
    const id = typeof channel.id === 'string' ? channel.id.trim() : ''
    const mode = channel.mode
    if (!id) {
      diagnostics.push('Slack trigger channel id is required')
      continue
    }
    if (mode !== 'mention' && mode !== 'always') {
      diagnostics.push(`Slack trigger channel mode must be mention or always: ${id}`)
      continue
    }
    if (seen.has(id)) {
      diagnostics.push(`Duplicate Slack trigger channel: ${id}`)
      continue
    }
    seen.add(id)
    channels.push({ id, mode })
  }

  if (diagnostics.length) return { trigger: null, diagnostics }
  return { trigger: { account, channels }, diagnostics: [] }
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    throw new Error('Routine must start with YAML frontmatter')
  }
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('Routine frontmatter is not closed')
  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + 5),
  }
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Routine ${key} is required`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isRoutineFileTriggerEvent(value: unknown): value is RoutineFileTriggerEvent {
  return value === 'add' || value === 'change' || value === 'unlink'
}

function parseIntervalMs(value: string): number | null {
  const match = value.trim().match(/^([1-9][0-9]*)(m|h|d)$/)
  if (!match) return null
  const amount = Number(match[1])
  const multiplier = match[2] === 'm' ? 60_000 : match[2] === 'h' ? 3_600_000 : 86_400_000
  return amount * multiplier
}

function isValidCronExpression(value: string): boolean {
  const fields = value.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ] as const
  return fields.every((field, index) => isValidCronField(field, ranges[index][0], ranges[index][1]))
}

function isValidCronField(field: string, min: number, max: number): boolean {
  if (field === '*') return true
  return field.split(',').every(token => {
    if (!/^[0-9]+$/.test(token)) return false
    const value = Number(token)
    return value >= min && value <= max
  })
}

function optionalObject(value: unknown, key: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Routine ${key} must be a mapping`)
  }
  return value as Record<string, unknown>
}

function stringArray(value: unknown, key: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`Routine ${key} must be a list`)
  const strings = value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
  if (strings.length !== value.length) throw new Error(`Routine ${key} must contain only strings`)
  return [...new Set(strings)]
}

function approvalAllowList(value: unknown): string[] {
  if (value === undefined) return []
  const approval = optionalObject(value, 'approval')
  return stringArray(approval?.allow, 'approval.allow')
}

function optionalPositiveInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Routine ${key} must be a positive integer`)
  }
  return value
}

function optionalEnum<T extends string>(value: unknown, key: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Routine ${key} must be one of: ${allowed.join(', ')}`)
  }
  return value as T
}

export function readRoutineState(workspacePath: string): RoutineStateFile {
  const path = join(workspacePath, STATE_PATH)
  if (!existsSync(path)) return { routines: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { routines: {} }
    const state = parsed as RoutineStateFile
    const routines = state.routines
    if (!routines || typeof routines !== 'object' || Array.isArray(routines)) return { routines: {} }
    return {
      routines,
      ...(state.scheduler && typeof state.scheduler === 'object' && !Array.isArray(state.scheduler) ? { scheduler: state.scheduler } : {}),
      ...(state.webhookDeliveries && typeof state.webhookDeliveries === 'object' && !Array.isArray(state.webhookDeliveries) ? { webhookDeliveries: state.webhookDeliveries } : {}),
    }
  } catch {
    return { routines: {} }
  }
}

export function writeRoutineState(workspacePath: string, state: RoutineStateFile): void {
  const statePath = join(workspacePath, STATE_PATH)
  mkdirSync(join(workspacePath, '.mim', 'routines'), { recursive: true })
  atomicWriteJson(statePath, state)
}

function routineAuthorityHash(routine: Pick<ParsedRoutine, 'trigger' | 'agent' | 'model' | 'tools' | 'approvalAllow' | 'steps' | 'missed'>): string {
  const authority = {
    trigger: routine.trigger ?? null,
    agent: routine.agent ?? null,
    model: routine.model ?? null,
    tools: routine.tools,
    approvalAllow: routine.approvalAllow,
    steps: routine.steps ?? null,
    missed: routine.missed ?? null,
  }
  return createHash('sha256').update(stableStringify(authority)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
