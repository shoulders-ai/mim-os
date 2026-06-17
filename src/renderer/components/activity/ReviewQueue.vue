<script setup lang="ts">
import { IconAlertTriangle, IconCircleCheck, IconRotateClockwise, IconShieldCheck } from '@tabler/icons-vue'
import type { ReviewItem } from '../../services/trace/reviewItems'

defineProps<{
  items: ReviewItem[]
}>()

const emit = defineEmits<{
  openRun: [traceId: string]
}>()

function itemIcon(item: ReviewItem) {
  if (item.tone === 'error') return IconAlertTriangle
  if (item.event.kind === 'outcome.edit') return IconRotateClockwise
  return IconShieldCheck
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <section class="border-b border-rule-light" data-testid="signal-queue">
    <div class="flex items-center gap-2 border-b border-rule-light bg-chrome-high px-3 py-2">
      <div class="min-w-0 flex-1">
        <div class="text-[12px] font-medium text-ink">Signals</div>
        <div class="mt-0.5 text-[11px] text-ink-4">
          {{ items.length ? `${items.length} notable event${items.length === 1 ? '' : 's'} in this range` : 'No notable events in this range' }}
        </div>
      </div>
    </div>

    <div v-if="!items.length" class="flex items-center gap-3 px-3 py-4 text-[12px] text-ink-3">
      <span class="grid h-6 w-6 place-items-center rounded-[5px] border border-rule-light bg-surface text-ink-4">
        <IconCircleCheck :size="14" :stroke="1.8" />
      </span>
      <span>No errors, denials, or reverted outputs found.</span>
    </div>

    <div v-else class="divide-y divide-rule-light">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="grid w-full grid-cols-[26px_minmax(0,1fr)_auto] gap-3 px-3 py-2 text-left hover:bg-chrome-mid"
        :title="item.title"
        @click="emit('openRun', item.traceId)"
      >
        <span
          class="mt-0.5 grid h-6 w-6 place-items-center rounded-[5px] border border-rule-light bg-surface"
          :class="item.tone === 'error' ? 'text-red-600 dark:text-red-300' : 'text-ink-3'"
        >
          <component :is="itemIcon(item)" :size="14" :stroke="1.8" />
        </span>
        <span class="min-w-0">
          <span class="block truncate text-[12px] font-medium text-ink">{{ item.title }}</span>
          <span class="mt-0.5 block truncate text-[11px] text-ink-4">{{ item.detail }}</span>
        </span>
        <span class="font-mono text-[10px] text-ink-4">{{ formatTime(item.ts) }}</span>
      </button>
    </div>
  </section>
</template>
