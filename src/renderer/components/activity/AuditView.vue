<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconDatabase,
  IconFileText,
  IconPackage,
  IconShieldCheck,
  IconWorld,
} from '@tabler/icons-vue'
import MimSegmented from '../ui/MimSegmented.vue'
import type { TraceEvent } from '../../services/trace/spans'
import { isImportantAuditEvent } from '../../services/trace/reviewItems'

const props = defineProps<{
  events: TraceEvent[]
}>()

const emit = defineEmits<{
  openRun: [traceId: string]
}>()

const mode = ref<'important' | 'full'>('important')
const selectedId = ref('')

const modeOptions = [
  { value: 'important', label: 'Important' },
  { value: 'full', label: 'Full log' },
]

const auditEvents = computed(() =>
  mode.value === 'important'
    ? props.events.filter(isImportantAuditEvent)
    : props.events,
)

const selectedEvent = computed(() =>
  auditEvents.value.find(event => eventId(event) === selectedId.value) ?? auditEvents.value[0] ?? null,
)

const summary = computed(() => {
  const important = props.events.filter(isImportantAuditEvent).length
  const errors = props.events.filter(isErrorEvent).length
  const changes = props.events.filter(event => event.kind === 'tool.call' && event.effect === 'mutate').length
  const external = props.events.filter(event => event.kind === 'tool.call' && event.effect === 'external').length
  return [
    { label: 'Important', value: formatCount(important) },
    { label: 'Errors', value: formatCount(errors) },
    { label: 'Changes', value: formatCount(changes) },
    { label: 'External', value: formatCount(external) },
  ]
})

watch(
  () => auditEvents.value.map(eventId).join('|'),
  () => {
    if (!selectedEvent.value) selectedId.value = ''
    else selectedId.value = eventId(selectedEvent.value)
  },
  { immediate: true },
)

function selectEvent(event: TraceEvent) {
  selectedId.value = eventId(event)
}

function eventId(event: TraceEvent): string {
  return `${event.traceId}:${event.spanId}:${event.kind}:${event.ts}`
}

function eventTitle(event: TraceEvent): string {
  const decision = stringValue(event.data?.decision)
  if (event.kind === 'gate.decision' && decision) return `${capitalize(decision)} ${event.tool ?? 'action'}`
  if (event.kind === 'tool.call') return `${actorLabel(event.actor)} requested ${event.tool ?? 'a tool'}`
  if (event.kind === 'tool.result') return `${event.tool ?? 'Tool'} completed`
  if (event.kind === 'tool.error') return `${event.tool ?? 'Tool'} failed`
  if (event.kind === 'model.call') return `Model call ${event.model ?? ''}`.trim()
  if (event.kind.startsWith('job.')) return `${event.kind.replace('job.', 'Job ')} ${event.subject ?? event.packageId ?? ''}`.trim()
  if (event.kind === 'outcome.edit') return event.data?.reverted === true
    ? `You reverted ${event.subject ?? 'the output'}`
    : `You edited ${event.subject ?? 'the output'}`
  if (event.kind === 'package.http.request') return `${packageLabel(event)} contacted ${event.subject ?? 'an external host'}`
  return event.kind
}

function eventDetail(event: TraceEvent): string {
  const parts = [
    event.subject,
    event.effect ? `effect ${event.effect}` : '',
    event.packageId && event.packageVersion ? `${event.packageId}@${event.packageVersion}` : event.packageId,
    event.sessionId ? `session ${shortId(event.sessionId)}` : '',
    event.runId ? `run ${shortId(event.runId)}` : '',
    event.durationMs !== undefined ? formatDuration(event.durationMs) : '',
    event.payloadRef ? 'evidence captured' : '',
  ].filter(Boolean)
  return parts.join(' / ')
}

function statusPillClass(event: TraceEvent): string {
  if (isErrorEvent(event)) return 'border-red-500/30 text-red-700 dark:text-red-300'
  if (event.status === 'ok') return 'border-rule-light text-ink-3'
  return 'border-rule-light text-ink-4'
}

function eventStatusLabel(event: TraceEvent): string {
  if (isErrorEvent(event)) return 'error'
  if (event.effect) return event.effect
  return event.status ?? event.actor
}

function eventIcon(event: TraceEvent) {
  if (isErrorEvent(event)) return IconAlertTriangle
  if (event.kind === 'package.http.request') return IconWorld
  if (isFileMutationTool(event.tool)) return IconFileText
  if (event.kind === 'model.call') return IconDatabase
  if (event.kind === 'gate.decision') return IconShieldCheck
  if (event.actor === 'package') return IconPackage
  if (event.effect === 'external') return IconWorld
  if (event.effect === 'mutate') return IconBolt
  return IconActivity
}

function isErrorEvent(event: TraceEvent): boolean {
  return event.status === 'error' || event.kind === 'tool.error' || event.kind === 'job.failed'
}

function isFileMutationTool(toolName: string | undefined): boolean {
  return toolName === 'fs.write' || toolName === 'fs.edit' || toolName === 'fs.create' || toolName === 'fs.delete' || toolName === 'fs.rename' || toolName === 'fs.copy' || toolName === 'fs.trash'
}

function packageLabel(event: TraceEvent): string {
  if (!event.packageId) return 'App'
  return event.packageVersion ? `${event.packageId}@${event.packageVersion}` : event.packageId
}

function detailJson(event: TraceEvent | null): string {
  if (!event) return ''
  return JSON.stringify(event, null, 2)
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function shortId(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value
}

function capitalize(value: string): string {
  return value ? value.slice(0, 1).toUpperCase() + value.slice(1) : ''
}

function actorLabel(actor: TraceEvent['actor']): string {
  if (actor === 'ai') return 'Mim'
  if (actor === 'package') return 'An app'
  if (actor === 'system') return 'System'
  return 'You'
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0).replace(/\.0$/, '')}s`
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
  <section class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]" data-testid="audit-view">
    <div class="min-h-0 overflow-y-auto overscroll-contain">
      <div class="flex items-center gap-2 border-b border-rule-light bg-chrome-high px-3 py-2">
        <div class="min-w-0 flex-1">
          <div class="text-[12px] font-medium text-ink">Audit</div>
          <div class="mt-0.5 text-[11px] text-ink-4">Consequential actions by default; full log on demand.</div>
        </div>
        <MimSegmented v-model="mode" :options="modeOptions" aria-label="Audit mode" />
      </div>

      <div class="grid grid-cols-2 border-b border-rule-light sm:grid-cols-4">
        <div
          v-for="item in summary"
          :key="item.label"
          class="min-w-0 border-r border-rule-light px-3 py-2 last:border-r-0"
        >
          <div class="truncate text-[10px] font-semibold uppercase text-ink-3">{{ item.label }}</div>
          <div class="mt-0.5 font-mono text-[16px] leading-5 text-ink">{{ item.value }}</div>
        </div>
      </div>

      <div v-if="!auditEvents.length" class="px-3 py-6 text-[12px] text-ink-3">
        No audit events match the filters.
      </div>

      <div v-else class="divide-y divide-rule-light">
        <button
          v-for="event in auditEvents"
          :key="eventId(event)"
          type="button"
          class="grid w-full grid-cols-[26px_minmax(0,1fr)_auto] gap-2 px-3 py-2 text-left hover:bg-chrome-mid"
          :class="selectedEvent && eventId(event) === eventId(selectedEvent) ? 'bg-accent-tint' : ''"
          :title="eventTitle(event)"
          @click="selectEvent(event)"
        >
          <span class="mt-0.5 grid h-6 w-6 place-items-center rounded-[5px] border border-rule-light bg-surface text-ink-3">
            <component :is="eventIcon(event)" :size="14" :stroke="1.8" />
          </span>
          <span class="min-w-0">
            <span class="block truncate text-[12px] text-ink">{{ eventTitle(event) }}</span>
            <span class="block truncate text-[11px] text-ink-4">{{ eventDetail(event) }}</span>
          </span>
          <span class="flex min-w-[72px] flex-col items-end gap-1">
            <span class="font-mono text-[10px] text-ink-4">{{ formatTime(event.ts) }}</span>
            <span class="rounded-full border px-1.5 py-0.5 text-[10px]" :class="statusPillClass(event)">
              {{ eventStatusLabel(event) }}
            </span>
          </span>
        </button>
      </div>
    </div>

    <aside class="min-h-0 overflow-y-auto overscroll-contain border-t border-rule-light bg-chrome-high lg:border-l lg:border-t-0" data-testid="audit-detail">
      <div class="border-b border-rule-light px-3 py-2">
        <div class="truncate text-[12px] font-medium text-ink">{{ selectedEvent ? eventTitle(selectedEvent) : 'Audit event' }}</div>
        <div class="truncate font-mono text-[10px] text-ink-4">{{ selectedEvent ? selectedEvent.traceId : '' }}</div>
      </div>
      <div v-if="selectedEvent" class="divide-y divide-rule-light">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
          title="Open run"
          aria-label="Open run"
          @click="emit('openRun', selectedEvent.traceId)"
        >
          <span>Run</span>
          <span class="font-mono">{{ shortId(selectedEvent.traceId) }}</span>
        </button>
        <dl class="divide-y divide-rule-light">
          <div v-if="selectedEvent.tool" class="grid grid-cols-[88px_minmax(0,1fr)] gap-2 px-3 py-1.5">
            <dt class="text-[11px] text-ink-4">Tool</dt>
            <dd class="min-w-0 truncate font-mono text-[11px] text-ink-2">{{ selectedEvent.tool }}</dd>
          </div>
          <div v-if="selectedEvent.effect" class="grid grid-cols-[88px_minmax(0,1fr)] gap-2 px-3 py-1.5">
            <dt class="text-[11px] text-ink-4">Effect</dt>
            <dd class="min-w-0 truncate text-[11px] text-ink-2">{{ selectedEvent.effect }}</dd>
          </div>
          <div v-if="numberValue(selectedEvent.data?.estimatedCost)" class="grid grid-cols-[88px_minmax(0,1fr)] gap-2 px-3 py-1.5">
            <dt class="text-[11px] text-ink-4">Cost</dt>
            <dd class="min-w-0 truncate font-mono text-[11px] text-ink-2">${{ numberValue(selectedEvent.data?.estimatedCost).toFixed(4) }}</dd>
          </div>
        </dl>
        <pre class="max-h-[520px] overflow-auto overscroll-contain whitespace-pre-wrap px-3 py-2 font-mono text-[10.5px] leading-5 text-ink-2">{{ detailJson(selectedEvent) }}</pre>
      </div>
    </aside>
  </section>
</template>
