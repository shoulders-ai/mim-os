<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoutineStore, type RoutineDefinition } from '../../stores/routines.js'
import MimDialog from '../ui/MimDialog.vue'

const props = defineProps<{
  open: boolean
  routine: RoutineDefinition | null
}>()

const emit = defineEmits<{
  close: []
  duplicated: [routine: RoutineDefinition]
}>()

const store = useRoutineStore()
const name = ref('')
const saving = ref(false)
const error = ref('')

watch(() => [props.open, props.routine] as const, ([open, routine]) => {
  if (!open || !routine) return
  name.value = nextName(routine.id)
  error.value = ''
}, { immediate: true })

async function duplicate(): Promise<void> {
  if (!props.routine) return
  if (!name.value.trim()) {
    error.value = 'Identifier is required.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    const duplicate = await store.duplicate(props.routine.id, name.value.trim())
    if (duplicate) emit('duplicated', duplicate)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

function nextName(id: string): string {
  const existing = new Set(store.routines.map(routine => routine.id))
  if (!existing.has(`${id}-copy`)) return `${id}-copy`
  for (let index = 2; index < 100; index++) {
    if (!existing.has(`${id}-copy-${index}`)) return `${id}-copy-${index}`
  }
  return `${id}-copy-${Date.now()}`
}
</script>

<template>
  <MimDialog :open="open" title="Duplicate routine" size="sm" @close="emit('close')">
    <div class="p-4 font-sans">
      <p class="text-[11px] leading-4 text-ink-3">
        The copy keeps the instructions and access settings. Automatic runs stay off until you review them.
      </p>
      <div v-if="error" class="mt-3 rounded-[6px] border border-rem/30 bg-rem/10 px-3 py-2 text-[11px] text-rem">{{ error }}</div>
      <label class="mt-3 grid gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        New identifier
        <input v-model="name" data-testid="routine-duplicate-name" class="h-8 rounded-[5px] border border-rule-light bg-chrome-high px-2 font-mono text-[11px] normal-case tracking-normal text-ink outline-none hover:bg-chrome-mid focus-visible:border-accent" />
      </label>
    </div>
    <div class="flex h-12 items-center justify-end gap-1.5 border-t border-rule-light bg-chrome-high px-4 font-sans">
      <button type="button" class="h-7 rounded-[5px] px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid" @click="emit('close')">Cancel</button>
      <button type="button" data-testid="routine-duplicate-submit" class="h-7 rounded-[5px] bg-accent px-3 text-[11px] font-semibold text-accent-ink hover:bg-accent/90 disabled:opacity-50" :disabled="saving" @click="duplicate">
        {{ saving ? 'Duplicating' : 'Duplicate' }}
      </button>
    </div>
  </MimDialog>
</template>
