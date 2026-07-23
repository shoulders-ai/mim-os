<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import SettingsGroup from './SettingsGroup.vue'
import SettingRow from './SettingRow.vue'

interface TeamStatus {
  state: string
  repository: string | null
  message: string
  team: {
    name: string
    root: string
    contributions: {
      instructions: boolean
      files: number
      skills: number
      apps: number
      routines: number
    }
  } | null
}

const status = ref<TeamStatus | null>(null)
const repository = ref('')
const busy = ref('')
const error = ref('')

const connected = computed(() => Boolean(status.value?.repository && status.value.team))
const contributionSummary = computed(() => {
  if (!status.value?.team) return ''
  const contributions = status.value.team.contributions
  return [
    contributions.files > 0 ? 'Files' : '',
    contributions.skills > 0 ? 'Skills' : '',
    contributions.apps > 0 ? 'Apps' : '',
    contributions.routines > 0 ? 'Routines' : '',
  ].filter(Boolean).join(' · ') || 'No contributions yet'
})

async function refresh() {
  try {
    status.value = await window.kernel.call('team.status') as TeamStatus
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function connect() {
  if (!repository.value.trim()) return
  busy.value = 'connect'
  error.value = ''
  try {
    status.value = await window.kernel.call('team.connect', { repository: repository.value.trim() }) as TeamStatus
    repository.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = ''
  }
}

async function sync() {
  busy.value = 'sync'
  error.value = ''
  try {
    status.value = await window.kernel.call('team.sync') as TeamStatus
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    await refresh()
  } finally {
    busy.value = ''
  }
}

async function open() {
  const result = await window.kernel.call('team.open') as { team: { root: string } }
  await window.kernel.revealInFinder(result.team.root)
}

onMounted(() => {
  void refresh()
  window.kernel.on('team:changed', refresh)
})
onBeforeUnmount(() => window.kernel.off('team:changed', refresh))
</script>

<template>
  <section class="flex flex-col gap-6 text-ink" aria-label="Team settings">
    <SettingsGroup v-if="connected && status?.team" title="Team source">
      <div class="rounded-[7px] border border-rule-light bg-surface p-4">
        <div class="text-[15px] font-semibold text-ink">{{ status.team.name }}</div>
        <div class="mt-1 truncate font-mono text-[10px] text-ink-3" :title="status.repository || ''">{{ status.repository }}</div>
        <div class="mt-2 text-[11px]" :class="status.state === 'synced' ? 'text-add' : status.state === 'stopped' ? 'text-rem' : 'text-ink-3'">
          {{ status.message }}
        </div>
        <div class="mt-4 border-t border-rule-light pt-3 text-[11px] text-ink-2">{{ contributionSummary }}</div>
        <div class="mt-4 flex gap-2">
          <button type="button" data-testid="team-open" class="h-7 rounded-[5px] border border-rule-light px-3 text-[11px] text-ink-2 hover:bg-chrome-mid" @click="open">Open</button>
          <button type="button" class="h-7 rounded-[5px] bg-accent px-3 text-[11px] font-semibold text-accent-ink hover:bg-accent/90 disabled:opacity-50" :disabled="busy !== ''" @click="sync">
            {{ busy === 'sync' ? 'Syncing' : 'Sync now' }}
          </button>
        </div>
      </div>
    </SettingsGroup>

    <SettingsGroup v-else title="Team source">
      <p class="pb-3 text-[11px] leading-5 text-ink-3">Connect one writable Git repository for shared files, instructions, skills, apps, and routines.</p>
      <SettingRow label="Repository" desc="Uses your system Git credentials.">
        <div class="flex min-w-[320px] gap-2">
          <input v-model="repository" placeholder="git@github.com:team/mim.git" class="h-8 min-w-0 flex-1 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[10px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" @keydown.enter="connect" />
          <button type="button" class="h-8 shrink-0 rounded-[5px] bg-accent px-3 text-[11px] font-semibold text-accent-ink hover:bg-accent/90 disabled:opacity-50" :disabled="busy !== '' || !repository.trim()" @click="connect">
            {{ busy === 'connect' ? 'Connecting' : 'Connect Team source' }}
          </button>
        </div>
      </SettingRow>
    </SettingsGroup>
    <p v-if="error" class="m-0 text-[11px] text-rem">{{ error }}</p>
  </section>
</template>
