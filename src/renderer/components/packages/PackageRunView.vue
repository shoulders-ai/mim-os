<script setup lang="ts">
import {
  IconAlertTriangle,
  IconExternalLink,
  IconFileText,
  IconListDetails,
  IconPlayerStop,
} from '@tabler/icons-vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  latestRunActivity,
  latestRunProgress,
  packageRunEventLabel,
  runDurationLabel,
} from './packageManagerLogic.js'
import type { PackageViewDefinition } from '../../services/workbench/packageViews.js'
import {
  packageRunDisplayTitle,
  type PackageRunEvent,
  type PackageRunRecord,
  type PackageRunStatus,
} from '../../stores/runs.js'

interface LoadedPackage {
  manifest: {
    id: string
    name: string
    icon?: string
    views?: PackageViewDefinition[]
  }
  dir: string
  source: string
}

type ResultFileOpenWith = 'native' | 'editor'

interface ResultFile {
  kind: string
  label: string
  path: string
  description: string
  action: string
  openWith: ResultFileOpenWith
}

interface FriendlyError {
  title: string
  message: string
  detail: string
}

const props = defineProps<{
  packageId: string
  runId: string
  packages: LoadedPackage[]
}>()

defineEmits<{
  openPackage: [id: string]
}>()

const run = ref<PackageRunRecord | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const actionBusy = ref<string | null>(null)
const actionError = ref<string | null>(null)
const now = ref(Date.now())

let refreshTimer: number | null = null
let tickTimer: number | null = null
let refreshToken = 0

const pkg = computed(() =>
  props.packages.find(candidate => candidate.manifest.id === props.packageId) ?? null
)

const packageName = computed(() => pkg.value?.manifest.name ?? props.packageId)
const runTitle = computed(() =>
  run.value ? packageRunDisplayTitle(run.value) : 'Loading run'
)
const inputPath = computed(() =>
  typeof run.value?.inputs?.path === 'string' ? run.value.inputs.path : ''
)
const inputName = computed(() => basenamePath(inputPath.value))
const statusLabel = computed(() => {
  if (!run.value) return 'Loading'
  if (run.value.status === 'running') return 'Running'
  if (run.value.status === 'completed') return 'Complete'
  if (run.value.status === 'failed') return 'Failed'
  return 'Cancelled'
})
const statusClass = computed(() => {
  if (!run.value) return 'border-rule text-ink-3 bg-chrome-high'
  if (run.value.status === 'running') return 'border-accent/25 text-accent bg-accent-tint'
  if (run.value.status === 'completed') return 'border-add/25 text-add bg-add/8'
  if (run.value.status === 'failed') return 'border-rem/25 text-rem bg-rem/8'
  return 'border-rule text-ink-3 bg-chrome-mid'
})
const progress = computed(() =>
  run.value ? latestRunProgress(run.value) : { value: 0, percent: 0, label: 'Loading' }
)
const activeSegments = computed(() =>
  Math.max(0, Math.min(12, Math.round(progress.value.percent / 100 * 12)))
)
const timeline = computed(() =>
  [...(run.value?.events ?? [])].sort((a, b) => a.sequence - b.sequence)
)
const activity = computed(() => run.value ? latestRunActivity(run.value) : 'Loading run')
const duration = computed(() => run.value ? runDurationLabel(run.value, now.value) : '')
const subtitle = computed(() => {
  if (!run.value) return ''
  const file = inputName.value ? `${inputName.value} - ` : ''
  if (run.value.status === 'running') return `${file}${duration.value ? `running ${duration.value}` : 'running'}`
  if (run.value.status === 'completed') return `${file}${duration.value ? `completed in ${duration.value}` : 'complete'}`
  if (run.value.status === 'failed') return `${file}${duration.value ? `stopped after ${duration.value}` : 'failed'}`
  return `${file}cancelled`
})
const resultRecord = computed(() => asRecord(run.value?.result))
const resultFiles = computed<ResultFile[]>(() => {
  const result = resultRecord.value
  if (!result) return []
  const files: ResultFile[] = []
  const seen = new Set<string>()
  const addFile = (file: ResultFile) => {
    const key = `${file.path}\n${file.label}`
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }

  for (const output of outputDescriptors(result)) addFile(output)

  const outputPath = stringField(result, 'outputPath')
  if (outputPath) {
    const kind = kindFromPath(outputPath)
    const openWith = ['markdown', 'md', 'txt', 'json', 'html'].includes(kind) ? 'editor' : 'native'
    addFile({
      kind,
      label: defaultOutputLabel(kind, outputPath),
      path: outputPath,
      description: defaultOutputDescription(kind),
      action: defaultOutputAction(openWith, kind),
      openWith,
    })
  }

  const reviewedDocxPath = stringField(result, 'reviewedDocxPath')
  const reportPath = stringField(result, 'reportPath')
  if (reviewedDocxPath) {
    addFile({
      kind: 'docx',
      label: 'Reviewed Word document',
      path: reviewedDocxPath,
      description: 'Native Word comments, opened with your default DOCX app.',
      action: 'Open',
      openWith: 'native',
    })
  }
  if (reportPath) {
    addFile({
      kind: 'report',
      label: 'Peer review report',
      path: reportPath,
      description: 'Markdown report with the review summary and all comments.',
      action: 'Open',
      openWith: 'editor',
    })
  }
  const pdfPath = stringField(result, 'pdfPath')
  const htmlPath = stringField(result, 'htmlPath')
  const planPath = stringField(result, 'planPath')
  if (pdfPath) {
    addFile({
      kind: 'pdf',
      label: 'Deck PDF',
      path: pdfPath,
      description: 'Rendered slide deck PDF, opened with your default PDF app.',
      action: 'Open PDF',
      openWith: 'native',
    })
  }
  if (htmlPath) {
    addFile({
      kind: 'html',
      label: 'Deck HTML',
      path: htmlPath,
      description: 'Paginated source HTML for the generated deck.',
      action: 'Open in editor',
      openWith: 'editor',
    })
  }
  if (planPath) {
    addFile({
      kind: 'json',
      label: 'Deck plan',
      path: planPath,
      description: 'Structured plan used to generate the deck.',
      action: 'Open',
      openWith: 'editor',
    })
  }
  return files
})
const docxWarning = computed(() => {
  const annotation = asRecord(resultRecord.value?.docxAnnotation)
  const warning = stringField(annotation, 'warning')
  if (warning) return warning
  const summary = asRecord(annotation?.summary)
  const failed = numberField(summary, 'failed')
  const total = numberField(summary, 'total')
  if (failed && total) return `${failed} of ${total} Word comments could not be placed.`
  return ''
})
const displayError = computed(() =>
  run.value?.status === 'failed' ? friendlyError(run.value.error || 'The run failed.') : null
)
const jsonResult = computed(() => formatJson(run.value?.result))
const jsonInputs = computed(() => formatJson(run.value?.inputs ?? {}))

watch(
  () => [props.packageId, props.runId] as const,
  () => {
    void refreshRun()
  },
  { immediate: true },
)

onMounted(() => {
  window.kernel.on('package:job:event', onPackageJobEvent)
  tickTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  window.kernel.off('package:job:event', onPackageJobEvent)
  if (refreshTimer != null) window.clearTimeout(refreshTimer)
  if (tickTimer != null) window.clearInterval(tickTimer)
})

async function refreshRun() {
  const token = ++refreshToken
  loading.value = !run.value
  error.value = null
  try {
    const result = await window.kernel.call('package.jobs.get', { runId: props.runId })
    if (token !== refreshToken) return
    const next = (result as { run?: PackageRunRecord }).run ?? result as PackageRunRecord
    run.value = {
      ...next,
      events: [...(next.events ?? [])],
    }
  } catch (err) {
    if (token !== refreshToken) return
    error.value = err instanceof Error ? err.message : String(err)
    run.value = null
  } finally {
    if (token === refreshToken) loading.value = false
  }
}

function onPackageJobEvent(payload: unknown) {
  const event = payload as PackageRunEvent
  if (event.runId !== props.runId) return
  mergeEvent(event)
  scheduleRefresh()
}

function mergeEvent(event: PackageRunEvent) {
  if (!run.value) return
  if (!run.value.events.some(existing => existing.sequence === event.sequence)) {
    run.value.events = [...run.value.events, event].sort((a, b) => a.sequence - b.sequence)
  }
  run.value.status = statusFromEvent(event, run.value.status)
  run.value.completedAt = completedAtFromEvent(event) ?? run.value.completedAt
  run.value.error = errorFromEvent(event) ?? run.value.error
  run.value = { ...run.value }
}

function scheduleRefresh() {
  if (refreshTimer != null) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null
    void refreshRun()
  }, 160)
}

async function cancelRun() {
  if (!run.value || run.value.status !== 'running') return
  actionBusy.value = 'cancel'
  error.value = null
  try {
    await window.kernel.call('package.jobs.cancel', { runId: run.value.runId })
    await refreshRun()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    actionBusy.value = null
  }
}

async function openResultFile(file: ResultFile) {
  actionBusy.value = file.path
  actionError.value = null
  try {
    if (file.openWith === 'editor') {
      await window.kernel.call('editor.open', { path: file.path })
    } else {
      await window.kernel.call('fs.openNative', { path: file.path })
    }
  } catch (err) {
    actionError.value = err instanceof Error ? err.message : String(err)
  } finally {
    actionBusy.value = null
  }
}

function segmentClass(index: number): string {
  const active = index < activeSegments.value
  if (!active) return 'bg-chrome-mid'
  if (run.value?.status === 'completed') return 'bg-add'
  if (run.value?.status === 'failed') return 'bg-rem'
  if (run.value?.status === 'cancelled') return 'bg-ink-4'
  return 'bg-accent'
}

function formatTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatJson(value: unknown): string {
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function statusFromEvent(event: PackageRunEvent, fallback: PackageRunStatus): PackageRunStatus {
  if (event.type === 'job.started') return 'running'
  if (event.type === 'job.failed') return 'failed'
  if (event.type === 'job.cancelled') return 'cancelled'
  if (event.type === 'job.done' && event.data && 'result' in event.data) return 'completed'
  return fallback
}

function completedAtFromEvent(event: PackageRunEvent): string | undefined {
  if (event.type === 'job.failed' || event.type === 'job.cancelled') return event.ts
  if (event.type === 'job.done' && event.data && 'result' in event.data) return event.ts
  return undefined
}

function errorFromEvent(event: PackageRunEvent): string | undefined {
  if (event.type !== 'job.failed' && event.type !== 'job.cancelled') return undefined
  const eventError = event.data?.error
  return typeof eventError === 'string' ? eventError : undefined
}

function friendlyError(raw: string): FriendlyError {
  const text = String(raw || 'The run failed.')
  const parsedWorker = parseEmbeddedJson(text)
  if (parsedWorker) {
    const summary = asRecord(parsedWorker.summary)
    const total = numberField(summary, 'total')
    const succeeded = numberField(summary, 'succeeded')
    const failed = numberField(summary, 'failed')
    if (total && failed) {
      return {
        title: 'Some Word comments could not be placed',
        message: succeeded
          ? `The Word writer placed ${succeeded} of ${total} comments. ${failed} comments still need better anchors.`
          : `The Word writer could not place ${failed} of ${total} comments.`,
        detail: text,
      }
    }
  }

  if (/api key/i.test(text)) {
    return {
      title: 'Model access is not configured',
      message: text,
      detail: text,
    }
  }

  if (/DOCX worker binary not found/i.test(text)) {
    return {
      title: 'Word writer is not installed',
      message: 'Build the DOCX worker or configure DOCX_WORKER_PATH, then run the review again.',
      detail: text,
    }
  }

  return {
    title: 'Run could not be completed',
    message: text.length > 180 ? `${text.slice(0, 177)}...` : text,
    detail: text,
  }
}

function parseEmbeddedJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  try {
    const parsed = JSON.parse(text.slice(start))
    return asRecord(parsed)
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function outputDescriptors(result: Record<string, unknown>): ResultFile[] {
  const outputs = Array.isArray(result.outputs) ? result.outputs : []
  return outputs.flatMap((output): ResultFile[] => {
    const record = asRecord(output)
    const path = stringField(record, 'path')
    if (!path) return []
    const kind = stringField(record, 'kind') || kindFromPath(path)
    const openWith = openWithForOutput(record, kind)
    return [{
      kind,
      label: stringField(record, 'label') || defaultOutputLabel(kind, path),
      path,
      description: stringField(record, 'description') || defaultOutputDescription(kind),
      action: stringField(record, 'action') || defaultOutputAction(openWith, kind),
      openWith,
    }]
  })
}

function openWithForOutput(record: Record<string, unknown> | null, kind: string): ResultFileOpenWith {
  const requested = stringField(record, 'openWith')
  if (requested === 'editor' || requested === 'native') return requested
  if (['html', 'md', 'markdown', 'json', 'txt', 'csv', 'report'].includes(kind)) return 'editor'
  return 'native'
}

function kindFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || 'file'
  if (ext === 'htm') return 'html'
  if (ext === 'md') return 'markdown'
  return ext
}

function defaultOutputLabel(kind: string, path: string): string {
  if (kind === 'markdown') return 'Markdown file'
  if (kind === 'pdf') return 'PDF'
  if (kind === 'html') return 'HTML'
  if (kind === 'json') return 'JSON'
  return basenamePath(path)
}

function defaultOutputDescription(kind: string): string {
  if (kind === 'markdown') return 'AI-ready Markdown output.'
  if (kind === 'pdf') return 'Rendered output file.'
  if (kind === 'html') return 'Source HTML output.'
  if (kind === 'json') return 'Structured output data.'
  return 'Run output file.'
}

function defaultOutputAction(openWith: ResultFileOpenWith, kind: string): string {
  if (kind === 'pdf') return 'Open PDF'
  return openWith === 'editor' ? 'Open in editor' : 'Open'
}

function stringField(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value : ''
}

function numberField(record: Record<string, unknown> | null | undefined, key: string): number {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function basenamePath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col overflow-hidden bg-surface text-ink" data-testid="package-run-view">
    <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-rule-light bg-chrome-high px-4">
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <h1 class="truncate font-sans text-[14px] font-semibold leading-tight text-ink">{{ runTitle }}</h1>
          <span class="shrink-0 rounded-full border px-2 py-[2px] font-sans text-[10px] font-semibold uppercase tracking-[0.04em]" :class="statusClass">
            {{ statusLabel }}
          </span>
        </div>
        <div v-if="subtitle" class="mt-0.5 truncate font-sans text-[11px] text-ink-4">
          {{ subtitle }}
        </div>
      </div>
      <button
        v-if="run?.status === 'running'"
        class="flex h-7 items-center gap-1.5 rounded-[5px] border border-rem/25 bg-rem/8 px-2 font-sans text-[11px] font-semibold text-rem hover:bg-rem/10 disabled:opacity-50"
        :disabled="actionBusy === 'cancel'"
        title="Cancel run"
        @click="cancelRun"
      >
        <IconPlayerStop :size="13" :stroke-width="2.1" />
        Cancel
      </button>
    </header>

    <div v-if="loading" class="flex flex-1 items-center justify-center font-sans text-[12px] text-ink-3">
      Loading run
    </div>

    <div v-else-if="error" class="m-4 flex items-start gap-2 rounded-[7px] border border-rem/20 bg-rem/8 p-3 font-sans text-[12px] text-rem">
      <IconAlertTriangle class="mt-px shrink-0" :size="15" :stroke-width="2.1" />
      <span>{{ error }}</span>
    </div>

    <main v-else-if="run" class="flex-1 overflow-auto p-4">
      <section v-if="resultFiles.length" class="grid gap-3 rounded-[8px] border border-rule-light bg-chrome-high p-3">
        <div>
          <h2 class="m-0 font-sans text-[12px] font-semibold text-ink">Result files</h2>
          <p class="m-0 mt-0.5 font-sans text-[11.5px] text-ink-3">Open the run outputs directly from here.</p>
        </div>
        <div class="grid gap-2">
          <div
            v-for="file in resultFiles"
            :key="file.path"
            class="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-[7px] border border-rule-light bg-surface p-2.5"
          >
            <IconFileText class="text-accent" :size="17" :stroke-width="1.9" />
            <div class="min-w-0">
              <div class="truncate font-sans text-[12px] font-semibold text-ink-2">{{ file.label }}</div>
              <div class="truncate font-mono text-[10.5px] text-ink-4">{{ file.path }}</div>
              <div class="mt-0.5 font-sans text-[11px] text-ink-3">{{ file.description }}</div>
            </div>
            <button
              class="flex h-7 items-center gap-1.5 rounded-[5px] border border-rule-light bg-chrome-high px-2 font-sans text-[11px] font-semibold text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-50"
              :disabled="actionBusy === file.path"
              @click="openResultFile(file)"
            >
              <IconExternalLink :size="13" :stroke-width="2.1" />
              {{ file.action }}
            </button>
          </div>
        </div>
      </section>

      <section v-if="displayError" class="grid gap-2 rounded-[8px] border border-rem/20 bg-rem/8 p-3">
        <div class="flex items-start gap-2">
          <IconAlertTriangle class="mt-px shrink-0 text-rem" :size="16" :stroke-width="2.1" />
          <div class="min-w-0">
            <h2 class="m-0 font-sans text-[12.5px] font-semibold text-rem">{{ displayError.title }}</h2>
            <p class="m-0 mt-1 font-sans text-[12px] leading-relaxed text-ink-2">{{ displayError.message }}</p>
          </div>
        </div>
      </section>

      <section v-if="docxWarning" class="mt-3 flex items-start gap-2 rounded-[8px] border border-rule-light bg-chrome-high p-3">
        <IconAlertTriangle class="mt-px shrink-0 text-ink-3" :size="15" :stroke-width="2.1" />
        <p class="m-0 font-sans text-[12px] leading-relaxed text-ink-3">{{ docxWarning }}</p>
      </section>

      <section v-if="actionError" class="mt-3 flex items-start gap-2 rounded-[8px] border border-rem/20 bg-rem/8 p-3">
        <IconAlertTriangle class="mt-px shrink-0 text-rem" :size="15" :stroke-width="2.1" />
        <p class="m-0 font-sans text-[12px] leading-relaxed text-rem">{{ actionError }}</p>
      </section>

      <section class="mt-3 grid gap-3 rounded-[8px] border border-rule-light bg-surface p-3">
        <div class="flex min-w-0 items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-sans text-[13px] font-semibold text-ink">{{ activity }}</div>
            <div class="mt-0.5 font-sans text-[11px] text-ink-3">{{ packageName }}</div>
          </div>
          <div class="shrink-0 text-right font-mono text-[10.5px] text-ink-4">
            <div>{{ formatTime(run.startedAt) }}</div>
            <div v-if="duration">{{ duration }}</div>
          </div>
        </div>

        <div class="grid grid-cols-12 gap-1" aria-label="Run progress">
          <span
            v-for="index in 12"
            :key="index"
            class="h-1.5 rounded-full"
            :class="segmentClass(index - 1)"
          />
        </div>
        <div class="flex items-center justify-between gap-3 font-sans text-[11px] text-ink-3">
          <span>{{ progress.label }}</span>
        </div>
      </section>

      <section class="mt-4 grid gap-3 rounded-[8px] border border-rule-light bg-surface p-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="m-0 flex items-center gap-1.5 font-sans text-[12px] font-semibold text-ink-2">
            <IconListDetails :size="14" :stroke-width="2.1" />
            Progress
          </h2>
          <span class="font-mono text-[10.5px] text-ink-4">{{ timeline.length }} events</span>
        </div>
        <div v-if="timeline.length" class="grid gap-1">
          <div
            v-for="event in timeline"
            :key="event.sequence"
            class="grid grid-cols-[8px_minmax(0,1fr)_70px] items-start gap-2 rounded-[6px] border border-rule-light bg-chrome-high px-2 py-1.5"
          >
            <span class="mt-[5px] h-1.5 w-1.5 rounded-full bg-ink-4" />
            <span class="min-w-0 truncate font-sans text-[11.5px] text-ink-2">{{ packageRunEventLabel(event) }}</span>
            <span class="text-right font-mono text-[10px] text-ink-4">{{ formatTime(event.ts) }}</span>
          </div>
        </div>
        <div v-else class="rounded-[6px] border border-rule-light bg-chrome-high p-2 font-sans text-[12px] text-ink-3">
          Waiting for the first update
        </div>
      </section>

      <details class="mt-4 rounded-[8px] border border-rule-light bg-surface">
        <summary class="cursor-default px-3 py-2 font-sans text-[12px] font-semibold text-ink-2 hover:bg-chrome-high">
          Technical details
        </summary>
        <div class="grid gap-3 border-t border-rule-light p-3">
          <div>
            <h3 class="m-0 mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3">Run</h3>
            <pre class="m-0 max-h-[120px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-rule-light bg-chrome-high p-2 font-mono text-[10.5px] leading-relaxed text-ink-3">{{ run.packageId }} / {{ run.jobId }} / {{ run.runId }}</pre>
          </div>
          <div v-if="jsonInputs">
            <h3 class="m-0 mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3">Inputs</h3>
            <pre class="m-0 max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-rule-light bg-chrome-high p-2 font-mono text-[10.5px] leading-relaxed text-ink-3">{{ jsonInputs }}</pre>
          </div>
          <div v-if="displayError">
            <h3 class="m-0 mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3">Error</h3>
            <pre class="m-0 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-rule-light bg-chrome-high p-2 font-mono text-[10.5px] leading-relaxed text-ink-3">{{ displayError.detail }}</pre>
          </div>
          <div v-if="jsonResult">
            <h3 class="m-0 mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3">Raw result</h3>
            <pre class="m-0 max-h-[260px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-rule-light bg-chrome-high p-2 font-mono text-[10.5px] leading-relaxed text-ink-3">{{ jsonResult }}</pre>
          </div>
        </div>
      </details>
    </main>
  </section>
</template>
