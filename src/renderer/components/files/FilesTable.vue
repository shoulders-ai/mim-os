<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  IconAlertCircle,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolders,
} from '@tabler/icons-vue'
import {
  WORKSPACE_DRAG_MIME,
  encodeWorkspaceDragPayload,
  isWorkspaceDragRow,
  isWorkspaceDropDir,
  parseWorkspaceDragPayload,
  buildWorkspaceMovePlan,
  type WorkspaceDragItem,
  type WorkspaceDragPayload,
} from './fileMove.js'
import {
  formatSize,
  formatTime,
  highlight,
  highlightQueryText,
  locationLabel,
  rowTitle,
} from './fileDisplay.js'
import type { FileRow, SortDirection, SortKey, TableMode } from './fileTypes.js'

const props = withDefaults(defineProps<{
  rows: FileRow[]
  tableMode: TableMode
  showLocationColumn: boolean
  showChangedByColumn?: boolean
  selectedIndex: number
  query: string
  activeFilePath?: string
  emptyText: string
  directoryError: string
  sortKey: SortKey
  sortDirection: SortDirection
  expandedPaths: Set<string>
  expandedLoading: Set<string>
  selectedPaths: Set<string>
}>(), {
  showChangedByColumn: false,
})

const emit = defineEmits<{
  setSort: [key: SortKey]
  rowClick: [row: FileRow, event: MouseEvent]
  rowMouseenter: [index: number]
  rowDblclick: [row: FileRow, event: MouseEvent]
  rowContextmenu: [row: FileRow, event: MouseEvent]
  emptyContextmenu: [event: MouseEvent]
  dropExternal: [files: File[], targetDir: string | null]
  dropWorkspace: [source: WorkspaceDragPayload, targetDir: string | null]
  scrollToTeam: [event: MouseEvent]
}>()

// Right-click on the scroll pane outside any row (rows stop propagation by
// preventing default first in their own handler upstream).
function onContainerContextmenu(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-testid="files-row"], [data-testid="files-team-header"]')) return
  emit('emptyContextmenu', event)
}

// ── External drag-drop (files from the OS) ──

const dragDepth = ref(0)
const dropTargetDir = ref<string | null>(null)
const dragKind = ref<'external' | 'workspace' | null>(null)
const draggedWorkspaceRow = ref<WorkspaceDragPayload | null>(null)

function hasExternalFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  return !!types && Array.from(types).includes('Files')
}

function hasWorkspaceDrag(event: DragEvent): boolean {
  const types = event.dataTransfer?.types
  return !!types && Array.from(types).includes(WORKSPACE_DRAG_MIME)
}

function eventDragKind(event: DragEvent): 'external' | 'workspace' | null {
  if (hasExternalFiles(event)) return 'external'
  if (hasWorkspaceDrag(event)) return 'workspace'
  return null
}

function onZoneDragenter(event: DragEvent) {
  const kind = eventDragKind(event)
  if (!kind) return
  event.preventDefault()
  dragKind.value = kind
  dragDepth.value++
}

function onZoneDragover(event: DragEvent) {
  const kind = eventDragKind(event)
  if (!kind) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = kind === 'workspace' ? 'move' : 'copy'
  dragKind.value = kind
  dropTargetDir.value = null
}

function onZoneDragleave(event: DragEvent) {
  if (!eventDragKind(event)) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) resetDragState()
}

function onZoneDrop(event: DragEvent) {
  const kind = eventDragKind(event)
  if (!kind) return
  event.preventDefault()
  if (kind === 'external') emitExternalDrop(event, null)
  else emitWorkspaceDrop(event, null)
}

function onRowDragover(row: FileRow, event: DragEvent) {
  if (hasExternalFiles(event)) {
    if (!isWorkspaceDropDir(row)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer!.dropEffect = 'copy'
    dragKind.value = 'external'
    dropTargetDir.value = row.path
    return
  }
  if (!hasWorkspaceDrag(event)) return
  event.stopPropagation()
  if (!isWorkspaceDropDir(row)) return
  const source = workspacePayloadFromEvent(event)
  if (!source || !canDropWorkspaceItems(source, row.path)) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
  dragKind.value = 'workspace'
  dropTargetDir.value = row.path
}

// A multi-item drop is offered as long as at least one item can move; the
// parent skips the rest per item.
function canDropWorkspaceItems(source: WorkspaceDragPayload, targetDir: string): boolean {
  return source.items.some(item => buildWorkspaceMovePlan(item, targetDir).ok)
}

function onRowDrop(row: FileRow, event: DragEvent) {
  if (hasExternalFiles(event)) {
    if (!isWorkspaceDropDir(row)) return
    event.preventDefault()
    event.stopPropagation()
    emitExternalDrop(event, row.path)
    return
  }
  if (!hasWorkspaceDrag(event)) return
  event.stopPropagation()
  if (!isWorkspaceDropDir(row)) return
  const source = workspacePayloadFromEvent(event)
  if (!source || !canDropWorkspaceItems(source, row.path)) return
  event.preventDefault()
  emitWorkspaceDrop(event, row.path)
}

function emitExternalDrop(event: DragEvent, targetDir: string | null) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  resetDragState()
  if (files.length) emit('dropExternal', files, targetDir)
}

function emitWorkspaceDrop(event: DragEvent, targetDir: string | null) {
  const source = workspacePayloadFromEvent(event)
  resetDragState()
  if (source) emit('dropWorkspace', source, targetDir)
}

// Dragging a row that is part of a multi-selection carries the whole
// selection; a row outside it drags alone.
function dragItemsFor(row: FileRow): WorkspaceDragItem[] {
  if (props.selectedPaths.has(row.path) && props.selectedPaths.size > 1) {
    const items = props.rows
      .filter(item => props.selectedPaths.has(item.path) && isWorkspaceDragRow(item))
      .map(item => ({ path: item.path, type: item.type }))
    if (items.length) return items
  }
  return [{ path: row.path, type: row.type }]
}

function onRowDragstart(row: FileRow, event: DragEvent) {
  if (!isWorkspaceDragRow(row) || !event.dataTransfer) {
    event.preventDefault()
    return
  }
  const payload = { items: dragItemsFor(row) }
  draggedWorkspaceRow.value = payload
  dragKind.value = 'workspace'
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(WORKSPACE_DRAG_MIME, encodeWorkspaceDragPayload(payload.items))
  event.dataTransfer.setData('text/plain', payload.items.map(item => item.path).join('\n'))
}

function onRowDragend() {
  resetDragState()
}

function workspacePayloadFromEvent(event: DragEvent): WorkspaceDragPayload | null {
  const encoded = event.dataTransfer?.getData(WORKSPACE_DRAG_MIME) ?? ''
  return parseWorkspaceDragPayload(encoded) ?? draggedWorkspaceRow.value
}

function resetDragState() {
  dragDepth.value = 0
  dropTargetDir.value = null
  dragKind.value = null
  draggedWorkspaceRow.value = null
}

const overlayText = computed(() => {
  if (dragKind.value === 'workspace') {
    return dropTargetDir.value ? `Drop to move into ${dropTargetDir.value}` : 'Drop to move here'
  }
  return dropTargetDir.value ? `Drop to import into ${dropTargetDir.value}` : 'Drop to import'
})

const gridClass = 'grid-cols-[minmax(0,2fr)_minmax(0,0.62fr)_minmax(38px,0.3fr)_minmax(52px,0.42fr)_minmax(52px,0.42fr)]'

function sortIndicator(key: SortKey): string {
  if (props.sortKey !== key) return ''
  return props.sortDirection === 'asc' ? '↑' : '↓'
}

const levelPaddingClasses = ['', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20', 'pl-24', 'pl-28', 'pl-32'] as const

function levelPaddingClass(level: number): string {
  return levelPaddingClasses[Math.min(Math.max(0, level), levelPaddingClasses.length - 1)]
}

function isActiveFile(row: FileRow): boolean {
  return row.type === 'file' && !!props.activeFilePath && row.path === props.activeFilePath
}

function fileIconClass(row: FileRow): string {
  return isActiveFile(row) ? 'shrink-0 text-accent' : 'shrink-0 text-ink-3'
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
      data-testid="files-column-header"
      class="sticky top-0 z-10 grid h-8 items-center gap-2 border-b border-rule-light bg-surface px-3 font-sans text-[10px] font-[650] uppercase tracking-normal text-ink-4"
      :class="gridClass"
    >
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'name')">Name {{ sortIndicator('name') }}</button>
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'kindOrLocation')">
        {{ showChangedByColumn ? 'Changed by' : showLocationColumn ? 'Location' : 'Kind' }} {{ sortIndicator('kindOrLocation') }}
      </button>
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'size')">Size {{ sortIndicator('size') }}</button>
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'modifiedAt')">Modified {{ sortIndicator('modifiedAt') }}</button>
      <button type="button" class="truncate text-left hover:text-ink" @click="emit('setSort', 'createdAt')">Created {{ sortIndicator('createdAt') }}</button>
    </div>

    <template v-for="row in rows" :key="`${tableMode}:${row.path}`">
      <button
        v-if="row.sectionLabel"
        type="button"
        data-testid="files-team-header"
        class="sticky bottom-0 z-10 flex h-7 w-full items-center gap-1.5 border-y border-rule-light/70 bg-chrome-high px-3 text-left font-sans text-[10px] font-[650] uppercase tracking-normal text-ink-4 hover:bg-chrome-mid hover:text-ink-2"
        title="Scroll to Team Files"
        @click="emit('scrollToTeam', $event)"
      >
        <IconFolders :size="12" :stroke-width="2" class="shrink-0" />
        <span>{{ row.sectionLabel }}</span>
      </button>
      <button
        type="button"
        data-testid="files-row"
        :data-active-file="isActiveFile(row) ? 'true' : undefined"
        :data-selected="selectedPaths.has(row.path) ? 'true' : undefined"
        :aria-current="isActiveFile(row) ? 'true' : undefined"
        :aria-selected="selectedPaths.has(row.path) ? 'true' : undefined"
        class="grid w-full items-center gap-2 border-b border-rule-light/70 px-3 text-left font-sans text-[12px] text-ink-2"
        :class="[gridClass, row.searchSnippet ? 'h-[44px]' : 'h-[34px]', selectedPaths.has(row.path) || row.gi === selectedIndex || dropTargetDir === row.path ? 'bg-accent-tint text-ink' : '', row.disabled ? 'opacity-55' : 'hover:bg-chrome-high hover:text-ink']"
        :disabled="row.disabled"
        :draggable="isWorkspaceDragRow(row)"
        :title="rowTitle(row)"
        @click="emit('rowClick', row, $event)"
        @mouseenter="emit('rowMouseenter', row.gi)"
        @dblclick="emit('rowDblclick', row, $event)"
        @contextmenu="emit('rowContextmenu', row, $event)"
        @dragstart="onRowDragstart(row, $event)"
        @dragend="onRowDragend"
        @dragover="onRowDragover(row, $event)"
        @drop="onRowDrop(row, $event)"
      >
        <span class="flex min-w-0 items-center gap-1.5" :class="levelPaddingClass(row.level)">
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
            data-testid="files-row-kind-icon"
            :size="15"
            :stroke-width="1.9"
            :class="fileIconClass(row)"
          />
          <IconFile
            v-else
            data-testid="files-row-kind-icon"
            :size="15"
            :stroke-width="1.9"
            :class="fileIconClass(row)"
          />
          <span class="min-w-0 truncate leading-tight">
            <span
              data-testid="files-row-name"
              class="block truncate"
              :class="isActiveFile(row) ? 'font-[650] text-ink' : ''"
            >
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
        </span>
        <span class="min-w-0 truncate font-mono text-[10px] text-ink-3">
          {{ showChangedByColumn ? (row.lastChangedBy || 'Unknown') : locationLabel(row, showLocationColumn) }}
        </span>
        <span class="truncate font-mono text-[10px] text-ink-3">{{ formatSize(row.size, row.type) }}</span>
        <span class="truncate font-mono text-[10px] text-ink-3">{{ formatTime(row.modifiedAt) }}</span>
        <span class="truncate font-mono text-[10px] text-ink-3">{{ showChangedByColumn ? row.changeSummary : formatTime(row.createdAt) }}</span>
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
      {{ overlayText }}
    </span>
  </div>
  </div>
</template>
