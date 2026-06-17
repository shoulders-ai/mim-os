<script setup lang="ts">
import {
  IconAlertTriangle,
  IconCode,
  IconColumns2,
  IconEye,
  IconFileText,
  IconFileX,
  IconGitCompare,
  IconHistory,
  IconMessageCircle,
  IconPencil,
  IconQuote,
  IconTable,
} from '@tabler/icons-vue'
import type { ViewMode } from './editorTypes.js'
import { shortcutLabel } from '../../services/shortcutLabels.js'

defineProps<{
  activeIsTable: boolean
  tableStatsTitle: string
  tableStatsLabel: string
  showWordStats: boolean
  wordStatsTitle: string
  wordStatsLabel: string
  showCitationStatus: boolean
  citationStatusTitle: string
  citationStatusLabel: string
  citationMissing: boolean
  commentRailCollapsed: boolean
  commentCount: number
  historyPreviewActive: boolean
  diffActive: boolean
  activeIsMarkdown: boolean
  activeTruncated: boolean
  externalState?: 'changed' | 'deleted'
  activeDirty: boolean
  viewMode: ViewMode
  viewModes: ViewMode[]
}>()

const emit = defineEmits<{
  toggleBibliography: []
  showComments: []
  'update:viewMode': [mode: ViewMode]
}>()

function viewModeLabel(mode: ViewMode): string {
  if (mode === 'source') return 'Source'
  if (mode === 'split') return 'Split'
  return 'Preview'
}

function viewModeShortLabel(mode: ViewMode): string {
  if (mode === 'source') return 'Src'
  if (mode === 'split') return 'Split'
  return 'Prev'
}

const itemClass = 'inline-flex h-[18px] min-w-0 max-w-full flex-[0_1_auto] items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] leading-none text-ink-3'
const labelClass = 'min-w-0 overflow-hidden text-ellipsis'
</script>

<template>
  <div class="flex h-7 shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap border-t border-rule-light bg-chrome-high px-3">
    <span
      v-if="activeIsTable"
      :class="[itemClass, 'max-w-[120px]']"
      :title="tableStatsTitle"
    >
      <IconTable class="shrink-0" :size="12" :stroke-width="2" aria-hidden="true" />
      <span :class="labelClass">{{ tableStatsLabel }}</span>
    </span>
    <span
      v-if="showWordStats"
      :class="[itemClass, 'max-w-[120px]']"
      :title="wordStatsTitle"
    >
      <IconFileText class="shrink-0" :size="12" :stroke-width="2" aria-hidden="true" />
      <span :class="labelClass">{{ wordStatsLabel }}</span>
    </span>
    <button
      v-if="showCitationStatus"
      type="button"
      :class="[
        itemClass,
        'max-w-[108px] rounded-[3px] border-0 bg-transparent px-1.5 py-0.5 hover:bg-chrome-mid',
        citationMissing ? 'text-rem' : 'text-ink-3 hover:text-ink-2',
      ]"
      :title="citationStatusTitle"
      :aria-label="citationStatusTitle"
      data-testid="editor-citation-status"
      @click="emit('toggleBibliography')"
    >
      <IconAlertTriangle
        v-if="citationMissing"
        class="shrink-0"
        :size="12"
        :stroke-width="2.2"
        aria-hidden="true"
      />
      <IconQuote
        v-else
        class="shrink-0"
        :size="12"
        :stroke-width="2"
        aria-hidden="true"
      />
      <span :class="labelClass">{{ citationStatusLabel }}</span>
    </button>

    <div class="min-w-1 flex-1" />

    <button
      v-if="commentRailCollapsed && commentCount > 0 && !historyPreviewActive"
      type="button"
      :class="[itemClass, 'max-w-[92px] rounded-[3px] border-0 bg-transparent px-1.5 py-0.5 hover:bg-chrome-mid']"
      :title="`Show ${commentCount} comment${commentCount === 1 ? '' : 's'} (${shortcutLabel(['Shift', 'Mod', 'M'])})`"
      :aria-label="`Show ${commentCount} comment${commentCount === 1 ? '' : 's'}`"
      @click="emit('showComments')"
    >
      <IconMessageCircle class="shrink-0" :size="12" :stroke-width="2" aria-hidden="true" />
      <span :class="labelClass">{{ commentCount }} note{{ commentCount === 1 ? '' : 's' }}</span>
    </button>
    <span
      v-if="activeTruncated"
      :class="[itemClass, 'font-semibold text-rem']"
      title="Truncated (read-only)"
    >
      <IconAlertTriangle class="shrink-0" :size="12" :stroke-width="2.2" aria-hidden="true" />
      <span :class="labelClass">Truncated</span>
    </span>
    <span
      v-if="externalState === 'changed'"
      :class="[itemClass, 'text-accent']"
      title="Changed on disk"
      data-testid="editor-disk-status"
    >
      <IconAlertTriangle class="shrink-0" :size="12" :stroke-width="2.2" aria-hidden="true" />
      <span :class="labelClass">Disk</span>
    </span>
    <span
      v-if="externalState === 'deleted'"
      :class="[itemClass, 'text-accent']"
      title="Deleted on disk"
      data-testid="editor-disk-status"
    >
      <IconFileX class="shrink-0" :size="12" :stroke-width="2.1" aria-hidden="true" />
      <span :class="labelClass">Deleted</span>
    </span>
    <span v-if="activeDirty" :class="[itemClass, 'text-accent']" title="Modified">
      <IconPencil class="shrink-0" :size="12" :stroke-width="2.1" aria-hidden="true" />
      <span :class="labelClass">Mod</span>
    </span>
    <span v-if="historyPreviewActive" :class="[itemClass, 'text-accent']" title="Viewing previous save">
      <IconHistory class="shrink-0" :size="12" :stroke-width="2" aria-hidden="true" />
      <span :class="labelClass">History</span>
    </span>
    <span v-if="diffActive" :class="[itemClass, 'text-accent']" title="Reviewing change">
      <IconGitCompare class="shrink-0" :size="12" :stroke-width="2" aria-hidden="true" />
      <span :class="labelClass">Review</span>
    </span>
    <div
      v-if="!diffActive && !historyPreviewActive && activeIsMarkdown"
      class="inline-flex h-[18px] shrink-0 items-center gap-px rounded-[5px] border border-rule-light bg-chrome-mid p-px"
    >
      <button
        v-for="mode in viewModes"
        :key="mode"
        type="button"
        class="inline-flex h-4 min-w-[54px] items-center justify-center gap-[3px] overflow-hidden whitespace-nowrap rounded-[3px] border-0 bg-transparent px-1.5 font-mono text-[9px] leading-none text-ink-3 hover:text-ink-2"
        :class="viewMode === mode ? 'bg-surface font-semibold text-ink shadow-[0_0_0_1px_var(--color-rule-light)]' : ''"
        :title="viewModeLabel(mode)"
        :aria-label="viewModeLabel(mode)"
        @click="emit('update:viewMode', mode)"
      >
        <IconCode v-if="mode === 'source'" class="shrink-0" :size="11" :stroke-width="2" aria-hidden="true" />
        <IconColumns2 v-else-if="mode === 'split'" class="shrink-0" :size="11" :stroke-width="2" aria-hidden="true" />
        <IconEye v-else class="shrink-0" :size="11" :stroke-width="2" aria-hidden="true" />
        <span class="min-w-0 overflow-hidden text-ellipsis max-[760px]:hidden">{{ viewModeLabel(mode) }}</span>
        <span class="hidden min-w-0 overflow-hidden text-ellipsis max-[760px]:inline">{{ viewModeShortLabel(mode) }}</span>
      </button>
    </div>
    <span
      v-if="!diffActive && !historyPreviewActive && activeIsMarkdown"
      class="ml-0.5 shrink-0 font-mono text-[9px] text-ink-3 max-[760px]:hidden"
    >&#8984;E</span>
  </div>
</template>
