<script setup lang="ts">
import {
  IconActivity,
  IconAlertTriangle,
  IconPackage,
  IconRobot,
  IconShieldCheck,
  IconWorld,
} from '@tabler/icons-vue'
import type { RunSummary } from '../../services/trace/narrate'

defineProps<{
  runs: RunSummary[]
}>()

const emit = defineEmits<{
  openRun: [traceId: string]
}>()

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

function formatMoney(value: number): string {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(value < 1 ? 4 : 2)}`
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
  <div class="min-h-0" data-testid="activity-feed">
    <div v-if="!runs.length" class="px-3 py-6 text-[12px] text-ink-3">
      No runs in this range.
    </div>
    <div v-else class="divide-y divide-rule-light">
      <button
        v-for="run in runs"
        :key="run.traceId"
        type="button"
        class="grid w-full grid-cols-[26px_minmax(0,1fr)_auto] gap-3 px-3 py-2 text-left hover:bg-chrome-mid"
        :title="run.title"
        @click="emit('openRun', run.traceId)"
      >
        <span class="mt-0.5 grid h-6 w-6 place-items-center rounded-[5px] border border-rule-light bg-surface text-ink-3">
          <IconAlertTriangle v-if="run.status === 'error'" :size="14" :stroke="1.8" class="text-red-600 dark:text-red-300" />
          <IconRobot v-else-if="run.actor === 'ai'" :size="14" :stroke="1.8" />
          <IconPackage v-else-if="run.actor === 'package'" :size="14" :stroke="1.8" />
          <IconActivity v-else :size="14" :stroke="1.8" />
        </span>
        <span class="min-w-0">
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate text-[12px] font-medium text-ink">{{ run.title }}</span>
            <span v-if="run.approvalCount" class="shrink-0 text-ink-4" title="Approvals in this run">
              <IconShieldCheck :size="12" :stroke="1.8" />
            </span>
            <span v-if="run.externalCount" class="shrink-0 text-ink-4" title="External requests in this run">
              <IconWorld :size="12" :stroke="1.8" />
            </span>
          </span>
          <span class="mt-0.5 block truncate font-sans text-[11px] text-ink-4">{{ run.detail }}</span>
        </span>
        <span class="flex min-w-[96px] flex-col items-end gap-0.5">
          <span class="font-mono text-[10px] text-ink-4">{{ formatTime(run.endedAt) }}</span>
          <span v-if="run.cost > 0" class="font-mono text-[11px] text-ink-3">{{ formatMoney(run.cost) }}</span>
          <span v-else-if="run.totalTokens > 0" class="font-mono text-[11px] text-ink-3">{{ formatCount(run.totalTokens) }} tok</span>
        </span>
      </button>
    </div>
  </div>
</template>
