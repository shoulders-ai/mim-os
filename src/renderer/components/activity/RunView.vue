<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IconAlertTriangle, IconArrowLeft } from '@tabler/icons-vue'
import MimSegmented from '../ui/MimSegmented.vue'
import { buildSpanTree, flattenTree, type TraceEvent } from '../../services/trace/spans'
import { formatDuration, storySteps, summarizeRun } from '../../services/trace/narrate'
import { spanIcon } from './spanVisuals'
import SpanTree from './SpanTree.vue'
import SpanDetail from './SpanDetail.vue'

const props = defineProps<{ events: TraceEvent[] }>()
const emit = defineEmits<{ back: [] }>()

const lens = ref<'story' | 'timeline'>('story')
const selectedSpanId = ref('')

const run = computed(() => summarizeRun(props.events))
const roots = computed(() => buildSpanTree(props.events))
const nodes = computed(() => flattenTree(roots.value))
const nodeById = computed(() => new Map(nodes.value.map(node => [node.spanId, node])))
const steps = computed(() =>
  storySteps(props.events).map(step => ({ ...step, node: nodeById.value.get(step.spanId) })),
)

const runStart = computed(() => Date.parse(run.value.startedAt) || 0)
const runDuration = computed(() => {
  const span = (Date.parse(run.value.endedAt) || 0) - runStart.value
  return run.value.durationMs > 0 ? run.value.durationMs : span > 0 ? span : 1
})

const selectedSpan = computed(() => nodeById.value.get(selectedSpanId.value) ?? nodes.value[0] ?? null)

const chips = computed(() => {
  const r = run.value
  const out: { label: string; tone?: 'error' }[] = []
  out.push({ label: r.status === 'error' ? `${r.errorCount} ${r.errorCount === 1 ? 'error' : 'errors'}` : 'OK', ...(r.status === 'error' ? { tone: 'error' as const } : {}) })
  if (r.durationMs > 0) out.push({ label: formatDuration(r.durationMs) })
  if (r.actionCount > 0) out.push({ label: `${r.actionCount} ${r.actionCount === 1 ? 'action' : 'actions'}` })
  if (r.files.length > 0) out.push({ label: `${r.files.length} ${r.files.length === 1 ? 'file' : 'files'} changed` })
  if (r.totalTokens > 0) out.push({ label: `${formatCount(r.totalTokens)} tokens` })
  if (r.cost > 0) out.push({ label: formatMoney(r.cost) })
  return out
})

const lensOptions = [
  { value: 'story', label: 'Story' },
  { value: 'timeline', label: 'Timeline' },
]

watch(
  () => run.value.traceId,
  () => {
    lens.value = 'story'
    selectedSpanId.value = nodes.value[0]?.spanId ?? ''
  },
  { immediate: true },
)

function toneText(tone: string): string {
  if (tone === 'error') return 'text-red-700 dark:text-red-300'
  return 'text-ink-2'
}
function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}
function formatMoney(value: number): string {
  return value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(value < 1 ? 4 : 2)}`
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" data-testid="run-view">
    <header class="shrink-0 border-b border-rule-light px-3 py-2">
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="grid h-6 w-6 shrink-0 place-items-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
          title="Back to activity"
          aria-label="Back to activity"
          @click="emit('back')"
        >
          <IconArrowLeft :size="15" :stroke="1.9" />
        </button>
        <h2 class="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{{ run.title }}</h2>
        <MimSegmented v-model="lens" :options="lensOptions" aria-label="Run lens" />
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1.5 pl-8">
        <span
          v-for="chip in chips"
          :key="chip.label"
          class="rounded-full border px-1.5 py-0.5 font-mono text-[10px]"
          :class="chip.tone === 'error' ? 'border-red-500/30 text-red-700 dark:text-red-300' : 'border-rule-light text-ink-3'"
        >
          {{ chip.label }}
        </span>
      </div>
    </header>

    <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-h-0 border-r border-rule-light">
        <!-- Story lens: the readable narrative -->
        <div v-if="lens === 'story'" class="min-h-0 overflow-y-auto overscroll-contain" data-testid="run-story">
          <div v-if="!steps.length" class="px-3 py-6 text-[12px] text-ink-3">
            This run completed with no recorded steps.
          </div>
          <ol v-else class="px-1 py-1">
            <li v-for="step in steps" :key="step.spanId">
              <button
                type="button"
                class="grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5 text-left hover:bg-chrome-mid"
                :class="step.spanId === selectedSpanId ? 'bg-accent-tint' : ''"
                @click="selectedSpanId = step.spanId"
              >
                <span class="grid h-5 w-5 place-items-center" :class="step.tone === 'error' ? 'text-red-600 dark:text-red-300' : 'text-ink-4'">
                  <IconAlertTriangle v-if="step.tone === 'error'" :size="14" :stroke="1.8" />
                  <component :is="spanIcon(step.node)" v-else-if="step.node" :size="14" :stroke="1.8" />
                </span>
                <span class="min-w-0 truncate text-[12px]" :class="toneText(step.tone)">{{ step.label }}</span>
                <span v-if="step.meta" class="shrink-0 font-mono text-[10px] text-ink-4">{{ step.meta }}</span>
              </button>
            </li>
          </ol>
        </div>

        <!-- Timeline lens: the instrument -->
        <SpanTree
          v-else
          :roots="roots"
          :selected-span-id="selectedSpanId"
          :run-start="runStart"
          :run-duration="runDuration"
          @select="selectedSpanId = $event"
        />
      </div>

      <SpanDetail :span="selectedSpan" />
    </div>
  </section>
</template>
