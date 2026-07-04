<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  IconArrowUp,
  IconChevronRight,
  IconClock,
  IconDots,
  IconFilePlus,
  IconFolderOpen,
  IconFolderPlus,
  IconHistory,
  IconList,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-vue'
import MimMenu from '../ui/MimMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'
import type { BreadcrumbItem, Mode, TableMode } from './fileTypes.js'

const props = defineProps<{
  tableMode: TableMode
  currentDir: string
  breadcrumbItems: BreadcrumbItem[]
  query: string
  contentSearchLoading: boolean
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  setMode: [mode: Mode]
  navigateTo: [path: string]
  navigateUp: []
  refresh: []
  newDraft: []
  newFile: []
  newFolder: []
  openFileDialog: []
  searchKeydown: [event: KeyboardEvent]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
const searchValue = computed({
  get: () => props.query,
  set: value => emit('update:query', value),
})

// The path bar shows breadcrumbs only while browsing; the other table modes
// list workspace-wide results where a directory path would be misleading.
const modeLabel = computed(() => {
  if (props.tableMode === 'recent') return 'Recent files'
  if (props.tableMode === 'changed') return 'Recently changed'
  if (props.tableMode === 'search') return 'Search results'
  return ''
})

defineExpose({
  focusSearch: () => inputRef.value?.focus(),
})
</script>

<template>
  <div
    class="flex h-[38px] min-h-[38px] items-center gap-2 border-b border-rule-light bg-chrome-high px-2"
    data-testid="files-browser-bar"
  >
    <div class="flex h-6 shrink-0 items-center rounded-[6px] border border-rule-light bg-chrome p-0.5" aria-label="Files view">
      <button
        type="button"
        class="flex h-[18px] w-6 items-center justify-center rounded-[4px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        :class="tableMode === 'browse' ? 'bg-surface text-ink' : ''"
        aria-label="Browse"
        title="Browse"
        @click="emit('setMode', 'browse')"
      >
        <IconList :size="13" :stroke-width="2" />
      </button>
      <button
        type="button"
        class="flex h-[18px] w-6 items-center justify-center rounded-[4px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        :class="tableMode === 'recent' ? 'bg-surface text-ink' : ''"
        aria-label="Recent"
        title="Recent"
        @click="emit('setMode', 'recent')"
      >
        <IconHistory :size="13" :stroke-width="2" />
      </button>
      <button
        type="button"
        class="flex h-[18px] w-6 items-center justify-center rounded-[4px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        :class="tableMode === 'changed' ? 'bg-surface text-ink' : ''"
        aria-label="Changed"
        title="Changed"
        @click="emit('setMode', 'changed')"
      >
        <IconClock :size="13" :stroke-width="2" />
      </button>
    </div>

    <label class="ml-auto flex h-6 w-full min-w-0 max-w-[240px] items-center gap-1.5 rounded-[6px] border border-rule-light bg-surface px-1.5 text-ink-4 focus-within:border-accent/40">
      <IconSearch :size="13" :stroke-width="2" class="shrink-0" />
      <input
        ref="inputRef"
        v-model="searchValue"
        type="text"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="Search files"
        class="min-w-0 flex-1 bg-transparent font-sans text-[11px] text-ink outline-none placeholder:text-ink-4"
        @keydown="emit('searchKeydown', $event)"
      >
      <span v-if="contentSearchLoading && tableMode === 'search'" class="shrink-0 font-mono text-[9px] text-ink-4">
        Searching
      </span>
    </label>

    <div class="relative flex shrink-0 items-center gap-1">
      <button
        type="button"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        aria-label="Refresh files"
        title="Refresh files"
        @click="emit('refresh')"
      >
        <IconRefresh :size="13" :stroke-width="2" />
      </button>
      <MimMenu
        aria-label="More file actions"
        title="More file actions"
        placement="bottom-end"
        trigger-class="h-6 w-6 shrink-0 justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        items-class="min-w-[148px] border-rule-light py-1 font-sans text-[12px] text-ink-2"
      >
        <template #trigger>
          <IconDots :size="14" :stroke-width="2" />
        </template>
        <MimMenuItem item-class="h-7 px-3 py-0" @select="emit('newDraft')">
          <IconFilePlus :size="13" :stroke-width="2" class="shrink-0 text-ink-3" />
          <span>New draft</span>
        </MimMenuItem>
        <MimMenuItem item-class="h-7 px-3 py-0" @select="emit('newFile')">
          <IconFilePlus :size="13" :stroke-width="2" class="shrink-0 text-ink-3" />
          <span>New file here...</span>
        </MimMenuItem>
        <MimMenuItem item-class="h-7 px-3 py-0" @select="emit('newFolder')">
          <IconFolderPlus :size="13" :stroke-width="2" class="shrink-0 text-ink-3" />
          <span>New folder here...</span>
        </MimMenuItem>
        <MimMenuItem item-class="h-7 px-3 py-0" @select="emit('openFileDialog')">
          <IconFolderOpen :size="13" :stroke-width="2" class="shrink-0 text-ink-3" />
          <span>Open file...</span>
        </MimMenuItem>
      </MimMenu>
    </div>
  </div>

  <div
    class="flex h-7 min-h-7 items-center gap-1 border-b border-rule-light bg-chrome-high px-2 font-sans text-[12px]"
    data-testid="files-path-bar"
  >
    <template v-if="tableMode === 'browse'">
      <button
        type="button"
        class="flex h-[22px] w-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
        :disabled="currentDir === '.'"
        aria-label="Up one folder"
        title="Up one folder"
        @click="emit('navigateUp')"
      >
        <IconArrowUp :size="13" :stroke-width="2" />
      </button>
      <nav class="flex min-w-0 items-center gap-0.5 overflow-hidden" aria-label="File breadcrumb">
        <template v-for="(crumb, indexCrumb) in breadcrumbItems" :key="crumb.path">
          <button
            type="button"
            class="min-w-0 shrink truncate rounded-[5px] px-1.5 py-0.5 hover:bg-chrome-mid hover:text-ink"
            :class="indexCrumb === breadcrumbItems.length - 1 ? 'font-medium text-ink' : 'text-ink-3'"
            @click="emit('navigateTo', crumb.path)"
          >
            {{ crumb.label }}
          </button>
          <IconChevronRight
            v-if="indexCrumb < breadcrumbItems.length - 1"
            :size="12"
            :stroke-width="2"
            class="shrink-0 text-ink-4"
          />
        </template>
      </nav>
    </template>
    <span v-else class="truncate px-1.5 text-ink-3">{{ modeLabel }}</span>
  </div>
</template>
