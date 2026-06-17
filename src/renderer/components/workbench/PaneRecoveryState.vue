<script setup lang="ts">
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconRefresh,
  IconTrash,
  IconX,
} from '@tabler/icons-vue'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  pane: 'work' | 'artifact'
  error: unknown
  title?: string
  canBack?: boolean
  canRemove?: boolean
}>(), {
  title: '',
  canBack: false,
  canRemove: false,
})

defineEmits<{
  retry: []
  back: []
  remove: []
  dismiss: []
}>()

const heading = computed(() =>
  props.title || (props.pane === 'artifact' ? 'Artifact failed to open' : 'Work failed to open')
)

const message = computed(() => {
  if (props.error instanceof Error) return props.error.message
  if (typeof props.error === 'string') return props.error
  if (isRecord(props.error) && typeof props.error.message === 'string') return props.error.message
  return 'The selected entry could not be restored.'
})

const detail = computed(() => {
  if (props.error instanceof Error && props.error.stack) return props.error.stack
  if (typeof props.error === 'string') return ''
  if (!props.error) return ''
  try {
    return JSON.stringify(props.error, null, 2)
  } catch {
    return ''
  }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
</script>

<template>
  <section
    class="m-3 grid min-h-0 content-start gap-3 rounded-[8px] border border-rule-light bg-chrome-high p-3 text-ink-2 grid-cols-[auto_minmax(0,1fr)] max-[720px]:grid-cols-1"
    :data-pane-recovery="pane"
    role="alert"
  >
    <div class="flex h-7 w-7 items-center justify-center rounded-[6px] bg-accent-tint text-accent">
      <IconAlertTriangle :size="18" :stroke-width="2.1" />
    </div>

    <div class="min-w-0">
      <h3 class="m-0 font-sans text-xs font-semibold tracking-normal text-ink">{{ heading }}</h3>
      <p class="m-0 mt-1 break-words font-sans text-xs leading-[1.4] text-ink-3 [overflow-wrap:anywhere]">{{ message }}</p>
      <details v-if="detail" class="mt-2 font-mono text-[10px] text-ink-4">
        <summary class="cursor-pointer select-none">Details</summary>
        <pre class="m-0 mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap">{{ detail }}</pre>
      </details>
    </div>

    <div class="col-start-2 flex flex-wrap gap-1.5 max-[720px]:col-start-1">
      <button
        type="button"
        class="inline-flex min-h-[26px] items-center justify-center gap-[5px] rounded-[6px] border border-rule-light bg-surface px-2 font-sans text-[11px] font-semibold text-ink-2 hover:border-rule hover:bg-chrome-mid hover:text-ink"
        title="Retry"
        @click="$emit('retry')"
      >
        <IconRefresh :size="14" :stroke-width="2.2" />
        <span>Retry</span>
      </button>
      <button
        v-if="canBack"
        type="button"
        class="inline-flex min-h-[26px] items-center justify-center gap-[5px] rounded-[6px] border border-rule-light bg-surface px-2 font-sans text-[11px] font-semibold text-ink-2 hover:border-rule hover:bg-chrome-mid hover:text-ink"
        title="Go back"
        @click="$emit('back')"
      >
        <IconArrowBackUp :size="14" :stroke-width="2.2" />
        <span>Back</span>
      </button>
      <button
        v-if="canRemove"
        type="button"
        class="inline-flex min-h-[26px] items-center justify-center gap-[5px] rounded-[6px] border border-rule-light bg-surface px-2 font-sans text-[11px] font-semibold text-ink-2 hover:border-rule hover:bg-chrome-mid hover:text-ink"
        title="Remove from history"
        @click="$emit('remove')"
      >
        <IconTrash :size="14" :stroke-width="2.2" />
        <span>Remove</span>
      </button>
      <button
        type="button"
        class="inline-flex h-[28px] min-h-[26px] w-[28px] items-center justify-center gap-[5px] rounded-[6px] border border-rule-light bg-surface p-0 font-sans text-[11px] font-semibold text-ink-2 hover:border-rule hover:bg-chrome-mid hover:text-ink"
        title="Dismiss"
        @click="$emit('dismiss')"
      >
        <IconX :size="14" :stroke-width="2.2" />
      </button>
    </div>
  </section>
</template>
