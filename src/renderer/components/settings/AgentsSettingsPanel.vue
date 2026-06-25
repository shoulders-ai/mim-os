<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAgentsStore, type DetectedAgent } from '../../stores/agents.js'
import MimToggle from '../ui/MimToggle.vue'

const agentsStore = useAgentsStore()

const error = ref<string | null>(null)
const agentBusyId = ref<string | null>(null)
const agentAdvancedOpen = ref<string | null>(null)
const mcpStatus = ref<Record<string, 'checking' | 'connected' | 'disconnected' | 'busy'>>({})
const mcpError = ref<Record<string, string>>({})

const AGENT_FLAGS_PLACEHOLDER: Record<string, string> = {
  'claude-code': 'e.g. --dangerously-skip-permissions --verbose',
  'codex': 'e.g. --model o3 --full-auto',
  'gemini-cli': 'e.g. --model gemini-2.5-pro --sandbox',
}

function agentFlagsPlaceholder(agentId: string): string {
  return AGENT_FLAGS_PLACEHOLDER[agentId] ?? 'e.g. --flag value'
}

function toggleAgentAdvanced(agentId: string) {
  agentAdvancedOpen.value = agentAdvancedOpen.value === agentId ? null : agentId
}

async function onAgentFlagsChange(agentId: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  await agentsStore.setFlags(agentId, value)
}

async function toggleAgent(agent: DetectedAgent, enabled: boolean) {
  if (!agent.installed) return
  agentBusyId.value = agent.id
  error.value = null
  try {
    await agentsStore.setEnabled(agent.id, enabled)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    agentBusyId.value = null
  }
}

function agentToggleTitle(agent: DetectedAgent): string {
  if (!agent.installed) return 'Not installed on this machine'
  return agentsStore.isEnabled(agent.id) ? 'Hide launcher in Navigator' : 'Show launcher in Navigator'
}

async function checkMcpStatus() {
  for (const agent of agentsStore.agents) {
    if (agent.installed) mcpStatus.value[agent.id] = 'checking'
  }
  try {
    const result = await window.kernel.call('agent.mcp.status', {}) as { statuses: Record<string, boolean> }
    for (const [id, connected] of Object.entries(result.statuses)) {
      mcpStatus.value[id] = connected ? 'connected' : 'disconnected'
    }
  } catch {
    for (const agent of agentsStore.agents) {
      if (agent.installed && mcpStatus.value[agent.id] === 'checking') {
        mcpStatus.value[agent.id] = 'disconnected'
      }
    }
  }
}

async function connectMcp(agentId: string) {
  mcpStatus.value[agentId] = 'busy'
  mcpError.value[agentId] = ''
  try {
    await window.kernel.call('agent.mcp.connect', { agentId })
    mcpStatus.value[agentId] = 'connected'
  } catch (err) {
    mcpStatus.value[agentId] = 'disconnected'
    mcpError.value[agentId] = (err as Error).message
  }
}

async function disconnectMcp(agentId: string) {
  mcpStatus.value[agentId] = 'busy'
  mcpError.value[agentId] = ''
  try {
    await window.kernel.call('agent.mcp.disconnect', { agentId })
    mcpStatus.value[agentId] = 'disconnected'
  } catch (err) {
    mcpStatus.value[agentId] = 'connected'
    mcpError.value[agentId] = (err as Error).message
  }
}

function refreshAgents() {
  void agentsStore.refresh().then(() => void checkMcpStatus())
}

onMounted(() => {
  refreshAgents()
  window.kernel.on('workspace:changed', refreshAgents)
})

onBeforeUnmount(() => {
  window.kernel.off('workspace:changed', refreshAgents)
})
</script>

<template>
  <section class="flex flex-col font-sans" aria-label="CLI tools">
    <div v-if="error" class="mb-2 rounded-[6px] border border-rem/30 px-2.5 py-2 text-[11.5px] text-rem">
      {{ error }}
    </div>

    <section class="mb-4">
      <h2 class="mb-1.5 text-[9px] font-semibold uppercase tracking-[1.8px] text-ink-3">
        Coding agents
      </h2>
      <div class="overflow-hidden rounded-[8px] border border-rule-light bg-surface">
        <div
          v-for="agent in agentsStore.agents"
          :key="agent.id"
          class="apps-row-wrapper border-b border-rule-light last:border-b-0"
          :data-testid="`apps-row-agent-${agent.id}`"
        >
          <div class="flex items-stretch">
            <div class="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left">
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium text-ink">
                  {{ agent.name }}
                </span>
                <span class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-ink-3">
                  <span class="truncate font-mono">{{ agent.installed ? agent.binPath : 'Not installed' }}</span>
                  <template v-if="agent.installed">
                    <span
                      v-if="agentsStore.getFlags(agent.id)"
                      class="max-w-[180px] truncate rounded-[3px] bg-chrome-mid px-1 font-mono text-[9.5px] text-ink-2"
                      :title="agentsStore.getFlags(agent.id)"
                    >
                      {{ agentsStore.getFlags(agent.id) }}
                    </span>
                    <button
                      v-if="mcpStatus[agent.id] === 'disconnected'"
                      type="button"
                      :data-testid="`agent-mcp-connect-${agent.id}`"
                      class="shrink-0 rounded-[4px] px-1 text-[10px] font-medium text-accent hover:bg-accent-tint hover:text-accent"
                      @click="connectMcp(agent.id)"
                    >
                      Connect
                    </button>
                    <span
                      v-else-if="mcpStatus[agent.id] === 'connected'"
                      :data-testid="`agent-mcp-status-${agent.id}`"
                      class="shrink-0 px-1 text-[10px] text-ink-4"
                    >
                      Connected
                    </span>
                    <span
                      v-else-if="mcpStatus[agent.id] === 'busy' || mcpStatus[agent.id] === 'checking'"
                      class="shrink-0 px-1 text-[10px] text-ink-4"
                    >
                      {{ mcpStatus[agent.id] === 'checking' ? 'Checking…' : 'Connecting…' }}
                    </span>
                    <button
                      type="button"
                      class="shrink-0 rounded-[4px] px-1 text-[10px] font-medium text-accent hover:bg-accent-tint hover:text-accent"
                      :data-testid="`agent-advanced-${agent.id}`"
                      @click="toggleAgentAdvanced(agent.id)"
                    >
                      {{ agentAdvancedOpen === agent.id ? 'Close' : 'Customise' }}
                    </button>
                  </template>
                </span>
              </span>
            </div>
            <div class="flex items-center gap-1.5 px-3">
              <MimToggle
                :data-testid="`apps-toggle-agent-${agent.id}`"
                :model-value="agent.installed && agentsStore.isEnabled(agent.id)"
                :disabled="!agent.installed || agentBusyId === agent.id"
                :aria-label="`${agent.name} ${agentsStore.isEnabled(agent.id) ? 'enabled' : 'disabled'}`"
                :title="agentToggleTitle(agent)"
                @update:model-value="toggleAgent(agent, $event)"
              />
            </div>
          </div>

          <div v-if="agent.installed && agentAdvancedOpen === agent.id" class="flex flex-col gap-2 px-3 pb-3 pl-3">
            <div class="flex flex-col gap-1">
              <label class="text-[10px] font-medium text-ink-3">CLI flags</label>
              <input
                type="text"
                class="h-[26px] min-w-[140px] flex-1 rounded-[5px] border border-rule-light bg-surface px-2 text-[11px] text-ink outline-none placeholder:text-ink-4 focus:border-accent"
                :data-testid="`agent-flags-${agent.id}`"
                :value="agentsStore.getFlags(agent.id)"
                :placeholder="agentFlagsPlaceholder(agent.id)"
                @change="onAgentFlagsChange(agent.id, $event)"
              />
              <span class="text-[10px] text-ink-4">Appended to the launch command. Saved per workspace.</span>
            </div>

            <div class="flex items-center gap-2">
              <span class="text-[10px] font-medium text-ink-3">MCP</span>
              <span v-if="mcpStatus[agent.id] === 'connected'" class="text-[10px] text-ink-4">
                Connected to Mim
              </span>
              <span v-else class="text-[10px] text-ink-4">
                Not connected
              </span>
              <button
                v-if="mcpStatus[agent.id] === 'connected'"
                type="button"
                :data-testid="`agent-mcp-disconnect-${agent.id}`"
                class="rounded-[4px] px-1.5 text-[10px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink-2"
                @click="disconnectMcp(agent.id)"
              >
                Disconnect
              </button>
            </div>

            <div v-if="mcpError[agent.id]" class="text-[10px] text-rem">
              {{ mcpError[agent.id] }}
            </div>
          </div>
        </div>

        <div v-if="!agentsStore.agents.length" class="px-3 py-4 text-center text-[10.5px] text-ink-4">
          No CLI coding agents detected
        </div>
      </div>
      <p class="m-0 mt-1.5 text-[10.5px] leading-5 text-ink-4">
        Enabled agents appear as launchers in the Navigator. Each launch starts a new agent session.
      </p>
    </section>
  </section>
</template>
