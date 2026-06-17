<script setup lang="ts">
import {
  IconArrowBarLeft,
  IconArrowBarRight,
} from '@tabler/icons-vue'
import type { PaneId } from '../../services/workbench/entries.js'

const props = withDefaults(defineProps<{
  pane: PaneId
  title: string
  subtitle?: string
  meta?: string
  // Hide the top restore cap so the rail reads as a quiet labeled column
  // while another pane's header owns restore controls (both left panes
  // collapsed). The rail button is still clickable to restore.
  quiet?: boolean
}>(), {
  subtitle: '',
  meta: '',
  quiet: false,
})

defineEmits<{
  restore: []
}>()

const railButtonClass = 'group flex h-full w-11 flex-col items-center overflow-hidden border-rule-light bg-chrome-high text-ink-3 hover:bg-chrome-mid hover:text-ink'

function railTitle(): string {
  const label = props.pane === 'work' ? 'Work' : 'Artifact'
  return `Show ${label}: ${props.title}`
}
</script>

<template>
  <button
    type="button"
    :class="[
      railButtonClass,
      pane === 'work' ? 'border-r' : 'border-l',
    ]"
    :title="railTitle()"
    :aria-label="railTitle()"
    @click="$emit('restore')"
  >
    <span
      v-if="!quiet"
      class="flex h-10 w-full shrink-0 items-center justify-center border-b border-rule-light"
    >
      <IconArrowBarRight v-if="pane === 'work'" :size="15" :stroke-width="1.9" />
      <IconArrowBarLeft v-else :size="15" :stroke-width="1.9" />
    </span>

    <span class="flex min-h-0 flex-1 items-center justify-center py-3">
      <span class="flex max-h-full min-h-0 items-center gap-2 [writing-mode:vertical-rl]">
        <span class="max-h-[220px] truncate font-sans text-[11px] font-[650] tracking-normal text-ink-2 group-hover:text-ink">
          {{ title }}
        </span>
        <span v-if="subtitle" class="max-h-[160px] truncate font-mono text-[9px] text-ink-4">
          {{ subtitle }}
        </span>
      </span>
    </span>

    <span class="flex h-10 w-full shrink-0 items-center justify-center border-t border-rule-light">
      <span class="max-w-8 truncate font-mono text-[9px] font-[650] uppercase tracking-normal text-ink-4">
        {{ meta || (pane === 'work' ? 'Work' : 'Obj') }}
      </span>
    </span>
  </button>
</template>
