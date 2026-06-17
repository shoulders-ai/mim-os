<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppsStore } from '../stores/coreApps.js'

// Committed-but-missing apps (mim.yaml names them, this machine lacks them)
// surface as one workspace-level moment instead of rows buried in settings.
// Dismissible per session; App.vue re-mounts on workspace change.
const appsStore = useAppsStore()
const dismissed = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

const missingApps = computed(() =>
  Object.values(appsStore.apps).filter(app => app.needsInstall && app.source),
)

const appNames = computed(() => missingApps.value.map(app => app.id).join(', '))

async function addAll() {
  busy.value = true
  error.value = null
  try {
    for (const app of missingApps.value) {
      await window.kernel.call('package.install', {
        repo: app.source,
        ...(app.path ? { path: app.path } : {}),
      })
    }
    await appsStore.refresh()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    v-if="!dismissed && missingApps.length"
    data-testid="missing-apps-banner"
    class="flex items-start gap-3 border-b border-rule-light bg-accent-soft px-4 py-3 font-sans text-xs text-ink-2"
  >
    <div class="min-w-0 flex-1">
      <p class="font-medium text-ink">
        This workspace uses {{ appNames }}{{ missingApps.length === 1 ? ', which is' : ', which are' }} not installed on this machine.
      </p>
      <p class="mt-0.5 text-ink-3">
        Adding installs {{ missingApps.length === 1 ? 'it' : 'them' }} from the source declared in mim.yaml.
      </p>
      <p v-if="error" class="mt-0.5 text-rem">{{ error }}</p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <button
        data-testid="missing-apps-add-all"
        class="rounded bg-accent px-3 py-1 font-medium text-accent-ink hover:opacity-85 disabled:opacity-50"
        :disabled="busy"
        @click="addAll"
      >{{ missingApps.length === 1 ? 'Add it' : 'Add all' }}</button>
      <button
        class="rounded px-2 py-1 text-ink-3 hover:text-ink"
        title="Dismiss"
        @click="dismissed = true"
      >Dismiss</button>
    </div>
  </div>
</template>
