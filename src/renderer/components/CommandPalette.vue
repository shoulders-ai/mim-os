<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import MimDialog from './ui/MimDialog.vue'
import {
  rankPaletteItems,
  coreActions,
  coreSurfaces,
  type PaletteItem,
  type RankedPaletteItem,
} from '../services/commandPalette.js'

const props = defineProps<{
  files: Array<{ path: string; name: string }>
  sessions: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{
  close: []
  select: [id: string]
}>()

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)

// Build the full item set from static items + dynamic files/sessions.
const allItems = computed<PaletteItem[]>(() => {
  const items: PaletteItem[] = [
    ...coreSurfaces(),
    ...coreActions(),
  ]
  for (const session of props.sessions) {
    items.push({
      id: `session:${session.id}`,
      kind: 'session',
      label: session.label || 'Untitled chat',
      hint: 'Chat',
    })
  }
  for (const file of props.files) {
    items.push({
      id: `file:${file.path}`,
      kind: 'file',
      label: file.name,
      hint: file.path,
    })
  }
  return items
})

const ranked = computed<RankedPaletteItem[]>(() =>
  rankPaletteItems(query.value, allItems.value, 50)
)

// Reset selection when query changes.
watch(query, () => { selectedIndex.value = 0 })

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, ranked.value.length - 1)
    scrollToSelected()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollToSelected()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = ranked.value[selectedIndex.value]
    if (item) {
      emit('select', item.item.id)
      emit('close')
    }
  }
}

function scrollToSelected() {
  nextTick(() => {
    const el = listRef.value?.querySelector('[data-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function selectItem(index: number) {
  const item = ranked.value[index]
  if (item) {
    emit('select', item.item.id)
    emit('close')
  }
}

onMounted(() => {
  nextTick(() => inputRef.value?.focus())
})
</script>

<template>
  <MimDialog
    size="sm"
    align="top"
    top-class="pt-[min(20vh,120px)]"
    @close="$emit('close')"
  >
    <div class="flex flex-col" @keydown="handleKeydown">
      <div class="flex items-center border-b border-rule-light px-3">
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          class="h-10 w-full border-0 bg-transparent font-sans text-[13px] text-ink placeholder:text-ink-4 focus:outline-none"
          placeholder="Search files, chats, and actions..."
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </div>
      <div
        ref="listRef"
        class="max-h-[min(50vh,360px)] overflow-y-auto overscroll-contain py-1"
      >
        <div
          v-if="ranked.length === 0"
          class="px-3 py-6 text-center font-sans text-xs text-ink-4"
        >
          No results
        </div>
        <button
          v-for="(result, i) in ranked"
          :key="result.item.id"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 font-sans text-xs text-ink-2"
          :class="i === selectedIndex ? 'bg-accent-soft text-ink' : 'hover:bg-chrome-mid'"
          :data-selected="i === selectedIndex"
          @click="selectItem(i)"
          @mouseenter="selectedIndex = i"
        >
          <span
            class="min-w-0 flex-1 truncate text-left"
            :class="i === selectedIndex ? 'text-ink' : ''"
          >{{ result.item.label }}</span>
          <span
            v-if="result.item.hint"
            class="shrink-0 font-mono text-[10px] text-ink-4"
          >{{ result.item.hint }}</span>
          <span
            class="shrink-0 rounded-sm px-1 font-mono text-[9px] uppercase"
            :class="
              result.item.kind === 'surface' ? 'bg-chrome text-ink-3' :
              result.item.kind === 'action' ? 'bg-chrome text-ink-3' :
              result.item.kind === 'session' ? 'text-ink-4' :
              'text-ink-4'
            "
          >{{ result.item.kind === 'file' ? '' : result.item.kind }}</span>
        </button>
      </div>
    </div>
  </MimDialog>
</template>
