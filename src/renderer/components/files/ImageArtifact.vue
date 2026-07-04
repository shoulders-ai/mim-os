<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { baseName } from './fileDisplay.js'

const props = defineProps<{
  path: string
}>()

const dataUrl = ref<string | null>(null)
const loadError = ref('')
const naturalSize = ref<{ width: number; height: number } | null>(null)
const fullSize = ref(false)
let loadToken = 0

const name = computed(() => baseName(props.path))
const dimensionsLabel = computed(() =>
  naturalSize.value ? `${naturalSize.value.width} × ${naturalSize.value.height}px` : '',
)

watch(() => props.path, load, { immediate: true })

async function load() {
  const token = ++loadToken
  dataUrl.value = null
  loadError.value = ''
  naturalSize.value = null
  fullSize.value = false
  try {
    const result = await window.kernel.call('fs.readImageDataUrl', { path: props.path }) as { dataUrl?: string }
    if (token !== loadToken) return
    dataUrl.value = result.dataUrl ?? null
    if (!dataUrl.value) loadError.value = 'Image could not be loaded.'
  } catch (err) {
    if (token !== loadToken) return
    loadError.value = err instanceof Error ? err.message : String(err)
  }
}

function onImageLoad(event: Event) {
  const img = event.target as HTMLImageElement
  naturalSize.value = { width: img.naturalWidth, height: img.naturalHeight }
}

function toggleZoom() {
  fullSize.value = !fullSize.value
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-surface">
    <div
      class="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
      :class="fullSize ? 'items-start justify-start' : ''"
    >
      <img
        v-if="dataUrl"
        :src="dataUrl"
        :alt="name"
        :class="fullSize ? 'max-w-none' : 'max-h-full max-w-full object-contain'"
        @load="onImageLoad"
        @click="toggleZoom"
      >
      <p v-else-if="loadError" class="m-0 max-w-[420px] text-center text-[12px] text-ink-3">
        {{ loadError }}
      </p>
    </div>
    <div class="flex h-7 shrink-0 items-center gap-3 border-t border-rule-light px-3 text-[11px] text-ink-3">
      <span class="truncate" :title="path">{{ name }}</span>
      <span v-if="dimensionsLabel">{{ dimensionsLabel }}</span>
      <span v-if="dataUrl" class="ml-auto">{{ fullSize ? '100%' : 'Fit' }} — click image to toggle</span>
    </div>
  </div>
</template>
