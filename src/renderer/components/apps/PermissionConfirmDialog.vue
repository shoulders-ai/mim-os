<script setup lang="ts">
import { computed } from 'vue'
import MimDialog from '../ui/MimDialog.vue'
import { permissionLines } from '../packages/permissionSummary.js'

const props = withDefaults(
  defineProps<{
    open: boolean
    appName: string
    permissions?: Record<string, unknown>
    confirmLabel?: string
    testId?: string
    confirmTestId?: string
  }>(),
  {
    permissions: () => ({}),
    confirmLabel: 'Enable',
    testId: undefined,
    confirmTestId: undefined,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
  'update:open': [open: boolean]
}>()

const lines = computed(() => permissionLines(props.permissions ?? {}))

function close() {
  emit('update:open', false)
  emit('cancel')
}
</script>

<template>
  <MimDialog
    :open="open"
    role="alertdialog"
    size="sm"
    title="Review access"
    @close="close"
    @update:open="emit('update:open', $event)"
  >
    <div :data-testid="testId" class="flex flex-col gap-3 px-4 py-4 font-sans">
      <div class="flex flex-col gap-1">
        <p class="m-0 text-[12px] font-semibold text-ink">
          {{ appName }} can:
        </p>
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          <li
            v-for="line in lines"
            :key="line"
            class="flex gap-2 text-[11px] leading-5 text-ink-2"
          >
            <span class="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-add" />
            <span>{{ line }}</span>
          </li>
        </ul>
      </div>

      <div class="flex justify-end gap-1.5 border-t border-rule-light pt-3">
        <button
          type="button"
          class="inline-flex h-[26px] items-center justify-center rounded-[5px] border border-rule bg-chrome-high px-2.5 text-[11px] font-medium text-ink-2 hover:bg-chrome-mid hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          @click="close"
        >
          Cancel
        </button>
        <button
          type="button"
          :data-testid="confirmTestId"
          class="inline-flex h-[26px] items-center justify-center rounded-[5px] border border-accent bg-accent px-2.5 text-[11px] font-semibold text-accent-ink hover:bg-accent-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </div>
  </MimDialog>
</template>
