<script setup lang="ts">
import { ref, watch } from 'vue'
import { IconLockCheck } from '@tabler/icons-vue'
import { useRoutineStore, type RoutineDefinition } from '../../stores/routines.js'
import MimDialog from '../ui/MimDialog.vue'
import { routineAccessSummary, routineTriggerLabel } from './routinePresentation.js'

const props = defineProps<{
  open: boolean
  routine: RoutineDefinition | null
}>()

const emit = defineEmits<{
  close: []
  enabled: [routineId: string]
}>()

const store = useRoutineStore()
const enabling = ref(false)
const error = ref('')

watch(() => props.open, open => {
  if (open) error.value = ''
})

async function enable(): Promise<void> {
  if (!props.routine) return
  enabling.value = true
  error.value = ''
  try {
    await store.enable(props.routine.id)
    emit('enabled', props.routine.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    enabling.value = false
  }
}
</script>

<template>
  <MimDialog :open="open" title="Review automatic runs" size="md" @close="emit('close')">
    <div v-if="routine" class="p-4 font-sans">
      <div class="flex items-start gap-3">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-accent/30 bg-accent-tint text-accent">
          <IconLockCheck :size="16" :stroke="1.8" />
        </div>
        <div class="min-w-0">
          <h3 class="text-[13px] font-semibold text-ink">{{ routine.description || routine.name }}</h3>
          <p class="mt-1 text-[11px] leading-4 text-ink-3">
            This approval applies to automatic runs on this device. Manual runs remain available when automatic runs are off.
          </p>
        </div>
      </div>

      <div v-if="error" class="mt-3 rounded-[6px] border border-rem/30 bg-rem/10 px-3 py-2 text-[11px] text-rem">
        {{ error }}
      </div>

      <dl class="mt-4 divide-y divide-rule-light rounded-[6px] border border-rule-light bg-chrome-high text-[11px]">
        <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5">
          <dt class="font-medium text-ink-3">Runs when</dt>
          <dd class="text-ink">{{ routineTriggerLabel(routine) }}</dd>
        </div>
        <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5">
          <dt class="font-medium text-ink-3">Owner</dt>
          <dd class="text-ink">{{ routine.owner || 'This device' }}</dd>
        </div>
        <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5">
          <dt class="font-medium text-ink-3">Agent</dt>
          <dd class="break-all text-ink">{{ routine.agent || 'Default agent' }}</dd>
        </div>
        <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5">
          <dt class="font-medium text-ink-3">Model</dt>
          <dd class="break-all text-ink">{{ routine.model || 'Agent default' }}</dd>
        </div>
        <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5">
          <dt class="font-medium text-ink-3">Access</dt>
          <dd class="text-ink">{{ routineAccessSummary(routine) }}</dd>
        </div>
        <div class="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5">
          <dt class="font-medium text-ink-3">Without asking</dt>
          <dd class="break-words font-mono text-[10px] text-ink">
            {{ routine.approvalAllow.length ? routine.approvalAllow.join(', ') : 'No consequential actions' }}
          </dd>
        </div>
      </dl>
    </div>

    <div class="flex h-12 items-center justify-end gap-1.5 border-t border-rule-light bg-chrome-high px-4 font-sans">
      <button type="button" class="h-7 rounded-[5px] px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid" @click="emit('close')">
        Cancel
      </button>
      <button
        type="button"
        data-testid="routine-authority-enable"
        class="h-7 rounded-[5px] bg-accent px-3 text-[11px] font-semibold text-accent-ink hover:bg-accent/90 disabled:opacity-50"
        :disabled="enabling || !routine"
        @click="enable"
      >
        {{ enabling ? 'Enabling' : 'Enable automatic runs' }}
      </button>
    </div>
  </MimDialog>
</template>
