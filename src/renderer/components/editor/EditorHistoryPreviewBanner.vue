<script setup lang="ts">
import type { HistoryPreviewPayload } from './editorTypes.js'

defineProps<{
  preview: HistoryPreviewPayload
  busy: boolean
}>()

const emit = defineEmits<{
  useVersion: []
  cancel: []
}>()
</script>

<template>
  <div
    class="flex min-h-[44px] shrink-0 items-center gap-3 border-b border-rule-light bg-accent-soft px-3 font-sans"
    data-testid="history-preview-banner"
  >
    <div class="min-w-0 flex-1">
      <div class="truncate text-[12px] font-semibold text-ink">
        Previewing {{ preview.relativeTime }}
      </div>
      <div class="truncate text-[11px] text-ink-3" :title="preview.exactTime">
        Current file is unchanged
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-1" title="Line changes compared with the current file">
      <span class="min-w-[34px] rounded-[4px] bg-surface px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-accent">
        +{{ preview.added }}
      </span>
      <span class="min-w-[34px] rounded-[4px] bg-rem/10 px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-rem">
        -{{ preview.removed }}
      </span>
    </div>
    <button
      type="button"
      class="h-7 rounded-[5px] bg-accent px-3 text-[12px] font-semibold text-accent-ink hover:opacity-90 disabled:opacity-40"
      :disabled="busy"
      data-testid="history-use-version"
      @click="emit('useVersion')"
    >
      Use this version
    </button>
    <button
      type="button"
      class="h-7 rounded-[5px] border border-rule-light bg-surface px-3 text-[12px] text-ink-2 hover:bg-chrome-high disabled:opacity-40"
      :disabled="busy"
      data-testid="history-cancel-preview"
      @click="emit('cancel')"
    >
      Cancel
    </button>
  </div>
</template>
