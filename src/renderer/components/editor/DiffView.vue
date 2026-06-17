<template>
  <div
    ref="wrapperEl"
    class="relative flex min-h-0 flex-1 overflow-hidden bg-surface"
    :style="wrapperStyle"
  >
    <div
      ref="viewHost"
      class="diff-view-host min-h-0 flex-1 overflow-hidden"
      :class="{
        'diff-view-host-split': diff.viewMode === 'diff' && diff.layout === 'split',
        'diff-view-host-readonly': diff.viewMode !== 'diff',
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { EditorView } from '@codemirror/view'
import { useDiffStore } from '../../stores/diff.js'
import { useSettingsStore } from '../../stores/settings.js'
import {
  createReadOnlyView,
  createSplitDiffView,
  createUnifiedDiffView,
  getResolvedContent as readResolvedContent,
  getSplitChunks,
  getUnifiedChunks,
} from './codemirror/merge.js'
import { shouldCollapseUnchangedDiffSections } from './diffPresentation.js'

const diff = useDiffStore()
const settings = useSettingsStore()
const wrapperEl = ref<HTMLElement | null>(null)
const viewHost = ref<HTMLElement | null>(null)

let currentView: any = null
let currentType: 'unified' | 'split' | 'readonly' | null = null
let resizeObserver: ResizeObserver | null = null

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
    '--editor-paper': 'var(--color-surface)',
  }
})

const isApproval = computed(() => diff.reviewMeta?.type === 'approval')
const shouldCollapse = computed(() => shouldCollapseUnchangedDiffSections(diff.reviewMeta))

function enforceReadableLayout(width = wrapperEl.value?.clientWidth ?? 0): void {
  if (width > 0 && width < 760 && diff.layout === 'split') {
    diff.setLayout('unified')
  }
}

function destroyCurrent(): void {
  if (!currentView) return
  currentView.destroy()
  currentView = null
  currentType = null
  if (viewHost.value) viewHost.value.innerHTML = ''
}

function buildView(): void {
  destroyCurrent()
  if (!viewHost.value || !diff.active) return
  enforceReadableLayout()

  const originalContent = diff.originalContent
  const resultContent = diff.effectiveContent

  if (diff.viewMode === 'original') {
    currentView = createReadOnlyView({
      parent: viewHost.value,
      content: originalContent,
    })
    currentType = 'readonly'
    return
  }

  if (diff.viewMode === 'result') {
    currentView = createReadOnlyView({
      parent: viewHost.value,
      content: resultContent,
    })
    currentType = 'readonly'
    return
  }

  if (diff.layout === 'split') {
    currentView = createSplitDiffView({
      parent: viewHost.value,
      originalContent,
      modifiedContent: resultContent,
      collapse: shouldCollapse.value,
      readOnly: isApproval.value,
      onChunkCountChange: diff.setChunkCount,
      onResolvedContentChange: diff.setResolvedContent,
    })
    currentType = 'split'
    nextTick(() => scrollToChunk(diff.currentChunk))
    return
  }

  currentView = createUnifiedDiffView({
    parent: viewHost.value,
    originalContent,
    modifiedContent: resultContent,
    collapse: shouldCollapse.value,
    readOnly: isApproval.value,
    onChunkCountChange: diff.setChunkCount,
    onResolvedContentChange: diff.setResolvedContent,
  })
  currentType = 'unified'
  nextTick(() => scrollToChunk(diff.currentChunk))
}

function scrollToChunk(index: number): void {
  if (!currentView || currentType === 'readonly') return

  if (currentType === 'unified') {
    const chunks = getUnifiedChunks(currentView)
    const chunk = chunks[index] ?? chunks[0]
    if (!chunk) return
    currentView.dispatch({
      effects: EditorView.scrollIntoView(chunk.fromB, { y: 'center' }),
    })
    return
  }

  const chunks = getSplitChunks(currentView)
  const chunk = chunks[index] ?? chunks[0]
  if (!chunk) return
  currentView.a.dispatch({
    effects: EditorView.scrollIntoView(chunk.fromA, { y: 'center' }),
  })
  currentView.b.dispatch({
    effects: EditorView.scrollIntoView(chunk.fromB, { y: 'center' }),
  })
}

function getResolvedContent(): string {
  return readResolvedContent(currentView, currentType, diff.effectiveContent)
}

defineExpose({
  getResolvedContent,
  scrollToChunk,
})

watch(() => [
  diff.active,
  diff.viewMode,
  diff.layout,
  diff.originalContent,
  diff.modifiedContent,
  diff.viewMode === 'result' ? diff.effectiveContent : '',
], () => {
  if (diff.active) nextTick(buildView)
  else destroyCurrent()
})

onMounted(() => {
  if (wrapperEl.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(entries => {
      const width = Math.round(entries[0]?.contentRect.width ?? wrapperEl.value?.clientWidth ?? 0)
      enforceReadableLayout(width)
    })
    resizeObserver.observe(wrapperEl.value)
  }
  if (diff.active) buildView()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  destroyCurrent()
})
</script>

<style scoped>
.diff-view-host :deep(.cm-editor) {
  height: 100%;
}

.diff-view-host :deep(.cm-scroller) {
  font-family: var(--editor-font, var(--font-mono));
  line-height: var(--editor-line-height);
  background: var(--editor-paper, var(--color-surface));
  overflow: auto;
}

.diff-view-host :deep(.cm-content) {
  padding: 24px clamp(8px, 3vw, 24px) clamp(72px, 20vh, 100px);
}

.diff-view-host :deep(.cm-mergeView) {
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.diff-view-host-split :deep(.cm-mergeView) {
  display: flex;
  min-width: 0;
  overflow: hidden;
}

.diff-view-host-split :deep(.cm-mergeViewEditors) {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex: 1;
}

.diff-view-host-split :deep(.cm-mergeViewEditor) {
  display: flex;
  min-height: 0;
  min-width: 0;
  flex: 1;
  height: 100%;
  overflow: hidden;
}

.diff-view-host-split :deep(.cm-mergeViewEditor .cm-editor) {
  min-height: 0;
  min-width: 0;
  flex: 1;
}

.diff-view-host :deep(.cm-merge-revert) {
  width: 22px;
  background: var(--color-chrome);
  border-left: 1px solid var(--color-rule-light);
  border-right: 1px solid var(--color-rule-light);
}

/* The split revert gutter sits between the two editors, outside CodeMirror's
   own theme scope, so these control rules must live here (scoped :deep), not
   only in merge.js's EditorView.theme. */
.diff-view-host :deep(.cm-merge-revert button),
.diff-view-host :deep(.cm-chunkButtons button),
.diff-view-host :deep(.mim-merge-control) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-ink-3);
}

.diff-view-host :deep(.cm-merge-revert button svg),
.diff-view-host :deep(.cm-chunkButtons button svg),
.diff-view-host :deep(.mim-merge-control svg) {
  width: 12px;
  height: 12px;
  display: block;
}

.diff-view-host :deep(.cm-merge-revert button:hover),
.diff-view-host :deep(.mim-merge-control-reject:hover) {
  color: var(--color-rem);
  border-color: color-mix(in srgb, var(--color-rem) 35%, var(--color-rule));
  background: color-mix(in srgb, var(--color-rem) 9%, var(--color-surface));
}

.diff-view-host :deep(.mim-merge-control-accept:hover) {
  color: var(--color-add);
  border-color: color-mix(in srgb, var(--color-add) 35%, var(--color-rule));
  background: color-mix(in srgb, var(--color-add) 10%, var(--color-surface));
}

.diff-view-host-readonly :deep(.cm-content) {
  cursor: default;
}

.diff-view-host-readonly :deep(.cm-cursor) {
  display: none !important;
}
</style>
