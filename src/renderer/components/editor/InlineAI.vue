<template>
  <div
    ref="surfaceRef"
    class="overflow-hidden"
    :class="surfaceClass"
    :style="surfaceLayoutStyle"
  >
    <form :class="formClass" @submit.prevent="onSubmit">
      <div :class="inputWrapClass">
        <textarea
          ref="inputRef"
          v-model="input"
          :class="inputClass"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          rows="1"
          :disabled="isLoading"
          :placeholder="placeholder"
          title="Describe the edit. Enter submits, Shift+Enter adds a new line."
          @keydown="onInputKeydown"
          @input="autoResize"
        />
        <button
          type="button"
          :class="closeButtonClass"
          title="Close inline edit (Esc)"
          @mousedown.prevent
          @click="onClose"
        >
          <IconX :size="13" :stroke-width="2.4" />
        </button>
      </div>

      <div
        v-if="assistantNote"
        :class="messageClass"
      >
        {{ assistantNote }}
      </div>

      <div
        v-if="chatError"
        :class="errorClass"
      >
        {{ chatError }}
      </div>

      <div :class="footerClass">
        <div class="flex min-w-0 flex-wrap items-center gap-0">
          <span :class="scopeClass">
            <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ scopeLabel }}</span>
          </span>

          <span
            v-if="statusLabel"
            class="mr-2 inline-flex h-[22px] items-center border-r border-rule-light pr-2 font-sans text-[11px] font-medium"
            :class="statusTone"
          >
            {{ statusLabel }}<span v-if="isLoading" class="iai-dots">...</span>
          </span>

          <div v-if="modelList.length" :class="modelClass" :title="modelStatusText || 'Inline model'">
            <ModelPicker
              :modelId="currentModelId"
              :models="modelList"
              :disabled="isLoading"
              placement="auto"
              @update:modelId="onModelChange"
            />
          </div>

          <span
            v-else
            class="inline-flex h-[22px] max-w-[180px] items-center font-mono text-[10px] font-medium"
            :class="selectedInlineModel ? 'text-ink-3' : 'text-rem'"
          >
            <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ modelStatusText }}</span>
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-1">
          <button
            v-if="chatError"
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 font-sans text-[11px] font-semibold text-ink-2 hover:bg-chrome-mid hover:text-ink disabled:opacity-35"
            :disabled="isLoading || !lastInstruction"
            title="Retry the last edit"
            @mousedown.prevent
            @click="onRetry"
          >
            <IconRefresh :size="13" :stroke-width="2.2" />
            Retry
          </button>

          <template v-else-if="pendingEdit && !isLoading && !isReview">
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 font-sans text-[11px] font-semibold text-rem hover:bg-rem/8 disabled:opacity-35"
              title="Reject proposed edit"
              @mousedown.prevent
              @click="onReject"
            >
              <IconX :size="13" :stroke-width="2.4" />
              Reject
            </button>
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-accent px-2.5 font-sans text-[11px] font-semibold text-accent-ink hover:bg-accent-2"
              :title="`Apply proposed edit (${shortcutLabel(['Mod', 'Enter'])})`"
              @mousedown.prevent
              @click="onAccept"
            >
              <IconCheck :size="13" :stroke-width="2.5" />
              Accept
            </button>
          </template>

          <button
            v-else-if="isLoading"
            type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded-[6px] bg-accent text-accent-ink hover:bg-accent-2"
            title="Stop editing (Esc)"
            @mousedown.prevent
            @click="onCancel"
          >
            <IconPlayerStop :size="13" :stroke-width="2.2" />
          </button>

          <button
            v-else
            type="submit"
            class="inline-flex h-7 w-7 items-center justify-center rounded-[6px] bg-ink text-surface hover:bg-accent disabled:opacity-25 disabled:pointer-events-none"
            :disabled="!canSubmit"
            :title="submitTitle"
            @mousedown.prevent
          >
            <IconArrowUp :size="14" :stroke-width="2.5" />
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { IconArrowUp, IconCheck, IconPlayerStop, IconRefresh, IconX } from '@tabler/icons-vue'
import { useSettingsStore } from '../../stores/settings.js'
import { modelMenuItems, resolvePreferredModel } from '../../services/ai/modelControls.js'
import { shortcutLabel } from '../../services/shortcutLabels.js'
import { aiApiBase, aiFetch } from '../../services/ai/aiApi.js'
import ModelPicker from '../chat/ModelPicker.vue'

const TOOL_LABELS = {
  fs_read: 'Reading',
  search: 'Searching',
  suggest_edit: 'Preparing edit',
}

const FLOATING_MARGIN = 12
const FLOATING_WIDTH = 520

const settings = useSettingsStore()

const props = defineProps({
  selection: { type: Object, required: true },
  variant: { type: String, default: 'floating' },
  initialInstruction: { type: String, default: '' },
  autoSubmit: { type: Boolean, default: false },
})

const emit = defineEmits(['apply', 'activate-diff', 'deactivate-diff', 'close'])

const surfaceRef = ref(null)
const inputRef = ref(null)
const registry = ref(null)
// Inline model menu derives from the shared key status, so adding a key in
// Settings enables inline models live (no editor reopen).
const modelList = computed(() => modelMenuItems(registry.value, settings.keyStatuses))
const pendingEdit = ref(null)
const toolStatus = ref('')
const lastInstruction = ref('')
const localError = ref('')

const input = ref('')
const surfaceStyle = ref({
  width: `${FLOATING_WIDTH}px`,
  left: '50vw',
  top: '96px',
  transform: 'translateX(-50%)',
})

const isReview = computed(() => props.variant === 'review')
const surfaceClass = computed(() =>
  isReview.value
    ? 'relative z-[1] w-full max-w-none bg-transparent'
    : 'fixed z-[80] max-w-[calc(100vw-24px)] rounded-[8px] border border-rule bg-surface shadow-[0_8px_30px_rgba(0,0,0,0.18),0_0_0_1px_rgba(255,255,255,0.07)]'
)
const surfaceLayoutStyle = computed(() => isReview.value ? null : surfaceStyle.value)
const formClass = computed(() =>
  isReview.value
    ? 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 px-3 py-2'
    : 'p-2'
)
const inputWrapClass = computed(() => isReview.value ? 'relative min-w-0' : 'relative')
const inputClass = computed(() =>
  [
    'block w-full min-h-[38px] max-h-[112px] resize-none overflow-hidden rounded-[6px] border px-2.5 py-2 pr-8 font-sans text-[12px] leading-[18px] text-ink outline-none disabled:opacity-40',
    isReview.value
      ? 'border-rule bg-surface focus:border-accent'
      : 'border-rule-light bg-chrome-high focus:border-accent focus:bg-surface',
  ].join(' ')
)
const closeButtonClass = computed(() =>
  [
    'absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-[5px] text-ink-3 hover:bg-chrome-mid hover:text-ink',
    isReview.value ? 'bg-surface/80' : '',
  ].join(' ')
)
const messageClass = computed(() =>
  isReview.value
    ? 'col-span-2 rounded-[5px] border border-rule-light bg-surface px-2.5 py-1.5 font-sans text-[11px] leading-[16px] text-ink-2'
    : 'mt-1.5 rounded-[6px] border border-rule-light bg-chrome-high px-2.5 py-2 font-sans text-[11px] leading-[16px] text-ink-2'
)
const errorClass = computed(() =>
  isReview.value
    ? 'col-span-2 rounded-[5px] border border-rem/20 bg-rem/8 px-2.5 py-1.5 font-sans text-[11px] leading-[16px] text-rem'
    : 'mt-1.5 rounded-[6px] border border-rem/20 bg-rem/8 px-2.5 py-2 font-sans text-[11px] leading-[16px] text-rem'
)
const footerClass = computed(() =>
  isReview.value
    ? 'flex min-w-[230px] items-center justify-between gap-2 self-start pt-[5px]'
    : 'mt-1.5 flex items-end justify-between gap-2 border-t border-rule-light pt-1.5'
)
const scopeClass = computed(() =>
  [
    'mr-2 inline-flex h-[22px] items-center border-r border-rule-light pr-2 font-mono text-[10px] font-medium text-ink-3',
    isReview.value ? 'max-w-[130px]' : 'max-w-[180px]',
  ].join(' ')
)
const modelClass = computed(() => isReview.value ? 'hidden' : 'w-[136px] min-w-[104px] max-w-[148px]')

let chatInstance = null
const _chatVersion = ref(0)
let chatPoll = null
const appliedEditToolCalls = new Set()

const selectedInlineModel = computed(() =>
  resolvePreferredModel(registry.value, settings.keyStatuses, settings.lastInlineModel, 'inline')
)

const currentModelId = computed(() => selectedInlineModel.value?.id || settings.lastInlineModel || '')

const modelStatusText = computed(() => {
  if (!registry.value) return 'Loading models'
  if (selectedInlineModel.value) {
    return `${selectedInlineModel.value.providerLabel || selectedInlineModel.value.provider}: ${selectedInlineModel.value.displayName || selectedInlineModel.value.name || selectedInlineModel.value.id}`
  }
  return 'No configured inline model'
})

const placeholder = computed(() => {
  void _chatVersion.value
  if (!props.selection.text) return 'Tell Mim what to insert'
  if (pendingEdit.value || chatInstance) return 'Refine the edit...'
  return 'Tell Mim how to change the selection'
})

const scopeLabel = computed(() => {
  const text = props.selection.text || ''
  if (!text.trim()) return 'Cursor'
  const lines = text.split(/\r\n|\r|\n/).length
  if (lines > 1) return `Selection · ${lines} lines`
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words > 0) return `Selection · ${words} words`
  return `Selection · ${text.length} chars`
})

const statusLabel = computed(() => {
  if (isLoading.value) return toolStatus.value || 'Editing selection'
  if (pendingEdit.value) return 'Previewing edit'
  if (chatError.value) return 'Needs attention'
  if (!selectedInlineModel.value && registry.value) return 'No model'
  return ''
})

const statusTone = computed(() => {
  if (chatError.value || (!selectedInlineModel.value && registry.value)) return 'text-rem'
  if (pendingEdit.value) return 'text-add'
  if (isLoading.value) return 'text-accent'
  return 'text-ink-3'
})

const assistantNote = computed(() => {
  if (isLoading.value || chatError.value || pendingEdit.value) return ''
  return responseText.value
})

const canSubmit = computed(() => Boolean(input.value.trim()) && !isLoading.value && Boolean(selectedInlineModel.value))

const submitTitle = computed(() => {
  if (!selectedInlineModel.value) return 'Configure an inline model in Settings'
  return pendingEdit.value ? 'Refine proposed edit (Enter)' : 'Generate edit (Enter)'
})

async function createChat() {
  await modelsReady
  if (!registry.value) throw new Error('No API key configured. Open Settings to add one.')
  const model = selectedInlineModel.value
  if (!model?.provider) throw new Error('No API key configured for inline AI. Open Settings to add a key.')
  const base = await aiApiBase()
  const api = `${base}/api/ai/inline`

  chatInstance = new Chat({
    id: `inline-ai-${Date.now()}`,
    messages: [],
    transport: new DefaultChatTransport({
      api,
      fetch: aiFetch,
      prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
        body: {
          id,
          messages,
          trigger,
          messageId,
          modelId: selectedInlineModel.value?.id,
          selection: {
            text: props.selection.text,
            contextBefore: props.selection.contextBefore || '',
            contextAfter: props.selection.contextAfter || '',
          },
        },
      }),
    }),
    onError(error) {
      console.error('[inline-ai]', error)
      _chatVersion.value++
    },
    onFinish() {
      toolStatus.value = ''
      _chatVersion.value++
    },
  })
  _chatVersion.value++
}

const isLoading = computed(() => {
  void _chatVersion.value
  if (!chatInstance) return false
  const status = chatInstance.status
  return status === 'submitted' || status === 'streaming'
})

const chatError = computed(() => {
  void _chatVersion.value
  if (localError.value) return localError.value
  if (!chatInstance) return null
  const err = chatInstance.error
  return err ? (err.message || String(err)) : null
})

const responseText = computed(() => {
  void _chatVersion.value
  if (!chatInstance) return ''
  const msgs = chatInstance.messages
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (msg.role !== 'assistant') continue
    const parts = msg.parts || []
    const textParts = parts.filter(p => p.type === 'text').map(p => p.text)
    if (textParts.length) return textParts.join('')
    if (typeof msg.content === 'string' && msg.content) return msg.content
  }
  return ''
})

function isToolPart(part) {
  return part?.type?.startsWith?.('tool-') || part?.type === 'dynamic-tool' || part?.type === 'tool-invocation'
}

function getToolName(part) {
  if (part?.type === 'tool-invocation') return part.toolInvocation?.toolName
  if (part?.type === 'dynamic-tool') return part.toolName
  return part?.type?.replace?.(/^tool-/, '')
}

function getToolState(part) {
  return part?.state || part?.toolInvocation?.state || ''
}

function isToolPending(part) {
  const state = getToolState(part)
  return isToolPart(part) && state !== 'output-available' && state !== 'output-error' && state !== 'error'
}

function maybeActivateSuggestedEdit(part) {
  if (getToolName(part) !== 'suggest_edit') return
  if (getToolState(part) !== 'output-available') return
  const callId = part.toolCallId || part.toolInvocation?.toolCallId
  if (callId && appliedEditToolCalls.has(callId)) return
  const replacement = part.input?.replacement || part.output?.replacement || part.toolInvocation?.args?.replacement
  if (typeof replacement !== 'string') return
  if (callId) appliedEditToolCalls.add(callId)
  pendingEdit.value = { replacement }
  emit('activate-diff', {
    from: props.selection.from,
    to: props.selection.to,
    replacement,
  })
}

watch(() => { void _chatVersion.value; return chatInstance?.messages }, (msgs) => {
  if (!msgs) return
  for (const msg of msgs) {
    if (msg.role !== 'assistant') continue
    for (const part of (msg.parts || [])) {
      maybeActivateSuggestedEdit(part)
      if (isToolPending(part)) {
        toolStatus.value = TOOL_LABELS[getToolName(part)] || 'Working'
      }
    }
  }
}, { deep: true })

function onModelChange(id) {
  localError.value = ''
  settings.set('lastInlineModel', id)
}

function autoResize() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 112) + 'px'
  el.style.overflowY = el.scrollHeight > 112 ? 'auto' : 'hidden'
  nextTick(updatePosition)
}

function resetInput() {
  input.value = ''
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = '38px'
      inputRef.value.style.overflowY = 'hidden'
    }
    updatePosition()
  })
}

function onInputKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    if (pendingEdit.value && !isReview.value) onAccept()
    else onSubmit()
  } else if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSubmit()
  }
}

async function onSubmit() {
  const instruction = input.value.trim()
  if (!instruction || isLoading.value) return
  localError.value = ''
  await modelsReady
  if (!selectedInlineModel.value) {
    localError.value = modelStatusText.value
    return
  }

  lastInstruction.value = instruction
  pendingEdit.value = null
  toolStatus.value = ''
  appliedEditToolCalls.clear()

  if (!isReview.value) emit('deactivate-diff')

  try {
    if (!chatInstance) await createChat()
    chatInstance.sendMessage({ text: instruction })
    resetInput()
    startChatPoll()
  } catch (error) {
    localError.value = error?.message || String(error)
  }
}

function onCancel() {
  localError.value = ''
  if (chatInstance) chatInstance.stop()
  toolStatus.value = ''
  stopChatPoll()
  _chatVersion.value++
}

function onRetry() {
  if (!lastInstruction.value) return
  localError.value = ''
  input.value = lastInstruction.value
  nextTick(() => onSubmit())
}

function onAccept() {
  if (!pendingEdit.value) return
  emit('apply', pendingEdit.value.replacement, props.selection.from, props.selection.to)
}

function onReject() {
  localError.value = ''
  emit('deactivate-diff')
  pendingEdit.value = null
  nextTick(() => {
    inputRef.value?.focus()
    updatePosition()
  })
}

function onClose() {
  localError.value = ''
  if (chatInstance) try { chatInstance.stop() } catch {}
  stopChatPoll()
  emit('close')
}

function stopChatPoll() {
  if (chatPoll != null) {
    clearInterval(chatPoll)
    chatPoll = null
  }
}

function startChatPoll() {
  stopChatPoll()
  chatPoll = setInterval(() => {
    _chatVersion.value++
    if (!chatInstance || chatInstance.status === 'ready' || chatInstance.status === 'error') {
      stopChatPoll()
    }
  }, 80)
}

function updatePosition() {
  if (isReview.value) return
  const width = Math.min(FLOATING_WIDTH, window.innerWidth - FLOATING_MARGIN * 2)
  const height = surfaceRef.value?.offsetHeight || 156
  const coords = props.selection?.coords || {}
  const anchorLeft = Number.isFinite(coords.left) ? coords.left : window.innerWidth / 2
  const anchorRight = Number.isFinite(coords.right) ? coords.right : anchorLeft
  const anchorCenter = (anchorLeft + anchorRight) / 2
  const minLeft = FLOATING_MARGIN + width / 2
  const maxLeft = window.innerWidth - FLOATING_MARGIN - width / 2
  const left = Math.max(minLeft, Math.min(maxLeft, anchorCenter))

  const anchorBottom = Number.isFinite(coords.bottom) ? coords.bottom : 88
  const anchorTop = Number.isFinite(coords.top) ? coords.top : anchorBottom
  let top = anchorBottom + 10
  if (top + height > window.innerHeight - FLOATING_MARGIN) {
    top = anchorTop - height - 10
  }
  top = Math.max(FLOATING_MARGIN, Math.min(window.innerHeight - FLOATING_MARGIN - height, top))

  surfaceStyle.value = {
    width: `${Math.round(width)}px`,
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    transform: 'translateX(-50%)',
  }
}

function onGlobalKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (isLoading.value) onCancel()
    else onClose()
  }
}

let modelsReady = Promise.resolve()

async function doLoadModels() {
  try {
    registry.value = await window.kernel.call('ai.registry')
    await settings.refreshKeyStatuses()
    const model = selectedInlineModel.value
    if (model && settings.lastInlineModel !== model.id) {
      settings.set('lastInlineModel', model.id)
    }
  } catch (err) {
    console.warn('[inline-ai] failed to load models:', err?.message || err)
  }
}

function loadModels() {
  modelsReady = doLoadModels()
}

// Clear a stale "no configured inline model" message the instant a key is added
// and a usable model resolves, so inline rewrite recovers without reopening.
watch(() => settings.keyStatuses, () => {
  if (selectedInlineModel.value && localError.value) localError.value = ''
}, { deep: true })

onMounted(async () => {
  document.addEventListener('keydown', onGlobalKeydown, true)
  window.addEventListener('resize', updatePosition)
  loadModels()
  if (props.initialInstruction) input.value = props.initialInstruction
  await modelsReady
  await nextTick()
  autoResize()
  updatePosition()
  inputRef.value?.focus()
  if (props.autoSubmit && input.value.trim()) {
    await onSubmit()
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onGlobalKeydown, true)
  window.removeEventListener('resize', updatePosition)
  stopChatPoll()
  if (chatInstance) try { chatInstance.stop() } catch {}
})

watch([isLoading, pendingEdit, chatError, responseText], () => nextTick(updatePosition))
</script>

<style scoped>
.iai-dots {
  display: inline-block;
  width: 1.5em;
  overflow: hidden;
  vertical-align: bottom;
  animation: iai-dots 1.2s steps(2, end) infinite;
}

@keyframes iai-dots {
  0% { opacity: 0.35; }
  50% { opacity: 1; }
  100% { opacity: 0.35; }
}
</style>
