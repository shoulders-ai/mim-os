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
  removed: [routineId: string]
}>()

const store = useRoutineStore()
const removing = ref(false)
const error = ref('')

watch(() => props.open, open => {
  if (open) error.value = ''
})

async function remove(): Promise<void> {
  if (!props.routine) return
  removing.value = true
  error.value = ''
  try {
    await store.remove(props.routine.id)
    emit('removed', props.routine.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <MimDialog :open="open" title="Move routine to Trash" role="alertdialog" size="sm" @close="emit('close')">
    <div class="p-4 font-sans">
      <p class="text-[12px] leading-5 text-ink">
        Move <strong>{{ routine?.description || routine?.name }}</strong> to the OS Trash?
      </p>
      <p class="mt-2 text-[11px] leading-4 text-ink-3">
        Future automatic runs stop immediately. Existing run transcripts stay in Activity and History.
      </p>
      <div v-if="error" class="mt-3 rounded-[6px] border border-rem/30 bg-rem/10 px-3 py-2 text-[11px] text-rem">{{ error }}</div>
    </div>
    <div class="flex h-12 items-center justify-end gap-1.5 border-t border-rule-light bg-chrome-high px-4 font-sans">
      <button type="button" class="h-7 rounded-[5px] px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid" @click="emit('close')">Cancel</button>
      <button type="button" data-testid="routine-remove-confirm" class="h-7 rounded-[5px] border border-rem/40 bg-surface px-3 text-[11px] font-semibold text-rem hover:bg-rem/10 disabled:opacity-50" :disabled="removing || !routine" @click="remove">
        {{ removing ? 'Moving' : 'Move to Trash' }}
      </button>
    </div>
  </MimDialog>
</template>
