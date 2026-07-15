<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-vue'
import {
  compactionRecordDetail,
  compactionTokenTransition,
  type ChatCompactionRecord,
} from './compactionDivider.js'

const props = defineProps<{
  record: ChatCompactionRecord
}>()

const expanded = ref(false)

const title = computed(() => expanded.value ? 'Hide summary' : 'Show summary')
const chevron = computed(() => expanded.value ? IconChevronDown : IconChevronRight)
const detail = computed(() => compactionRecordDetail(props.record))
const tokenTransition = computed(() => compactionTokenTransition(props.record))
</script>

<template>
  <div class="py-1 font-sans" data-testid="chat-compaction-divider">
    <div class="flex items-center gap-3 text-[11px] leading-4 text-ink-3">
      <div class="h-px min-w-4 flex-1 bg-rule-light" />
      <button
        type="button"
        class="flex min-w-0 max-w-full items-center gap-1.5 rounded-[4px] bg-transparent px-2 py-1 text-left text-ink-3 hover:bg-chrome-mid hover:text-ink-2"
        :aria-expanded="expanded"
        :title="title"
        @click="expanded = !expanded"
      >
        <component :is="chevron" :size="12" :stroke="2" class="shrink-0 text-ink-4" />
        <span class="shrink-0 font-medium text-ink-2">Context compacted</span>
        <span v-if="tokenTransition" class="shrink-0 font-mono text-[10px] text-ink-4">{{ tokenTransition }}</span>
        <span class="min-w-0 truncate text-ink-4">{{ detail }} Full chat stays visible.</span>
      </button>
      <div class="h-px min-w-4 flex-1 bg-rule-light" />
    </div>

    <div
      v-if="expanded"
      class="mx-auto mt-2 max-w-[640px] border-l border-rule-light pl-3 text-[12px] leading-5 text-ink-2 [overflow-wrap:anywhere]"
      data-testid="chat-compaction-summary"
    >
      <div class="mb-1 font-medium text-ink-3">Summary</div>
      <div class="whitespace-pre-wrap">{{ props.record.summary }}</div>
    </div>
  </div>
</template>
