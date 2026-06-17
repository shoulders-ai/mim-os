<script setup lang="ts">
import MimContextMenu from '../ui/MimContextMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'

const props = defineProps<{
  x: number
  y: number
}>()

const emit = defineEmits<{
  close: []
  rename: []
  export: []
  archive: []
  delete: []
}>()
</script>

<template>
  <MimContextMenu
    :x="x"
    :y="y"
    :width="190"
    :height="180"
    panel-class="ctx-menu"
    @close="emit('close')"
  >
    <MimMenuItem :headless="false" item-class="px-[10px] py-[6px] text-xs" @select="emit('rename')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </svg>
      <span>Rename</span>
    </MimMenuItem>
    <MimMenuItem :headless="false" item-class="px-[10px] py-[6px] text-xs" @select="emit('export')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>Export</span>
    </MimMenuItem>
    <div class="h-px bg-rule-light my-[3px] mx-1" />
    <MimMenuItem :headless="false" item-class="px-[10px] py-[6px] text-xs" @select="emit('archive')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="20" height="5" x="2" y="3" rx="1" />
        <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
        <path d="M10 12h4" />
      </svg>
      <span>Archive</span>
    </MimMenuItem>
    <MimMenuItem :headless="false" danger item-class="px-[10px] py-[6px] text-xs" @select="emit('delete')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      </svg>
      <span>Delete</span>
    </MimMenuItem>
  </MimContextMenu>
</template>
