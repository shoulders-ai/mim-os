<script setup>
import { ref, computed } from 'vue'
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconGitCompare, IconShieldHalfFilled } from '@tabler/icons-vue'
import {
  approvalNote,
  approvalQuestion,
  approvalTone,
  canRemember,
  canReviewChange,
  detailRows,
  formatToolName,
  rememberLabel,
  targetDetail,
  targetDisplay,
  targetIsCommand,
} from './approvalLogic.js'
import { changeSummary } from './approvalSummary.js'

const props = defineProps({
  approval: { type: Object, required: true },
  queueLength: { type: Number, default: 1 },
})

const emit = defineEmits(['approve', 'decline', 'review'])

const alwaysAllow = ref(false)
const detailsOpen = ref(false)

const question = computed(() => approvalQuestion(props.approval))
const summary = computed(() => changeSummary(props.approval.preview))
const target = computed(() => targetDisplay(props.approval))
const detail = computed(() => targetDetail(props.approval))
const isCommand = computed(() => targetIsCommand(props.approval))
const note = computed(() => approvalNote(props.approval))
const tone = computed(() => approvalTone(props.approval))
const showReview = computed(() => canReviewChange(props.approval))
const showRemember = computed(() => canRemember(props.approval))
const rememberText = computed(() => rememberLabel(props.approval))
const caution = computed(() => tone.value === 'caution')
const toolName = computed(() => formatToolName(props.approval.toolName))
const rows = computed(() => detailRows(props.approval))

function approve() {
  emit('approve', alwaysAllow.value)
}
</script>

<template>
  <div
    class="inline-approval flex flex-col gap-2.5 rounded-[8px] border bg-surface px-3.5 py-3"
    :class="caution ? 'border-rem/35' : 'border-rule'"
    role="group"
    aria-label="Permission request"
    @keydown.escape="emit('decline')"
  >
    <!-- Question -->
    <div class="flex items-start gap-2.5">
      <span
        class="mt-px inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] border"
        :class="caution ? 'border-rem/30 bg-rem/8 text-rem' : 'border-rule-light bg-chrome-high text-accent'"
      >
        <IconAlertTriangle v-if="caution" :size="14" :stroke-width="2" />
        <IconShieldHalfFilled v-else :size="14" :stroke-width="2" />
      </span>
      <p class="min-w-0 flex-1 font-sans text-[13px] font-[620] leading-[1.35] text-ink">{{ question }}</p>
      <span
        v-if="queueLength > 1"
        class="mt-px shrink-0 whitespace-nowrap font-mono text-[10px] text-ink-4"
      >1 of {{ queueLength }}</span>
    </div>

    <!-- The one thing to verify -->
    <code
      v-if="target"
      class="block rounded-[6px] bg-chrome-mid px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.45] text-ink-2 break-all"
      :class="isCommand ? 'whitespace-pre-wrap' : ''"
    >{{ target }}</code>

    <!-- Plain-language summary of the change (file edits) -->
    <p v-if="summary" class="font-sans text-[12px] leading-[1.4] text-ink-2">{{ summary }}</p>

    <!-- What is being sent (outbound payload) -->
    <p
      v-if="detail"
      class="font-sans text-[11.5px] leading-[1.45] text-ink-3 line-clamp-3 whitespace-pre-wrap break-words"
    >{{ detail }}</p>

    <!-- Heads-up, only when unusual -->
    <p v-if="note" class="font-sans text-[11px] leading-[1.4] text-rem">{{ note }}</p>

    <!-- Exact call, for transparency -->
    <div>
      <button
        type="button"
        class="inline-flex items-center gap-1 font-sans text-[11px] text-ink-4 hover:text-ink-2"
        @click="detailsOpen = !detailsOpen"
      >
        <IconChevronDown v-if="detailsOpen" :size="12" :stroke-width="2.2" />
        <IconChevronRight v-else :size="12" :stroke-width="2.2" />
        {{ detailsOpen ? 'Hide details' : 'Show details' }}
      </button>
      <div v-if="detailsOpen" class="mt-1.5 rounded-[6px] bg-chrome-mid px-2.5 py-2 font-mono text-[10.5px] leading-[1.5] text-ink-2">
        <div class="break-all"><span class="text-ink-4">tool</span> {{ toolName }}</div>
        <div v-for="row in rows" :key="row.key" class="break-all"><span class="text-ink-4">{{ row.key }}</span> {{ row.value }}</div>
      </div>
    </div>

    <!-- Remember -->
    <label
      v-if="showRemember"
      class="flex select-none items-center gap-1.5 font-sans text-[11px] text-ink-3"
    >
      <input
        v-model="alwaysAllow"
        type="checkbox"
        class="h-[13px] w-[13px] shrink-0 accent-accent"
      />
      {{ rememberText }}
    </label>

    <!-- Decision -->
    <div class="flex items-center justify-end gap-1.5">
      <button
        v-if="showReview"
        type="button"
        class="mr-auto inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-[6px] border border-rule px-2.5 font-sans text-[11px] font-[620] text-ink-2 hover:bg-chrome-mid hover:text-ink"
        title="Open the proposed change in the editor"
        @click="emit('review')"
      >
        <IconGitCompare :size="13" :stroke-width="2.1" />
        Review change
      </button>
      <button
        type="button"
        class="inline-flex h-7 items-center whitespace-nowrap rounded-[6px] border border-rule px-3 font-sans text-[11px] font-[620] text-ink-2 hover:bg-chrome-mid hover:text-ink"
        @click="emit('decline')"
      >Decline</button>
      <button
        type="button"
        class="inline-flex h-7 items-center whitespace-nowrap rounded-[6px] bg-ink px-3.5 font-sans text-[11px] font-[650] text-surface hover:bg-accent hover:text-accent-ink"
        @click="approve"
      >Approve</button>
    </div>
  </div>
</template>

<style scoped>
.inline-approval {
  animation: inline-approval-in 160ms cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes inline-approval-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
