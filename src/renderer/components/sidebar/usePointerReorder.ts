// Pointer-based row reorder shared by the Navigator's Work and Activity lists.
// Hand-rolled (no HTML5 DnD) so the press can still become a click: a drag only
// activates past a small movement threshold, and the click that ends a drop is
// suppressed for one tick so it does not select the dragged row.
import { computed, getCurrentInstance, onUnmounted, ref, type Ref } from 'vue'
import { reorderKeys } from './sidebarOrdering.js'

const DRAG_THRESHOLD = 5

export interface DropIndicator {
  beforeKey: string | null
  afterKey: string | null
}

interface DragState {
  key: string
  startX: number
  startY: number
  active: boolean
}

export interface PointerReorder {
  drag: Ref<DragState | null>
  dropIndicator: Ref<DropIndicator | null>
  dragging: Ref<boolean>
  suppressClick: Ref<boolean>
  onPointerDown: (event: PointerEvent, key: string) => void
}

export function usePointerReorder(options: {
  /** querySelectorAll selector for the rendered rows, in visual order. */
  rowSelector: string
  /** dataset property carrying each row's key (e.g. 'activityKey'). */
  keyAttr: string
  /** Current row keys in render order; the reorder commit starts from these. */
  keys: () => string[]
  onReorder: (reordered: string[]) => void
}): PointerReorder {
  const drag = ref<DragState | null>(null)
  const dropIndicator = ref<DropIndicator | null>(null)
  const suppressClick = ref(false)
  const dragging = computed(() => drag.value?.active === true)

  function onPointerDown(event: PointerEvent, key: string) {
    if ((event.target as HTMLElement | null)?.tagName === 'INPUT' || event.button !== 0) return
    drag.value = { key, startX: event.clientX, startY: event.clientY, active: false }
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
  }

  function onPointerMove(event: PointerEvent) {
    if (!drag.value) return
    if (!drag.value.active) {
      const dx = Math.abs(event.clientX - drag.value.startX)
      const dy = Math.abs(event.clientY - drag.value.startY)
      if (dx + dy < DRAG_THRESHOLD) return
      drag.value.active = true
    }
    updateDropIndicator(event.clientY)
  }

  function onPointerUp() {
    detach()
    if (drag.value?.active && dropIndicator.value) {
      onReorderCommit()
      suppressNextClick()
    }
    drag.value = null
    dropIndicator.value = null
  }

  function onReorderCommit() {
    options.onReorder(reorderKeys(
      options.keys(),
      drag.value!.key,
      dropIndicator.value!.beforeKey,
    ))
  }

  function updateDropIndicator(clientY: number) {
    const rows = document.querySelectorAll(options.rowSelector)
    let best: DropIndicator | null = null

    for (const row of rows) {
      const el = row as HTMLElement
      const key = el.dataset[options.keyAttr]!
      if (key === drag.value?.key) continue
      const rect = el.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      if (clientY < midY) {
        best = { beforeKey: key, afterKey: null }
        break
      }
      best = { beforeKey: null, afterKey: key }
    }
    dropIndicator.value = best
  }

  function suppressNextClick() {
    suppressClick.value = true
    window.setTimeout(() => { suppressClick.value = false }, 0)
  }

  function detach() {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
  }

  if (getCurrentInstance()) onUnmounted(detach)

  return { drag, dropIndicator, dragging, suppressClick, onPointerDown }
}
