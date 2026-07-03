<script setup lang="ts">
// Expanded-tray row for a run (package run or agent session): monogram chip,
// inline rename, status line. Mirrors SessionRow; rename persists through the
// runs store, dispatched by run kind.
import { computed, ref, nextTick } from 'vue'
import { IconBell, IconBellRinging } from '@tabler/icons-vue'
import { useRunsStore, type NavigatorRun } from '../../stores/runs.js'
import { usePingsStore } from '../../stores/pings.js'
import { initialsFrom, pingOutcomeClass, pingOutcomeLabel, runStatusTag } from './sidebarStatus.js'
import WorkingIndicator from '../ui/WorkingIndicator.vue'

const props = defineProps<{
  run: NavigatorRun
  active: boolean
  dragging?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{
  select: [run: NavigatorRun, event: MouseEvent]
  contextmenu: [event: MouseEvent, run: NavigatorRun]
  pointerdown: [event: PointerEvent]
}>()

const runsStore = useRunsStore()

// "Ping when done" — armed shows a quiet bell; a fired ping shows a prominent
// outcome tag until the row is opened (ShellSidebar clears it on select).
const pingsStore = usePingsStore()
const pingArmed = computed(() => pingsStore.isArmed(props.run.id))
const pingSettled = computed(() => pingsStore.settledOutcome(props.run.id))

// Inline rename
const editing = ref(false)
const editValue = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)
const committing = ref(false)

async function startRename() {
  if (props.run.kind !== 'package-job' && props.run.kind !== 'agent-session') return
  editing.value = true
  editValue.value = props.run.title
  await nextTick()
  editInputRef.value?.focus()
  editInputRef.value?.select()
}

async function commitRename() {
  if (!editing.value || committing.value) return
  const label = editValue.value.trim()
  if (!label || label === props.run.title.trim()) {
    cancelRename()
    return
  }

  committing.value = true
  const renamed = props.run.kind === 'agent-session'
    ? await runsStore.renameAgentSession(props.run.sourceId, label)
    : await runsStore.renamePackageRun(props.run.sourceId, label)
  committing.value = false
  if (renamed) {
    editing.value = false
    editValue.value = ''
  } else {
    // Keep the edit open so the label is not silently lost.
    await nextTick()
    editInputRef.value?.focus()
  }
}

function cancelRename() {
  editing.value = false
  editValue.value = ''
}

function relativeTime(value?: string): string {
  if (!value) return 'now'
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return 'now'
  const minutes = Math.max(0, Math.floor((Date.now() - t) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

defineExpose({ startRename })
</script>

<template>
  <button
    class="group/navrow flex h-8 w-full items-center pl-1 rounded-[7px] text-left text-ink-2 hover:bg-chrome-mid hover:text-ink"
    :class="[
      active || selected ? 'bg-accent-tint text-ink' : '',
      dragging ? 'opacity-35' : '',
    ]"
    :data-run-id="run.id"
    :data-selected="selected ? 'true' : undefined"
    @pointerdown="emit('pointerdown', $event)"
    @click="emit('select', run, $event)"
    @contextmenu.prevent="emit('contextmenu', $event, run)"
    @dblclick.stop="startRename"
  >
    <!-- Same h-7 (1.75rem) chip box as SessionRow / the nav-token / the
         collapsed rail — one height across tray and rail. -->
    <span
      class="relative grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border font-sans text-[11px] font-semibold leading-none tracking-tight"
      :class="active ? 'border-accent/40 text-accent' : 'border-rule-light bg-chrome-mid text-ink-2'"
    >
      {{ initialsFrom(run.title) }}
    </span>
    <span class="ml-1 flex min-w-0 flex-1 items-center gap-1 pr-2">
      <input
        v-if="editing"
        ref="editInputRef"
        v-model="editValue"
        data-testid="run-rename-input"
        class="w-full min-w-0 bg-transparent border-0 border-b border-accent p-0 font-sans text-[12.5px] font-medium text-ink outline-none"
        autocorrect="off"
        autocapitalize="off"
        @keydown.enter.prevent="commitRename"
        @keydown.escape.prevent="cancelRename"
        @blur="commitRename"
        @click.stop
        @pointerdown.stop
      />
      <span v-else class="truncate font-sans text-[12.5px] font-medium">{{ run.title }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-[5px] font-mono text-[10px] text-ink-4">
        <span
          v-if="pingArmed"
          data-testid="ping-indicator"
          class="grid shrink-0 place-items-center"
          :class="pingSettled ? pingOutcomeClass(pingSettled) : 'text-ink-4'"
          :title="pingSettled ? 'Pinged' : 'Will ping when done'"
        >
          <component :is="pingSettled ? IconBellRinging : IconBell" :size="11" :stroke="1.8" />
        </span>
        <WorkingIndicator v-if="run.status === 'working'" />
        <span
          v-else-if="pingSettled"
          data-testid="ping-outcome"
          class="font-medium"
          :class="pingOutcomeClass(pingSettled)"
        >{{ pingOutcomeLabel(pingSettled) }}</span>
        <template v-else-if="runStatusTag(run.status)">{{ runStatusTag(run.status) }}</template>
        <template v-else>{{ relativeTime(run.updatedAt) }}</template>
      </span>
    </span>
  </button>
</template>
