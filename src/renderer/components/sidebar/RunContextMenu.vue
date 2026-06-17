<script setup lang="ts">
// Context menu for run Activity rows (package runs and agent sessions).
// Mirrors SessionContextMenu (sessions add Export; runs do not have a
// portable file format yet). Agent sessions add Stop while running and lose
// Delete until they end — a running session must be stopped first.
import { onMounted, onUnmounted } from 'vue'

withDefaults(defineProps<{
  x: number
  y: number
  canStop?: boolean
  canDelete?: boolean
}>(), {
  canStop: false,
  canDelete: true,
})

const emit = defineEmits<{
  close: []
  rename: []
  stop: []
  archive: []
  delete: []
}>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[200]"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        class="fixed z-[201] min-w-[160px] rounded-[6px] border border-rule bg-surface p-1 shadow-lg"
        :style="{ left: x + 'px', top: y + 'px' }"
        @click.stop
      >
        <button
          data-testid="run-context-rename"
          class="flex w-full items-center gap-2 rounded px-[10px] py-[6px] text-left font-sans text-xs text-ink-2 hover:bg-chrome-high hover:text-ink"
          @click="emit('rename')"
        >
          <span>Rename</span>
        </button>
        <button
          v-if="canStop"
          data-testid="run-context-stop"
          class="flex w-full items-center gap-2 rounded px-[10px] py-[6px] text-left font-sans text-xs text-rem hover:bg-rem/8"
          @click="emit('stop')"
        >
          <span>Stop</span>
        </button>
        <button
          data-testid="run-context-archive"
          class="flex w-full items-center gap-2 rounded px-[10px] py-[6px] text-left font-sans text-xs text-ink-2 hover:bg-chrome-high hover:text-ink"
          @click="emit('archive')"
        >
          <span>Archive</span>
        </button>
        <button
          v-if="canDelete"
          data-testid="run-context-delete"
          class="flex w-full items-center gap-2 rounded px-[10px] py-[6px] text-left font-sans text-xs text-rem hover:bg-rem/8"
          @click="emit('delete')"
        >
          <span>Delete</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>
