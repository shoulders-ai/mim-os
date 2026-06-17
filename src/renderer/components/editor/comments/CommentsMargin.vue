<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  IconArrowBarToRight,
  IconArrowUp,
  IconChevronDown,
  IconChevronUp,
  IconMessageCircle,
} from '@tabler/icons-vue'
import type { CommentThread } from '@main/comments/model.js'
import { useSessionStore } from '../../../stores/sessions.js'
import MimMenu from '../../ui/MimMenu.vue'
import MimMenuItem from '../../ui/MimMenuItem.vue'
import CommentCard from './CommentCard.vue'
import { useCommentPositions } from './useCommentPositions.js'

const props = withDefaults(
  defineProps<{
    threads: CommentThread[]
    activeId?: string | null
    editorView?: any
    draft?: { from: number; to: number; anchor: string } | null
  }>(),
  {
    activeId: null,
    editorView: null,
    draft: null,
  },
)

const emit = defineEmits<{
  active: [id: string]
  saveDraft: [text: string]
  cancelDraft: []
  reply: [id: string, text: string]
  resolve: [id: string]
  applyEdit: [id: string]
  sendToChat: [ids: string[], targetSessionId?: string | null]
  copyAnchor: [id: string]
  editNote: [id: string, noteIndex: number, text: string]
  close: []
}>()

const sessionStore = useSessionStore()
const railRef = ref<HTMLElement | null>(null)
const cardHeights = ref<Record<string, number>>({})
const cardEls = new Map<string, HTMLElement>()
let resizeObserver: ResizeObserver | null = null
let detachScroll: null | (() => void) = null

const layoutThreads = computed<CommentThread[]>(() => {
  if (!props.draft) return props.threads
  return [
    ...props.threads,
    {
      id: 'draft',
      anchor: props.draft.anchor,
      notes: [],
      tagFrom: props.draft.from,
      tagTo: props.draft.to,
      anchorFrom: props.draft.from,
      anchorTo: props.draft.to,
    },
  ]
})

const activeLayoutId = computed(() => props.draft ? 'draft' : props.activeId ?? null)
const threadRef = computed(() => layoutThreads.value)
const activeRef = computed(() => activeLayoutId.value)

const {
  positions,
  scrollTop,
  measureAnchors,
  updateScrollTop,
} = useCommentPositions(threadRef, activeRef, () => props.editorView, cardHeights)

const positionById = computed(() => {
  const map = new Map<string, number>()
  for (const item of positions.value) map.set(item.id, item.top)
  return map
})

const visibleCount = computed(() => props.threads.length)
const chatTargets = computed(() => sessionStore.visibleSessions.slice(0, 5))

const sortedThreadIds = computed(() =>
  [...props.threads]
    .sort((a, b) => a.anchorFrom - b.anchorFrom)
    .map(thread => thread.id),
)
const activeIndex = computed(() =>
  props.activeId ? sortedThreadIds.value.indexOf(props.activeId) : -1,
)
const hasPrev = computed(() => activeIndex.value > 0)
const hasNext = computed(() => {
  if (sortedThreadIds.value.length === 0) return false
  if (activeIndex.value < 0) return true
  return activeIndex.value < sortedThreadIds.value.length - 1
})

function goToPrev() {
  if (!hasPrev.value) return
  emit('active', sortedThreadIds.value[activeIndex.value - 1])
}

function goToNext() {
  if (!hasNext.value) return
  const next = activeIndex.value < 0 ? 0 : activeIndex.value + 1
  emit('active', sortedThreadIds.value[next])
}

function setCardRef(id: string, el: unknown) {
  const current = cardEls.get(id)
  if (current && current !== el) {
    resizeObserver?.unobserve(current)
    cardEls.delete(id)
  }
  const element = el ? ((el as { $el?: HTMLElement }).$el ?? el) : null
  if (element instanceof HTMLElement) {
    cardEls.set(id, element)
    resizeObserver?.observe(element)
  }
  queueMeasureCards()
}

let measureFrame = 0
function queueMeasureCards() {
  if (measureFrame) cancelAnimationFrame(measureFrame)
  measureFrame = requestAnimationFrame(() => {
    measureFrame = 0
    measureCardHeights()
  })
}

function measureCardHeights() {
  const next: Record<string, number> = {}
  for (const [id, el] of cardEls) {
    next[id] = el.offsetHeight
  }
  cardHeights.value = next
}

function attachScroll() {
  detachScroll?.()
  detachScroll = null
  const scroller = props.editorView?.scrollDOM
  if (!scroller) return
  const onScroll = () => updateScrollTop()
  scroller.addEventListener('scroll', onScroll, { passive: true })
  detachScroll = () => scroller.removeEventListener('scroll', onScroll)
  measureAnchors()
}

function sendAll(targetSessionId: string | null = null) {
  const ids = props.threads.map(thread => thread.id)
  if (ids.length) emit('sendToChat', ids, targetSessionId)
}

function activate(id: string) {
  emit('active', id)
}

watch(() => [props.threads, props.activeId, props.draft, props.editorView], async () => {
  await nextTick()
  attachScroll()
  measureAnchors()
  queueMeasureCards()
}, { deep: true, immediate: true })

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      measureCardHeights()
      measureAnchors()
    })
    if (railRef.value) resizeObserver.observe(railRef.value)
  }
  attachScroll()
  measureAnchors()
  queueMeasureCards()
})

onBeforeUnmount(() => {
  detachScroll?.()
  detachScroll = null
  if (measureFrame) cancelAnimationFrame(measureFrame)
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <aside
    ref="railRef"
    class="relative flex w-[248px] shrink-0 flex-col overflow-hidden border-l border-rule-light bg-chrome-mid"
    data-testid="comments-margin"
  >
    <!-- Header -->
    <div class="flex h-8 shrink-0 items-center gap-1.5 border-b border-rule-light px-2.5">
      <span class="font-sans text-[11px] font-medium text-ink-3">Review</span>
      <div class="flex-1" />
      <span
        v-if="visibleCount"
        class="font-mono text-[11px] text-ink-4"
      >{{ activeIndex >= 0 ? `${activeIndex + 1}/${visibleCount}` : visibleCount }}</span>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-high hover:text-ink-2 disabled:opacity-30"
        title="Previous comment"
        :disabled="!hasPrev"
        @click="goToPrev"
      >
        <IconChevronUp :size="14" stroke-width="2" />
      </button>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-high hover:text-ink-2 disabled:opacity-30"
        title="Next comment"
        :disabled="!hasNext"
        @click="goToNext"
      >
        <IconChevronDown :size="14" stroke-width="2" />
      </button>
      <button
        type="button"
        class="flex h-6 w-6 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-high hover:text-ink"
        title="Close review rail"
        @click="emit('close')"
      >
        <IconArrowBarToRight :size="14" stroke-width="2" />
      </button>
    </div>

    <!-- Scroll-synced card container -->
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <div
        class="absolute inset-x-0 top-0"
        :style="{ transform: `translate3d(0, ${-scrollTop}px, 0)` }"
      >
        <div
          v-for="thread in threads"
          :key="thread.id"
          :ref="el => setCardRef(thread.id, el)"
          class="absolute inset-x-0 will-change-transform"
          :style="{ transform: `translate3d(0, ${positionById.get(thread.id) ?? 8}px, 0)` }"
        >
          <CommentCard
            :thread="thread"
            :active="activeId === thread.id"
            @activate="activate"
            @reply="(id, text) => emit('reply', id, text)"
            @resolve="emit('resolve', $event)"
            @apply-edit="emit('applyEdit', $event)"
            @send-to-chat="emit('sendToChat', [$event], null)"
            @copy-anchor="emit('copyAnchor', $event)"
            @edit-note="(id, noteIndex, text) => emit('editNote', id, noteIndex, text)"
          />
        </div>

        <div
          v-if="draft"
          :ref="el => setCardRef('draft', el)"
          class="absolute inset-x-0 will-change-transform"
          :style="{ transform: `translate3d(0, ${positionById.get('draft') ?? 8}px, 0)` }"
        >
          <CommentCard
            draft
            :draft-anchor="draft.anchor"
            active
            @save-draft="emit('saveDraft', $event)"
            @cancel-draft="emit('cancelDraft')"
          />
        </div>
      </div>
    </div>

    <!-- Bottom bar: send to chat -->
    <div
      v-if="visibleCount"
      class="flex h-8 shrink-0 items-center border-t border-rule-light px-2.5"
    >
      <MimMenu
        placement="top-start"
        aria-label="Send comments to chat"
        trigger-class="flex h-6 items-center gap-1.5 rounded-[4px] px-2 font-sans text-[11px] text-ink-3 hover:bg-chrome-high hover:text-ink"
        :min-width="172"
      >
        <template #trigger>
          <IconArrowUp :size="13" stroke-width="2.5" />
          <span>Send to chat</span>
        </template>
        <MimMenuItem item-class="h-7 px-2 py-0" @select="sendAll(null)">
          <IconMessageCircle :size="13" stroke-width="2" />
          <span>New chat</span>
        </MimMenuItem>
        <template v-if="chatTargets.length">
          <div class="mx-1 my-0.5 h-px bg-rule-light" />
          <MimMenuItem
            v-for="session in chatTargets"
            :key="session.id"
            item-class="h-7 px-2 py-0"
            @select="sendAll(session.id)"
          >
            <IconMessageCircle :size="13" stroke-width="2" />
            <span class="min-w-0 truncate">{{ session.label || 'Chat' }}</span>
          </MimMenuItem>
        </template>
      </MimMenu>
    </div>
  </aside>
</template>
