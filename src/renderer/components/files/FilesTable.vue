<script setup lang="ts">
import { ref } from 'vue'
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolders,
  IconLock,
} from '@tabler/icons-vue'
import {
  formatSize,
  formatTime,
  highlight,
  highlightQueryText,
  locationLabel,
  rowTitle,
} from './fileDisplay.js'
import type { FileRow, SortDirection, SortKey, TableMode } from './fileTypes.js'

const props = defineProps<{
  rows: FileRow[]
  tableMode: TableMode
  showLocationColumn: boolean
  selectedIndex: number
  query: string
  resourceRootCount: number
  emptyText: string
  directoryError: string
  sortKey: SortKey
  sortDirection: SortDirection
  expandedPaths: Set<string>
  expandedLoading: Set<string>
}>()

const emit = defineEmits<{
  setSort: [key: SortKey]
  rowClick: [row: FileRow]
  rowMouseenter: [index: number]
  rowDblclick: [row: FileRow]
  rowContextmenu: [row: FileRow, event: MouseEvent]
  emptyContextmenu: [event: MouseEvent]
  dropExternal: [files: File[], targetDir: string | null]
  scrollToResources: [event: MouseEvent]
}>()

// Right-click on the scroll pane outside any row (rows stop propagation by
// preventing default first in their own handler upstream).
function onContainerContextmenu(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-testid="files-row"], [data-testid="files-resources-header"]')) return
  emit('emptyContextmenu', event)
}

// ── External drag-drop (files from the OS) ──

const dragDepth = ref(0)
const dropTargetDir = ref<string | null>(null)

function hasExternalFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

// Resource mounts are managed (and usually readonly); they are not drop targets.
function isDropDir(row: FileRow): boolean {
  return row.type === 'directory'
    && !row.disabled
    && !row.collection
    && !row.path.startsWith('.mim/')
}

function onZoneDragenter(event: DragEvent) {
  if (!hasExternalFiles(event)) return
  event.preventDefault()
  dragDepth.value++
}

function onZoneDragover(event: DragEvent) {
  if (!hasExternalFiles(event)) return
  event.preventDefault()
  dropTargetDir.value = null
}

function onZoneDragleave(event: DragEvent) {
  if (!hasExternalFiles(event)) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) dropTargetDir.value = null
}

function onZoneDrop(event: DragEvent) {
  if (!hasExternalFiles(event)) return
  event.preventDefault()
  emitDrop(event, null)
}

function onRowDragover(row: FileRow, event: DragEvent) {
  if (!hasExternalFiles(event) || !isDropDir(row)) return
  event.preventDefault()
  event.stopPropagation()
  dropTargetDir.value = row.path
}

function onRowDrop(row: FileRow, event: DragEvent) {
  if (!hasExternalFiles(event) || !isDropDir(row)) return
  event.preventDefault()
  event.stopPropagation()
  emitDrop(event, row.path)
}

function emitDrop(event: DragEvent, targetDir: string | null) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  dragDepth.value = 0
  dropTargetDir.value = null
  if (files.length) emit('dropExternal', files, targetDir)
}

const gridClass = 'grid-cols-[minmax(0,1.34fr)_minmax(0,0.7fr)_minmax(42px,0.42fr)_minmax(58px,0.56fr)_minmax(58px,0.56fr)]'

function sortIndicator(key: SortKey): string {
  if (props.sortKey !== key) return ''
  return props.sortDirection === 'asc' ? '↑' : '↓'
}
</script>

<template>
  <div
    class="relative flex min-h-0 flex-1 flex-col"
    data-testid="files-drop-zone"
    @dragenter="onZoneDragenter"
    @dragover="onZoneDragover"
    @dragleave="onZoneDragleave"
    @drop="onZoneDrop"
  >
  <div
    class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface"
    @contextmenu="onContainerContextmenu"
  >
    <div
      class="grid h-8 items-center gap-2 border-b border-rule-light px-3 font-sans text-[10px] font-[650] uppercase tracking-normal text-ink-4"
      :class="gridClass"
    >
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'name')">Name {{ sortIndicator('name') }}</button>
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'kindOrLocation')">
        {{ showLocationColumn ? 'Location' : 'Kind' }} {{ sortIndicator('kindOrLocation') }}
      </button>
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'size')">Size {{ sortIndicator('size') }}</button>
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'modifiedAt')">Modified {{ sortIndicator('modifiedAt') }}</button>
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'createdAt')">Created {{ sortIndicator('createdAt') }}</button>
    </div>

    <template v-for="row in rows" :key="`${tableMode}:${row.path}`">
      <button
        v-if="row.sectionLabel"
        type="button"
        data-testid="files-resources-header"
        class="sticky bottom-0 z-10 flex h-7 w-full items-center gap-1.5 border-y border-rule-light/70 bg-chrome-high px-3 text-left font-sans text-[10px] font-[650] uppercase tracking-normal text-ink-4 hover:text-ink-2"
        title="Scroll to shared resources"
        @click="emit('scrollToResources', $event)"
      >
        <IconFolders :size="12" :stroke-width="2" class="shrink-0" />
        <span>{{ row.sectionLabel }}</span>
        <span class="inline-flex h-4 items-center rounded-full bg-chrome-mid px-1.5 font-semibold text-ink-4">{{ resourceRootCount }}</span>
      </button>
      <button
        type="button"
        data-testid="files-row"
        class="grid w-full items-center gap-2 border-b border-rule-light/70 px-3 text-left font-sans text-[12px] text-ink-2"
        :class="[gridClass, row.searchSnippet ? 'h-[44px]' : 'h-[34px]', row.gi === selectedIndex || dropTargetDir === row.path ? 'bg-accent-tint text-ink' : '', row.disabled ? 'opacity-55' : 'hover:bg-chrome-high hover:text-ink']"
        :disabled="row.disabled"
        :title="rowTitle(row)"
        @click="emit('rowClick', row)"
        @mouseenter="emit('rowMouseenter', row.gi)"
        @dblclick="emit('rowDblclick', row)"
        @contextmenu="emit('rowContextmenu', row, $event)"
        @dragover="onRowDragover(row, $event)"
        @drop="onRowDrop(row, $event)"
      >
        <span class="flex min-w-0 items-center gap-1.5" :class="row.level > 0 ? 'pl-4' : ''">
          <IconChevronDown
            v-if="row.type === 'directory' && expandedPaths.has(row.path)"
            :size="12"
            :stroke-width="2"
            class="shrink-0 text-ink-4"
          />
          <IconChevronRight
            v-else-if="row.type === 'directory'"
            :size="12"
            :stroke-width="2"
            class="shrink-0 text-ink-4"
          />
          <span v-else class="w-3 shrink-0" />
          <IconFolder
            v-if="row.type === 'directory'"
            :size="15"
            :stroke-width="1.9"
            class="shrink-0 text-ink-3"
          />
          <IconFileText
            v-else-if="row.kind === 'Markdown' || row.kind === 'Text'"
            :size="15"
            :stroke-width="1.9"
            class="shrink-0 text-ink-3"
          />
          <IconFile
            v-else
            :size="15"
            :stroke-width="1.9"
            class="shrink-0 text-ink-3"
          />
          <IconLock
            v-if="row.readonly"
            :size="11"
            :stroke-width="2"
            class="shrink-0 text-ink-4"
            title="Read-only resource"
          />
          <span class="min-w-0 truncate leading-tight">
            <span class="block truncate">
              <template v-for="(part, indexPart) in highlight(row.name, row.positions)" :key="indexPart">
                <span :class="part.hl ? 'font-[700] text-accent' : ''">{{ part.text }}</span>
              </template>
            </span>
            <span v-if="row.searchSnippet" class="block truncate font-mono text-[10px] text-ink-4">
              <template v-for="(part, snippetPart) in highlightQueryText(row.searchSnippet, query)" :key="snippetPart">
                <mark v-if="part.hl" class="bg-accent-tint px-0.5 text-accent">{{ part.text }}</mark>
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
            <span v-if="expandedLoading.has(row.path)" class="pl-1 text-ink-4">...</span>
          </span>
          <span
            v-if="row.statusLabel"
            class="inline-flex h-4 shrink-0 items-center rounded-full bg-chrome-mid px-1.5 font-sans text-[9px] font-semibold text-ink-3"
            title="Configure in Settings -> Resources"
          >{{ row.statusLabel }}</span>
        </span>
        <span class="min-w-0 truncate font-mono text-[10px] text-ink-3">
          {{ locationLabel(row, showLocationColumn) }}
        </span>
        <span class="truncate font-mono text-[10px] text-ink-3">{{ formatSize(row.size, row.type) }}</span>
        <span class="truncate font-mono text-[10px] text-ink-3">{{ formatTime(row.modifiedAt) }}</span>
        <span class="truncate font-mono text-[10px] text-ink-3">{{ formatTime(row.createdAt) }}</span>
      </button>
    </template>

    <div
      v-if="!rows.length"
      class="flex h-28 items-center justify-center px-4 font-sans text-[12px] text-ink-3"
    >
      {{ emptyText }}
    </div>

    <div
      v-if="directoryError"
      class="mx-3 mt-3 flex items-center gap-2 rounded-[6px] border border-rule-light bg-chrome-high px-3 py-2 font-sans text-[12px] text-rem"
    >
      <IconAlertCircle :size="14" :stroke-width="2" />
      <span class="min-w-0 truncate">{{ directoryError }}</span>
    </div>
  </div>

  <div
    v-if="dragDepth > 0"
    class="pointer-events-none absolute inset-1 z-20 flex items-end justify-center rounded-[6px] border-2 border-dashed border-accent bg-accent-soft pb-5"
  >
    <span class="rounded-full bg-accent px-3 py-1 font-sans text-[11px] font-medium text-accent-ink shadow-md">
      {{ dropTargetDir ? `Drop to import into ${dropTargetDir}` : 'Drop to import' }}
    </span>
  </div>
  </div>
</template>
