<script setup lang="ts">
const emit = defineEmits<{
  newDocument: []
  openFileDialog: []
}>()
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-surface px-6 py-8 text-center font-sans">
    <div class="text-[13px] font-medium text-ink">No document open</div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="h-7 rounded-[5px] border border-rule-light bg-chrome-high px-3 text-[12px] text-ink-2 hover:bg-chrome-mid"
        @click="emit('newDocument')"
      >
        New document
      </button>
      <button
        type="button"
        class="h-7 rounded-[5px] border border-rule-light bg-chrome-high px-3 text-[12px] text-ink-2 hover:bg-chrome-mid"
        @click="emit('openFileDialog')"
      >
        Open file...
      </button>
    </div>
  </div>
</template>
