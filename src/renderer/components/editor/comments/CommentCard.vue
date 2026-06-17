<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  IconCheck,
  IconCopy,
  IconDotsVertical,
  IconEdit,
  IconSparkles,
} from '@tabler/icons-vue'
import type { CommentThread } from '@main/comments/model.js'
import MimMenu from '../../ui/MimMenu.vue'
import MimMenuItem from '../../ui/MimMenuItem.vue'
import { shortcutLabel } from '../../../services/shortcutLabels.js'

const props = withDefaults(
  defineProps<{
    thread?: CommentThread
    draft?: boolean
    draftAnchor?: string
    active?: boolean
  }>(),
  {
    thread: undefined,
    draft: false,
    draftAnchor: '',
    active: false,
  },
)

const emit = defineEmits<{
  activate: [id: string]
  saveDraft: [text: string]
  cancelDraft: []
  reply: [id: string, text: string]
  resolve: [id: string]
  applyEdit: [id: string]
  sendToChat: [id: string]
  copyAnchor: [id: string]
  editNote: [id: string, noteIndex: number, text: string]
}>()

const cardRef = ref<HTMLElement | null>(null)
const draftText = ref('')
const replyText = ref('')
const editingNoteIndex = ref<number | null>(null)
const editingText = ref('')
const draftTextarea = ref<HTMLTextAreaElement | null>(null)
const replyTextarea = ref<HTMLTextAreaElement | null>(null)
const editTextarea = ref<HTMLTextAreaElement | null>(null)

const id = computed(() => props.thread?.id ?? 'draft')
const notes = computed(() => props.thread?.notes ?? [])
const firstNote = computed(() => notes.value[0] ?? null)
const replyCount = computed(() => Math.max(0, notes.value.length - 1))
const isExpanded = computed(() => props.active || props.draft)
const canSendDraft = computed(() => draftText.value.trim().length > 0)
const canSendReply = computed(() => replyText.value.trim().length > 0)

watch(() => props.draft, async (isDraft) => {
  if (!isDraft) return
  await nextTick()
  draftTextarea.value?.focus()
}, { immediate: true })

async function startEditing(index: number) {
  const note = notes.value[index]
  if (!note || !props.thread) return
  editingNoteIndex.value = index
  editingText.value = note.text
  await nextTick()
  editTextarea.value?.focus()
  editTextarea.value?.select()
}

function commitEdit() {
  if (!props.thread || editingNoteIndex.value == null) return
  const text = editingText.value.trim()
  if (text) emit('editNote', props.thread.id, editingNoteIndex.value, text)
  editingNoteIndex.value = null
  editingText.value = ''
}

function cancelEdit() {
  editingNoteIndex.value = null
  editingText.value = ''
}

function submitDraft() {
  if (!canSendDraft.value) return
  emit('saveDraft', draftText.value.trim())
  draftText.value = ''
}

function submitReply() {
  if (!props.thread || !canSendReply.value) return
  emit('reply', props.thread.id, replyText.value.trim())
  replyText.value = ''
  nextTick(() => replyTextarea.value?.focus())
}

function escapeDraft() {
  if (draftText.value.trim()) return
  emit('cancelDraft')
}

function onDraftBlur() {
  window.setTimeout(() => {
    if (!props.draft || draftText.value.trim()) return
    if (cardRef.value?.contains(document.activeElement)) return
    emit('cancelDraft')
  }, 0)
}

function activate() {
  if (props.thread) emit('activate', props.thread.id)
}

function relativeTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ')
  const diffSeconds = Math.round((Date.now() - date.getTime()) / 1000)
  const abs = Math.abs(diffSeconds)
  if (abs < 60) return 'now'
  const units: Array<[number, string]> = [
    [60 * 60 * 24 * 30, 'mo'],
    [60 * 60 * 24, 'd'],
    [60 * 60, 'h'],
    [60, 'm'],
  ]
  for (const [seconds, label] of units) {
    if (abs >= seconds) {
      const amount = Math.max(1, Math.round(abs / seconds))
      return diffSeconds < 0 ? `in ${amount}${label}` : `${amount}${label}`
    }
  }
  return 'now'
}
</script>

<template>
  <!-- Draft -->
  <div
    v-if="draft"
    ref="cardRef"
    class="bg-accent-tint px-2.5 py-2"
    :data-comment-id="id"
    @mousedown.stop
  >
    <textarea
      ref="draftTextarea"
      v-model="draftText"
      class="w-full min-h-[56px] resize-y border border-rule-light bg-surface px-2 py-1.5 font-sans text-[13px] leading-snug text-ink outline-none focus:border-accent"
      placeholder="Add a comment…"
      @blur="onDraftBlur"
      @keydown.meta.enter.prevent="submitDraft"
      @keydown.ctrl.enter.prevent="submitDraft"
      @keydown.escape.prevent="escapeDraft"
    />
    <div class="mt-1.5 flex justify-end gap-3">
      <button
        type="button"
        class="font-sans text-[11px] text-ink-3 hover:text-ink"
        @click.stop="emit('cancelDraft')"
      >Cancel</button>
      <button
        type="button"
        class="font-sans text-[11px] font-medium text-accent disabled:opacity-35"
        :disabled="!canSendDraft"
        @click.stop="submitDraft"
      >Save {{ shortcutLabel(['Mod', 'Enter']) }}</button>
    </div>
  </div>

  <!-- Collapsed: two-line row -->
  <div
    v-else-if="!isExpanded"
    ref="cardRef"
    class="group px-2.5 py-1 hover:bg-chrome-high"
    :data-comment-id="id"
    @mousedown.stop
    @click="activate"
  >
    <div class="flex items-center gap-1.5">
      <span class="shrink-0 font-mono text-[11px] font-semibold text-ink-3">{{ firstNote?.by }}</span>
      <div class="flex-1" />
      <span v-if="replyCount" class="shrink-0 font-mono text-[11px] text-ink-4">+{{ replyCount }}</span>
      <span v-if="firstNote" class="shrink-0 font-mono text-[11px] text-ink-4">{{ relativeTime(firstNote.at) }}</span>
      <button
        v-if="thread"
        type="button"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-ink-4 opacity-0 hover:bg-chrome-mid hover:text-accent group-hover:opacity-100"
        title="Resolve"
        @click.stop="emit('resolve', thread.id)"
      >
        <IconCheck :size="13" stroke-width="2.3" />
      </button>
    </div>
    <p class="truncate font-sans text-[12px] leading-snug text-ink-2">{{ firstNote?.text }}</p>
  </div>

  <!-- Expanded -->
  <div
    v-else
    ref="cardRef"
    class="group bg-accent-tint px-2.5 py-2"
    :data-comment-id="id"
    @mousedown.stop
    @click="activate"
  >
    <!-- Header -->
    <div class="flex items-center gap-1.5">
      <span class="font-mono text-[11px] font-semibold text-ink-3">{{ firstNote?.by }}</span>
      <span v-if="firstNote" class="font-mono text-[11px] text-ink-4">{{ relativeTime(firstNote.at) }}</span>
      <div class="flex-1" />
      <button
        v-if="thread"
        type="button"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-high hover:text-accent"
        title="Apply as edit"
        @click.stop="emit('applyEdit', thread.id)"
      >
        <IconSparkles :size="13" stroke-width="2" />
      </button>
      <button
        v-if="thread"
        type="button"
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-high hover:text-accent"
        title="Resolve"
        @click.stop="emit('resolve', thread.id)"
      >
        <IconCheck :size="13" stroke-width="2.3" />
      </button>
      <MimMenu
        v-if="thread"
        placement="bottom-end"
        aria-label="Comment actions"
        trigger-class="flex h-6 w-6 items-center justify-center rounded-[4px] text-ink-4 hover:bg-chrome-high hover:text-ink-2"
        :min-width="148"
      >
        <template #trigger>
          <IconDotsVertical :size="13" stroke-width="2" />
        </template>
        <MimMenuItem item-class="h-7 px-2 py-0" @select="emit('sendToChat', thread.id)">
          <span>Send to chat</span>
        </MimMenuItem>
        <MimMenuItem item-class="h-7 px-2 py-0" @select="emit('copyAnchor', thread.id)">
          <IconCopy :size="13" stroke-width="2" />
          <span>Copy anchor</span>
        </MimMenuItem>
        <MimMenuItem item-class="h-7 px-2 py-0" @select="startEditing(0)">
          <IconEdit :size="13" stroke-width="2" />
          <span>Edit</span>
        </MimMenuItem>
        <MimMenuItem danger item-class="h-7 px-2 py-0" @select="emit('resolve', thread.id)">
          <IconCheck :size="13" stroke-width="2" />
          <span>Resolve</span>
        </MimMenuItem>
      </MimMenu>
    </div>

    <!-- Thread notes -->
    <div class="mt-1 max-h-[240px] space-y-2 overflow-y-auto overscroll-contain">
      <div v-for="(note, index) in notes" :key="`${thread!.id}:${index}:${note.at}`">
        <div v-if="index > 0" class="flex items-center gap-1.5">
          <span class="font-mono text-[11px] font-semibold text-ink-3">{{ note.by }}</span>
          <span class="font-mono text-[11px] text-ink-4">{{ relativeTime(note.at) }}</span>
          <button
            type="button"
            class="ml-auto flex h-5 w-5 items-center justify-center rounded-[4px] text-ink-4 opacity-0 hover:bg-chrome-high hover:text-ink-2 group-hover:opacity-100"
            title="Edit"
            @click.stop="startEditing(index)"
          >
            <IconEdit :size="12" stroke-width="2" />
          </button>
        </div>
        <textarea
          v-if="editingNoteIndex === index"
          ref="editTextarea"
          v-model="editingText"
          class="mt-0.5 w-full min-h-[40px] resize-y border border-rule-light bg-surface px-2 py-1.5 font-sans text-[13px] leading-snug text-ink outline-none focus:border-accent"
          @keydown.meta.enter.prevent="commitEdit"
          @keydown.ctrl.enter.prevent="commitEdit"
          @keydown.escape.prevent="cancelEdit"
        />
        <div v-if="editingNoteIndex === index" class="mt-1 flex justify-end gap-3">
          <button
            type="button"
            class="font-sans text-[11px] text-ink-4 hover:text-ink"
            @click.stop="cancelEdit"
          >Cancel</button>
          <button
            type="button"
            class="font-sans text-[11px] text-accent"
            @click.stop="commitEdit"
          >Save</button>
        </div>
        <p v-else class="whitespace-pre-wrap font-sans text-[13px] leading-snug text-ink">{{ note.text }}</p>
      </div>
    </div>

    <!-- Reply -->
    <div v-if="thread" class="mt-2 flex items-end gap-1.5">
      <textarea
        ref="replyTextarea"
        v-model="replyText"
        class="min-h-[28px] flex-1 resize-none border border-rule-light bg-surface px-2 py-1 font-sans text-[13px] leading-snug text-ink outline-none placeholder:text-ink-4 focus:border-accent"
        placeholder="Reply…"
        @keydown.meta.enter.prevent="submitReply"
        @keydown.ctrl.enter.prevent="submitReply"
      />
      <button
        type="button"
        class="flex h-7 shrink-0 items-center rounded-[4px] px-2 font-sans text-[11px] font-medium text-accent hover:bg-chrome-high disabled:opacity-35"
        :title="`Reply (${shortcutLabel(['Mod', 'Enter'])})`"
        :disabled="!canSendReply"
        @click.stop="submitReply"
      >Reply</button>
    </div>
  </div>
</template>
