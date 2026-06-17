// Pure-function logic for AppsSurface row derivation, filtering, and update
// lookup. Keeps the Vue component lean by pushing every non-trivial conditional
// here so they can be unit-tested without mounting.

import type { ResolvedApp } from '../../stores/coreApps.js'

// ---- Registry types ----

export interface RegistryInfo {
  id: string
  kind: 'git' | 'local'
  location: string
  name?: string
  origin: 'default' | 'user' | 'workspace' | 'machine'
  status: 'ok' | 'stale' | 'error' | 'needs-trust'
  error?: string
  diagnostics: string[]
}

export interface RegistryEntry {
  id: string
  name: string
  description?: string
  repo?: string
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

// ---- Manageable app membership ----

/** An app belongs in the Settings > Apps Installed set when any of these hold. */
export function isManageableApp(app: ResolvedApp): boolean {
  return (
    app.enabled
    || app.layer === 'workspace'
    || app.layer === 'local'
    || app.needsTrust
    || app.needsInstall
  )
}

// ---- Browse entries (registry entries NOT already installed/manageable) ----

export function availableEntries(
  entries: RegistryEntry[],
  inWorkspaceIds: Set<string>,
): RegistryEntry[] {
  return entries.filter(e => !e.shadowed && !inWorkspaceIds.has(e.id))
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
