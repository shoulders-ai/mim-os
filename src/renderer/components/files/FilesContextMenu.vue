<script setup lang="ts">
import { computed } from 'vue'
import { defaultOpenLabelForPath, defaultOpenTargetForPath } from '../../services/fileOpenPolicy.js'
import MimContextMenu from '../ui/MimContextMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'
import type { FileRow } from './fileTypes.js'

const props = withDefaults(defineProps<{
  row: FileRow
  x: number
  y: number
  expanded: boolean
  // ≥2 switches the menu to bulk actions over the whole multi-selection.
  selectionCount?: number
}>(), {
  selectionCount: 0,
})

const emit = defineEmits<{
  close: []
  open: []
  openNative: []
  versionHistory: []
  toggleFolder: []
  newFile: []
  newFolder: []
  rename: []
  duplicate: []
  trash: []
  reveal: []
  copyPath: []
  trashSelection: []
  copySelectionPaths: []
  clearSelection: []
}>()

const isBulk = computed(() => props.selectionCount >= 2)

const isDirectory = computed(() => props.row.type === 'directory')

// PDFs, tables, and images open in Artifact by default; offer the OS app explicitly.
const showOpenNative = computed(() =>
  !isDirectory.value && ['pdf', 'table', 'image'].includes(defaultOpenTargetForPath(props.row.path)),
)

const itemCount = computed(() => {
  if (isBulk.value) return 3 // delete selection, copy paths, clear selection
  let count = 6 // open, rename, duplicate, trash, reveal, copy path
  if (isDirectory.value) count += 3 // expand/collapse, new file, new folder
  else count += 1 // version history
  if (showOpenNative.value) count += 1
  return count
})

const menuHeight = computed(() => itemCount.value * 28 + 10)
</script>

<template>
  <MimContextMenu
    :x="x"
    :y="y"
    :width="172"
    :height="menuHeight"
    panel-class="border-rule-light py-1 font-sans text-[12px] text-ink-2"
    @close="emit('close')"
  >
    <template v-if="isBulk">
      <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('trashSelection')">
        Delete {{ selectionCount }} items
      </MimMenuItem>
      <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('copySelectionPaths')">
        Copy {{ selectionCount }} paths
      </MimMenuItem>
      <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('clearSelection')">
        Clear selection
      </MimMenuItem>
    </template>
    <template v-else>
    <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('open')">
      {{ isDirectory ? 'Open folder' : defaultOpenLabelForPath(row.path) }}
    </MimMenuItem>
    <MimMenuItem
      v-if="showOpenNative"
      :headless="false"
      item-class="h-7 px-3 py-0"
      @select="emit('openNative')"
    >
      Open in default app
    </MimMenuItem>
    <MimMenuItem
      v-if="!isDirectory"
      :headless="false"
      item-class="h-7 px-3 py-0"
      @select="emit('versionHistory')"
    >
      Version history...
    </MimMenuItem>
    <MimMenuItem
      v-if="isDirectory"
      :headless="false"
      item-class="h-7 px-3 py-0"
      @select="emit('toggleFolder')"
    >
      {{ expanded ? 'Collapse' : 'Expand' }}
    </MimMenuItem>
    <MimMenuItem
      v-if="isDirectory"
      :headless="false"
      item-class="h-7 px-3 py-0"
      @select="emit('newFile')"
    >
      New file inside
    </MimMenuItem>
    <MimMenuItem
      v-if="isDirectory"
      :headless="false"
      item-class="h-7 px-3 py-0"
      @select="emit('newFolder')"
    >
      New folder inside
    </MimMenuItem>
    <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('rename')">
      Rename
    </MimMenuItem>
    <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('duplicate')">
      Duplicate
    </MimMenuItem>
    <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('trash')">
      Delete
    </MimMenuItem>
    <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('reveal')">
      Reveal in Finder
    </MimMenuItem>
    <MimMenuItem :headless="false" item-class="h-7 px-3 py-0" @select="emit('copyPath')">
      Copy path
    </MimMenuItem>
    </template>
  </MimContextMenu>
</template>
