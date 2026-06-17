// Detected CLI coding agents (Claude Code, Codex, Gemini CLI) from the
// main-process catalog. Refreshed on workspace open. Detection alone never
// surfaces an agent: launcher rows show only agents the user enabled in
// the Apps surface (persisted as the `enabledAgents` workspace setting).

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSettingsStore } from './settings.js'

// Mirrors src/main/agents/agentCatalog.ts — the renderer never imports
// main-process types.
export interface DetectedAgent {
  id: string
  name: string
  bin: string
  args: string[]
  installed: boolean
  binPath?: string
}

export const useAgentsStore = defineStore('agents', () => {
  const settings = useSettingsStore()
  const agents = ref<DetectedAgent[]>([])

  const installedAgents = computed<DetectedAgent[]>(() =>
    agents.value.filter(agent => agent.installed)
  )

  // Launcher rows: installed AND user-enabled. Enablement controls visibility
  // only — session records and relaunch are unaffected by toggling off.
  const enabledAgents = computed<DetectedAgent[]>(() =>
    installedAgents.value.filter(agent => settings.enabledAgents.includes(agent.id))
  )

  function isEnabled(id: string): boolean {
    return settings.enabledAgents.includes(id)
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    const current = settings.enabledAgents
    const next = enabled
      ? (current.includes(id) ? current : [...current, id])
      : current.filter(item => item !== id)
    await settings.set('enabledAgents', next)
  }

  // Custom CLI flags per agent (e.g. --dangerously-skip-permissions for
  // Claude Code, --model for Codex/Gemini). Parsed to string[] at launch.
  function getFlags(id: string): string {
    return settings.agentFlags[id] ?? ''
  }

  function getExtraArgs(id: string): string[] {
    const raw = (settings.agentFlags[id] ?? '').trim()
    if (!raw) return []
    return raw.split(/\s+/)
  }

  async function setFlags(id: string, flags: string): Promise<void> {
    const trimmed = flags.trim()
    const next = { ...settings.agentFlags }
    if (trimmed) {
      next[id] = trimmed
    } else {
      delete next[id]
    }
    await settings.set('agentFlags', next)
  }

  // Error-tolerant: a failed detection pass keeps the last known catalog so
  // launcher rows do not flicker away on a transient kernel error.
  async function refresh(): Promise<void> {
    try {
      const result = await window.kernel.call('agent.list') as { agents?: DetectedAgent[] }
      agents.value = result.agents ?? []
    } catch (err) {
      console.error('[agents] failed to refresh detected agents:', err)
    }
  }

  return {
    agents,
    installedAgents,
    enabledAgents,
    isEnabled,
    setEnabled,
    getFlags,
    getExtraArgs,
    setFlags,
    refresh,
  }
})
