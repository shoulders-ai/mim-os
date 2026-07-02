<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { IconDownload, IconMessageCirclePlus, IconQuote } from '@tabler/icons-vue'
import { shortcutLabel } from '../../services/shortcutLabels.js'

const props = defineProps<{
  activeFormats: string[]
  canComment?: boolean
  commentCount?: number
  commentRailOpen?: boolean
}>()

const emit = defineEmits<{
  format: [action: string]
  comment: []
  export: []
}>()

const TB_BASE = 'inline-flex h-[22px] min-w-[22px] items-center justify-center px-1.5 font-sans text-[12px] font-normal text-ink-3 hover:rounded-[3px] hover:bg-chrome-high hover:text-ink'
const TB_ACTIVE = 'rounded-[3px] bg-accent-soft font-semibold text-accent'

function tb(action: string): string[] {
  return [TB_BASE, props.activeFormats.includes(action) ? TB_ACTIVE : '']
}

const toolbarRef = ref<HTMLElement>()
const compact = ref(false)
let fullContentWidth = 0

function checkOverflow() {
  const el = toolbarRef.value
  if (!el) return
  if (!compact.value) {
    if (el.scrollWidth > el.clientWidth) {
      fullContentWidth = el.scrollWidth
      compact.value = true
    }
  } else if (el.clientWidth >= fullContentWidth) {
    compact.value = false
    requestAnimationFrame(() => {
      const e = toolbarRef.value
      if (e && e.scrollWidth > e.clientWidth) {
        fullContentWidth = e.scrollWidth
        compact.value = true
      }
    })
  }
}

let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(checkOverflow)
  if (toolbarRef.value) observer.observe(toolbarRef.value)
})
onUnmounted(() => observer?.disconnect())

watch(() => props.commentCount, () => nextTick(checkOverflow))
</script>

<template>
  <div ref="toolbarRef" class="flex h-[30px] shrink-0 items-center gap-[1.5px] overflow-x-auto overflow-y-hidden border-b border-rule-light bg-chrome-mid px-3.5 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <div class="flex shrink-0 items-center gap-0.5">
      <button :class="tb('heading-1')" title="Heading 1" @mousedown.prevent @click="emit('format', 'heading-1')">H1</button>
      <button :class="tb('heading-2')" title="Heading 2" @mousedown.prevent @click="emit('format', 'heading-2')">H2</button>
      <button :class="tb('heading-3')" title="Heading 3" @mousedown.prevent @click="emit('format', 'heading-3')">H3</button>
      <button :class="[tb('bold'), 'font-bold']" title="Bold" @mousedown.prevent @click="emit('format', 'bold')">B</button>
      <button :class="[tb('italic'), 'italic']" title="Italic" @mousedown.prevent @click="emit('format', 'italic')">I</button>
      <button :class="[tb('strikethrough'), 'line-through']" title="Strikethrough" @mousedown.prevent @click="emit('format', 'strikethrough')">S</button>
    </div>
    <span class="mx-0 my-1.5 w-px shrink-0 self-stretch bg-rule"></span>
    <div class="flex shrink-0 items-center gap-0.5">
      <button :class="tb('bullet-list')" title="Bullet List" @mousedown.prevent @click="emit('format', 'bullet-list')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
      </button>
      <button :class="tb('numbered-list')" title="Numbered List" @mousedown.prevent @click="emit('format', 'numbered-list')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="2" y="14" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="2" y="20" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
      </button>
      <button :class="tb('checkbox')" title="Checkbox" @mousedown.prevent @click="emit('format', 'checkbox')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="14" height="14" rx="2"/><polyline points="7 12 10 15 17 8"/></svg>
      </button>
      <button :class="tb('blockquote')" title="Blockquote" @mousedown.prevent @click="emit('format', 'blockquote')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>
      </button>
      <button :class="tb('horizontal-rule')" title="Horizontal Rule" @mousedown.prevent @click="emit('format', 'horizontal-rule')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12" stroke-dasharray="3 3"/></svg>
      </button>
      <button :class="tb('link')" title="Link" @mousedown.prevent @click="emit('format', 'link')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
      </button>
      <button :class="tb('image')" title="Image" @mousedown.prevent @click="emit('format', 'image')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      </button>
      <button :class="tb('code')" title="Inline Code" @mousedown.prevent @click="emit('format', 'code')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
      </button>
      <button :class="tb('cite')" class="gap-1" title="Citation" @mousedown.prevent @click="emit('format', 'cite')">
        <IconQuote :size="13" stroke-width="2" />
        <span v-show="!compact" class="text-[11px]">Cite</span>
      </button>
    </div>
    <span class="mx-0 my-1.5 w-px shrink-0 self-stretch bg-rule"></span>
    <button
      :class="TB_BASE"
      class="shrink-0 gap-1 px-2 text-[11px]"
      :title="canComment ? `Add comment (${shortcutLabel(['Shift', 'Mod', 'M'])})` : `${commentCount ? `${commentCount} comments` : 'Comments'} (${shortcutLabel(['Shift', 'Mod', 'M'])})`"
      @mousedown.prevent
      @click="emit('comment')"
    >
      <IconMessageCirclePlus :size="13" stroke-width="2" :class="commentCount && !commentRailOpen ? 'text-accent' : ''" />
      <span v-show="!compact">Comment</span>
      <span
        v-if="commentCount && !commentRailOpen"
        class="font-mono text-[10px] text-accent"
      >{{ commentCount }}</span>
    </button>
    <div class="min-w-2 flex-1"></div>
    <button
      :class="TB_BASE"
      class="shrink-0 gap-1 px-2 text-[11px]"
      :title="`Export to PDF or Word (${shortcutLabel(['Shift', 'Mod', 'E'])})`"
      @mousedown.prevent
      @click="emit('export')"
    >
      <IconDownload :size="13" stroke-width="2" />
      <span v-show="!compact">Export</span>
    </button>
  </div>
</template>
