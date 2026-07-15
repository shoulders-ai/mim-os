<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  IconArrowBarToRight,
  IconExternalLink,
  IconHistory,
  IconRefresh,
} from '@tabler/icons-vue'

interface HistoryVersion {
  id: string
  path: string
  at: string
  actor: 'user' | 'agent' | 'package' | 'external' | 'system'
  event: string
  kind: 'text' | 'binary' | 'deleted'
  bytes: number
  deleted: boolean
  anchor: boolean
  foldedCount?: number
}

interface HistoryListResult {
  path: string
  current: { bytes: number; deleted: boolean; kind: 'text' | 'binary' | 'deleted'; modifiedAt?: string } | null
  versions: HistoryVersion[]
  totalVersions: number
  foldedCount: number
}

interface HistoryPreviewResult {
  kind: 'text' | 'binary' | 'deleted'
  content?: string
  bytes: number
  deleted: boolean
}

interface HistoryLineDelta {
  added: number
  removed: number
}

interface HistoryPreviewPayload {
  path: string
  versionId: string
  kind: 'text' | 'deleted'
  content: string
  label: string
  relativeTime: string
  exactTime: string
  event: string
  actor: string
  added: number
  removed: number
}

const props = defineProps<{
  path: string
  currentText?: string
  refreshKey?: number
  previewingVersionId?: string
}>()

const emit = defineEmits<{
  close: []
  showCurrent: []
  preview: [payload: HistoryPreviewPayload]
}>()

const loading = ref(false)
const error = ref('')
const includeFolded = ref(false)
const list = ref<HistoryListResult | null>(null)
const previewLoadingId = ref('')
const openingVersionId = ref('')
const lineDeltas = ref<Record<string, HistoryLineDelta>>({})

const previewCache = new Map<string, HistoryPreviewResult>()
let loadToken = 0
let deltaToken = 0

const versions = computed(() => list.value?.versions ?? [])
const currentSelected = computed(() => !props.previewingVersionId)
const currentModifiedLabel = computed(() => {
  const modifiedAt = list.value?.current?.modifiedAt
  return modifiedAt ? relativeTime(modifiedAt) : 'Now'
})
const currentModifiedTitle = computed(() => exactTime(list.value?.current?.modifiedAt))

watch(
  () => [props.path, props.refreshKey, includeFolded.value] as const,
  () => { void load() },
  { immediate: true },
)

watch(
  () => [props.currentText, versions.value.map(version => `${version.id}:${version.kind}:${version.bytes}`).join('|')] as const,
  () => { void refreshLineDeltas() },
)

async function load() {
  if (!props.path) return
  const token = ++loadToken
  loading.value = true
  error.value = ''
  previewCache.clear()
  lineDeltas.value = {}
  try {
    const result = await window.kernel.call('history.list', {
      path: props.path,
      include_folded: includeFolded.value,
    }) as HistoryListResult
    if (token !== loadToken) return
    list.value = result
    void refreshLineDeltas()
  } catch (err) {
    if (token !== loadToken) return
    error.value = err instanceof Error ? err.message : String(err)
    list.value = null
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function getPreview(version: HistoryVersion): Promise<HistoryPreviewResult> {
  const cached = previewCache.get(version.id)
  if (cached) return cached
  const result = await window.kernel.call('history.preview', {
    path: props.path,
    version_id: version.id,
  }) as HistoryPreviewResult
  previewCache.set(version.id, result)
  return result
}

async function previewVersion(version: HistoryVersion) {
  if (version.kind === 'binary') return
  previewLoadingId.value = version.id
  error.value = ''
  try {
    const result = version.deleted
      ? { kind: 'deleted', content: '', bytes: 0, deleted: true } as HistoryPreviewResult
      : await getPreview(version)
    if (result.kind === 'binary') return
    const delta = lineDeltas.value[version.id] ?? lineDelta(result.content ?? '', props.currentText ?? '')
    emit('preview', {
      path: props.path,
      versionId: version.id,
      kind: result.kind === 'deleted' ? 'deleted' : 'text',
      content: result.content ?? '',
      label: versionLabel(version),
      relativeTime: relativeTime(version.at),
      exactTime: exactTime(version.at),
      event: eventLabel(version.event),
      actor: actorLabel(version.actor),
      added: delta.added,
      removed: delta.removed,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    previewLoadingId.value = ''
  }
}

async function openVersionCopy(version: HistoryVersion) {
  if (version.deleted) return
  openingVersionId.value = version.id
  error.value = ''
  try {
    const result = await window.kernel.call('history.openVersion', {
      path: props.path,
      version_id: version.id,
    }) as { path?: string }
    if (result.path) await window.kernel.openNativeFile(result.path)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    openingVersionId.value = ''
  }
}

async function refreshLineDeltas() {
  const token = ++deltaToken
  const current = props.currentText ?? ''
  const next: Record<string, HistoryLineDelta> = {}
  lineDeltas.value = next

  for (const version of versions.value.slice(0, 60)) {
    if (token !== deltaToken) return
    if (version.deleted || version.kind === 'deleted') {
      next[version.id] = { added: countLines(current), removed: 0 }
      lineDeltas.value = { ...next }
      continue
    }
    if (version.kind !== 'text') continue
    try {
      const result = await getPreview(version)
      if (token !== deltaToken) return
      if (result.kind === 'text' && typeof result.content === 'string') {
        next[version.id] = lineDelta(result.content, current)
        lineDeltas.value = { ...next }
      }
    } catch {
      // Change counts are useful context, not a reason to block history browsing.
    }
  }
}

function lineDelta(previous: string, current: string): HistoryLineDelta {
  const before = lineCounts(previous)
  const after = lineCounts(current)
  let added = 0
  let removed = 0
  for (const [line, count] of after) {
    added += Math.max(0, count - (before.get(line) ?? 0))
  }
  for (const [line, count] of before) {
    removed += Math.max(0, count - (after.get(line) ?? 0))
  }
  return { added, removed }
}

function lineCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of text.split('\n')) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  return counts
}

function countLines(text: string): number {
  if (!text) return 0
  return text.split('\n').length
}

function versionLabel(version: HistoryVersion): string {
  return `${eventLabel(version.event)} · ${relativeTime(version.at)}`
}

function actorLabel(actor: HistoryVersion['actor']): string {
  if (actor === 'agent') return 'agent'
  if (actor === 'package') return 'app'
  if (actor === 'external') return 'outside Mim'
  if (actor === 'system') return 'Mim'
  return 'you'
}

function eventLabel(event: string): string {
  const labels: Record<string, string> = {
    baseline: 'Saved',
    save: 'Saved',
    external: 'External edit',
    create: 'Created',
    'after-write': 'Saved',
    'after-edit': 'Edited',
    'before-write': 'Before save',
    'before-edit': 'Before edit',
    'before-delete': 'Before delete',
    delete: 'Deleted',
    'before-rename': 'Before rename',
    rename: 'Renamed',
    copy: 'Copied',
    import: 'Imported',
    'before-restore': 'Before restore',
    restore: 'Restored',
  }
  return labels[event] ?? event
}

function detailLabel(version: HistoryVersion): string {
  if (version.deleted) return 'Deleted'
  if (version.actor === 'external' || version.event === 'external') return 'Changed outside Mim'
  return `${eventLabel(version.event)} by ${actorLabel(version.actor)}`
}

function exactTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function relativeTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  const then = date.getTime()
  if (Number.isNaN(then)) return value
  const diffMs = then - Date.now()
  const abs = Math.abs(diffMs)
  if (abs < 45_000) return 'Just now'

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['week', 7 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ]
  const [unit, size] = units.find(([, unitSize]) => abs >= unitSize) ?? ['minute', 60 * 1000]
  const valueForUnit = Math.round(diffMs / size)
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(valueForUnit, unit)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function deltaFor(version: HistoryVersion): HistoryLineDelta | null {
  return lineDeltas.value[version.id] ?? null
}
</script>

<template>
  <aside
    class="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-rule-light bg-chrome-mid font-sans text-ink"
    data-testid="history-rail"
  >
    <div class="flex h-8 shrink-0 items-center gap-1.5 border-b border-rule-light px-2.5">
      <IconHistory :size="14" stroke-width="2" class="text-ink-3" />
      <span class="text-[11px] font-medium text-ink-3">History</span>
      <div class="flex-1" />
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-high hover:text-ink-2 disabled:opacity-30"
        title="Refresh history"
        :disabled="loading"
        @click="load"
      >
        <IconRefresh :size="13" stroke-width="2" />
      </button>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-high hover:text-ink"
        title="Close history"
        @click="emit('close')"
      >
        <IconArrowBarToRight :size="14" stroke-width="2" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <button
        type="button"
        class="flex w-full items-center gap-3 border-b border-rule-light px-3 py-2.5 text-left hover:bg-chrome-high"
        :class="currentSelected ? 'bg-surface' : 'bg-chrome-mid'"
        data-testid="history-current-row"
        @click="emit('showCurrent')"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="truncate text-[13px] font-semibold text-ink">{{ currentModifiedLabel }}</span>
            <span class="rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent">Current</span>
          </div>
          <div class="mt-0.5 truncate text-[11px] text-ink-3" :title="currentModifiedTitle">
            {{ list?.current?.deleted ? 'Deleted on disk' : list?.current ? formatSize(list.current.bytes) : 'No current file' }}
          </div>
        </div>
      </button>

      <div v-if="error" class="border-b border-rule-light px-3 py-2 text-[11px] text-rem">
        {{ error }}
      </div>

      <div v-if="loading" class="px-3 py-3 text-[11px] text-ink-3">Loading saves</div>

      <div v-else-if="!versions.length" class="px-3 py-4 text-[12px] leading-relaxed text-ink-3">
        No saved versions yet.
      </div>

      <div v-else class="divide-y divide-rule-light">
        <div
          v-for="version in versions"
          :key="version.id"
          class="px-2 py-1.5"
          :class="previewingVersionId === version.id ? 'bg-accent-tint' : 'hover:bg-chrome-high'"
        >
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] px-1.5 py-1.5 text-left"
              :class="version.kind === 'binary' ? 'cursor-default' : ''"
              :aria-disabled="version.kind === 'binary'"
              :data-testid="`history-version-row-${version.id}`"
              :title="version.kind === 'binary' ? 'Open a copy to inspect this file version' : exactTime(version.at)"
              @click="previewVersion(version)"
            >
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate text-[13px] font-semibold text-ink">{{ relativeTime(version.at) }}</span>
                  <span v-if="version.anchor" class="rounded-[3px] bg-chrome-high px-1 text-[9px] font-medium uppercase text-ink-4">Kept</span>
                  <span
                    v-if="previewLoadingId === version.id"
                    class="shrink-0 text-[10px] text-ink-3"
                  >
                    Loading
                  </span>
                </div>
                <div class="mt-0.5 truncate text-[11px] text-ink-3">
                  {{ detailLabel(version) }}
                  <span v-if="!version.deleted && version.kind !== 'deleted'">&middot; {{ formatSize(version.bytes) }}</span>
                </div>
              </div>

              <div
                v-if="deltaFor(version)"
                class="flex shrink-0 items-center gap-1"
                title="Line changes compared with the current file"
              >
                <span class="min-w-[30px] rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-accent">
                  +{{ deltaFor(version)?.added ?? 0 }}
                </span>
                <span class="min-w-[30px] rounded-[4px] bg-rem/10 px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-rem">
                  -{{ deltaFor(version)?.removed ?? 0 }}
                </span>
              </div>
            </button>
            <button
              v-if="version.kind === 'binary' && !version.deleted"
              type="button"
              class="flex h-6 shrink-0 items-center gap-1 rounded-[4px] border border-rule-light bg-surface px-2 text-[10px] text-ink-2 hover:bg-chrome-high disabled:opacity-40"
              :disabled="openingVersionId === version.id"
              title="Open a temporary copy"
              @click.stop="openVersionCopy(version)"
            >
              <IconExternalLink :size="12" stroke-width="2" />
              Open copy
            </button>
          </div>
        </div>

        <button
          v-if="list?.foldedCount"
          type="button"
          class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[11px] text-ink-3 hover:bg-chrome-high"
          @click="includeFolded = !includeFolded"
        >
          <span>{{ includeFolded ? 'Hide older saves' : 'Show older saves' }}</span>
          <span class="font-medium text-accent">{{ list.foldedCount }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>
