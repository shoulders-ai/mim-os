// Resolved-state apps store — the renderer's single source of truth for
// app enablement, visibility, install, trust, and override state.
//
// Replaces the old hardcoded PACKAGE_APP_MAP + per-app-name refs with a flat
// map keyed by app id, populated from the resolved app.status tool (which
// merges committed mim.yaml, local overlay, and loader state in one pass).
//
// Refresh triggers: apps:changed AND packages:changed events from main.

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

export type AppLayer = 'workspace' | 'local' | 'default'

// Per-package resolved state, mirroring the main-process AppStatus shape with
// an added `visible` flag (enabled + has a view → visible in launchers).
export interface ResolvedApp {
  id: string
  enabled: boolean
  layer: AppLayer
  installed: boolean
  source?: string
  path?: string
  shadowed: boolean
  needsTrust: boolean
  needsInstall: boolean
  visible: boolean
  folderPresent: boolean
}

// Raw shape returned by app.status (src/main/tools/coreApps.ts).
interface AppStatusEntry {
  id: string
  enabled: boolean
  layer: AppLayer
  installed: boolean
  installedVersions: string[]
  source?: string
  path?: string
  shadowed: boolean
  needsTrust: boolean
  needsInstall: boolean
  folderPresent: boolean
}

function toResolved(entry: AppStatusEntry): ResolvedApp {
  return {
    id: entry.id,
    enabled: entry.enabled,
    layer: entry.layer,
    installed: entry.installed,
    source: entry.source,
    path: entry.path,
    shadowed: entry.shadowed,
    needsTrust: entry.needsTrust,
    needsInstall: entry.needsInstall,
    // Visibility for launchers: enabled apps are visible; disabled are
    // hidden. (The launcher filters on this flag, settings panels show all.)
    visible: entry.enabled,
    folderPresent: entry.folderPresent,
  }
}

export interface AppUpdateInfo {
  installed: string
  latest: string
  registryId: string
}

export const useAppsStore = defineStore('coreApps', () => {
  // Keyed by package id. Reactive so Vue components track individual entries.
  const apps = reactive<Record<string, ResolvedApp>>({})

  // Update check state — populated by app.updates and 'apps:updates' broadcast.
  const updates = ref<Record<string, AppUpdateInfo>>({})
  const updateCount = computed(() => Object.keys(updates.value).length)

  function isEnabled(id: string): boolean {
    return apps[id]?.enabled === true
  }

  function isVisible(id: string): boolean {
    return apps[id]?.visible === true
  }

  function folderPresent(id: string): boolean {
    return apps[id]?.folderPresent === true
  }

  // An app's launch row is shown iff the resolved state says it is visible.
  // This replaces the old PACKAGE_APP_MAP-based isPackageVisible().
  function isPackageVisible(packageId: string): boolean {
    const entry = apps[packageId]
    // Unknown apps (not in resolved state) are assumed visible — they have
    // no enablement gate.
    if (!entry) return true
    return entry.visible
  }

  async function refresh(): Promise<void> {
    try {
      const result = await window.kernel.call('app.status') as { apps: AppStatusEntry[] }
      const entries = result.apps ?? []
      // Clear stale entries and rebuild from the authoritative response.
      for (const key of Object.keys(apps)) delete apps[key]
      for (const entry of entries) {
        apps[entry.id] = toResolved(entry)
      }
    } catch {
      // No workspace open or kernel failure — leave current state.
    }
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    await window.kernel.call(enabled ? 'app.enable' : 'app.disable', { id })
    await refresh()
  }

  // Acknowledge trust for a vendored workspace app. Called from the
  // renderer as the USER actor (the default — the preload bridge does not set
  // an explicit actor, and kernel:call defaults to 'user'). The gate
  // hard-denies ai/package actors on app.trust (spec decision 12).
  async function trust(id: string): Promise<void> {
    await window.kernel.call('app.trust', { id })
    await refresh()
  }

  async function remove(id: string): Promise<void> {
    await window.kernel.call('app.remove', { id })
    await refresh()
  }

  function setUpdates(data: Record<string, AppUpdateInfo>): void {
    updates.value = data
  }

  async function fetchUpdates(): Promise<void> {
    try {
      const result = await window.kernel.call('app.updates') as {
        updates: Array<{ id: string; installed: string; latest: string; registryId: string }>
        checkedAt?: string
      }
      const map: Record<string, AppUpdateInfo> = {}
      for (const u of result.updates ?? []) {
        map[u.id] = { installed: u.installed, latest: u.latest, registryId: u.registryId }
      }
      updates.value = map
    } catch {
      // No update info available — leave current state.
    }
  }

  return {
    apps,
    updates,
    updateCount,
    isEnabled,
    isVisible,
    folderPresent,
    isPackageVisible,
    refresh,
    setEnabled,
    trust,
    remove,
    setUpdates,
    fetchUpdates,
  }
})
