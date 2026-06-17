<script setup lang="ts">
import { computed } from 'vue'
import { baseName } from './fileDisplay.js'

const props = defineProps<{
  path: string
  port: number
}>()

// Chromium's built-in PDF viewer renders the iframe; the file is served by
// the local kernel server (renderer pages must not use file:// URLs).
const src = computed(() => {
  if (!props.port) return ''
  const encoded = props.path.split('/').map(encodeURIComponent).join('/')
  return `http://127.0.0.1:${props.port}/workspace-files/${encoded}`
})
</script>

<template>
  <iframe
    v-if="src"
    :src="src"
    :title="baseName(path)"
    class="h-full w-full border-0 bg-surface"
  />
  <div v-else class="flex h-full items-center justify-center font-sans text-xs text-ink-4">
    <p class="m-0">PDF viewer unavailable</p>
  </div>
</template>
