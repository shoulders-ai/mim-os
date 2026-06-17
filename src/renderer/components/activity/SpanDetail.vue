<script setup lang="ts">
import { computed } from 'vue'
import { IconAlertTriangle } from '@tabler/icons-vue'
import type { FoldedSpan } from '../../services/trace/spans'
import { formatDuration } from '../../services/trace/narrate'
import { spanIcon, spanKindLabel } from './spanVisuals'

const props = defineProps<{ span: FoldedSpan | null }>()

interface Fact {
  label: string
  value: string
  mono?: boolean
}

const facts = computed<Fact[]>(() => {
  const span = props.span
  if (!span) return []
  const out: Fact[] = []
  if (span.tool) out.push({ label: 'Tool', value: span.tool, mono: true })
  if (span.model) out.push({ label: 'Model', value: span.model, mono: true })
  if (span.subject) out.push({ label: 'Subject', value: span.subject, mono: true })
  if (span.packageId) out.push({ label: 'Package', value: packageLabel(span), mono: true })
  if (span.durationMs !== undefined) out.push({ label: 'Duration', value: formatDuration(span.durationMs), mono: true })
  const tokens = numberValue(span.data.totalTokens)
  if (tokens) out.push({ label: 'Tokens', value: formatCount(tokens), mono: true })
  const cost = numberValue(span.data.estimatedCost)
  if (cost) out.push({ label: 'Cost', value: formatMoney(cost), mono: true })
  const decision = stringValue(span.data.decision)
  if (decision) out.push({ label: 'Decision', value: decision })
  out.push({ label: 'Started', value: formatTime(span.startedAt), mono: true })
  return out
})

const summaryJson = computed(() => (props.span?.summary ? prettyJson(props.span.summary) : ''))
const isError = computed(() => props.span?.error === true)

function packageLabel(span: FoldedSpan): string {
  return span.packageVersion ? `${span.packageId}@${span.packageVersion}` : (span.packageId ?? '')
}
function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}
function formatMoney(value: number): string {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(value < 1 ? 4 : 2)}`
}
function formatTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}
</script>

<template>
  <aside class="flex min-h-0 flex-col bg-chrome-high" data-testid="span-detail">
    <div v-if="!span" class="grid flex-1 place-items-center px-4 text-center text-[12px] text-ink-4">
      Select a step to see what happened
    </div>
    <template v-else>
      <div class="flex shrink-0 items-center gap-2 border-b border-rule-light px-3 py-2">
        <span
          class="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] border border-rule-light bg-surface"
          :class="isError ? 'text-red-600 dark:text-red-300' : 'text-ink-3'"
        >
          <IconAlertTriangle v-if="isError" :size="14" :stroke="1.8" />
          <component :is="spanIcon(span)" v-else :size="14" :stroke="1.8" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[12px] font-medium text-ink">{{ spanKindLabel(span.kind) }}</span>
          <span class="block truncate font-mono text-[10px] text-ink-4">{{ span.spanId }}</span>
        </span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <dl class="divide-y divide-rule-light">
          <div v-for="fact in facts" :key="fact.label" class="grid grid-cols-[88px_minmax(0,1fr)] gap-2 px-3 py-1.5">
            <dt class="font-sans text-[11px] text-ink-4">{{ fact.label }}</dt>
            <dd class="min-w-0 truncate text-[11px] text-ink-2" :class="fact.mono ? 'font-mono' : 'font-sans'">{{ fact.value }}</dd>
          </div>
        </dl>

        <div v-if="span.payloadRef" class="border-t border-rule-light px-3 py-2 text-[11px] text-ink-4">
          Full payload captured for this step.
        </div>

        <div v-if="summaryJson" class="border-t border-rule-light">
          <div class="px-3 pt-2 font-sans text-[10px] font-semibold uppercase text-ink-3">Summary</div>
          <pre class="overflow-x-auto overscroll-contain px-3 py-2 font-mono text-[10.5px] leading-5 text-ink-2">{{ summaryJson }}</pre>
        </div>
      </div>
    </template>
  </aside>
</template>
