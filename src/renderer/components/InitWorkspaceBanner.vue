<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ missing: string[] }>()
const emit = defineEmits<{ initialize: [] }>()

const dismissed = ref(false)

function onInitialize() {
  emit('initialize')
}
</script>

<template>
  <div
    v-if="!dismissed"
    class="flex items-center gap-3 border-b border-rule-light bg-accent-soft px-4 py-2 font-sans text-xs"
  >
    <span class="text-ink-3">Workspace not initialized</span>
    <div class="ml-auto flex items-center gap-2">
      <button
        class="rounded bg-accent px-2.5 py-0.5 font-medium text-accent-ink hover:opacity-85"
        @click="onInitialize"
      >Initialize</button>
      <button
        class="rounded px-1.5 py-0.5 text-ink-3 hover:text-ink"
        title="Dismiss"
        @click="dismissed = true"
      >Dismiss</button>
    </div>
  </div>
</template>
