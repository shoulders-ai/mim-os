<script setup lang="ts">
import { computed } from 'vue'
import { sanitizeHtml } from '../../services/sanitize.js'

const props = defineProps<{
  label: string
  preview: string
  previewHtml?: string
  date: string
  messageCount: number
  meta?: string
}>()

const safePreviewHtml = computed(() =>
  props.previewHtml ? sanitizeHtml(props.previewHtml) : undefined,
)

const emit = defineEmits<{
  open: []
  remove: []
}>()
</script>

<template>
  <div
    class="archive-card group flex flex-col gap-1 rounded-[8px] border border-rule-light bg-surface px-3.5 py-3 hover:border-rule hover:bg-chrome-mid"
    @dblclick="emit('open')"
  >
    <div class="flex items-baseline gap-3">
      <span class="flex-1 min-w-0 truncate text-[13px] font-medium text-ink">{{ label }}</span>
      <time class="shrink-0 font-mono text-[10px] text-ink-4">{{ date }}</time>
    </div>

    <p
      v-if="safePreviewHtml"
      class="archive-preview line-clamp-3 text-[12px] leading-snug text-ink-3"
      v-html="safePreviewHtml"
    />
    <p
      v-else-if="preview"
      class="line-clamp-3 text-[12px] leading-snug text-ink-3"
    >{{ preview }}</p>
    <p v-else class="text-[12px] italic text-ink-4">No messages</p>

    <div class="mt-1.5 flex items-center gap-2">
      <span class="flex-1 font-mono text-[10px] text-ink-4">
        {{ meta ?? `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}` }}
      </span>
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100">
        <button
          class="rounded-[5px] px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-accent-tint hover:text-accent"
          @click.stop="emit('open')"
        >Open</button>
        <button
          class="rounded-[5px] px-2 py-1 text-[11px] text-ink-3 hover:bg-rem/8 hover:text-rem"
          @click.stop="emit('remove')"
        >Delete</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Highlight spans from the FTS snippet (third-party-shaped content). */
.archive-preview :deep(mark) {
  background: var(--color-accent-tint);
  color: var(--color-accent);
  border-radius: 2px;
  padding: 0 1px;
}
</style>
