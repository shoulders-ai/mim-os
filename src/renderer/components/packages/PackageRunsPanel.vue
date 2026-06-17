<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PackageRunEvent, PackageRunRecord } from '../../stores/runs.js'
import {
  activeRunForJob as findActiveRunForJob,
  defaultInputForSchema,
  jobInputSummary as summarizeJobInput,
  latestRunActivity,
  latestRunProgress,
  packageRunEventLabel,
  parseJobInputText,
  runDurationLabel,
} from './packageManagerLogic.js'
import type { CapabilityJob, PackageCapabilities } from './packageManagerTypes.js'
import { schemaToFields, defaultValuesFromFields, hasFormFields, type SchemaField } from './schemaFields.js'

const props = defineProps<{
  packageId: string
  capabilities: PackageCapabilities | null
  runs: PackageRunRecord[]
  selectedRun: PackageRunRecord | null
  actionBusy: string | null
}>()

const emit = defineEmits<{
  refresh: []
  selectRun: [runId: string]
  startJob: [job: CapabilityJob, inputs: Record<string, unknown>]
  cancelRun: [run: PackageRunRecord]
  retryRun: [run: PackageRunRecord]
}>()

const jobInputs = ref<Record<string, string>>({})
const jobFormValues = ref<Record<string, Record<string, unknown>>>({})

const jobs = computed(() => props.capabilities?.jobs ?? [])

const progressWidthClasses = [
  'w-0',
  'w-1/12',
  'w-2/12',
  'w-3/12',
  'w-4/12',
  'w-5/12',
  'w-6/12',
  'w-7/12',
  'w-8/12',
  'w-9/12',
  'w-10/12',
  'w-11/12',
  'w-full',
] as const

function statusLabel(status: PackageRunRecord['status']): string {
  if (status === 'running') return 'Running'
  if (status === 'completed') return 'Complete'
  if (status === 'failed') return 'Failed'
  return 'Cancelled'
}

function statusClass(status: PackageRunRecord['status']): string {
  if (status === 'running') return 'border-accent/25 bg-accent-tint text-accent'
  if (status === 'completed') return 'border-add/25 bg-add/10 text-add'
  if (status === 'failed') return 'border-rem/25 bg-rem/10 text-rem'
  return 'border-rule bg-chrome-mid text-ink-3'
}

function progressFillClass(status: PackageRunRecord['status']): string {
  if (status === 'completed') return 'bg-add'
  if (status === 'failed') return 'bg-rem'
  if (status === 'cancelled') return 'bg-ink-4'
  return 'bg-accent'
}

function progressWidthClass(percent: number): string {
  const bucket = Math.max(0, Math.min(12, Math.round(percent / 100 * 12)))
  return progressWidthClasses[bucket]
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

function eventLabel(event: PackageRunEvent): string {
  return packageRunEventLabel(event)
}

function runActivity(run: PackageRunRecord): string {
  return latestRunActivity(run)
}

function runDuration(run: PackageRunRecord): string {
  return runDurationLabel(run)
}

function runProgress(run: PackageRunRecord) {
  return latestRunProgress(run)
}

function activeRunForJob(job: CapabilityJob): PackageRunRecord | null {
  return findActiveRunForJob(job, props.runs)
}

function selectActiveJobRun(job: CapabilityJob) {
  const run = activeRunForJob(job)
  if (run) emit('selectRun', run.runId)
}

function activeRunForRun(run: PackageRunRecord): PackageRunRecord | null {
  const job = jobs.value.find(candidate => candidate.id === run.jobId)
  return job ? activeRunForJob(job) : null
}

function selectActiveRunForRun(run: PackageRunRecord) {
  const activeRun = activeRunForRun(run)
  if (activeRun) emit('selectRun', activeRun.runId)
}

function jobKey(jobId: string): string {
  return `${props.packageId}:${jobId}`
}

function inputText(job: CapabilityJob): string {
  const key = jobKey(job.id)
  if (!jobInputs.value[key]) jobInputs.value[key] = defaultInputForSchema(job.inputSchema)
  return jobInputs.value[key]
}

function setInputText(job: CapabilityJob, value: string) {
  jobInputs.value = { ...jobInputs.value, [jobKey(job.id)]: value }
}

function parseInputs(job: CapabilityJob): Record<string, unknown> {
  return parseJobInputText(inputText(job))
}

function inputError(job: CapabilityJob): string | null {
  try {
    parseInputs(job)
    return null
  } catch (err) {
    return (err as Error).message
  }
}

function jobInputSummary(job: CapabilityJob): string {
  return summarizeJobInput(job.inputSchema)
}

function jobFields(job: CapabilityJob): SchemaField[] {
  return schemaToFields(job.inputSchema)
}

function useFormMode(job: CapabilityJob): boolean {
  return hasFormFields(job.inputSchema)
}

function getFormValues(job: CapabilityJob): Record<string, unknown> {
  const key = jobKey(job.id)
  if (!jobFormValues.value[key]) {
    jobFormValues.value[key] = defaultValuesFromFields(jobFields(job))
  }
  return jobFormValues.value[key]
}

function setFormValue(job: CapabilityJob, fieldKey: string, value: unknown) {
  const key = jobKey(job.id)
  const current = getFormValues(job)
  jobFormValues.value = { ...jobFormValues.value, [key]: { ...current, [fieldKey]: value } }
}

function formInputs(job: CapabilityJob): Record<string, unknown> {
  const values = getFormValues(job)
  const fields = jobFields(job)
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    const value = values[field.key]
    if (field.type === 'json' && typeof value === 'string') {
      try {
        result[field.key] = JSON.parse(value)
      } catch {
        result[field.key] = value
      }
    } else if (value !== undefined && value !== '') {
      result[field.key] = value
    }
  }
  return result
}

function formInputError(job: CapabilityJob): string | null {
  const fields = jobFields(job)
  const values = getFormValues(job)
  for (const field of fields) {
    if (field.required) {
      const val = values[field.key]
      if (val === undefined || val === '' || val === null) {
        return `${field.label} is required`
      }
    }
    if (field.type === 'json' && typeof values[field.key] === 'string' && (values[field.key] as string).trim()) {
      try {
        JSON.parse(values[field.key] as string)
      } catch {
        return `${field.label}: invalid JSON`
      }
    }
  }
  return null
}

function startJob(job: CapabilityJob) {
  if (useFormMode(job)) {
    if (formInputError(job)) return
    emit('startJob', job, formInputs(job))
  } else {
    if (inputError(job)) return
    emit('startJob', job, parseInputs(job))
  }
}
</script>

<template>
  <section class="mb-0 overflow-hidden rounded-[8px] border border-rule-light bg-chrome-high">
    <div class="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-rule-light px-2.5 py-2">
      <h3 class="m-0 text-[12px] font-semibold text-ink">Runs</h3>
      <button
        class="inline-flex h-6 items-center justify-center rounded-[5px] border border-rule bg-chrome-high px-2 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
        @click="emit('refresh')"
      >
        Refresh
      </button>
    </div>

    <div v-if="jobs.length" class="flex flex-col gap-2 border-b border-rule-light p-2.5">
      <div
        v-for="job in jobs"
        :key="job.id"
        class="overflow-hidden rounded-[7px] border border-rule-light bg-surface"
      >
        <div class="flex min-h-[34px] items-center justify-between gap-2.5 px-2 py-[7px]">
          <div class="flex min-w-0 flex-col gap-0.5">
            <strong class="text-[11.5px] font-semibold text-ink-2">{{ job.label }}</strong>
            <code class="font-mono text-[10px] text-ink-3">{{ job.id }}</code>
            <span class="text-[10.5px] text-ink-3">{{ jobInputSummary(job) }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              v-if="activeRunForJob(job)"
              class="inline-flex h-6 items-center justify-center rounded-[5px] border border-rule bg-chrome-high px-2 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
              @click="selectActiveJobRun(job)"
            >
              View run
            </button>
            <button
              class="inline-flex h-7 items-center justify-center rounded-[5px] border border-accent bg-accent px-2.5 text-[12px] font-medium text-accent-ink hover:bg-accent disabled:opacity-50"
              :disabled="actionBusy === `start:${job.id}` || !!(useFormMode(job) ? formInputError(job) : inputError(job)) || !!activeRunForJob(job)"
              @click="startJob(job)"
            >
              {{ activeRunForJob(job) ? 'Running' : 'Start' }}
            </button>
          </div>
        </div>
        <!-- Schema-based form fields -->
        <div v-if="useFormMode(job)" class="border-t border-rule-light bg-chrome-high p-2">
          <div
            v-for="field in jobFields(job)"
            :key="field.key"
            class="mb-1.5 last:mb-0"
          >
            <label class="mb-0.5 flex items-center gap-1 text-[10.5px] font-medium text-ink-2">
              {{ field.label }}
              <span v-if="field.required" class="text-rem">*</span>
            </label>
            <span v-if="field.description" class="mb-0.5 block text-[10px] text-ink-3">{{ field.description }}</span>

            <input
              v-if="field.type === 'text'"
              type="text"
              class="block h-7 w-full rounded-[5px] border border-rule bg-surface px-2 text-[11px] text-ink-2 outline-none focus:border-accent"
              :value="getFormValues(job)[field.key] ?? ''"
              @input="setFormValue(job, field.key, ($event.target as HTMLInputElement).value)"
            />
            <input
              v-else-if="field.type === 'number'"
              type="number"
              class="block h-7 w-full rounded-[5px] border border-rule bg-surface px-2 text-[11px] text-ink-2 outline-none focus:border-accent"
              :value="getFormValues(job)[field.key] ?? 0"
              @input="setFormValue(job, field.key, Number(($event.target as HTMLInputElement).value))"
            />
            <label
              v-else-if="field.type === 'checkbox'"
              class="flex items-center gap-1.5"
            >
              <input
                type="checkbox"
                class="h-3.5 w-3.5 rounded border border-rule accent-accent"
                :checked="!!getFormValues(job)[field.key]"
                @change="setFormValue(job, field.key, ($event.target as HTMLInputElement).checked)"
              />
              <span class="text-[11px] text-ink-2">{{ field.label }}</span>
            </label>
            <select
              v-else-if="field.type === 'select'"
              class="block h-7 w-full rounded-[5px] border border-rule bg-surface px-2 text-[11px] text-ink-2 outline-none focus:border-accent"
              :value="getFormValues(job)[field.key] ?? ''"
              @change="setFormValue(job, field.key, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <textarea
              v-else
              class="block min-h-[40px] max-h-[80px] w-full resize-y rounded-[5px] border border-rule bg-surface p-2 font-mono text-[11px] leading-[1.35] text-ink-2 outline-none focus:border-accent"
              :value="String(getFormValues(job)[field.key] ?? '')"
              spellcheck="false"
              @input="setFormValue(job, field.key, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
          <div
            v-if="formInputError(job)"
            class="mt-1 text-[10.5px] text-rem"
          >
            {{ formInputError(job) }}
          </div>
        </div>
        <!-- JSON textarea fallback -->
        <template v-else>
          <textarea
            class="block min-h-[54px] max-h-[110px] w-full resize-y border-0 border-t border-rule-light bg-chrome-high p-2 font-mono text-[11px] leading-[1.35] text-ink-2 outline-none focus:shadow-[inset_0_0_0_1px_var(--color-accent)]"
            :value="inputText(job)"
            spellcheck="false"
            @input="setInputText(job, ($event.target as HTMLTextAreaElement).value)"
          />
          <div
            class="flex min-h-6 items-center border-t border-rule-light px-2 text-[10.5px]"
            :class="inputError(job) ? 'text-rem' : 'text-ink-3'"
          >
            <span>{{ inputError(job) || 'JSON object input' }}</span>
          </div>
        </template>
      </div>
    </div>

    <div class="grid min-h-[260px] grid-cols-[minmax(170px,240px)_minmax(0,1fr)] max-[860px]:grid-cols-1">
      <div class="overflow-auto border-r border-rule-light p-2 max-[860px]:border-r-0 max-[860px]:border-b">
        <button
          v-for="run in runs"
          :key="run.runId"
          class="grid min-h-[38px] w-full grid-cols-[72px_minmax(0,1fr)] items-center gap-2 rounded-[6px] p-1.5 text-left hover:bg-chrome-mid"
          :class="{ 'bg-chrome-mid': selectedRun?.runId === run.runId }"
          @click="emit('selectRun', run.runId)"
        >
          <span
            class="inline-flex h-[19px] items-center justify-center rounded-full border px-[7px] text-[9.5px] font-semibold"
            :class="statusClass(run.status)"
          >
            {{ statusLabel(run.status) }}
          </span>
          <span class="flex min-w-0 flex-col gap-px">
            <strong class="truncate text-[11.5px] font-semibold text-ink-2">{{ run.jobId }}</strong>
            <span class="truncate text-[10.5px] text-ink-3">{{ formatTime(run.startedAt) }} / {{ runActivity(run) }}</span>
            <span class="mt-[3px] block h-[3px] overflow-hidden rounded-full bg-rule-light">
              <span
                class="block h-full rounded-full"
                :class="[progressFillClass(run.status), progressWidthClass(runProgress(run).percent)]"
              />
            </span>
          </span>
        </button>
        <div v-if="!runs.length" class="p-3 text-[11px] text-ink-3">No runs</div>
      </div>

      <div class="min-w-0 overflow-auto p-2.5">
        <template v-if="selectedRun">
          <div class="mb-2.5 flex justify-between gap-3">
            <div class="min-w-0">
              <h4 class="m-0 mb-2 text-[11px] font-semibold text-ink-2">{{ selectedRun.jobId }}</h4>
              <code class="block truncate font-mono text-[10px] text-ink-3">{{ selectedRun.runId }}</code>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <button
                v-if="selectedRun.status === 'running'"
                class="inline-flex h-7 items-center justify-center rounded-[5px] border border-rule bg-chrome-high px-2.5 text-[12px] font-medium text-rem hover:bg-chrome-mid disabled:opacity-50"
                :disabled="actionBusy === `cancel:${selectedRun.runId}`"
                @click="emit('cancelRun', selectedRun)"
              >
                Cancel
              </button>
              <button
                v-else-if="activeRunForRun(selectedRun)"
                class="inline-flex h-7 items-center justify-center rounded-[5px] border border-rule bg-chrome-high px-2.5 text-[12px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                @click="selectActiveRunForRun(selectedRun)"
              >
                View running
              </button>
              <button
                v-else
                class="inline-flex h-7 items-center justify-center rounded-[5px] border border-rule bg-chrome-high px-2.5 text-[12px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                @click="emit('retryRun', selectedRun)"
              >
                Retry
              </button>
            </div>
          </div>

          <div class="mb-2.5 grid grid-cols-[minmax(82px,0.45fr)_minmax(82px,0.45fr)_minmax(82px,0.45fr)_minmax(170px,1fr)] gap-2 max-[860px]:grid-cols-1">
            <div class="min-w-0 rounded-[7px] border border-rule-light bg-surface px-2 py-[7px]">
              <span class="block text-[10px] font-semibold uppercase text-ink-3">Status</span>
              <strong class="mt-1 block truncate text-[12px] font-semibold text-ink-2">{{ statusLabel(selectedRun.status) }}</strong>
            </div>
            <div class="min-w-0 rounded-[7px] border border-rule-light bg-surface px-2 py-[7px]">
              <span class="block text-[10px] font-semibold uppercase text-ink-3">Started</span>
              <strong class="mt-1 block truncate text-[12px] font-semibold text-ink-2">{{ formatTime(selectedRun.startedAt) }}</strong>
            </div>
            <div class="min-w-0 rounded-[7px] border border-rule-light bg-surface px-2 py-[7px]">
              <span class="block text-[10px] font-semibold uppercase text-ink-3">Duration</span>
              <strong class="mt-1 block truncate text-[12px] font-semibold text-ink-2">{{ runDuration(selectedRun) || 'n/a' }}</strong>
            </div>
            <div class="min-w-0 rounded-[7px] border border-rule-light bg-surface px-2 py-[7px]">
              <span class="block text-[11px] text-ink-3">{{ runProgress(selectedRun).label }}</span>
              <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rule-light" aria-label="Run progress">
                <span
                  class="block h-full rounded-full"
                  :class="[progressFillClass(selectedRun.status), progressWidthClass(runProgress(selectedRun).percent)]"
                />
              </div>
            </div>
          </div>

          <div class="overflow-hidden rounded-[7px] border border-rule-light">
            <div
              v-for="event in selectedRun.events"
              :key="event.sequence"
              class="grid min-h-7 grid-cols-[28px_minmax(0,1fr)_64px] items-center gap-2 border-b border-rule-light px-2 py-1 text-[11.5px] last:border-b-0"
            >
              <span class="font-mono text-[10px] text-ink-4">{{ event.sequence }}</span>
              <span class="truncate text-ink-2">{{ eventLabel(event) }}</span>
              <span class="text-right font-mono text-[10px] text-ink-3">{{ formatTime(event.ts) }}</span>
            </div>
          </div>

          <div class="mt-2.5 grid grid-cols-2 gap-2 max-[860px]:grid-cols-1">
            <div v-if="selectedRun.error" class="min-w-0 overflow-hidden rounded-[7px] border border-rem/35 bg-surface">
              <strong class="block border-b border-rule-light px-2 py-1.5 text-[10.5px] font-semibold uppercase text-rem">Error</strong>
              <pre class="m-0 max-h-[180px] overflow-auto whitespace-pre-wrap p-2 font-mono text-[10.5px] leading-[1.4] text-rem">{{ selectedRun.error }}</pre>
            </div>
            <div v-if="selectedRun.result !== undefined" class="min-w-0 overflow-hidden rounded-[7px] border border-rule-light bg-surface">
              <strong class="block border-b border-rule-light px-2 py-1.5 text-[10.5px] font-semibold uppercase text-ink-3">Result</strong>
              <pre class="m-0 max-h-[180px] overflow-auto whitespace-pre-wrap p-2 font-mono text-[10.5px] leading-[1.4] text-ink-2">{{ formatJson(selectedRun.result) }}</pre>
            </div>
            <div class="min-w-0 overflow-hidden rounded-[7px] border border-rule-light bg-surface">
              <strong class="block border-b border-rule-light px-2 py-1.5 text-[10.5px] font-semibold uppercase text-ink-3">Inputs</strong>
              <pre class="m-0 max-h-[180px] overflow-auto whitespace-pre-wrap p-2 font-mono text-[10.5px] leading-[1.4] text-ink-2">{{ formatJson(selectedRun.inputs) }}</pre>
            </div>
          </div>
        </template>
        <div v-else class="p-3 text-[11px] text-ink-3">Select a run</div>
      </div>
    </div>
  </section>
</template>
