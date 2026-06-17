<script setup lang="ts">
// Context menu for a multi-selected set of Activity rows. Only batch verbs
// live here; single-row actions (rename, export) stay in the per-kind menus.
import MimContextMenu from '../ui/MimContextMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'

const props = defineProps<{
  x: number
  y: number
  count: number
}>()

const emit = defineEmits<{
  close: []
  archive: []
  delete: []
}>()
</script>

<template>
  <MimContextMenu
    :x="x"
    :y="y"
    :width="190"
    :height="80"
    panel-class="ctx-menu"
    @close="emit('close')"
  >
    <MimMenuItem :headless="false" item-class="px-[10px] py-[6px] text-xs" data-testid="batch-archive" @select="emit('archive')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="20" height="5" x="2" y="3" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
        <path d="M10 12h4" />
      </svg>
      <span>Archive {{ count }} items</span>
    </MimMenuItem>
    <MimMenuItem :headless="false" danger item-class="px-[10px] py-[6px] text-xs" data-testid="batch-delete" @select="emit('delete')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      </svg>
      <span>Delete {{ count }} items</span>
    </MimMenuItem>
  </MimContextMenu>
</template>
