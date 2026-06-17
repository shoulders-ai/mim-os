<script setup lang="ts">
import { ref, nextTick } from 'vue'
import type { Session, SessionStatusKind } from '../../stores/sessions.js'
import WorkingIndicator from '../ui/WorkingIndicator.vue'

const props = defineProps<{
  session: Session
  monogram: string
  active: boolean
  statusKind: SessionStatusKind
  statusTag: string | null
  justFinished: boolean
  dragging?: boolean
  selected?: boolean
}>()

const emit = defineEmits<{
  select: [id: string, event: MouseEvent]
  contextmenu: [event: MouseEvent, session: Session]
  'rename-commit': [session: Session]
  pointerdown: [event: PointerEvent, session: Session]
}>()

// Inline rename
const editing = ref(false)
const editValue = ref('')
const editInputRef = ref<HTMLInputElement | null>(null)

function startRename() {
  editing.value = true
  editValue.value = props.session.label
  nextTick(() => editInputRef.value?.select())
}

function commitRename() {
  if (!editing.value) return
  editing.value = false
  const trimmed = editValue.value.trim()
  if (trimmed && trimmed !== props.session.label) {
    emit('rename-commit', { ...props.session, label: trimmed } as Session)
  }
}

function cancelRename() {
  editing.value = false
}

function relativeTime(value: string): string {
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return 'now'
  const minutes = Math.max(0, Math.floor((Date.now() - t) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function statusClass(): string {
  if (!props.statusTag) return 'text-ink-4'
  if (props.justFinished && props.statusKind !== 'error') return 'text-ink-4 animate-[tag-done-fade_2s_ease-out_forwards]'
  if (props.statusKind === 'needs-approval') return 'text-accent'
  if (props.statusKind === 'error') return 'text-rem'
  if (props.statusKind === 'working') return 'text-ink-4'
  return 'text-ink-4'
}

defineExpose({ startRename })
</script>

<template>
  <button
    class="session-row flex h-8 w-full items-center pl-1 rounded-[7px] text-left text-ink-2 flex-shrink-0 hover:bg-chrome-mid"
    :class="{
      'bg-accent-tint text-ink': active || selected,
      'opacity-35': dragging,
      'bg-accent-soft hover:bg-accent-tint': statusKind === 'needs-approval' && !selected,
      'bg-[rgba(200,60,48,0.04)] hover:bg-[rgba(200,60,48,0.07)]': statusKind === 'error' && !selected,
    }"
    :data-session-id="session.id"
    :data-selected="selected ? 'true' : undefined"
    @pointerdown="emit('pointerdown', $event, session)"
    @click.prevent="emit('select', session.id, $event)"
    @contextmenu.prevent="emit('contextmenu', $event, session)"
    @dblclick="startRename"
  >
    <span
      class="relative grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border font-sans text-[11px] font-semibold leading-none tracking-tight"
      :class="active ? 'border-accent/40 text-accent' : 'border-rule-light bg-chrome-mid text-ink-2'"
    >{{ monogram }}</span>

    <span class="ml-1 flex min-w-0 flex-1 items-center gap-1 pr-2">
      <input
        v-if="editing"
        ref="editInputRef"
        v-model="editValue"
        class="w-full min-w-0 bg-transparent border-0 border-b border-accent p-0 font-sans text-[12.5px] text-ink outline-none"
        autocorrect="off"
        autocapitalize="off"
        @keydown.enter.prevent="commitRename"
        @keydown.escape.prevent="cancelRename"
        @blur="commitRename"
        @click.stop
        @pointerdown.stop
      />
      <span
        v-else
        class="truncate text-[12.5px]"
        :class="statusKind === 'unread' ? 'font-medium text-ink' : ''"
      >{{ session.label }}</span>
      <span
        class="ml-auto flex shrink-0 items-center gap-[5px] text-[10px] font-mono whitespace-nowrap"
        :class="statusClass()"
      >
        <WorkingIndicator v-if="statusKind === 'working'" />
        <template v-else-if="statusTag">{{ statusTag }}</template>
        <template v-else>{{ relativeTime(session.updatedAt || session.createdAt) }}</template>
      </span>
    </span>
  </button>
</template>

<style scoped>
@keyframes tag-done-fade {
  0%, 85% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(3px); }
}
</style>
