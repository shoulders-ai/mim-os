<template>
  <div ref="scrollRoot" class="min-h-0 flex-1 overflow-y-auto bg-chrome-mid" :style="wrapperStyle">
    <div class="sticky top-0 z-20 flex min-h-[34px] items-center gap-2 overflow-hidden border-b border-rule-light bg-chrome-high px-3">
      <span class="shrink-0 whitespace-nowrap font-mono text-[10px] text-ink-3">
        {{ batchSummary }}
      </span>
      <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          v-for="file in diff.files"
          :key="file.path"
          type="button"
          class="inline-flex h-[22px] max-w-[180px] shrink-0 items-center gap-1 rounded-[4px] px-1.5 font-mono text-[10px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
          :class="fileQueueClass(file.status)"
          :title="file.path"
          @mousedown.prevent
          @click="scrollToFile(file.path)"
        >
          <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="fileDotClass(file.status)" />
          <span class="min-w-0 truncate whitespace-nowrap">{{ fileLabel(file.path) }}</span>
        </button>
      </div>
    </div>
    <BatchFileDiff
      v-for="file in diff.files"
      :key="file.path"
      :file="file"
      @accept="onAcceptFile"
      @reject="onRejectFile"
      @reset="onResetFile"
      @resolved-content="onResolvedContent"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDiffStore } from '../../stores/diff.js'
import { useSettingsStore } from '../../stores/settings.js'
import BatchFileDiff from './BatchFileDiff.vue'

const emit = defineEmits<{
  acceptFile: [path: string, resolvedContent: string]
  rejectFile: [path: string]
}>()

const diff = useDiffStore()
const settings = useSettingsStore()
const scrollRoot = ref<HTMLElement | null>(null)

const wrapperStyle = computed(() => {
  const familyMap: Record<string, string> = {
    sans: 'var(--font-sans)',
    serif: 'var(--font-serif)',
    mono: 'var(--font-mono)',
    slab: 'var(--font-slab)',
  }
  const size = settings.editorFontSize || 14
  return {
    '--editor-size': `${size}px`,
    '--editor-line-height': `${Math.round((23 * size) / 14)}px`,
    '--editor-font': familyMap[settings.editorFontFamily] || familyMap.serif,
  }
})

const batchSummary = computed(() => {
  const total = diff.files.length
  const pending = diff.pendingFiles.length
  const conflicts = diff.files.filter(file => file.status === 'conflict').length
  if (total === 0) return 'No files'
  if (conflicts > 0) return `${pending} pending / ${conflicts} conflict${conflicts === 1 ? '' : 's'}`
  return `${diff.resolvedCount}/${total} resolved`
})

function onAcceptFile(path: string, resolvedContent: string): void {
  emit('acceptFile', path, resolvedContent)
}

function onRejectFile(path: string): void {
  emit('rejectFile', path)
}

function onResetFile(path: string): void {
  diff.resetFile(path)
}

function onResolvedContent(path: string, content: string): void {
  const file = diff.files.find(item => item.path === path)
  if (file) file.resolvedContent = content
}

function fileLabel(path: string): string {
  return path.split('/').pop() || path
}

function fileQueueClass(status = 'pending'): string {
  if (status === 'accepted') return 'text-add hover:bg-add/10'
  if (status === 'rejected') return 'text-ink-4 opacity-75 hover:opacity-100'
  if (status === 'conflict') return 'text-rem hover:bg-rem/10'
  return ''
}

function fileDotClass(status = 'pending'): string {
  if (status === 'accepted') return 'bg-add'
  if (status === 'rejected') return 'bg-ink-4'
  if (status === 'conflict') return 'bg-rem'
  return 'bg-ink-3'
}

function scrollToFile(path: string): void {
  const selector = `[data-file-path="${CSS.escape(path)}"]`
  const target = scrollRoot.value?.querySelector(selector)
  target?.scrollIntoView({ block: 'start' })
}

defineExpose({ scrollToFile })
</script>
