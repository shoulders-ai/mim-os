<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { IconPlus, IconPlayerPause, IconPlayerPlay, IconRefresh, IconX } from '@tabler/icons-vue'
import { useRoutineStore, type RoutineDefinition } from '../../stores/routines.js'
import { useSettingsStore } from '../../stores/settings.js'
import ModelPicker from '../chat/ModelPicker.vue'
import { modelMenuItems, resolvePreferredModel } from '../../services/ai/modelControls.js'

type TriggerKind = 'manual' | 'daily' | 'weekly' | 'interval' | 'files' | 'webhook'

interface ModelRegistry {
  models?: Array<{
    id: string
    provider?: string
    displayName?: string
    name?: string
    shortLabel?: string
    contextWindow?: number
    capabilities?: Record<string, unknown>
  }>
  defaults?: Record<string, string[]>
}

const props = withDefaults(defineProps<{
  active?: boolean
}>(), {
  active: true,
})

const emit = defineEmits<{
  openSession: [id: string]
  openFile: [path: string]
}>()

const store = useRoutineStore()
const settingsStore = useSettingsStore()
const creating = ref(false)
const saving = ref(false)
const createError = ref('')
const createName = ref('')
const createDescription = ref('')
const createModelId = ref('')
const createBody = ref('')
const triggerKind = ref<TriggerKind>('manual')
const scheduleTime = ref('09:00')
const weeklyDay = ref('1')
const intervalValue = ref('4')
const intervalUnit = ref<'m' | 'h' | 'd'>('h')
const filePath = ref('inbox/')
const externalRequestName = ref('')
const registry = ref<ModelRegistry | null>(null)
const modelError = ref('')
const modes: Array<{ kind: TriggerKind; label: string }> = [
  { kind: 'manual', label: 'Manual' },
  { kind: 'daily', label: 'Daily' },
  { kind: 'weekly', label: 'Weekly' },
  { kind: 'interval', label: 'Every few hours' },
  { kind: 'files', label: 'Files added or changed' },
  { kind: 'webhook', label: 'External request' },
]
const weekdays = [
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
  { value: '0', label: 'Sun' },
]
const intervalUnits: Array<{ value: 'm' | 'h' | 'd'; label: string }> = [
  { value: 'm', label: 'minutes' },
  { value: 'h', label: 'hours' },
  { value: 'd', label: 'days' },
]

const sortedRoutines = computed(() =>
  [...store.routines].sort((a, b) => a.name.localeCompare(b.name)),
)

const showCreatePanel = computed(() =>
  creating.value || (store.loaded && !store.loading && sortedRoutines.value.length === 0),
)

const selectableModels = computed(() =>
  modelMenuItems(registry.value, settingsStore.keyStatuses),
)

onMounted(() => {
  if (props.active) {
    void store.load()
    void loadModels()
  }
})

watch(() => props.active, active => {
  if (active) {
    void store.load()
    void loadModels()
  }
})

watch(showCreatePanel, visible => {
  if (visible && !createName.value) resetCreateDraft()
})

watch(selectableModels, () => {
  ensureCreateModel()
})

function triggerLabel(routine: RoutineDefinition): string {
  const trigger = routine.trigger ?? {}
  if (typeof trigger.every === 'string') return intervalLabel(trigger.every)
  if (typeof trigger.schedule === 'string') return scheduleLabel(trigger.schedule)
  if (isPlainObject(trigger.files) && typeof trigger.files.path === 'string') return `Files: ${trigger.files.path}`
  if (isPlainObject(trigger.webhook) && typeof trigger.webhook.secret === 'string') return `External request: ${trigger.webhook.secret}`
  if (isPlainObject(trigger.slack)) return 'Slack'
  return 'Manual'
}

function routineTools(routine: RoutineDefinition): string {
  return routine.tools?.length ? routine.tools.join(', ') : 'Default tools'
}

function resetCreateDraft() {
  createError.value = ''
  createName.value = nextRoutineName()
  createDescription.value = ''
  ensureCreateModel()
  createBody.value = 'Review the workspace and summarize the current state.'
  triggerKind.value = 'manual'
  scheduleTime.value = '09:00'
  weeklyDay.value = '1'
  intervalValue.value = '4'
  intervalUnit.value = 'h'
  filePath.value = 'inbox/'
  externalRequestName.value = createName.value
}

function openCreate() {
  resetCreateDraft()
  creating.value = true
}

function closeCreate() {
  creating.value = false
  createError.value = ''
}

function nextRoutineName(): string {
  const existing = new Set(store.routines.map(routine => routine.id))
  if (!existing.has('new-routine')) return 'new-routine'
  for (let i = 2; i < 100; i++) {
    const candidate = `new-routine-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `new-routine-${Date.now()}`
}

function setTriggerKind(kind: TriggerKind) {
  triggerKind.value = kind
  if (kind === 'webhook' && !externalRequestName.value.trim()) {
    externalRequestName.value = createName.value.trim() || 'intake'
  }
}

async function loadModels(): Promise<void> {
  modelError.value = ''
  try {
    registry.value = await window.kernel.call('ai.registry') as ModelRegistry
    await settingsStore.refreshKeyStatuses()
    ensureCreateModel()
  } catch (err) {
    modelError.value = err instanceof Error ? err.message : String(err)
  }
}

function ensureCreateModel(): void {
  if (createModelId.value && selectableModels.value.some(model => model.id === createModelId.value)) return
  const preferred = resolvePreferredModel(registry.value, settingsStore.keyStatuses, settingsStore.lastChatModel, 'chat')
  createModelId.value = preferred?.id ?? selectableModels.value[0]?.id ?? ''
}

function onModelChange(modelId: string) {
  createModelId.value = modelId
  settingsStore.set('lastChatModel', modelId)
}

function buildTrigger(): Record<string, unknown> | undefined {
  if (triggerKind.value === 'manual') return undefined
  if (triggerKind.value === 'daily') return { schedule: `${minuteField()} ${hourField()} * * *` }
  if (triggerKind.value === 'weekly') return { schedule: `${minuteField()} ${hourField()} * * ${weeklyDay.value}` }
  if (triggerKind.value === 'interval') return { every: `${positiveInterval()}${intervalUnit.value}` }
  if (triggerKind.value === 'files') return { files: { path: filePath.value.trim() || 'inbox/', events: ['add', 'change'] } }
  return { webhook: { secret: externalRequestName.value.trim() || createName.value.trim() || 'intake' } }
}

function minuteField(): number {
  const [, minute = '00'] = scheduleTime.value.split(':')
  return clamp(Number(minute), 0, 59)
}

function hourField(): number {
  const [hour = '09'] = scheduleTime.value.split(':')
  return clamp(Number(hour), 0, 23)
}

function positiveInterval(): number {
  return Math.max(1, Math.floor(Number(intervalValue.value) || 1))
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function intervalLabel(value: string): string {
  const match = /^(\d+)([mhd])$/.exec(value.trim())
  if (!match) return `Every ${value}`
  const amount = Number(match[1])
  const unit = match[2] === 'm' ? 'minute' : match[2] === 'h' ? 'hour' : 'day'
  return `Every ${amount} ${unit}${amount === 1 ? '' : 's'}`
}

function scheduleLabel(value: string): string {
  const parts = value.trim().split(/\s+/)
  if (parts.length !== 5) return 'Scheduled'
  const [minute, hour, day, month, weekday] = parts
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  if (day === '*' && month === '*' && weekday === '*') return `Daily at ${time}`
  if (day === '*' && month === '*') {
    const named = weekdays.find(item => item.value === weekday)
    if (named) return `${named.label} at ${time}`
  }
  return 'Scheduled'
}

async function createRoutine(): Promise<void> {
  createError.value = ''
  const name = createName.value.trim()
  const body = createBody.value.trim()
  if (!name) {
    createError.value = 'Name is required.'
    return
  }
  if (!body) {
    createError.value = 'Prompt is required.'
    return
  }

  saving.value = true
  try {
    const trigger = buildTrigger()
    const routine = await store.create({
      name,
      ...(createDescription.value.trim() ? { description: createDescription.value.trim() } : {}),
      ...(createModelId.value ? { model: createModelId.value } : {}),
      ...(trigger ? { trigger } : {}),
      body,
    })
    creating.value = false
    if (routine?.path) emit('openFile', routine.path)
  } catch (err) {
    createError.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

async function runNow(routine: RoutineDefinition): Promise<void> {
  const result = await store.runNow(routine.id)
  if (result.sessionId) emit('openSession', result.sessionId)
}

async function toggleEnabled(routine: RoutineDefinition): Promise<void> {
  if (routine.enabled) await store.pause(routine.id)
  else await store.resume(routine.id)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
</script>

<template>
  <main class="flex h-full min-h-0 flex-col bg-surface text-ink">
    <header class="flex h-11 shrink-0 items-center justify-between border-b border-rule-light px-4">
      <div class="min-w-0">
        <h1 class="truncate text-[13px] font-semibold">Routines</h1>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          class="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
          title="New routine"
          aria-label="New routine"
          data-testid="routine-new"
          @click="openCreate"
        >
          <IconPlus :size="15" :stroke="1.8" />
        </button>
        <button
          class="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
          title="Refresh"
          aria-label="Refresh"
          @click="store.load"
        >
          <IconRefresh :size="15" :stroke="1.8" />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div v-if="store.error" class="mb-3 rounded-[7px] border border-rem/30 bg-rem/10 px-3 py-2 text-[12px] text-rem">
        {{ store.error }}
      </div>

      <div v-if="store.diagnostics.length" class="mb-3 rounded-[7px] border border-warn/30 bg-warn/10 px-3 py-2">
        <div
          v-for="diagnostic in store.diagnostics"
          :key="`${diagnostic.path}:${diagnostic.message}`"
          class="text-[12px] text-ink-2"
        >
          {{ diagnostic.path }}: {{ diagnostic.message }}
        </div>
      </div>

      <section
        v-if="showCreatePanel"
        data-testid="routine-create-form"
        class="mb-3 rounded-[7px] border border-rule-light bg-chrome px-3 py-3"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="truncate text-[13px] font-semibold">New routine</h2>
          </div>
          <button
            v-if="sortedRoutines.length"
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
            title="Cancel"
            aria-label="Cancel"
            @click="closeCreate"
          >
            <IconX :size="15" :stroke="1.8" />
          </button>
        </div>

        <div v-if="createError" class="mt-3 rounded-[6px] border border-rem/30 bg-rem/10 px-2 py-1.5 text-[12px] text-rem">
          {{ createError }}
        </div>
        <div v-if="modelError" class="mt-3 rounded-[6px] border border-warn/30 bg-warn/10 px-2 py-1.5 text-[12px] text-ink-2">
          {{ modelError }}
        </div>

        <div class="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
          <label class="grid gap-1 text-[11px] font-medium text-ink-3">
            Name
            <input
              v-model="createName"
              data-testid="routine-create-name"
              class="h-8 rounded-[6px] border border-rule-light bg-surface px-2 text-[12px] text-ink outline-none focus:border-accent"
              placeholder="daily-review"
              autocapitalize="off"
              autocorrect="off"
            />
          </label>
          <div class="grid gap-1 text-[11px] font-medium text-ink-3">
            Model
            <div class="flex h-8 items-center rounded-[6px] border border-rule-light bg-surface px-1">
              <ModelPicker
                :model-id="createModelId"
                :models="selectableModels"
                placement="below"
                @update:model-id="onModelChange"
              />
            </div>
          </div>
        </div>

        <label class="mt-2 grid gap-1 text-[11px] font-medium text-ink-3">
          Description
          <input
            v-model="createDescription"
            class="h-8 rounded-[6px] border border-rule-light bg-surface px-2 text-[12px] text-ink outline-none focus:border-accent"
            placeholder="Short label for the routine"
          />
        </label>

        <div class="mt-3 grid gap-1 text-[11px] font-medium text-ink-3">
          Runs
          <div class="grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">
            <button
              v-for="mode in modes"
              :key="mode.kind"
              type="button"
              class="h-9 rounded-[7px] border px-2.5 text-left hover:bg-chrome-mid"
              :class="triggerKind === mode.kind ? 'border-accent/40 bg-accent-tint text-ink' : 'border-rule-light bg-surface text-ink-2'"
              :data-testid="`routine-mode-${mode.kind}`"
              @click="setTriggerKind(mode.kind)"
            >
              <span class="block truncate text-[12px] font-semibold">{{ mode.label }}</span>
            </button>
          </div>
        </div>

        <div v-if="triggerKind === 'daily' || triggerKind === 'weekly'" class="mt-3 rounded-[7px] border border-rule-light bg-surface px-3 py-2">
          <div class="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)]">
            <label class="grid gap-1 text-[11px] font-medium text-ink-3">
              Time
              <input
                v-model="scheduleTime"
                type="time"
                class="h-8 rounded-[6px] border border-rule-light bg-chrome px-2 text-[12px] text-ink outline-none focus:border-accent"
              />
            </label>
            <div v-if="triggerKind === 'weekly'" class="grid gap-1 text-[11px] font-medium text-ink-3">
              Day
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="day in weekdays"
                  :key="day.value"
                  type="button"
                  class="h-8 rounded-[6px] px-2 text-[12px] font-medium hover:bg-chrome-mid"
                  :class="weeklyDay === day.value ? 'bg-accent-tint text-accent' : 'text-ink-3'"
                  @click="weeklyDay = day.value"
                >
                  {{ day.label }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="triggerKind === 'interval'" class="mt-3 rounded-[7px] border border-rule-light bg-surface px-3 py-2">
          <div class="grid gap-1 text-[11px] font-medium text-ink-3">
            Repeat every
            <div class="flex flex-wrap items-center gap-1">
              <input
                v-model="intervalValue"
                type="number"
                min="1"
                class="h-8 w-20 rounded-[6px] border border-rule-light bg-chrome px-2 text-[12px] text-ink outline-none focus:border-accent"
              />
              <button
                v-for="unit in intervalUnits"
                :key="unit.value"
                type="button"
                class="h-8 rounded-[6px] px-2 text-[12px] font-medium hover:bg-chrome-mid"
                :class="intervalUnit === unit.value ? 'bg-accent-tint text-accent' : 'text-ink-3'"
                @click="intervalUnit = unit.value"
              >
                {{ unit.label }}
              </button>
            </div>
          </div>
        </div>

        <label v-else-if="triggerKind === 'files'" class="mt-3 grid gap-1 rounded-[7px] border border-rule-light bg-surface px-3 py-2 text-[11px] font-medium text-ink-3">
          Folder or file
          <input
            v-model="filePath"
            class="h-8 rounded-[6px] border border-rule-light bg-chrome px-2 text-[12px] text-ink outline-none focus:border-accent"
            placeholder="inbox/"
            autocapitalize="off"
            autocorrect="off"
          />
        </label>

        <label v-else-if="triggerKind === 'webhook'" class="mt-3 grid gap-1 rounded-[7px] border border-rule-light bg-surface px-3 py-2 text-[11px] font-medium text-ink-3">
          Connection name
          <input
            v-model="externalRequestName"
            class="h-8 rounded-[6px] border border-rule-light bg-chrome px-2 text-[12px] text-ink outline-none focus:border-accent"
            placeholder="intake"
            autocapitalize="off"
            autocorrect="off"
          />
        </label>

        <label class="mt-2 grid gap-1 text-[11px] font-medium text-ink-3">
          Prompt
          <textarea
            v-model="createBody"
            data-testid="routine-create-body"
            class="min-h-[96px] resize-y rounded-[6px] border border-rule-light bg-surface px-2 py-2 text-[12px] leading-5 text-ink outline-none focus:border-accent"
          />
        </label>

        <div class="mt-3 flex justify-end">
          <button
            type="button"
            data-testid="routine-create-submit"
            class="inline-flex h-7 items-center gap-1 rounded-[6px] bg-accent px-2.5 text-[12px] font-medium text-accent-ink hover:opacity-90"
            :class="saving ? 'opacity-60' : ''"
            :disabled="saving"
            @click="createRoutine"
          >
            <IconPlus :size="14" :stroke="1.8" />
            <span>{{ saving ? 'Creating' : 'Create' }}</span>
          </button>
        </div>
      </section>

      <div v-if="sortedRoutines.length" class="flex flex-col gap-2">
        <section
          v-for="routine in sortedRoutines"
          :key="routine.id"
          class="rounded-[7px] border border-rule-light bg-chrome px-3 py-3"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <h2 class="truncate text-[13px] font-semibold">{{ routine.name }}</h2>
                <span
                  class="shrink-0 rounded-[5px] border px-1.5 py-0.5 text-[10px] font-medium"
                  :class="routine.enabled ? 'border-accent/30 bg-accent-tint text-accent' : 'border-rule-light bg-chrome-mid text-ink-3'"
                >
                  {{ routine.enabled ? 'Enabled' : routine.paused ? 'Paused' : 'Disabled' }}
                </span>
              </div>
              <p v-if="routine.description" class="mt-1 text-[12px] text-ink-3">
                {{ routine.description }}
              </p>
              <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] text-ink-3">
                <span class="rounded-[5px] bg-chrome-mid px-1.5 py-0.5">{{ triggerLabel(routine) }}</span>
                <span class="rounded-[5px] bg-chrome-mid px-1.5 py-0.5">{{ routineTools(routine) }}</span>
                <span v-if="routine.nextRunAt" class="rounded-[5px] bg-chrome-mid px-1.5 py-0.5">
                  Next {{ new Date(routine.nextRunAt).toLocaleString() }}
                </span>
              </div>
              <p v-if="routine.body" class="mt-3 line-clamp-3 whitespace-pre-wrap text-[12px] leading-5 text-ink-2">
                {{ routine.body }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                data-testid="routine-run-now"
                class="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                :class="store.isRunning(routine.id) ? 'opacity-55' : ''"
                title="Run now"
                :disabled="store.isRunning(routine.id)"
                @click="runNow(routine)"
              >
                <IconPlayerPlay :size="14" :stroke="1.8" />
                <span>{{ store.isRunning(routine.id) ? 'Running' : 'Run' }}</span>
              </button>
              <button
                :data-testid="routine.enabled ? 'routine-pause' : 'routine-resume'"
                class="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink"
                :title="routine.enabled ? 'Pause' : 'Resume'"
                @click="toggleEnabled(routine)"
              >
                <IconPlayerPause v-if="routine.enabled" :size="14" :stroke="1.8" />
                <IconPlayerPlay v-else :size="14" :stroke="1.8" />
                <span>{{ routine.enabled ? 'Pause' : 'Resume' }}</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <div v-else-if="!store.loading" class="px-1 py-2 text-[12px] text-ink-4">
        No routines
      </div>
    </div>
  </main>
</template>
