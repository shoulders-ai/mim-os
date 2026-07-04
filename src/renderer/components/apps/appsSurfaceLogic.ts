// Pure-function logic for AppsSurface row derivation, filtering, and update
// lookup. Keeps the Vue component lean by pushing every non-trivial conditional
// here so they can be unit-tested without mounting.

import type { ResolvedApp } from '../../stores/coreApps.js'

// ---- Registry types ----

export interface RegistryInfo {
  id: string
  kind: 'git' | 'local' | 'url'
  location: string
  name?: string
  origin: 'default' | 'user' | 'workspace' | 'machine' | 'account'
  status: 'ok' | 'stale' | 'error' | 'needs-trust'
  error?: string
  diagnostics: string[]
}

export interface RegistryEntry {
  id: string
  name: string
  description?: string
  repo?: string
  archive?: string
  hash?: string
  path?: string
  dir?: string
  version: string
  ref?: string
  commit?: string
  permissions: Record<string, unknown>
  engines?: { mim?: string }
  installedVersions: string[]
  enabledHere: boolean
  permissionMismatch: boolean
  registryId: string
  shadowed?: boolean
  shadowedBy?: string
}

export interface UpdateInfo {
  installed: string
  latest: string
  registryId: string
}

// ---- Settings membership ----

/** An app belongs in Settings > Apps when it is enabled, in the workspace, blocked, or missing. */
export function isManageableApp(app: ResolvedApp): boolean {
  return (
    app.enabled
    || app.layer === 'workspace'
    || app.source === 'workspace'
    || app.needsTrust
    || app.needsInstall
  )
}

// ---- Registry grouping ----

export interface RegistryGroup {
  registryId: string
  label: string
  origin: RegistryInfo['origin']
  entries: RegistryEntry[]
}

const ORIGIN_PRECEDENCE: Record<RegistryInfo['origin'], number> = {
  workspace: 0,
  machine: 1,
  account: 2,
  user: 3,
  default: 4,
}

export function groupEntriesByRegistry(
  entries: RegistryEntry[],
  registries: RegistryInfo[],
): RegistryGroup[] {
  const buckets = new Map<string, RegistryEntry[]>()
  for (const entry of entries) {
    const list = buckets.get(entry.registryId)
    if (list) list.push(entry)
    else buckets.set(entry.registryId, [entry])
  }

  const groups: RegistryGroup[] = []
  for (const [registryId, groupEntries] of buckets) {
    const reg = registries.find(r => r.id === registryId)
    groups.push({
      registryId,
      label: reg?.name || registryId,
      origin: reg?.origin ?? 'default',
      entries: groupEntries,
    })
  }

  const regIndex = new Map(registries.map((r, i) => [r.id, i]))
  groups.sort((a, b) => {
    const pa = ORIGIN_PRECEDENCE[a.origin] ?? 5
    const pb = ORIGIN_PRECEDENCE[b.origin] ?? 5
    if (pa !== pb) return pa - pb
    const ia = regIndex.get(a.registryId) ?? Infinity
    const ib = regIndex.get(b.registryId) ?? Infinity
    return ia - ib
  })

  return groups
}

// ---- Browse entries (registry entries NOT already installed/manageable) ----

export function availableEntries(
  entries: RegistryEntry[],
  inWorkspaceIds: Set<string>,
): RegistryEntry[] {
  const latestById = new Map<string, RegistryEntry>()
  for (const entry of entries) {
    if (entry.shadowed || inWorkspaceIds.has(entry.id)) continue
    const current = latestById.get(entry.id)
    if (!current || compareSemver(entry.version, current.version) > 0) {
      latestById.set(entry.id, entry)
    }
  }
  return [...latestById.values()]
}

// ---- Registry entry action ----

export function registryEntryAction(entry: RegistryEntry): 'add' | 'update' | 'added' {
  if (entry.installedVersions.length > 0 && !entry.installedVersions.includes(entry.version)) return 'update'
  if (entry.enabledHere) return 'added'
  return 'add'
}

// ---- Visible (non-shadowed) entries ----

export function visibleEntries(entries: RegistryEntry[]): RegistryEntry[] {
  return entries.filter(e => !e.shadowed)
}

// ---- Non-ok registries ----

export function nonOkRegistries(registries: RegistryInfo[]): RegistryInfo[] {
  return registries.filter(r => r.status !== 'ok')
}

// ---- Registry display name ----

export function registryDisplayName(registries: RegistryInfo[], registryId: string): string {
  const reg = registries.find(r => r.id === registryId)
  return reg?.name || registryId
}

// ---- Filter rows ----

export function filterByText<T extends { id: string; label: string; description: string }>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(row =>
    row.label.toLowerCase().includes(q)
    || row.description.toLowerCase().includes(q)
    || row.id.toLowerCase().includes(q),
  )
}

// ---- Update lookup ----

export function hasUpdate(updates: Record<string, UpdateInfo>, id: string): boolean {
  return id in updates
}

function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a)
  const parsedB = parseSemver(b)
  if (!parsedA || !parsedB) return a.localeCompare(b)
  for (let i = 0; i < 3; i += 1) {
    const diff = parsedA.core[i] - parsedB.core[i]
    if (diff !== 0) return diff
  }
  if (!parsedA.pre.length && !parsedB.pre.length) return 0
  if (!parsedA.pre.length) return 1
  if (!parsedB.pre.length) return -1
  const len = Math.max(parsedA.pre.length, parsedB.pre.length)
  for (let i = 0; i < len; i += 1) {
    const left = parsedA.pre[i]
    const right = parsedB.pre[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNum = /^\d+$/.test(left) ? Number(left) : null
    const rightNum = /^\d+$/.test(right) ? Number(right) : null
    if (leftNum !== null && rightNum !== null && leftNum !== rightNum) return leftNum - rightNum
    if (leftNum !== null && rightNum === null) return -1
    if (leftNum === null && rightNum !== null) return 1
    const lexical = left.localeCompare(right)
    if (lexical !== 0) return lexical
  }
  return 0
}

function parseSemver(version: string): { core: [number, number, number]; pre: string[] } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  }
}
