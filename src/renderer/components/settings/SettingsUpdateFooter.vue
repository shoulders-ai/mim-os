<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const currentVersion = ref('')
const availableVersion = ref('')
const readyVersion = ref('')
const checking = ref(false)
const error = ref('')

const label = computed(() => readyVersion.value
  ? `Mim ${readyVersion.value} ready`
  : availableVersion.value
    ? `Mim ${availableVersion.value} available`
    : `Mim ${currentVersion.value || '—'}`)

function onAvailable(payload: unknown) {
  availableVersion.value = versionFrom(payload)
  checking.value = false
}
function onDownloaded(payload: unknown) {
  readyVersion.value = versionFrom(payload)
  checking.value = false
}
function onNotAvailable() {
  checking.value = false
}
function onError(payload: unknown) {
  error.value = payload && typeof payload === 'object' && typeof (payload as { message?: unknown }).message === 'string'
    ? String((payload as { message: string }).message)
    : 'Update check failed'
  checking.value = false
}

async function check() {
  checking.value = true
  error.value = ''
  try {
    await window.kernel.checkForUpdates()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    checking.value = false
  }
}

async function performAction() {
  if (!availableVersion.value) return check()
  checking.value = true
  error.value = ''
  try {
    await window.kernel.downloadUpdate()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    checking.value = false
  }
}

function restart() {
  void window.kernel.quitAndInstall()
}

onMounted(async () => {
  try {
    const info = await window.kernel.call('app.info') as {
      version?: string
      update?: { state?: string; version?: string }
    }
    currentVersion.value = info.version ?? ''
    if (info.update?.state === 'ready') readyVersion.value = info.update.version ?? ''
    else if (info.update?.state === 'available') availableVersion.value = info.update.version ?? ''
  } catch {
    currentVersion.value = ''
  }
  window.kernel.on('app:update-available', onAvailable)
  window.kernel.on('app:update-not-available', onNotAvailable)
  window.kernel.on('app:update-downloaded', onDownloaded)
  window.kernel.on('app:update-error', onError)
})

onBeforeUnmount(() => {
  window.kernel.off('app:update-available', onAvailable)
  window.kernel.off('app:update-not-available', onNotAvailable)
  window.kernel.off('app:update-downloaded', onDownloaded)
  window.kernel.off('app:update-error', onError)
})

function versionFrom(payload: unknown): string {
  return payload && typeof payload === 'object' && typeof (payload as { version?: unknown }).version === 'string'
    ? String((payload as { version: string }).version)
    : currentVersion.value
}
</script>

<template>
  <footer class="flex h-10 shrink-0 items-center justify-between border-t border-rule-light bg-chrome-high px-4 font-sans text-[10px] text-ink-3">
    <span :title="error || undefined">{{ label }}</span>
    <button
      v-if="readyVersion"
      type="button"
      data-testid="settings-restart-update"
      class="rounded-[5px] px-2 py-1 font-semibold text-accent hover:bg-accent-soft"
      @click="restart"
    >
      Restart
    </button>
    <button
      v-else
      type="button"
      data-testid="settings-check-updates"
      class="rounded-[5px] px-2 py-1 font-medium text-ink-2 hover:bg-chrome-mid"
      :disabled="checking"
      @click="performAction"
    >
      {{ checking ? 'Checking…' : availableVersion ? 'Download update' : 'Check for updates' }}
    </button>
  </footer>
</template>
