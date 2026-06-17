<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open?: boolean
    x: number
    y: number
    width?: number
    height?: number
    clamp?: boolean
    panelClass?: string
    overlayClass?: string
  }>(),
  {
    open: true,
    width: 180,
    height: 180,
    clamp: true,
    panelClass: '',
    overlayClass: '',
  },
)

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: []
}>()

const panelRef = ref<HTMLElement | null>(null)

const panelStyle = computed(() => {
  const gutter = 8
  const maxX = window.innerWidth - props.width - gutter
  const maxY = window.innerHeight - props.height - gutter
  const left = props.clamp ? Math.max(gutter, Math.min(props.x, maxX)) : props.x
  const top = props.clamp ? Math.max(gutter, Math.min(props.y, maxY)) : props.y
  return {
    left: `${left}px`,
    top: `${top}px`,
    minWidth: `${props.width}px`,
  }
})

const panelClasses = computed(() => [
  'mim-context-menu fixed z-[var(--z-popover)] rounded-[6px] border border-rule bg-surface p-1 shadow-[0_8px_30px_rgba(0,0,0,0.18)] focus:outline-none',
  props.panelClass,
])

const overlayClasses = computed(() => [
  'mim-context-menu-overlay fixed inset-0 z-[var(--z-popover)]',
  props.overlayClass,
])

function requestClose() {
  emit('update:open', false)
  emit('close')
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') requestClose()
}

async function focusPanel() {
  if (!props.open) return
  await nextTick()
  panelRef.value?.focus()
}

watch(() => props.open, () => {
  void focusPanel()
})

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown)
  void focusPanel()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      :class="overlayClasses"
      @click="requestClose"
      @contextmenu.prevent="requestClose"
    >
      <div
        ref="panelRef"
        role="menu"
        tabindex="-1"
        :class="panelClasses"
        :style="panelStyle"
        @click.stop
        @contextmenu.stop.prevent
        @keydown.stop
        @keydown.escape.prevent.stop="requestClose"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
