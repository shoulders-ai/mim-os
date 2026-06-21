<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  packageId: string
  viewId?: string
  port: number
  title?: string
  icon?: string
}>()

const url = ref<string | null>(null)
const error = ref<string | null>(null)

const label = computed(() => props.title || props.packageId)

watch(
  () => [props.packageId, props.viewId, props.port] as const,
  async () => {
    url.value = null
    error.value = null
    if (!props.packageId || !props.port) return

    try {
      url.value = await window.kernel.getPackageLaunchUrl(props.packageId, props.viewId)
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
      :key="`${packageId}:${viewId ?? 'default'}`"
      :src="url"
      class="h-full w-full flex-1 border-0 bg-surface"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />

    <div v-else class="flex flex-1 items-center justify-center font-sans text-[12px] text-ink-3">
      <p>{{ error || 'Loading app view' }}</p>
    </div>
  </section>
</template>
