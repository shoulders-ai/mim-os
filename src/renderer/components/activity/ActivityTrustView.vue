<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IconClock, IconFilter, IconRefresh, IconSearch } from '@tabler/icons-vue'
import MimSegmented from '../ui/MimSegmented.vue'
import MimSelect, { type MimSelectOption } from '../ui/MimSelect.vue'
import RunView from './RunView.vue'
import ActivityFeed from './ActivityFeed.vue'
import AuditView from './AuditView.vue'
import ReviewQueue from './ReviewQueue.vue'
import { summarizeRun, type RunSummary } from '../../services/trace/narrate'
import { buildReviewItems } from '../../services/trace/reviewItems'
import type { TraceActor, TraceEvent, TraceStatus } from '../../services/trace/spans'

type SurfaceMode = 'review' | 'audit' | 'run'

interface ToolTraceStats {
  tool: string
  calls: number
  successes: number
  errors: number
  errorRate: number
  avgDurationMs: number
  totalDurationMs: number
}

interface PackageTraceStats {
  packageId: string
  events: number
  errors: number
  errorRate: number
}

interface ModelTraceStats {
  model: string
  calls: number
  totalTokens: number
  estimatedCost: number
  avgDurationMs: number
}

interface DayTraceStats {
  day: string
  events: number
  errors: number
  estimatedCost: number
}

interface GateTraceStats {
  tool: string
  allowed: number
  requested: number
  approved: number
  denied: number
  bypassed: number
  denialRate: number
  approvalRate: number
}

interface JobTraceStats {
  subject: string
  started: number
  completed: number
  failed: number
  cancelled: number
  avgDurationMs: number
}

interface TraceStats {
  events: { total: number; errors: number }
  byTool: ToolTraceStats[]
  byPackage: PackageTraceStats[]
  byModel: ModelTraceStats[]
  byDay: DayTraceStats[]
  gates: GateTraceStats[]
  jobs: JobTraceStats[]
  outcomes: { edits: number; reverted: number; avgDiffRatio: number }
}

const props = withDefaults(defineProps<{
  active?: boolean
}>(), {
  active: true,
})

const surfaceMode = ref<SurfaceMode>('review')
const returnMode = ref<'review' | 'audit'>('review')
const days = ref(7)
const statusFilter = ref<'all' | TraceStatus>('all')
const actorFilter = ref<'all' | TraceActor>('all')
const query = ref('')
const loading = ref(false)
const error = ref('')
const refreshedAt = ref('')
const retentionDays = ref<number | null>(90)
const stats = ref<TraceStats | null>(null)
const events = ref<TraceEvent[]>([])
const runEvents = ref<TraceEvent[]>([])

const modeOptions = [
  { value: 'review', label: 'Monitor' },
  { value: 'audit', label: 'Audit' },
]

const dayOptions: MimSelectOption[] = [
  { value: 1, label: '1 day' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
]

const statusOptions: MimSelectOption[] = [
  { value: 'all', label: 'All status' },
  { value: 'error', label: 'Errors' },
  { value: 'ok', label: 'OK' },
]

const actorOptions: MimSelectOption[] = [
  { value: 'all', label: 'All actors' },
  { value: 'ai', label: 'Mim' },
  { value: 'package', label: 'Packages' },
  { value: 'user', label: 'You' },
  { value: 'system', label: 'System' },
]

const visibleEvents = computed(() => {
  const q = query.value.trim().toLowerCase()
  return events.value.filter(event => {
    if (!eventMatchesControls(event)) return false
    if (!q) return true
    return eventSearchText(event).includes(q)
  })
})

const reviewItems = computed(() =>
  buildReviewItems(visibleEvents.value).slice(0, 8),
)

const feedRuns = computed<RunSummary[]>(() => {
  const byTrace = new Map<string, TraceEvent[]>()
  for (const event of events.value) {
    const list = byTrace.get(event.traceId)
    if (list) list.push(event)
    else byTrace.set(event.traceId, [event])
  }
  const q = query.value.trim().toLowerCase()
  return [...byTrace.values()]
    .map(group => summarizeRun(group))
    .filter(run => {
      if (run.kind === 'model') return false
      if (statusFilter.value === 'error' && run.errorCount === 0) return false
      if (statusFilter.value === 'ok' && run.status !== 'ok') return false
      if (actorFilter.value !== 'all' && run.actor !== actorFilter.value) return false
      if (!q) return true
      return `${run.title} ${run.detail} ${run.traceId}`.toLowerCase().includes(q)
    })
    .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
})

const totalCost = computed(() =>
  (stats.value?.byModel ?? []).reduce((sum, model) => sum + model.estimatedCost, 0),
)

const reviewStatus = computed(() => {
  const count = reviewItems.value.length
  if (count > 0) return `${count} notable event${count === 1 ? '' : 's'}`
  return 'No notable events'
})

const reviewMeta = computed(() => {
  const parts = [
    `${formatCount(feedRuns.value.length)} ${feedRuns.value.length === 1 ? 'run' : 'runs'}`,
    `${formatCount(stats.value?.events.errors ?? 0)} errors`,
    totalCost.value > 0 ? `${formatMoney(totalCost.value)} cost` : '',
    retentionDays.value === null ? 'retention off' : `${retentionDays.value} day retention`,
  ].filter(Boolean)
  return parts.join(' / ')
})

watch(
  () => [props.active, days.value] as const,
  ([active]) => {
    if (active) void loadTraceData()
  },
  { immediate: true },
)

async function loadTraceData() {
  loading.value = true
  error.value = ''
  try {
    const [statsResult, queryResult, settingsResult] = await Promise.all([
      window.kernel.call('trace.stats', { days: days.value }) as Promise<TraceStats>,
      window.kernel.call('trace.query', { days: days.value, order: 'desc', limit: 500 }) as Promise<{ events?: TraceEvent[] }>,
      window.kernel.call('settings.get', { key: 'traceRetentionDays' }).catch(() => ({ value: 90 })) as Promise<{ value?: unknown }>,
    ])
    stats.value = statsResult
    events.value = Array.isArray(queryResult.events) ? queryResult.events : []
    retentionDays.value = settingsResult.value === 0
      ? null
      : typeof settingsResult.value === 'number'
        ? settingsResult.value
        : 90
    refreshedAt.value = new Date().toISOString()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not read activity'
  } finally {
    loading.value = false
  }
}

function eventMatchesControls(event: TraceEvent): boolean {
  if (statusFilter.value === 'error' && !isErrorEvent(event)) return false
  if (statusFilter.value !== 'all' && statusFilter.value !== 'error' && event.status !== statusFilter.value) return false
  if (actorFilter.value !== 'all' && event.actor !== actorFilter.value) return false
  return true
}

function eventSearchText(event: TraceEvent): string {
  return [
    event.kind,
    event.actor,
    event.status,
    event.effect,
    event.tool,
    event.packageId,
    event.packageVersion,
    event.sessionId,
    event.runId,
    event.traceId,
    event.model,
    event.subject,
    safeJson(event.summary),
    safeJson(event.data),
  ].filter(Boolean).join(' ').toLowerCase()
}

async function openRun(traceId: string) {
  if (surfaceMode.value === 'review' || surfaceMode.value === 'audit') returnMode.value = surfaceMode.value
  try {
    const result = await window.kernel.call('trace.query', {
      traceId,
      days: 365,
      order: 'asc',
      limit: 5000,
    }) as { events?: TraceEvent[] }
    const fetched = Array.isArray(result.events) ? result.events : []
    runEvents.value = fetched.length ? fetched : events.value.filter(event => event.traceId === traceId)
  } catch {
    runEvents.value = events.value.filter(event => event.traceId === traceId)
  }
  surfaceMode.value = 'run'
}

function closeRun() {
  runEvents.value = []
  surfaceMode.value = returnMode.value
}

function isErrorEvent(event: TraceEvent): boolean {
  return event.status === 'error' || event.kind === 'tool.error' || event.kind === 'job.failed'
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return ''
  }
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
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col bg-surface text-ink" data-testid="activity-trust-root">
    <div class="flex min-h-[42px] shrink-0 items-center gap-2 border-b border-rule-light bg-chrome-high px-3 py-2">
      <MimSegmented
        v-if="surfaceMode !== 'run'"
        v-model="surfaceMode"
        :options="modeOptions"
        aria-label="Monitor surface"
      />
      <div v-else class="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">Run details</div>
      <div v-if="surfaceMode !== 'run'" class="min-w-0 flex-1" />
      <template v-if="surfaceMode !== 'run'">
        <MimSelect
          v-model="days"
          :options="dayOptions"
          size="sm"
          tone="surface"
          aria-label="Monitor range"
          :leading-icon="IconClock"
        />
        <MimSelect
          v-model="statusFilter"
          :options="statusOptions"
          size="sm"
          tone="surface"
          aria-label="Monitor status"
          :leading-icon="IconFilter"
        />
        <MimSelect
          v-model="actorFilter"
          :options="actorOptions"
          size="sm"
          tone="surface"
          aria-label="Monitor actor"
        />
        <label class="hidden h-6 min-w-[160px] max-w-[240px] items-center gap-1 rounded-[4px] border border-rule-light bg-surface px-2 text-ink-3 focus-within:border-accent md:flex">
          <IconSearch :size="13" :stroke="1.9" class="shrink-0" />
          <input
            v-model="query"
            class="min-w-0 flex-1 bg-transparent font-sans text-[11px] text-ink outline-none placeholder:text-ink-4"
            type="search"
            aria-label="Search activity"
            placeholder="Search"
          >
        </label>
      </template>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        title="Refresh"
        aria-label="Refresh"
        @click="loadTraceData"
      >
        <IconRefresh :size="13" :stroke="1.9" />
      </button>
    </div>

    <div v-if="error" class="shrink-0 border-b border-rule-light bg-chrome-mid px-3 py-2 text-[12px] text-ink-2" data-testid="activity-error">
      {{ error }}
    </div>

    <div v-if="loading" class="grid flex-1 place-items-center text-[12px] text-ink-3">
      Reading activity
    </div>

    <template v-else>
      <RunView v-if="surfaceMode === 'run'" :events="runEvents" @back="closeRun" />

      <div v-else-if="surfaceMode === 'review'" class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="monitor-surface">
        <section class="border-b border-rule-light px-3 py-3">
          <div class="text-[13px] font-medium text-ink">{{ reviewStatus }}</div>
          <div class="mt-1 text-[11px] text-ink-4">{{ reviewMeta }}</div>
          <div v-if="refreshedAt" class="mt-1 font-mono text-[10px] text-ink-4">Updated {{ formatTime(refreshedAt) }}</div>
        </section>

        <ReviewQueue :items="reviewItems" @open-run="openRun" />

        <section>
          <div class="flex items-center justify-between gap-2 border-b border-rule-light bg-chrome-high px-3 py-2">
            <div class="text-[12px] font-medium text-ink">Runs</div>
            <div class="font-mono text-[10px] text-ink-4">{{ formatCount(feedRuns.length) }}</div>
          </div>
          <ActivityFeed :runs="feedRuns" @open-run="openRun" />
        </section>
      </div>

      <AuditView
        v-else
        :events="visibleEvents"
        @open-run="openRun"
      />
    </template>
  </section>
</template>
