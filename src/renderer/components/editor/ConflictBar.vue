<script setup lang="ts">
import { computed } from 'vue'
import { IconAlertTriangle, IconRefresh, IconUpload, IconArrowsSplit2 } from '@tabler/icons-vue'

const props = defineProps<{
  externalState: 'changed' | 'deleted'
}>()

const emit = defineEmits<{
  reload: []
  overwrite: []
  compare: []
}>()

const message = computed(() =>
  props.externalState === 'deleted'
    ? 'Deleted on disk by another process'
    : 'Changed on disk by another process'
)

const reloadLabel = computed(() =>
  props.externalState === 'deleted' ? 'Recreate from buffer' : 'Reload'
)

const reloadTitle = computed(() =>
  props.externalState === 'deleted'
    ? 'Write the current buffer content back to disk'
    : 'Discard buffer changes and reload the file from disk'
)
</script>

<template>
  <div
    class="flex h-9 shrink-0 items-center gap-2 border-b border-rem/30 bg-chrome-high px-3"
    data-testid="conflict-bar"
  >
    <IconAlertTriangle :size="14" :stroke-width="2" class="shrink-0 text-rem" />
    <span class="min-w-0 flex-1 truncate font-sans text-[11px] font-medium text-ink-2">{{ message }}</span>

    <button
      type="button"
      class="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-2.5 font-sans text-[11px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink"
      :title="reloadTitle"
      data-testid="conflict-reload"
      @mousedown.prevent
      @click="emit('reload')"
    >
      <IconRefresh :size="13" :stroke-width="2.2" />
      <span>{{ reloadLabel }}</span>
    </button>

    <button
      type="button"
      class="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-2.5 font-sans text-[11px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink"
      title="Write buffer content to disk, overriding the external change"
      data-testid="conflict-overwrite"
      @mousedown.prevent
      @click="emit('overwrite')"
    >
      <IconUpload :size="13" :stroke-width="2.2" />
      <span>Overwrite</span>
    </button>

    <button
      v-if="externalState === 'changed'"
      type="button"
      class="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-2.5 font-sans text-[11px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink"
      title="Compare disk content with your buffer in a diff view"
      data-testid="conflict-compare"
      @mousedown.prevent
      @click="emit('compare')"
    >
      <IconArrowsSplit2 :size="13" :stroke-width="2.2" />
      <span>Compare</span>
    </button>
  </div>
</template>
