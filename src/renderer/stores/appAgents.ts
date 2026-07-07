// App-mounted agents store — the renderer's source of truth for agents
// contributed by installed packages. Each agent is a headless chat profile
// defined in a package manifest. Refreshed on boot and on packages:changed.
//
// These are distinct from CLI agents (stores/agents.ts) — CLI agents are
// detected binaries; app agents are package-declared chat profiles resolved
// by the app system.

import { defineStore } from 'pinia'
import { ref } from 'vue'

// Mirrors the shape returned by app.agents.list (src/main/tools/coreApps.ts).
// The id is `package:<packageId>/<key>`.
export interface AppAgent {
  id: string
  packageId: string
  key: string
  name: string
  icon?: string
  model?: string
  scoped: boolean
  toolCount?: number
  skills: string[]
  diagnostics: string[]
}

export const useAppAgentsStore = defineStore('appAgents', () => {
  const agents = ref<AppAgent[]>([])

  function byId(id: string): AppAgent | undefined {
    return agents.value.find(a => a.id === id)
  }

  async function refresh(): Promise<void> {
    try {
      const result = await window.kernel.call('app.agents.list') as { agents: AppAgent[] }
      agents.value = result.agents ?? []
    } catch {
      // No workspace open or kernel failure — leave current state.
    }
  }

  return {
    agents,
    byId,
    refresh,
  }
})
