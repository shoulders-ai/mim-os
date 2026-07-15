<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IconChevronDown, IconChevronRight, IconFileText, IconPlus, IconTrash } from '@tabler/icons-vue'
import { useRoutineStore, type RoutineDefinition } from '../../stores/routines.js'
import { useSettingsStore } from '../../stores/settings.js'
import { useAppAgentsStore } from '../../stores/appAgents.js'
import { modelMenuItems, resolvePreferredModel } from '../../services/ai/modelControls.js'
import ModelPicker from '../chat/ModelPicker.vue'
import MimDialog from '../ui/MimDialog.vue'
import MimSelect from '../ui/MimSelect.vue'

type TriggerKind = 'manual' | 'daily' | 'weekly' | 'interval' | 'files' | 'webhook' | 'slack' | 'schedule'
type SlackChannelDraft = { id: string; mode: 'mention' | 'always' }

const DEFAULT_MODEL_ID = '__routine-workspace-default__'

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
  open: boolean
  routine?: RoutineDefinition | null
}>(), {
  routine: null,
})

const emit = defineEmits<{
  close: []
  saved: [routine: RoutineDefinition]
  openFile: [path: string]
}>()

const store = useRoutineStore()
const settingsStore = useSettingsStore()
const appAgentsStore = useAppAgentsStore()
const saving = ref(false)
const error = ref('')
const registry = ref<ModelRegistry | null>(null)
const advancedOpen = ref(false)
const name = ref('')
const description = ref('')
const body = ref('')
const modelId = ref('')
const agentId = ref('')
const triggerKind = ref<TriggerKind>('manual')
const scheduleTime = ref('09:00')
const weeklyDay = ref('1')
const customSchedule = ref('0 9 * * *')
const intervalValue = ref('4')
const intervalUnit = ref<'m' | 'h' | 'd'>('h')
const filePath = ref('inbox/')
const fileEvents = ref<Array<'add' | 'change' | 'unlink'>>(['add', 'change'])
const webhookSecret = ref('intake')
const slackAccount = ref('default')
const slackChannels = ref<SlackChannelDraft[]>([{ id: '', mode: 'mention' }])
const toolsText = ref('')
const approvalText = ref('')
const steps = ref('')
const missed = ref<'skip' | 'once'>('skip')

const isEdit = computed(() => Boolean(props.routine))
const selectableModels = computed(() => [
  {
    id: DEFAULT_MODEL_ID,
    displayName: 'Workspace default',
    shortLabel: 'Default',
    capabilities: { streaming: true, tools: true },
  },
  ...modelMenuItems(registry.value, settingsStore.keyStatuses),
])
const agentOptions = computed(() => [
  { value: '', label: 'Default agent' },
  ...appAgentsStore.agents.map(agent => ({ value: agent.id, label: agent.name })),
])
const missedOptions = [
  { value: 'skip', label: 'Skip missed runs' },
  { value: 'once', label: 'Run once when available' },
]
const modes: Array<{ kind: TriggerKind; label: string }> = [
  { kind: 'manual', label: 'Manual' },
  { kind: 'daily', label: 'Daily' },
  { kind: 'weekly', label: 'Weekly' },
  { kind: 'interval', label: 'Interval' },
  { kind: 'files', label: 'File changes' },
  { kind: 'webhook', label: 'External request' },
  { kind: 'slack', label: 'Slack' },
  { kind: 'schedule', label: 'Custom' },
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

watch(() => [props.open, props.routine] as const, ([open]) => {
  if (!open) return
  resetDraft()
  void loadOptions()
}, { immediate: true })

function resetDraft(): void {
  const routine = props.routine
  error.value = ''
  advancedOpen.value = Boolean(routine?.agent || routine?.tools.length || routine?.approvalAllow.length || routine?.steps || routine?.missed)
  name.value = routine?.name ?? nextRoutineName()
  description.value = routine?.description ?? ''
  body.value = routine?.body ?? 'Review the workspace and summarize the current state.'
  modelId.value = routine?.model ?? (routine ? DEFAULT_MODEL_ID : '')
  agentId.value = routine?.agent ?? ''
  toolsText.value = routine?.tools.join(', ') ?? ''
  approvalText.value = routine?.approvalAllow.join(', ') ?? ''
  steps.value = routine?.steps ? String(routine.steps) : ''
  missed.value = routine?.missed ?? 'skip'
  resetTrigger(routine)
}

function resetTrigger(routine: RoutineDefinition | null | undefined): void {
  triggerKind.value = 'manual'
  scheduleTime.value = '09:00'
  weeklyDay.value = '1'
  customSchedule.value = '0 9 * * *'
  intervalValue.value = '4'
  intervalUnit.value = 'h'
  filePath.value = 'inbox/'
  fileEvents.value = ['add', 'change']
  webhookSecret.value = routine?.name ?? 'intake'
  slackAccount.value = 'default'
  slackChannels.value = [{ id: '', mode: 'mention' }]
  const trigger = routine?.trigger
  if (!trigger) return
  if (typeof trigger.every === 'string') {
    triggerKind.value = 'interval'
    const match = /^(\d+)([mhd])$/.exec(trigger.every)
    if (match) {
      intervalValue.value = match[1]
      intervalUnit.value = match[2] as 'm' | 'h' | 'd'
    }
    return
  }
  if (typeof trigger.schedule === 'string') {
    const parts = trigger.schedule.trim().split(/\s+/)
    if (parts.length === 5 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      scheduleTime.value = `${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}`
      if (parts[2] === '*' && parts[3] === '*' && parts[4] === '*') triggerKind.value = 'daily'
      else if (parts[2] === '*' && parts[3] === '*' && /^\d$/.test(parts[4])) {
        triggerKind.value = 'weekly'
        weeklyDay.value = String(Number(parts[4]) % 7)
      } else {
        triggerKind.value = 'schedule'
        customSchedule.value = trigger.schedule
      }
    } else {
      triggerKind.value = 'schedule'
      customSchedule.value = trigger.schedule
    }
    return
  }
  if (isPlainObject(trigger.files)) {
    triggerKind.value = 'files'
    filePath.value = typeof trigger.files.path === 'string' ? trigger.files.path : 'inbox/'
    fileEvents.value = Array.isArray(trigger.files.events)
      ? trigger.files.events.filter(isFileEvent)
      : ['add', 'change']
    return
  }
  if (isPlainObject(trigger.webhook)) {
    triggerKind.value = 'webhook'
    webhookSecret.value = typeof trigger.webhook.secret === 'string' ? trigger.webhook.secret : routine?.name ?? 'intake'
    return
  }
  if (isPlainObject(trigger.slack)) {
    triggerKind.value = 'slack'
    slackAccount.value = typeof trigger.slack.account === 'string' ? trigger.slack.account : 'default'
    const channels = Array.isArray(trigger.slack.channels)
      ? trigger.slack.channels.flatMap(channel => {
          if (!isPlainObject(channel) || typeof channel.id !== 'string') return []
          return [{ id: channel.id, mode: channel.mode === 'always' ? 'always' : 'mention' } satisfies SlackChannelDraft]
        })
      : []
    slackChannels.value = channels.length ? channels : [{ id: '', mode: 'mention' }]
  }
}

async function loadOptions(): Promise<void> {
  try {
    const [models] = await Promise.all([
      window.kernel.call('ai.registry') as Promise<ModelRegistry>,
      settingsStore.refreshKeyStatuses(),
      appAgentsStore.refresh(),
    ])
    registry.value = models
    ensureModel()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function ensureModel(): void {
  if (modelId.value && selectableModels.value.some(model => model.id === modelId.value)) return
  if (isEdit.value) {
    modelId.value = DEFAULT_MODEL_ID
    return
  }
  const preferred = resolvePreferredModel(registry.value, settingsStore.keyStatuses, settingsStore.lastChatModel, 'chat')
  modelId.value = preferred?.id ?? selectableModels.value[0]?.id ?? modelId.value
}

function nextRoutineName(): string {
  const ids = new Set(store.routines.map(routine => routine.id))
  if (!ids.has('new-routine')) return 'new-routine'
  for (let index = 2; index < 100; index++) {
    if (!ids.has(`new-routine-${index}`)) return `new-routine-${index}`
  }
  return `new-routine-${Date.now()}`
}

function buildTrigger(): Record<string, unknown> | undefined {
  if (triggerKind.value === 'manual') return undefined
  if (triggerKind.value === 'daily') return { schedule: `${minuteField()} ${hourField()} * * *` }
  if (triggerKind.value === 'weekly') return { schedule: `${minuteField()} ${hourField()} * * ${weeklyDay.value}` }
  if (triggerKind.value === 'schedule') return { schedule: customSchedule.value.trim() }
  if (triggerKind.value === 'interval') return { every: `${positiveInteger(intervalValue.value, 1)}${intervalUnit.value}` }
  if (triggerKind.value === 'files') {
    return { files: { path: filePath.value.trim() || 'inbox/', events: fileEvents.value } }
  }
  if (triggerKind.value === 'webhook') return { webhook: { secret: webhookSecret.value.trim() || name.value } }
  return {
    slack: {
      account: slackAccount.value.trim() || 'default',
      channels: slackChannels.value.map(channel => ({ id: channel.id.trim(), mode: channel.mode })),
    },
  }
}

async function save(): Promise<void> {
  error.value = ''
  if (!name.value.trim()) return setError('Identifier is required.')
  if (!body.value.trim()) return setError('Instructions are required.')
  if (triggerKind.value === 'slack' && slackChannels.value.some(channel => !channel.id.trim())) {
    return setError('Every Slack channel needs an ID.')
  }
  if (triggerKind.value === 'files' && !fileEvents.value.length) return setError('Choose at least one file event.')

  const input = {
    name: name.value.trim(),
    ...(description.value.trim() ? { description: description.value.trim() } : {}),
    ...(buildTrigger() ? { trigger: buildTrigger() } : {}),
    ...(agentId.value ? { agent: agentId.value } : {}),
    ...(modelId.value && modelId.value !== DEFAULT_MODEL_ID ? { model: modelId.value } : {}),
    ...(parseList(toolsText.value).length ? { tools: parseList(toolsText.value) } : {}),
    ...(parseList(approvalText.value).length ? { approvalAllow: parseList(approvalText.value) } : {}),
    ...(steps.value.trim() ? { steps: positiveInteger(steps.value, 1) } : {}),
    ...(missed.value !== 'skip' ? { missed: missed.value } : {}),
    body: body.value.trim(),
  }
  saving.value = true
  try {
    const saved = props.routine
      ? await store.update({ ...input, expectedRevision: props.routine.revision })
      : await store.create(input)
    if (saved) emit('saved', saved)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

function toggleFileEvent(event: 'add' | 'change' | 'unlink'): void {
  fileEvents.value = fileEvents.value.includes(event)
    ? fileEvents.value.filter(item => item !== event)
    : [...fileEvents.value, event]
}

function onModelChange(value: string): void {
  modelId.value = value
  if (value !== DEFAULT_MODEL_ID) settingsStore.set('lastChatModel', value)
}

function addSlackChannel(): void {
  slackChannels.value = [...slackChannels.value, { id: '', mode: 'mention' }]
}

function removeSlackChannel(index: number): void {
  if (slackChannels.value.length === 1) return
  slackChannels.value = slackChannels.value.filter((_, itemIndex) => itemIndex !== index)
}

function minuteField(): number {
  return Math.max(0, Math.min(59, Number(scheduleTime.value.split(':')[1] ?? 0)))
}

function hourField(): number {
  return Math.max(0, Math.min(23, Number(scheduleTime.value.split(':')[0] ?? 9)))
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseList(value: string): string[] {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
}

function setError(message: string): void {
  error.value = message
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFileEvent(value: unknown): value is 'add' | 'change' | 'unlink' {
  return value === 'add' || value === 'change' || value === 'unlink'
}
</script>

<template>
  <MimDialog
    :open="open"
    :title="isEdit ? 'Edit routine' : 'New routine'"
    size="lg"
    height="fixed"
    align="top"
    top-class="pt-[6vh]"
    @close="emit('close')"
  >
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 font-sans">
      <div v-if="error" class="mb-3 rounded-[6px] border border-rem/30 bg-rem/10 px-3 py-2 text-[11px] text-rem">
        {{ error }}
      </div>

      <section class="grid gap-3">
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <label class="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            Identifier
            <input
              v-model="name"
              data-testid="routine-editor-name"
              :disabled="isEdit"
              class="h-8 rounded-[5px] border border-rule-light bg-chrome-high px-2 font-mono text-[11px] normal-case tracking-normal text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent disabled:opacity-60"
              autocapitalize="off"
              autocorrect="off"
            />
          </label>
          <div class="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            Model
            <div class="flex h-8 items-center rounded-[5px] border border-rule-light bg-chrome-high px-1 hover:bg-chrome-mid">
              <ModelPicker
                :model-id="modelId"
                :models="selectableModels"
                placement="below"
                @update:model-id="onModelChange"
              />
            </div>
          </div>
        </div>

        <label class="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Description
          <input
            v-model="description"
            class="h-8 rounded-[5px] border border-rule-light bg-chrome-high px-2 text-[11px] normal-case tracking-normal text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent"
            placeholder="What this routine does"
          />
        </label>
      </section>

      <section class="mt-5 border-t border-rule-light pt-4">
        <h3 class="text-[11px] font-semibold text-ink">Runs when</h3>
        <div class="mt-2 grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <button
            v-for="mode in modes"
            :key="mode.kind"
            type="button"
            class="h-8 rounded-[5px] border px-2 text-left text-[11px] font-medium hover:bg-chrome-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            :class="triggerKind === mode.kind ? 'border-accent/40 bg-accent-tint text-accent' : 'border-rule-light bg-surface text-ink-2'"
            :data-testid="`routine-editor-trigger-${mode.kind}`"
            @click="triggerKind = mode.kind"
          >
            {{ mode.label }}
          </button>
        </div>

        <div v-if="triggerKind === 'daily' || triggerKind === 'weekly'" class="mt-3 grid gap-3 rounded-[6px] border border-rule-light bg-chrome-high p-3 md:grid-cols-2">
          <label class="grid gap-1 text-[10px] font-medium text-ink-3">
            Time
            <input v-model="scheduleTime" type="time" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 text-[11px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
          </label>
          <div v-if="triggerKind === 'weekly'" class="grid gap-1 text-[10px] font-medium text-ink-3">
            Day
            <div class="flex flex-wrap gap-1">
              <button
                v-for="day in weekdays"
                :key="day.value"
                type="button"
                class="h-8 rounded-[5px] px-2 text-[10px] font-semibold hover:bg-chrome-mid"
                :class="weeklyDay === day.value ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-3'"
                @click="weeklyDay = day.value"
              >
                {{ day.label }}
              </button>
            </div>
          </div>
        </div>

        <label v-else-if="triggerKind === 'schedule'" class="mt-3 grid gap-1 rounded-[6px] border border-rule-light bg-chrome-high p-3 text-[10px] font-medium text-ink-3">
          Custom schedule
          <input v-model="customSchedule" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[11px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
        </label>

        <div v-else-if="triggerKind === 'interval'" class="mt-3 flex items-end gap-2 rounded-[6px] border border-rule-light bg-chrome-high p-3">
          <label class="grid gap-1 text-[10px] font-medium text-ink-3">
            Every
            <input v-model="intervalValue" type="number" min="1" class="h-8 w-20 rounded-[5px] border border-rule-light bg-surface px-2 text-[11px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
          </label>
          <div class="flex gap-1">
            <button v-for="unit in ['m', 'h', 'd'] as const" :key="unit" type="button" class="h-8 rounded-[5px] px-2 text-[10px] font-semibold hover:bg-chrome-mid" :class="intervalUnit === unit ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-3'" @click="intervalUnit = unit">
              {{ unit === 'm' ? 'Minutes' : unit === 'h' ? 'Hours' : 'Days' }}
            </button>
          </div>
        </div>

        <div v-else-if="triggerKind === 'files'" class="mt-3 grid gap-3 rounded-[6px] border border-rule-light bg-chrome-high p-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label class="grid gap-1 text-[10px] font-medium text-ink-3">
            Workspace path
            <input v-model="filePath" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[11px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
          </label>
          <div class="grid gap-1 text-[10px] font-medium text-ink-3">
            Events
            <div class="flex gap-1">
              <button v-for="event in ['add', 'change', 'unlink'] as const" :key="event" type="button" class="h-8 rounded-[5px] px-2 text-[10px] font-semibold hover:bg-chrome-mid" :class="fileEvents.includes(event) ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-3'" @click="toggleFileEvent(event)">
                {{ event === 'unlink' ? 'Removed' : event === 'add' ? 'Added' : 'Changed' }}
              </button>
            </div>
          </div>
        </div>

        <label v-else-if="triggerKind === 'webhook'" class="mt-3 grid gap-1 rounded-[6px] border border-rule-light bg-chrome-high p-3 text-[10px] font-medium text-ink-3">
          Connection name
          <input v-model="webhookSecret" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[11px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
        </label>

        <div v-else-if="triggerKind === 'slack'" class="mt-3 grid gap-3 rounded-[6px] border border-rule-light bg-chrome-high p-3">
          <label class="grid gap-1 text-[10px] font-medium text-ink-3">
            Account
            <input v-model="slackAccount" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[11px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
          </label>
          <div class="grid gap-1.5">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-medium text-ink-3">Channels</span>
              <button type="button" class="inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-[10px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink" @click="addSlackChannel">
                <IconPlus :size="12" :stroke="1.8" />
                Add channel
              </button>
            </div>
            <div v-for="(channel, index) in slackChannels" :key="index" class="grid grid-cols-[minmax(0,1fr)_160px_28px] items-end gap-2">
              <label class="grid gap-1 text-[10px] font-medium text-ink-3">
                Channel ID
                <input v-model="channel.id" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[11px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
              </label>
              <div class="grid gap-1 text-[10px] font-medium text-ink-3">
                Responds to
                <MimSelect v-model="channel.mode" :options="[{ value: 'mention', label: 'Mentions' }, { value: 'always', label: 'Every message' }]" tone="surface" />
              </div>
              <button type="button" class="flex h-8 w-7 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-rem disabled:opacity-40" :disabled="slackChannels.length === 1" title="Remove channel" aria-label="Remove Slack channel" @click="removeSlackChannel(index)">
                <IconTrash :size="13" :stroke="1.8" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="mt-5 border-t border-rule-light pt-4">
        <label class="grid gap-1 text-[11px] font-semibold text-ink">
          Instructions
          <textarea
            v-model="body"
            data-testid="routine-editor-body"
            class="min-h-[132px] resize-y rounded-[6px] border border-rule-light bg-surface px-3 py-2 font-serif text-[12px] leading-5 text-ink outline-none hover:bg-chrome-high focus-visible:border-accent"
          />
        </label>
      </section>

      <section class="mt-5 border-t border-rule-light pt-3">
        <button type="button" class="flex h-8 w-full items-center gap-1 rounded-[5px] px-1 text-left text-[11px] font-semibold text-ink-2 hover:bg-chrome-mid" @click="advancedOpen = !advancedOpen">
          <IconChevronDown v-if="advancedOpen" :size="14" :stroke="1.8" />
          <IconChevronRight v-else :size="14" :stroke="1.8" />
          Automatic access
          <span class="font-normal text-ink-4">Agent, tools, permissions, and run limits</span>
        </button>
        <div v-if="advancedOpen" class="mt-2 grid gap-3 rounded-[6px] border border-rule-light bg-chrome-high p-3">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="grid gap-1 text-[10px] font-medium text-ink-3">
              Agent
              <MimSelect v-model="agentId" :options="agentOptions" tone="surface" aria-label="Routine agent" />
            </div>
            <label class="grid gap-1 text-[10px] font-medium text-ink-3">
              Maximum steps
              <input v-model="steps" type="number" min="1" class="h-7 rounded-[5px] border border-rule-light bg-surface px-2 text-[11px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" placeholder="Use agent default" />
            </label>
          </div>
          <label class="grid gap-1 text-[10px] font-medium text-ink-3">
            Available tools
            <input v-model="toolsText" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[10px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" placeholder="Default access, or comma-separated tool IDs" />
          </label>
          <label class="grid gap-1 text-[10px] font-medium text-ink-3">
            Allowed without asking
            <input v-model="approvalText" class="h-8 rounded-[5px] border border-rule-light bg-surface px-2 font-mono text-[10px] text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" placeholder="Comma-separated subset of available tools" />
          </label>
          <div class="grid gap-1 text-[10px] font-medium text-ink-3">
            If Mim was not running at the scheduled time
            <MimSelect v-model="missed" :options="missedOptions" tone="surface" aria-label="Missed routine behavior" />
          </div>
        </div>
      </section>
    </div>

    <div class="flex h-12 shrink-0 items-center justify-between border-t border-rule-light bg-chrome-high px-4 font-sans">
      <button
        v-if="routine"
        type="button"
        class="inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[10px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink"
        title="Open the routine definition file"
        @click="emit('openFile', routine.path)"
      >
        <IconFileText :size="13" :stroke="1.8" />
        Open definition file
      </button>
      <span v-else />
      <div class="flex items-center gap-1.5">
        <button type="button" class="h-7 rounded-[5px] px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid" @click="emit('close')">
          Cancel
        </button>
        <button
          type="button"
          data-testid="routine-editor-save"
          class="h-7 rounded-[5px] bg-accent px-3 text-[11px] font-semibold text-accent-ink hover:bg-accent/90 disabled:opacity-50"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? 'Saving' : isEdit ? 'Save changes' : 'Create routine' }}
        </button>
      </div>
    </div>
  </MimDialog>
</template>
