<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '../../stores/settings.js'

const settings = useSettingsStore()

interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

const appInfo = ref<AppInfo | null>(null)
const workspacePath = ref<string | null>(null)

const identity = computed(() => {
  const parts = [settings.configUserName, settings.configUserEmail].filter(Boolean)
  return parts.join(' · ')
})

// Electron/Chrome/Node are pinned per build (identical for every user of a
// given Mim version), so they live in the diagnostics payload, not the UI.
const rows = computed(() => {
  const list: { label: string; value: string; mono?: boolean }[] = []
  if (workspacePath.value) list.push({ label: 'Workspace', value: workspacePath.value, mono: true })
  list.push({ label: 'Config', value: '~/.mim', mono: true })
  if (identity.value) list.push({ label: 'You', value: identity.value })
  if (settings.configTimezone) list.push({ label: 'Timezone', value: settings.configTimezone })
  return list
})

onMounted(async () => {
  try {
    appInfo.value = await window.kernel.call('app.info') as AppInfo
  } catch { /* headless / older main without app.info */ }
  workspacePath.value = await window.kernel.getWorkspace()
})
</script>

<template>
  <section class="flex flex-col items-center pt-8 text-center text-ink" aria-label="About">
    <span class="font-brand text-[22px] text-ink">Mim</span>
    <span class="mt-1 font-mono text-[10px] text-ink-3">{{ appInfo ? `v${appInfo.version}` : '' }}</span>

    <div class="mt-6 w-full max-w-[320px] border-t border-rule-light pt-2">
      <div
        v-for="row in rows"
        :key="row.label"
        class="flex items-center justify-between gap-4 border-b border-rule-light py-2 last:border-b-0"
      >
        <span class="shrink-0 font-sans text-[11px] text-ink-3">{{ row.label }}</span>
        <span
          class="min-w-0 truncate text-[10.5px] text-ink-2"
          :class="row.mono ? 'font-mono' : 'font-sans'"
          :title="row.value"
        >{{ row.value }}</span>
      </div>
    </div>

    <span class="mt-6 font-sans text-[10px] text-ink-4">© 2026</span>
  </section>
</template>
