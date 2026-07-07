<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { readThemeTokens } from './themeTokens'

const props = defineProps<{
  packageId: string
  viewId?: string
  port: number
  title?: string
  icon?: string
}>()

const url = ref<string | null>(null)
const error = ref<string | null>(null)
const iframeEl = ref<HTMLIFrameElement | null>(null)
const iframeLoaded = ref(false)

const label = computed(() => props.title || props.packageId)
const settings = useSettingsStore()

function sendTheme() {
  if (!iframeEl.value?.contentWindow || !iframeLoaded.value) return
  iframeEl.value.contentWindow.postMessage(
    { type: 'mim:theme', tokens: readThemeTokens() },
    '*',
  )
}

function onIframeLoad() {
  iframeLoaded.value = true
  sendTheme()
}

watch(() => settings.theme, sendTheme)

watch(
  () => [props.packageId, props.viewId, props.port] as const,
  async () => {
    url.value = null
    error.value = null
    iframeLoaded.value = false
    if (!props.packageId || !props.port) return

    try {
      const base = await window.kernel.getPackageLaunchUrl(props.packageId, props.viewId)
      // Theme rides along in the fragment so the app can paint with the
      // host theme from its very first frame; the postMessage in sendTheme
      // only arrives after the iframe has loaded (and covers live changes).
      url.value = `${base}#mim-theme=${encodeURIComponent(JSON.stringify(readThemeTokens()))}`
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    }
  },
  { immediate: true },
)
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface" :aria-label="label">
    <iframe
      v-if="url"
      ref="iframeEl"
      :key="`${packageId}:${viewId ?? 'default'}`"
      :src="url"
      class="h-full w-full flex-1 border-0 bg-surface"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      @load="onIframeLoad"
    />

    <div v-else class="flex flex-1 items-center justify-center font-sans text-[12px] text-ink-3">
      <p>{{ error || 'Loading app view' }}</p>
    </div>
  </section>
</template>
