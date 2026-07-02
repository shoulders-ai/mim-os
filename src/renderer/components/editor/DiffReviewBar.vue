<template>
  <div
    ref="barEl"
    data-diff-scope
    class="@container flex h-9 shrink-0 items-center gap-2 overflow-hidden border-b border-rule-light bg-chrome-high px-3"
  >
    <!-- Identity: what is being reviewed -->
    <div class="flex min-w-0 flex-[1_1_auto] items-center gap-2 overflow-hidden">
      <span class="shrink-0 whitespace-nowrap font-sans text-[11px] font-semibold text-ink-2">{{ sourceLabel }}</span>
      <span
        v-if="secondaryLabel"
        class="min-w-0 max-w-[220px] truncate whitespace-nowrap font-mono text-[10px] text-ink-3 @max-[560px]:max-w-[120px] @max-[420px]:hidden"
        :title="secondaryTitle"
      >{{ secondaryLabel }}</span>
      <span
        v-if="delta"
        class="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-[10px] tabular-nums @max-[640px]:hidden"
      >
        <span class="text-add">+{{ delta.added }}</span>
        <span class="text-rem">&minus;{{ delta.removed }}</span>
      </span>
    </div>

    <div class="h-4 w-px shrink-0 bg-rule-light @max-[560px]:hidden" />

    <!-- Batch progress -->
    <div
      v-if="diff.isBatch"
      class="flex min-w-[120px] shrink items-center gap-2 overflow-hidden @max-[500px]:hidden"
      aria-label="Batch review progress"
    >
      <span class="shrink-0 whitespace-nowrap font-mono text-[10px] text-ink-3">{{ batchProgressLabel }}</span>
      <span
        class="relative inline-flex h-[3px] w-[88px] shrink-0 overflow-hidden rounded-full bg-rule-light"
        role="progressbar"
        :aria-valuenow="batchProgressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span class="h-full rounded-full bg-ink-3 transition-[width] duration-150 ease-out" :class="batchProgressWidthClass" />
      </span>
    </div>

    <!-- View selector -->
    <div v-else class="flex shrink-0 items-center" aria-label="Review view">
      <div :class="segGroupClass">
        <button
          v-for="mode in viewModes"
          :key="mode.value"
          type="button"
          :class="segBtnClass(diff.viewMode === mode.value)"
          :disabled="busy"
          :title="mode.label"
          @mousedown.prevent
          @click="diff.setViewMode(mode.value)"
        >
          <span class="@max-[420px]:hidden">{{ mode.label }}</span>
          <span class="hidden font-mono @max-[420px]:inline">{{ mode.shortLabel }}</span>
        </button>
      </div>
    </div>

    <!-- Diff layout selector -->
    <div
      v-if="!diff.isBatch && diff.viewMode === 'diff'"
      class="flex shrink-0 items-center @max-[760px]:hidden"
      aria-label="Diff layout"
    >
      <div :class="segGroupClass">
        <button
          type="button"
          :class="segBtnClass(diff.layout === 'unified')"
          :disabled="busy"
          title="Unified diff"
          @mousedown.prevent
          @click="diff.setLayout('unified')"
        >
          <IconLayoutList :size="12" :stroke-width="2.2" />
          <span class="@max-[900px]:hidden">Unified</span>
        </button>
        <button
          type="button"
          :class="segBtnClass(diff.layout === 'split')"
          :disabled="busy || splitUnavailable"
          :title="splitUnavailable ? 'Split diff needs more width' : 'Split diff'"
          @mousedown.prevent
          @click="diff.setLayout('split')"
        >
          <IconColumns2 :size="12" :stroke-width="2.2" />
          <span class="@max-[900px]:hidden">Split</span>
        </button>
      </div>
    </div>

    <!-- Change navigation -->
    <div
      v-if="!diff.isBatch && diff.viewMode === 'diff'"
      class="flex shrink-0 items-center gap-0.5 @max-[480px]:hidden"
      aria-label="Change navigation"
    >
      <button
        type="button"
        :class="navBtnClass"
        :disabled="busy || diff.chunkCount === 0"
        :title="`Previous change (${altUpLabel})`"
        @mousedown.prevent
        @click="onPrevChunk"
      >
        <IconChevronLeft :size="14" :stroke-width="2.4" />
      </button>
      <span class="min-w-[40px] whitespace-nowrap text-center font-mono text-[10px] tabular-nums text-ink-3">{{ chunkLabel }}</span>
      <button
        type="button"
        :class="navBtnClass"
        :disabled="busy || diff.chunkCount === 0"
        :title="`Next change (${altDownLabel})`"
        @mousedown.prevent
        @click="onNextChunk"
      >
        <IconChevronRight :size="14" :stroke-width="2.4" />
      </button>
    </div>

    <span
      v-if="error"
      class="min-w-0 flex-1 truncate whitespace-nowrap text-right font-sans text-[11px] text-rem @max-[540px]:sr-only"
      :title="error"
    >{{ error }}</span>
    <span
      v-else-if="notice"
      class="min-w-0 flex-1 truncate whitespace-nowrap text-right font-sans text-[11px] text-rem @max-[540px]:sr-only"
      :title="notice"
    >{{ notice }}</span>
    <span
      v-else-if="showAllResolved"
      class="min-w-0 flex-1 truncate whitespace-nowrap text-right font-sans text-[11px] text-add @max-[540px]:sr-only"
      :title="allResolvedHint"
    >{{ allResolvedHint }}</span>
    <div v-else class="min-w-[4px] flex-1" />

    <!-- Decision -->
    <button
      type="button"
      class="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-2.5 font-sans text-[11px] font-medium text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:pointer-events-none disabled:opacity-40 @max-[440px]:w-7 @max-[440px]:justify-center @max-[440px]:px-0"
      :disabled="busy"
      title="Close review (Esc)"
      @mousedown.prevent
      @click="emit('close')"
    >
      <IconX :size="13" :stroke-width="2.4" class="hidden @max-[440px]:block" />
      <span class="@max-[440px]:sr-only">Close</span>
    </button>
    <button
      v-if="isApproval"
      type="button"
      class="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-2.5 font-sans text-[11px] font-semibold text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:pointer-events-none disabled:opacity-40 @max-[520px]:w-7 @max-[520px]:justify-center @max-[520px]:px-0"
      :disabled="busy || responding"
      title="Decline this change"
      @mousedown.prevent
      @click="respondApproval(false)"
    >
      <IconX :size="13" :stroke-width="2.4" />
      <span class="@max-[520px]:sr-only">Decline</span>
    </button>
    <button
      v-if="isApproval"
      type="button"
      class="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] bg-accent px-2.5 font-sans text-[11px] font-semibold text-accent-ink hover:bg-accent-2 disabled:pointer-events-none disabled:opacity-40 @max-[520px]:w-7 @max-[520px]:justify-center @max-[520px]:px-0"
      :disabled="busy || responding"
      :title="`Approve this change (${modEnterLabel})`"
      @mousedown.prevent
      @click="respondApproval(true)"
    >
      <IconCheck :size="13" :stroke-width="2.5" />
      <span class="@max-[520px]:sr-only">Approve</span>
    </button>
    <button
      v-if="!isApproval"
      type="button"
      class="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-2.5 font-sans text-[11px] font-semibold text-rem hover:bg-rem/10 disabled:pointer-events-none disabled:opacity-40 @max-[520px]:w-7 @max-[520px]:justify-center @max-[520px]:px-0"
      :disabled="busy"
      :title="rejectTitle"
      @mousedown.prevent
      @click="emit('reject')"
    >
      <IconX :size="13" :stroke-width="2.4" />
      <span class="@max-[520px]:sr-only">{{ rejectLabel }}</span>
    </button>
    <button
      v-if="!isApproval"
      type="button"
      class="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] bg-accent px-2.5 font-sans text-[11px] font-semibold text-accent-ink hover:bg-accent-2 disabled:pointer-events-none disabled:opacity-40 @max-[520px]:w-7 @max-[520px]:justify-center @max-[520px]:px-0"
      :class="{ 'diff-accept-pulse': showAllResolved }"
      :disabled="busy"
      :title="acceptTitle"
      @mousedown.prevent
      @click="emit('accept')"
    >
      <IconCheck :size="13" :stroke-width="2.5" />
      <span class="@max-[520px]:sr-only">{{ acceptLabel }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconColumns2,
  IconLayoutList,
  IconX,
} from '@tabler/icons-vue'
import { useDiffStore, type DiffViewMode } from '../../stores/diff.js'
import { useApprovalsStore } from '../../stores/approvals.js'
import { resolveDiffKeyAction } from './diffKeyboard.js'
import { shortcutLabel } from '../../services/shortcutLabels.js'

const props = defineProps<{
  busy?: boolean
  error?: string
}>()

const emit = defineEmits<{
  accept: []
  reject: []
  close: []
  navigateChunk: [index: number]
}>()

const diff = useDiffStore()
const approvals = useApprovalsStore()
const barEl = ref<HTMLElement | null>(null)
const barWidth = ref(0)
const responding = ref(false)
let resizeObserver: ResizeObserver | null = null

const modEnterLabel = shortcutLabel(['Mod', 'Enter'])
const altDownLabel = shortcutLabel(['Alt', '↓'])
const altUpLabel = shortcutLabel(['Alt', '↑'])

const viewModes: Array<{ value: DiffViewMode; label: string; shortLabel: string }> = [
  { value: 'original', label: 'Original', shortLabel: 'O' },
  { value: 'diff', label: 'Diff', shortLabel: 'D' },
  { value: 'result', label: 'Result', shortLabel: 'R' },
]

// Segmented control: a recessed chrome track; the active segment lifts to the
// lightest surface. No ring/border on the segment (that doubled the track edge
// and read as a glitch). Inactive segments preview the lift on hover.
const segGroupClass = 'inline-flex items-center gap-px rounded-[5px] bg-chrome p-0.5'

function segBtnClass(active: boolean): string {
  return [
    'inline-flex h-[22px] items-center justify-center gap-1 whitespace-nowrap rounded-[3px] px-2 font-sans text-[11px] font-medium leading-none disabled:pointer-events-none disabled:opacity-40',
    active ? 'bg-surface text-ink' : 'text-ink-3 hover:bg-chrome-high hover:text-ink-2',
  ].join(' ')
}

const navBtnClass =
  'inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:pointer-events-none disabled:opacity-40'

const fileLabel = computed(() => {
  if (!diff.filePath) return ''
  return diff.filePath.split('/').pop() || diff.filePath
})

const secondaryLabel = computed(() => {
  if (diff.isBatch) {
    const total = diff.files.length
    if (total === 1) return diff.files[0]?.path.split('/').pop() || diff.files[0]?.path || ''
    return `${total} files`
  }
  return fileLabel.value
})

const secondaryTitle = computed(() => {
  if (diff.isBatch) return diff.files.map(file => file.path).join('\n')
  return diff.filePath
})

const isApproval = computed(() => diff.reviewMeta?.type === 'approval')
const isConflict = computed(() => diff.reviewMeta?.type === 'conflict')

const sourceLabel = computed(() => {
  if (diff.isBatch) return 'Review all'
  if (diff.reviewMeta?.type === 'inline-ai') return 'AI edit'
  if (isConflict.value) return 'File changed on disk'
  if (diff.reviewMeta?.kind === 'create') return 'Create'
  if (diff.reviewMeta?.kind === 'delete') return 'Delete'
  if (diff.reviewMeta?.kind === 'write') return 'Overwrite'
  if (diff.reviewMeta?.kind === 'edit') return 'Edit'
  return 'Review'
})

const delta = computed<{ added: number; removed: number } | null>(() => {
  if (diff.isBatch) {
    const added = diff.files.reduce((sum, file) => sum + (file.added ?? 0), 0)
    const removed = diff.files.reduce((sum, file) => sum + (file.removed ?? 0), 0)
    return { added, removed }
  }
  const added = Number(diff.reviewMeta?.added ?? NaN)
  const removed = Number(diff.reviewMeta?.removed ?? NaN)
  if (!Number.isFinite(added) && !Number.isFinite(removed)) return null
  if (!added && !removed) return null
  return { added: Number.isFinite(added) ? added : 0, removed: Number.isFinite(removed) ? removed : 0 }
})

const notice = computed(() => {
  const value = diff.reviewMeta?.notice
  return typeof value === 'string' ? value : ''
})

const showAllResolved = computed(() => !diff.isBatch && !isApproval.value && diff.allChunksResolved)
const allResolvedHint = computed(() => `All changes resolved — ${modEnterLabel} to apply`)

const chunkLabel = computed(() => {
  if (diff.chunkCount <= 0) return '0/0'
  return `${diff.currentChunk + 1}/${diff.chunkCount}`
})

const batchProgressLabel = computed(() => {
  const total = diff.files.length
  if (total === 0) return 'No files'
  const conflicts = diff.files.filter(file => file.status === 'conflict').length
  const pending = diff.pendingFiles.length
  if (conflicts > 0) return `${pending} pending, ${conflicts} conflict${conflicts === 1 ? '' : 's'}`
  return `${diff.resolvedCount}/${total} resolved`
})

const batchProgressPercent = computed(() => {
  const total = diff.files.length
  return total > 0 ? Math.round((diff.resolvedCount / total) * 100) : 0
})

const batchProgressWidthClass = computed(() => {
  const percent = batchProgressPercent.value
  if (percent >= 100) return 'w-full'
  if (percent >= 88) return 'w-11/12'
  if (percent >= 75) return 'w-3/4'
  if (percent >= 66) return 'w-2/3'
  if (percent >= 50) return 'w-1/2'
  if (percent >= 33) return 'w-1/3'
  if (percent >= 25) return 'w-1/4'
  if (percent > 0) return 'w-1/12'
  return 'w-0'
})

// A conflict decision is "which version survives", not accept/reject — the
// labels must say which side gets discarded before the user commits.
const acceptLabel = computed(() => {
  if (diff.isBatch) return 'Accept All'
  if (isConflict.value) return 'Keep my version'
  return 'Accept'
})
const rejectLabel = computed(() => {
  if (diff.isBatch) return 'Reject All'
  if (isConflict.value) return 'Take disk version'
  return 'Reject'
})
const acceptTitle = computed(() => {
  if (diff.isBatch) return 'Accept all pending files'
  if (isConflict.value) return `Write my version to disk, replacing the disk copy (${modEnterLabel})`
  return `Accept resolved content (${modEnterLabel})`
})
const rejectTitle = computed(() => {
  if (diff.isBatch) return 'Reject all pending files'
  if (isConflict.value) return 'Discard my unsaved edits and load the disk version'
  return 'Reject review'
})
const splitUnavailable = computed(() => !diff.isBatch && barWidth.value > 0 && barWidth.value < 760)

watch(splitUnavailable, unavailable => {
  if (unavailable && diff.layout === 'split') diff.setLayout('unified')
})

function onPrevChunk(): void {
  diff.prevChunk()
  emit('navigateChunk', diff.currentChunk)
}

function onNextChunk(): void {
  diff.nextChunk()
  emit('navigateChunk', diff.currentChunk)
}

// The approval decision resolves the same pending request as the chat card;
// the approvals store is the single decision point for both surfaces. When the
// request resolves, EditorPanel's watcher closes this review.
async function respondApproval(approved: boolean): Promise<void> {
  const requestId = typeof diff.reviewMeta?.requestId === 'string' ? diff.reviewMeta.requestId : ''
  if (!requestId || responding.value) return
  if (!approvals.get(requestId)) return
  responding.value = true
  try {
    await approvals.respond(requestId, { approved })
  } finally {
    responding.value = false
  }
}

function classifyKeyTarget(target: EventTarget | null) {
  const el = target instanceof Element ? target : null
  return {
    isEditable: !!el?.closest('input, textarea, [contenteditable="true"], .cm-content'),
    isButton: !!el?.closest('button'),
    inDiffScope: !!el?.closest('[data-diff-scope]'),
    overlayOpen: !!document.querySelector('.mim-dialog, [role="dialog"]'),
  }
}

function onWindowKeydown(event: KeyboardEvent): void {
  const action = resolveDiffKeyAction(event, classifyKeyTarget(event.target), {
    active: diff.active,
    busy: props.busy === true,
    isApproval: isApproval.value,
    isBatch: diff.isBatch,
    viewMode: diff.viewMode,
    chunkCount: diff.chunkCount,
    allChunksResolved: diff.allChunksResolved,
  })
  if (!action) return
  event.preventDefault()
  event.stopPropagation()
  if (action === 'close') emit('close')
  else if (action === 'accept') emit('accept')
  else if (action === 'approve') void respondApproval(true)
  else if (action === 'next-chunk') onNextChunk()
  else if (action === 'prev-chunk') onPrevChunk()
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  if (!barEl.value) return
  barWidth.value = barEl.value.clientWidth
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(entries => {
    const entry = entries[0]
    barWidth.value = Math.round(entry?.contentRect.width ?? barEl.value?.clientWidth ?? 0)
  })
  resizeObserver.observe(barEl.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped>
@keyframes diff-accept-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-accent) 45%, transparent);
  }
  55% {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--color-accent) 0%, transparent);
  }
}

.diff-accept-pulse {
  animation: diff-accept-pulse 900ms ease-out 2;
}
</style>
