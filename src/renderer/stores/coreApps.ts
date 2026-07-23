import { defineStore } from 'pinia'
import { reactive } from 'vue'

export type AppLayer = 'local' | 'default'

export interface ResolvedApp {
  id: string
  enabled: boolean
  layer: AppLayer
  source?: 'mim' | 'team' | 'project'
  version?: string
  shadowed: boolean
  needsTrust: boolean
  visible: boolean
  folderPresent: boolean
}

type AppStatusEntry = Omit<ResolvedApp, 'visible'>

function resolve(entry: AppStatusEntry): ResolvedApp {
  return {
    id: entry.id,
    enabled: entry.enabled,
    layer: entry.layer,
    source: entry.source,
    version: entry.version,
    shadowed: entry.shadowed,
    needsTrust: entry.needsTrust,
    visible: entry.enabled && !entry.needsTrust,
    folderPresent: entry.folderPresent,
  }
}

export const useAppsStore = defineStore('coreApps', () => {
  const apps = reactive<Record<string, ResolvedApp>>({})

  const isEnabled = (id: string) => apps[id]?.enabled === true
  const isVisible = (id: string) => apps[id]?.visible === true
  const folderPresent = (id: string) => apps[id]?.folderPresent === true
  const isPackageVisible = (id: string) => apps[id]?.visible ?? true

  async function refresh(): Promise<void> {
    try {
      const result = await window.kernel.call('app.status') as { apps?: AppStatusEntry[] }
      for (const key of Object.keys(apps)) delete apps[key]
      for (const entry of result.apps ?? []) apps[entry.id] = resolve(entry)
    } catch {
      // A Project can close while an app refresh is in flight.
    }
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    await window.kernel.call(enabled ? 'app.enable' : 'app.disable', { id })
    await refresh()
  }

  async function trust(id: string): Promise<void> {
    await window.kernel.call('app.trust', { id })
    await refresh()
  }

  return {
    apps,
    isEnabled,
    isVisible,
    folderPresent,
    isPackageVisible,
    refresh,
    setEnabled,
    trust,
  }
})
