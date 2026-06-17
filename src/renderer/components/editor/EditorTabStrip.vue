<template>
  <div
    ref="stripEl"
    class="relative flex items-end flex-1 min-w-0 gap-0 whitespace-nowrap mt-auto"
  >
    <!-- Tabs + the new-tab button share one horizontally-scrollable row so the
         "+" trails the last tab instead of pinning to the bar's right edge. -->
    <div
      ref="scrollRef"
      @wheel="onTabWheel"
      class="etab-scroll flex-1 min-w-0 flex items-end gap-0 overflow-x-auto overflow-y-hidden"
    >
      <TransitionGroup
        :name="dragState.active ? '' : 'etabs'"
        @before-leave="onTabBeforeLeave"
        tag="div"
        class="flex items-end gap-0"
      >
        <button
          v-for="(tab, i) in tabs"
          :key="tab.id"
          class="etab group/etab no-drag min-w-[80px] h-[28px] flex items-center gap-1 px-2 rounded-t-[5px] select-none whitespace-nowrap overflow-hidden font-mono text-[11.5px] relative"
          :class="[
            activeTab === i ? 'etab-active' : 'etab-inactive',
            dragState.active && dragState.fromIndex === i ? 'etab-dragging' : '',
          ]"
          @pointerdown="onPointerDown(i, $event)"
        >
          <component
            :is="tabKindIcon(tab.kind)"
            :data-testid="`tab-kind-${tab.kind ?? 'text'}`"
            :size="13"
            :stroke-width="1.9"
            class="shrink-0 text-ink-3"
            aria-hidden="true"
          />
          <span class="flex-1 min-w-0 overflow-hidden text-ellipsis">{{ tab.name }}</span>
          <span
            v-if="isDirtyDotVisible(tab)"
            data-testid="tab-dirty-dot"
            class="w-[5px] h-[5px] rounded-full shrink-0 bg-accent group-hover/etab:hidden"
            title="Unsaved changes"
          />
          <span
            class="etab-close"
            @click.stop="$emit('close-tab', i)"
          >
            <IconX :size="12" :stroke-width="2.2" aria-hidden="true" />
          </span>
        </button>
      </TransitionGroup>

      <!-- New-tab button: opens a fresh blank document (not a launcher page). -->
      <button
        class="no-drag shrink-0 my-auto ml-1 w-[18px] h-[18px] flex items-center justify-center rounded-sm font-mono text-[18px] leading-none text-ink-3 hover:text-ink-2 hover:bg-chrome-mid"
        aria-label="New tab"
        :title="`New document (${shortcutLabel(['Mod', 'T'])})`"
        @click="$emit('add-tab')"
      >+</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, nextTick, onUnmounted } from 'vue'
import { IconFile, IconFileText, IconFileTypePdf, IconTable, IconX } from '@tabler/icons-vue'
import { shortcutLabel } from '../../services/shortcutLabels.js'

const DRAG_THRESHOLD = 5
type TabKind = 'text' | 'pdf' | 'card' | 'table'

const props = defineProps<{
  tabs: Array<{ id: string; kind?: TabKind; name: string; dirty: boolean }>
  activeTab: number
}>()

const emit = defineEmits<{
  'select-tab': [index: number]
  'close-tab': [index: number]
  'add-tab': []
  'reorder-tab': [from: number, to: number]
}>()

const stripEl = ref<HTMLElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)

const dragState = reactive({
  fromIndex: -1,
  dropTarget: -1,
  active: false,
})

let startX = 0
let startY = 0

function tabKindIcon(kind: TabKind = 'text') {
  if (kind === 'pdf') return IconFileTypePdf
  if (kind === 'card') return IconFile
  if (kind === 'table') return IconTable
  return IconFileText
}

function isDirtyDotVisible(tab: { kind?: TabKind; dirty: boolean }) {
  const kind = tab.kind ?? 'text'
  return tab.dirty && (kind === 'text' || kind === 'table')
}

function getScrollEl() {
  return scrollRef.value
}

function onTabWheel(e: WheelEvent) {
  const el = getScrollEl()
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  e.preventDefault()
  el.scrollLeft += e.deltaY
}

function onTabBeforeLeave(el: Element) {
  if (dragState.active) return
  const htmlEl = el as HTMLElement
  htmlEl.style.width = htmlEl.offsetWidth + 'px'
  htmlEl.style.flex = 'none'
  htmlEl.style.overflow = 'hidden'
}

watch(
  () => props.activeTab,
  () => {
    nextTick(() => {
      const buttons = getTabButtons()
      const active = buttons[props.activeTab]
      if (active && getScrollEl()) {
        active.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        })
      }
    })
  },
)

function getTabButtons(): HTMLElement[] {
  if (!stripEl.value) return []
  return Array.from(stripEl.value.querySelectorAll('.etab'))
}

function onPointerDown(index: number, e: PointerEvent) {
  if (e.button !== 0) return
  if ((e.target as HTMLElement).closest('.etab-close')) return

  dragState.fromIndex = index
  dragState.dropTarget = -1
  dragState.active = false
  startX = e.clientX
  startY = e.clientY

  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e: PointerEvent) {
  const dx = e.clientX - startX
  const dy = e.clientY - startY

  if (!dragState.active) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
    dragState.active = true
    document.body.style.cursor = 'grabbing'
  }

  const buttons = getTabButtons()
  let target = -1

  for (let i = 0; i < buttons.length; i++) {
    const rect = buttons[i].getBoundingClientRect()
    const mid = rect.left + rect.width / 2
    if (e.clientX < mid) {
      target = i
      break
    }
  }
  if (target === -1) target = buttons.length

  if (target === dragState.fromIndex || target === dragState.fromIndex + 1) {
    dragState.dropTarget = dragState.fromIndex
  } else {
    dragState.dropTarget = target
  }
}

function onPointerUp(_e: PointerEvent) {
  removeListeners()

  if (!dragState.active) {
    const idx = dragState.fromIndex
    resetDrag()
    emit('select-tab', idx)
    return
  }

  const from = dragState.fromIndex
  if (dragState.dropTarget >= 0) {
    let to = dragState.dropTarget
    if (from < to) to -= 1
    resetDrag()
    if (from !== to) {
      emit('reorder-tab', from, to)
    }
    return
  }

  resetDrag()
}

function removeListeners() {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
}

function resetDrag() {
  dragState.fromIndex = -1
  dragState.dropTarget = -1
  dragState.active = false
  document.body.style.cursor = ''
}

onUnmounted(() => {
  removeListeners()
  document.body.style.cursor = ''
})
</script>

<style scoped>
/* Scrollbar hiding */
.etab-scroll {
  scrollbar-width: none;
}
.etab-scroll::-webkit-scrollbar {
  display: none;
}

/* TransitionGroup: enter */
.etabs-enter-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.etabs-enter-from {
  opacity: 0;
  transform: translateX(-8px);
}

/* TransitionGroup: leave (width-collapse) */
.etabs-leave-active {
  transition: width 200ms ease, opacity 150ms ease, padding 200ms ease;
}
.etabs-leave-to {
  width: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
  opacity: 0;
}

/* Tab sizing: size to content, clamped 80-200px, so the "+" trails the last
   tab instead of being pushed to the far edge of the bar. */
.etab {
  flex: 0 0 auto;
  min-width: 80px;
  max-width: 200px;
}

/* Tab separator line */
.etab::after {
  content: '';
  position: absolute;
  right: 0;
  top: 20%;
  height: 60%;
  width: 1px;
  background: var(--color-rule-light);
}
.etab.etab-active::after,
.etab:has(+ .etab-active)::after,
.etab:hover::after,
.etab:has(+ .etab:hover)::after {
  opacity: 0;
}

/* Close button */
.etab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 2px;
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
  color: var(--color-ink-3);
  flex-shrink: 0;
  opacity: 0;
}
.etab:hover .etab-close,
.etab-active .etab-close {
  opacity: 1;
}
.etab-close:hover {
  background: var(--color-chrome-high);
  color: var(--color-ink);
}

/* Tab states */
.etab-inactive {
  color: var(--color-ink-3);
  background: transparent;
}
.etab-inactive:hover {
  color: var(--color-ink-2);
  background: var(--color-chrome-mid);
}
.etab-active {
  color: var(--color-ink);
  font-weight: 600;
  background: var(--color-surface);
}

/* Drag state */
.etab-dragging {
  flex: 0 0 0 !important;
  width: 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none;
}
</style>
