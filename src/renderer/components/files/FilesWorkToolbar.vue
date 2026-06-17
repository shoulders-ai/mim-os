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

defineExpose({
  focusSearch: () => inputRef.value?.focus(),
})
</script>

<template>
  <div
    class="grid h-[38px] min-h-[38px] grid-cols-[auto_minmax(0,1fr)_minmax(96px,180px)_auto] items-center gap-2 border-b border-rule-light bg-chrome-high px-2"
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

    <nav class="flex min-w-0 items-center gap-1 overflow-hidden font-sans text-[12px]" aria-label="File breadcrumb">
      <button
        type="button"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink disabled:opacity-35"
        :disabled="currentDir === '.'"
        title="Up"
        @click="emit('navigateUp')"
      >
        <IconArrowUp :size="13" :stroke-width="2" />
      </button>
      <template v-for="(crumb, indexCrumb) in breadcrumbItems" :key="crumb.path">
        <button
          type="button"
          class="min-w-0 shrink truncate rounded-[5px] px-1.5 py-1 text-ink-3 hover:bg-chrome-mid hover:text-ink"
          :class="indexCrumb === breadcrumbItems.length - 1 ? 'text-ink' : ''"
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

    <label class="flex h-6 min-w-0 items-center gap-1.5 rounded-[6px] border border-rule-light bg-surface px-1.5 text-ink-4 focus-within:border-accent/40">
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
</template>
