<script setup lang="ts">
import { computed } from 'vue'
import { IconRefresh } from '@tabler/icons-vue'
import {
  contextPreparationCopy,
  type ContextPreparationKind,
  type ContextPreparationPhase,
} from './contextCompactionStatus.js'

const props = defineProps<{
  kind: ContextPreparationKind
  phase: ContextPreparationPhase
}>()

const copy = computed(() => contextPreparationCopy({ kind: props.kind }, props.phase))
</script>

<template>
  <div class="py-1 font-sans" role="status" aria-live="polite" data-testid="chat-turn-status">
    <div class="mx-auto flex max-w-[640px] items-center gap-2 rounded-[5px] border border-rule-light bg-chrome-high px-2.5 py-1.5 text-[12px] leading-4 text-ink-3">
      <IconRefresh :size="13" :stroke="2" class="shrink-0 animate-spin text-ink-4" />
      <span class="shrink-0 font-medium text-ink-2">{{ copy.title }}</span>
      <span class="min-w-0 truncate text-ink-4">{{ copy.detail }}</span>
    </div>
  </div>
</template>
