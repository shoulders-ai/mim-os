<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { IconPlus, IconRefresh } from '@tabler/icons-vue'
import { useRoutineStore, type RoutineDefinition } from '../../stores/routines.js'
import { useRunsStore } from '../../stores/runs.js'
import RoutineRow from './RoutineRow.vue'
import RoutineEditorDialog from './RoutineEditorDialog.vue'
import RoutineAuthorityDialog from './RoutineAuthorityDialog.vue'
import RoutineDuplicateDialog from './RoutineDuplicateDialog.vue'
import RoutineRemoveDialog from './RoutineRemoveDialog.vue'
import { routineHealth, sortRoutinesForAttention } from './routinePresentation.js'

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
const runsStore = useRunsStore()
const editorOpen = ref(false)
const editingRoutine = ref<RoutineDefinition | null>(null)
const authorityRoutine = ref<RoutineDefinition | null>(null)
const duplicateRoutine = ref<RoutineDefinition | null>(null)
const removeRoutine = ref<RoutineDefinition | null>(null)

const sortedRoutines = computed(() => sortRoutinesForAttention(store.routines))
const activeCount = computed(() => store.routines.filter(routine => routine.activation === 'active').length)
const attentionCount = computed(() => store.routines.filter(routine =>
  routine.activation === 'review-required' || routineHealth(routine) === 'failed',
).length)

const onRoutinesChanged = () => {
  if (props.active) void store.load()
}

onMounted(() => {
  window.kernel.on('routines:changed', onRoutinesChanged)
  if (props.active) void store.load()
})

onBeforeUnmount(() => {
  window.kernel.off('routines:changed', onRoutinesChanged)
})

watch(() => props.active, active => {
  if (active) void store.load()
})

function createRoutine(): void {
  editingRoutine.value = null
  editorOpen.value = true
}

function editRoutine(routine: RoutineDefinition): void {
  editingRoutine.value = routine
  editorOpen.value = true
}

function closeEditor(): void {
  editorOpen.value = false
  editingRoutine.value = null
}

function onSaved(routine: RoutineDefinition): void {
  closeEditor()
  if (routine.activation === 'review-required') authorityRoutine.value = routine
}

async function runNow(routine: RoutineDefinition): Promise<void> {
  const result = await store.runNow(routine.id)
  if (result.sessionId) emit('openSession', result.sessionId)
}

async function disable(routine: RoutineDefinition): Promise<void> {
  await store.disable(routine.id)
}

function lastRun(routine: RoutineDefinition) {
  if (!routine.lastRunId) return null
  return runsStore.chatRuns.find(run => run.id === `routine:${routine.lastRunId}`) ?? null
}

function openLastRun(routine: RoutineDefinition): void {
  const run = lastRun(routine)
  if (run) emit('openSession', run.sourceId)
}

function openDefinition(path: string): void {
  closeEditor()
  emit('openFile', path)
}

function closeAuthority(): void {
  authorityRoutine.value = null
}

function closeDuplicate(): void {
  duplicateRoutine.value = null
}

function closeRemove(): void {
  removeRoutine.value = null
}
</script>

<template>
  <main class="flex h-full min-h-0 flex-col bg-surface font-sans text-ink">
    <header class="flex h-11 shrink-0 items-center justify-between border-b border-rule-light bg-chrome-high px-4">
      <div class="flex min-w-0 items-baseline gap-3">
        <h1 class="truncate text-[13px] font-semibold">Routines</h1>
        <span v-if="store.routines.length" class="truncate text-[10px] text-ink-4">
          {{ activeCount }} active<span v-if="attentionCount"> · {{ attentionCount }} need attention</span>
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-[11px] font-semibold text-ink-2 hover:bg-chrome-mid hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          title="New routine"
          data-testid="routine-new"
          @click="createRoutine"
        >
          <IconPlus :size="14" :stroke="1.8" />
          New routine
        </button>
        <button
          type="button"
          class="inline-flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
          title="Refresh routines"
          aria-label="Refresh routines"
          :disabled="store.loading"
          @click="store.load"
        >
          <IconRefresh :size="14" :stroke="1.8" />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div v-if="store.error" class="m-3 rounded-[6px] border border-rem/30 bg-rem/10 px-3 py-2 text-[11px] text-rem">
        {{ store.error }}
      </div>

      <section v-if="store.diagnostics.length" class="m-3 rounded-[6px] border border-warn/30 bg-warn/10 p-2">
        <h2 class="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">Needs attention</h2>
        <button
          v-for="diagnostic in store.diagnostics"
          :key="`${diagnostic.path}:${diagnostic.message}`"
          type="button"
          class="block w-full rounded-[5px] px-2 py-1.5 text-left text-[11px] text-ink-2 hover:bg-chrome-high"
          title="Open routine definition"
          @click="emit('openFile', diagnostic.path)"
        >
          <span class="font-mono text-[10px] text-ink-3">{{ diagnostic.path }}</span>
          <span class="ml-2">{{ diagnostic.message }}</span>
        </button>
      </section>

      <div v-if="sortedRoutines.length" class="border-t border-rule-light">
        <RoutineRow
          v-for="routine in sortedRoutines"
          :key="routine.id"
          :routine="routine"
          :running="store.isRunning(routine.id)"
          :has-last-run="Boolean(lastRun(routine))"
          @run="runNow(routine)"
          @edit="editRoutine(routine)"
          @review="authorityRoutine = routine"
          @disable="disable(routine)"
          @open-file="emit('openFile', routine.path)"
          @open-last-run="openLastRun(routine)"
          @duplicate="duplicateRoutine = routine"
          @remove="removeRoutine = routine"
        />
      </div>

      <section
        v-else-if="store.loaded && !store.loading"
        class="mx-auto flex min-h-[320px] max-w-[460px] flex-col items-center justify-center px-8 py-12 text-center"
      >
        <div class="flex h-11 w-11 items-center justify-center rounded-full border border-rule-light bg-chrome-high text-accent">
          <IconRefresh :size="20" :stroke="1.6" />
        </div>
        <h2 class="mt-4 text-[15px] font-semibold text-ink">Create your first routine</h2>
        <p class="mt-2 max-w-[360px] text-[11px] leading-5 text-ink-3">
          Save an instruction once, then run it manually, on a schedule, or when something changes.
        </p>
        <button
          type="button"
          data-testid="routine-empty-create"
          class="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[5px] bg-accent px-3 text-[11px] font-semibold text-accent-ink hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          @click="createRoutine"
        >
          <IconPlus :size="14" :stroke="1.8" />
          New routine
        </button>
      </section>

      <div v-else-if="store.loading" class="px-4 py-3 text-[11px] text-ink-4">Loading routines…</div>
    </div>

    <RoutineEditorDialog
      :open="editorOpen"
      :routine="editingRoutine"
      @close="closeEditor"
      @saved="onSaved"
      @open-file="openDefinition"
    />
    <RoutineAuthorityDialog
      :open="Boolean(authorityRoutine)"
      :routine="authorityRoutine"
      @close="closeAuthority"
      @enabled="closeAuthority"
    />
    <RoutineDuplicateDialog
      :open="Boolean(duplicateRoutine)"
      :routine="duplicateRoutine"
      @close="closeDuplicate"
      @duplicated="closeDuplicate"
    />
    <RoutineRemoveDialog
      :open="Boolean(removeRoutine)"
      :routine="removeRoutine"
      @close="closeRemove"
      @removed="closeRemove"
    />
  </main>
</template>
