<template>
  <section
    class="min-h-0 border-b border-rule-light bg-surface"
    :class="{
      'opacity-55': fileStatus === 'rejected',
    }"
    :data-file-path="file.path"
  >
    <header class="sticky top-[34px] z-10 flex h-[32px] items-center gap-2 border-b border-rule-light bg-chrome-high px-3">
      <span class="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-ink-2" :title="file.path">
        {{ fileLabel }}
      </span>
      <span class="flex shrink-0 gap-1.5 font-mono text-[10px]">
        <span class="text-add">+{{ file.added ?? 0 }}</span>
        <span class="text-rem">-{{ file.removed ?? 0 }}</span>
      </span>
      <div class="flex shrink-0 items-center gap-1">
        <template v-if="fileStatus === 'pending'">
          <button
            type="button"
            class="h-[22px] whitespace-nowrap rounded-[4px] px-2 font-sans text-[10px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-40"
            @mousedown.prevent
            @click="emit('reject', file.path)"
          >
            Reject
          </button>
          <button
            type="button"
            class="h-[22px] whitespace-nowrap rounded-[4px] px-2 font-sans text-[10px] font-semibold text-add hover:bg-add/10 disabled:opacity-40"
            @mousedown.prevent
            @click="emit('accept', file.path, resolvedContent())"
          >
            Accept
          </button>
        </template>
        <template v-else-if="fileStatus === 'conflict'">
          <span class="font-sans text-[10px] font-semibold text-rem">
            Conflict
          </span>
        </template>
        <template v-else>
          <span class="font-sans text-[10px] font-medium" :class="fileStatus === 'accepted' ? 'text-add' : 'text-ink-3'">
            {{ fileStatus === 'accepted' ? 'Accepted' : 'Rejected' }}
          </span>
          <button
            type="button"
            class="h-[22px] whitespace-nowrap rounded-[4px] px-2 font-sans text-[10px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink"
            @mousedown.prevent
            @click="emit('reset', file.path)"
          >
            Undo
          </button>
        </template>
      </div>
    </header>

    <div
      v-if="fileStatus === 'pending'"
      ref="diffHost"
      class="batch-file-diff h-[min(58vh,520px)] min-h-[180px] overflow-hidden"
    />
    <div
      v-else-if="fileStatus === 'conflict'"
      class="border-t border-rule-light bg-rem/5 px-4 py-3 font-sans text-[11px] leading-5 text-rem"
    >
      {{ file.conflictReason || 'This file changed after review was prepared. Close review and ask for a fresh edit.' }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  createUnifiedDiffView,
  getResolvedContent,
} from './codemirror/merge.js'

const props = defineProps<{
  file: {
    path: string
    original: string
    modified: string
    resolvedContent?: string
    status?: string
    added?: number
    removed?: number
    conflictReason?: string
  }
}>()

const emit = defineEmits<{
  accept: [path: string, resolvedContent: string]
  reject: [path: string]
  reset: [path: string]
  resolvedContent: [path: string, content: string]
}>()

const diffHost = ref<HTMLElement | null>(null)
let editorView: any = null

const fileLabel = computed(() => props.file.path.split('/').pop() || props.file.path)
const fileStatus = computed(() => props.file.status || 'pending')

function buildEditor(): void {
  destroyEditor()
  if (!diffHost.value || fileStatus.value !== 'pending') return
  const modifiedContent = props.file.resolvedContent ?? props.file.modified
  editorView = createUnifiedDiffView({
    parent: diffHost.value,
    originalContent: props.file.original,
    modifiedContent,
    collapse: true,
    onChunkCountChange: () => {},
    onResolvedContentChange: (content: string) => emit('resolvedContent', props.file.path, content),
  })
}

function destroyEditor(): void {
  if (editorView) {
    editorView.destroy()
    editorView = null
  }
  if (diffHost.value) diffHost.value.innerHTML = ''
}

function resolvedContent(): string {
  return getResolvedContent(editorView, 'unified', props.file.resolvedContent ?? props.file.modified)
}

watch(() => [
  props.file.path,
  props.file.original,
  props.file.modified,
  props.file.status,
], () => {
  nextTick(buildEditor)
})

onMounted(buildEditor)
onUnmounted(destroyEditor)
</script>

<style scoped>
.batch-file-diff :deep(.cm-editor) {
  height: 100%;
  font-size: var(--editor-size, 14px);
}

.batch-file-diff :deep(.cm-content) {
  padding: 0 14px;
}

.batch-file-diff :deep(.cm-scroller) {
  font-family: var(--editor-font, var(--font-serif));
  line-height: var(--editor-line-height, 23px);
  overflow: auto;
}
</style>
