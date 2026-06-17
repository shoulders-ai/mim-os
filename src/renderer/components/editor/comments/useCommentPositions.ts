import { computed, ref, type Ref } from 'vue'
import type { CommentThread } from '@main/comments/model.js'

export interface CommentAnchorGeometry {
  id: string
  top: number
}

export interface CommentPosition {
  id: string
  top: number
  anchorTop: number
  height: number
}

export interface CommentLayoutOptions {
  anchors: CommentAnchorGeometry[]
  cardHeights: Record<string, number>
  activeId?: string | null
  gap?: number
  topPadding?: number
  defaultHeight?: number
}

const DEFAULT_GAP = 10
const DEFAULT_TOP_PADDING = 10
const DEFAULT_CARD_HEIGHT = 112

export function layoutCommentCards(options: CommentLayoutOptions): CommentPosition[] {
  const gap = options.gap ?? DEFAULT_GAP
  const topPadding = options.topPadding ?? DEFAULT_TOP_PADDING
  const defaultHeight = options.defaultHeight ?? DEFAULT_CARD_HEIGHT
  const items = options.anchors
    .map(anchor => ({
      id: anchor.id,
      anchorTop: Math.max(0, anchor.top),
      height: Math.max(24, options.cardHeights[anchor.id] ?? defaultHeight),
      top: Math.max(topPadding, anchor.top),
    }))
    .sort((a, b) => a.anchorTop - b.anchorTop || a.id.localeCompare(b.id))

  if (items.length === 0) return []

  const activeIndex = options.activeId
    ? items.findIndex(item => item.id === options.activeId)
    : -1

  if (activeIndex >= 0) {
    items[activeIndex].top = Math.max(topPadding, items[activeIndex].anchorTop)

    for (let index = activeIndex - 1; index >= 0; index--) {
      const next = items[index + 1]
      items[index].top = Math.min(items[index].anchorTop, next.top - gap - items[index].height)
    }

    for (let index = activeIndex + 1; index < items.length; index++) {
      const previous = items[index - 1]
      items[index].top = Math.max(items[index].anchorTop, previous.top + previous.height + gap)
    }
  } else {
    items[0].top = Math.max(topPadding, items[0].anchorTop)
    for (let index = 1; index < items.length; index++) {
      const previous = items[index - 1]
      items[index].top = Math.max(items[index].anchorTop, previous.top + previous.height + gap)
    }
  }

  const underflow = topPadding - items[0].top
  if (underflow > 0) {
    for (const item of items) item.top += underflow
  }

  return items
}

export function useCommentPositions(
  threads: Ref<CommentThread[]>,
  activeId: Ref<string | null>,
  getEditorView: () => any,
  cardHeights: Ref<Record<string, number>>,
) {
  const anchors = ref<CommentAnchorGeometry[]>([])
  const scrollTop = ref(0)

  const positions = computed(() =>
    layoutCommentCards({
      anchors: anchors.value,
      cardHeights: cardHeights.value,
      activeId: activeId.value,
    })
  )

  function updateScrollTop(): void {
    const view = getEditorView()
    scrollTop.value = Number(view?.scrollDOM?.scrollTop ?? 0)
  }

  function measureAnchors(): void {
    const view = getEditorView()
    const scrollDOM = view?.scrollDOM
    if (!view || !scrollDOM || typeof view.coordsAtPos !== 'function') {
      anchors.value = []
      scrollTop.value = 0
      return
    }

    const scrollerRect = scrollDOM.getBoundingClientRect?.()
    const scrollerTop = Number(scrollerRect?.top ?? 0)
    const next: CommentAnchorGeometry[] = []
    for (const thread of threads.value) {
      const coords = view.coordsAtPos(thread.anchorFrom)
      if (!coords) continue
      next.push({
        id: thread.id,
        top: Number(coords.top ?? 0) - scrollerTop + Number(scrollDOM.scrollTop ?? 0),
      })
    }
    anchors.value = next
    updateScrollTop()
  }

  return {
    anchors,
    positions,
    scrollTop,
    measureAnchors,
    updateScrollTop,
  }
}
