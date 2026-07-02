<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted, onDeactivated } from 'vue'
import { Chat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import {
  compactBrowserToolResultsForContext,
  estimateMessagesTokens,
} from '@main/ai/messageCompaction.js'
import { useSessionStore } from '../../stores/sessions.js'
import { useSettingsStore } from '../../stores/settings.js'
import { useApprovalsStore } from '../../stores/approvals.js'
import { controlForModel, resolveConcreteModel, modelMenuItems } from '../../services/ai/modelControls.js'
import { chatErrorActions, readableError } from './chatErrorActions.js'
import { isTextType, mediaTypeFromFilename, toUserMessageParts } from '../../services/attachments.js'
import { isPlaceholderTaskLabel, provisionalTaskLabel, requestTaskLabel, shouldRequestTaskLabel, taskLabelContextLabels } from '../../services/ai/taskLabel.js'
import { getCurrentDocument, getCurrentDocumentSummary, subscribeCurrentDocument } from '../../services/currentDocument.js'
import { documentContextAttachment, modelSupportsVision, projectFileContextAttachment } from './composerLogic.js'
import ChatMessage from './ChatMessage.vue'
import InlineApproval from './InlineApproval.vue'
import ChatComposer from './ChatComposer.vue'
import ChatComposerFooter from './ChatComposerFooter.vue'
import { useToastStore } from '../../stores/toasts.js'
import { useChatEngines } from './useChatEngines.js'
import { withLastAssistantTurnElapsed } from './assistantTurn.js'
import { requestSummary, lastUserMessageText, buildSeedMessage } from '../../services/ai/summary.js'

const sessionStore = useSessionStore()
const settingsStore = useSettingsStore()
const approvalsStore = useApprovalsStore()
const toastStore = useToastStore()
const NEW_CHAT_DRAFT_ID = '__new_chat_draft__'
const props = defineProps({
  sessionId: { type: String, default: null },
  draft: { type: Boolean, default: false },
})
const emit = defineEmits(['openFile', 'archiveSession', 'sessionCreated', 'reviewApproval', 'openSettings'])

const rootEl = ref(null)
const scrollEl = ref(null)
const composerRef = ref(null)
const registry = ref(null)
const error = ref(null)
const showJumpBottom = ref(false)
const userScrolledUp = ref(false)
const projectFiles = ref([])
const composerSkills = ref([])
const packageTools = ref([])
const currentDocumentSummary = ref(null)
let aiBaseUrlPromise = null
let unsubscribeCurrentDocument = null
// Track sessions that hit the 25-step cap so we can show a Continue button.
const stepCapHitSessionIds = new Set()

// --- Chat instance management ---

// Engine lifecycle (cache, in-flight dedupe, hydrate-before-construct, reactive
// active ref) lives in useChatEngines so it is testable without mounting. The
// Chat construction itself is injected via buildChatEngine below. @ai-sdk/vue's
// Chat holds messages/status/error in Vue refs, so reading them downstream is
// reactive — no polling (see docs/gotchas.md).
const engines = useChatEngines({
  ensureMessages: (id) =>
    sessionStore.ensureMessages(id).then(s => s ?? sessionStore.sessions.find(x => x.id === id) ?? null),
  buildEngine: (id, initialMessages, sess) => buildChatEngine(id, initialMessages, sess),
  isActive: (id) => activeSessionId.value === id,
})
const activeChat = computed(() => engines.activeEngine.value)
const getOrCreateChat = engines.getOrCreate

function logChatAi(level, message, details = undefined) {
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  if (details !== undefined) logger('[chat-ai]', message, details)
  else logger('[chat-ai]', message)
}

function replaceChatMessages(chat, messages) {
  if (!chat || !Array.isArray(chat.messages)) return
  chat.messages.splice(0, chat.messages.length, ...messages)
}

function finishMessagesWithElapsed(sessionId, chat) {
  const elapsedMs = sessionStore.finishTurnTimer(sessionId)
  const messagesWithElapsed = withLastAssistantTurnElapsed(chat.messages ?? [], elapsedMs)
  if (messagesWithElapsed !== chat.messages) replaceChatMessages(chat, messagesWithElapsed)
  return messagesWithElapsed
}

async function compactChatHistoryForContext(sessionId, chat) {
  const result = compactBrowserToolResultsForContext(chat.messages ?? [])
  if (!result.changed) return
  replaceChatMessages(chat, result.messages)
  await sessionStore.update(sessionId, { messages: result.messages }).catch((err) => {
    logChatAi('warn', 'context-compact:persist-failed', {
      sessionId,
      message: readableError(err),
    })
  })
}

const activeSessionId = computed(() => (
  props.draft ? null : (props.sessionId || sessionStore.activeSessionId)
))

const session = computed(() =>
  activeSessionId.value
    ? sessionStore.sessions.find(s => s.id === activeSessionId.value) ?? null
    : null
)

const activeDraftId = computed(() =>
  props.draft ? NEW_CHAT_DRAFT_ID : (session.value?.id ?? null)
)

const messages = computed(() => {
  const chat = activeChat.value
  // The engine is the source of truth once built; the store row is only a
  // pre-construction fallback (e.g. the brief window before ensureMessages
  // resolves on a cold open) so we never flash empty.
  if (chat) {
    try { return chat.messages ?? [] } catch { /* */ }
  }
  return session.value?.messages ?? []
})

const chatStatus = computed(() => {
  const chat = activeChat.value
  if (chat) {
    try { return chat.status } catch { /* */ }
  }
  return 'ready'
})

const isStreaming = computed(() =>
  chatStatus.value === 'streaming' || chatStatus.value === 'submitted'
)

const isEmptyChat = computed(() => messages.value.length === 0 && !isStreaming.value)

const showStepCapNotice = computed(() => {
  if (!activeSessionId.value || isStreaming.value) return false
  return stepCapHitSessionIds.has(activeSessionId.value)
})

// The raw error from the engine (object) or our local fallback (string).
const rawError = computed(() => {
  const chat = activeChat.value
  if (chat?.error) return chat.error
  return error.value
})

// Map to a friendly message + class (auth | limit | network | provider | unknown)
// so the banner can offer the action that actually resolves each kind.
// Banner contract (message + which actions to show) is a pure helper so it can
// be unit-tested without mounting ChatView. See chatErrorActions.js.
const errorActions = computed(() => chatErrorActions(rawError.value, settingsStore.anyKeyConfigured))
const chatError = computed(() => errorActions.value?.message ?? null)
const chatErrorKind = computed(() => errorActions.value?.kind ?? null)
const isAuthError = computed(() => chatErrorKind.value === 'auth')
const showRetry = computed(() => Boolean(errorActions.value?.showRetry))
const showOpenSettings = computed(() => Boolean(errorActions.value?.showOpenSettings))
const showErrorStartFresh = computed(() => Boolean(errorActions.value?.showStartFresh))

// --- Model list ---

const selectableModels = computed(() =>
  modelMenuItems(registry.value, settingsStore.keyStatuses)
)

const currentModelId = computed(() => {
  return session.value?.modelId || settingsStore.lastChatModel || ''
})

const concreteModel = computed(() =>
  resolveConcreteModel(registry.value, settingsStore.keyStatuses, currentModelId.value, 'chat')
)

// No provider has a key at all — gate sending and point the user at Settings
// instead of letting a send fail. Driven by the shared store, so it clears the
// instant a key is added. Wait for the store to load to avoid a boot flash.
const needsApiKey = computed(() => settingsStore.loaded && !settingsStore.anyKeyConfigured)

const contextWindow = computed(() => concreteModel.value?.contextWindow || 0)
const estimatedContextTokens = computed(() => {
  if (session.value?.lastContextTokens) return 0
  return estimateMessagesTokens(messages.value)
})
const contextTokens = computed(() => session.value?.lastContextTokens || estimatedContextTokens.value || 0)

const contextPercent = computed(() => {
  if (!contextWindow.value || !contextTokens.value) return 0
  return Math.min(1, contextTokens.value / contextWindow.value)
})

const costLabel = computed(() => {
  const cost = session.value?.usage?.estimatedCost
  if (!cost || cost < 0.001) return ''
  return '$' + cost.toFixed(cost < 0.1 ? 3 : 2)
})

const showUsageIndicators = computed(() => messages.value.length > 0)

const control = computed(() =>
  controlForModel(concreteModel.value, session.value?.controlId)
)

const supportsVision = computed(() =>
  modelSupportsVision(concreteModel.value)
)

const approvalModes = [
  { id: 'strict', label: 'Strict', desc: 'Ask before every action' },
  { id: 'normal', label: 'Normal', desc: 'Ask before changes and outside requests' },
  { id: 'developer', label: 'Allow all', desc: 'No approval prompts' },
]

// --- Approvals (inline, non-blocking) ---
// The agent's request appears in the conversation it belongs to instead of a
// blocking modal. A request for another conversation surfaces as an "Approve"
// status on that conversation in the Navigator.
const sessionApprovals = computed(() => approvalsStore.forSession(activeSessionId.value))
const activeApproval = computed(() => sessionApprovals.value[0] ?? null)

function approveActive(alwaysAllow) {
  const request = activeApproval.value
  if (request) void approvalsStore.respond(request.requestId, { approved: true, alwaysAllow })
}

function declineActive() {
  const request = activeApproval.value
  if (request) void approvalsStore.respond(request.requestId, { approved: false })
}

function reviewActive() {
  const request = activeApproval.value
  if (request) emit('reviewApproval', request)
}

const isArchived = computed(() => Boolean(session.value?.archived))

const canMarkDone = computed(() => {
  const s = session.value
  if (!s || s.archived || isStreaming.value) return false
  const kind = sessionStore.sessionStatusKind(s)
  return kind !== 'ready' && kind !== 'working'
})

async function aiApi(path) {
  if (!aiBaseUrlPromise) {
    aiBaseUrlPromise = window.kernel.getPort().then(port => `http://127.0.0.1:${port}`)
  }
  return `${await aiBaseUrlPromise}${path}`
}

// --- Scroll management ---

function scrollToBottom(smooth = false) {
  if (!scrollEl.value) return
  userScrolledUp.value = false
  scrollEl.value.scrollTo({
    top: scrollEl.value.scrollHeight,
    behavior: smooth ? 'smooth' : 'instant',
  })
}

function onScroll() {
  if (!scrollEl.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollEl.value
  const distFromBottom = scrollHeight - scrollTop - clientHeight
  showJumpBottom.value = distFromBottom > 120
  userScrolledUp.value = distFromBottom > 80
}

// Watch messages for auto-scroll
watch(messages, () => {
  if (!userScrolledUp.value) nextTick(() => scrollToBottom())
}, { deep: true })

// --- Mid-turn persistence ---
// Persist in-flight turns on each tool-result boundary so a crash does not
// lose the entire turn while its tool side effects persist on disk.
let lastPersistedToolCount = 0
let midTurnPersistTimer = null

function countCompletedToolResults(msgs) {
  let count = 0
  for (const msg of msgs) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.parts)) continue
    for (const part of msg.parts) {
      if (part && typeof part.type === 'string' && part.type.startsWith('tool-') && part.state === 'output-available') count++
      if (part && part.type === 'dynamic-tool' && part.state === 'output-available') count++
    }
  }
  return count
}

watch(messages, (msgs) => {
  if (!isStreaming.value || !session.value) return
  const toolCount = countCompletedToolResults(msgs)
  if (toolCount > lastPersistedToolCount) {
    lastPersistedToolCount = toolCount
    // Capture the session id NOW: if the user switches sessions inside the
    // debounce window, reading session.value at fire time would write this
    // session's messages into the other session's file.
    const sid = session.value.id
    const snapshot = [...msgs]
    // Debounce slightly so rapid tool completions don't hammer disk
    if (midTurnPersistTimer) clearTimeout(midTurnPersistTimer)
    midTurnPersistTimer = setTimeout(() => {
      sessionStore.update(sid, { messages: snapshot }).catch(() => {})
    }, 500)
  }
}, { deep: true })

// Reset the tool counter when streaming state changes
watch(isStreaming, (streaming) => {
  if (streaming) {
    lastPersistedToolCount = countCompletedToolResults(messages.value)
  } else {
    if (midTurnPersistTimer) clearTimeout(midTurnPersistTimer)
    midTurnPersistTimer = null
  }
})

// Reset scroll when switching sessions
watch(activeDraftId, (newId, oldId) => {
  userScrolledUp.value = false
  error.value = null

  // The mid-turn persistence counter tracks the visible session's messages;
  // re-baseline it so a switch never carries one session's count to another.
  lastPersistedToolCount = countCompletedToolResults(messages.value)

  // Save draft from old session
  if (oldId && composerRef.value) {
    const draftText = composerRef.value.draft || ''
    sessionStore.setDraft(oldId, draftText)
  }

  nextTick(() => {
    scrollToBottom()
    if (newId && composerRef.value) {
      composerRef.value.draft = sessionStore.getDraft(newId)
      nextTick(() => composerRef.value?.autoResize?.())
    }
    composerRef.value?.focus()
  })
}, { immediate: true })

// --- Chat lifecycle ---

// Construct a configured @ai-sdk/vue Chat engine. Caching, in-flight dedupe and
// hydrate-before-construct ordering are handled by useChatEngines; this factory
// only builds the engine from already-loaded messages.
async function buildChatEngine(sessionId, initialMessages, sess) {
  const api = await aiApi('/api/ai/chat')

  const chat = new Chat({
    id: sessionId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api,
      fetch: async (input, init) => {
        const started = performance.now()
        logChatAi('debug', 'request:start', { sessionId, api: String(input) })
        try {
          const response = await fetch(input, init)
          const durationMs = Math.round(performance.now() - started)
          if (!response.ok) {
            const body = await response.clone().text().catch(() => '')
            logChatAi('error', 'request:error', {
              sessionId,
              status: response.status,
              durationMs,
              body,
            })
          } else {
            logChatAi('debug', 'request:stream-open', {
              sessionId,
              status: response.status,
              durationMs,
            })
          }
          return response
        } catch (err) {
          logChatAi('error', 'request:failed', {
            sessionId,
            message: readableError(err),
          })
          throw err
        }
      },
      prepareSendMessagesRequest: ({ id, messages, trigger, messageId, body }) => {
        const currentSession = sessionStore.sessions.find(s => s.id === sessionId) || sess
        const model = resolveConcreteModel(registry.value, settingsStore.keyStatuses, currentSession.modelId || settingsStore.lastChatModel, 'chat')
        if (!model) throw new Error('No AI model available. Check your API keys in Settings.')
        const selectedControl = controlForModel(model, currentSession.controlId)
        return {
          body: {
            id,
            messages,
            trigger,
            messageId,
            modelId: model.id,
            controlId: currentSession.controlId || selectedControl.id,
            ...(Array.isArray(body?.skills) && body.skills.length ? { skills: body.skills } : {}),
          },
        }
      },
    }),
    onError: (err) => {
      logChatAi('error', 'chat:error', {
        sessionId,
        message: readableError(err),
      })
      sessionStore.clearTurnTimer(sessionId)
      sessionStore.setSessionStatus(sessionId, 'error')
      const errMsg = readableError(err)
      if (activeSessionId.value === sessionId) {
        error.value = errMsg
      } else {
        // Background session error: store it per-session, show a toast
        sessionStore.setSessionError(sessionId, errMsg)
        const s = sessionStore.sessions.find(x => x.id === sessionId)
        const label = s?.label || 'Background session'
        toastStore.push({ kind: 'error', message: `${label}: ${errMsg}` })
      }
    },
    onFinish: async ({ isError, isAbort, finishReason }) => {
      logChatAi('debug', 'chat:finish', {
        sessionId,
        isError,
        isAbort,
        finishReason,
        status: chat.status,
        messages: chat.messages?.length ?? 0,
      })
      if (isError) {
        sessionStore.clearTurnTimer(sessionId)
        sessionStore.setSessionStatus(sessionId, 'error')
        return
      }
      if (isAbort) {
        sessionStore.setSessionStatus(sessionId, chat.messages?.length ? 'done' : 'ready')
        return
      }
      error.value = null

      // Detect step-cap hit: finishReason 'tool-calls' means the model wanted
      // more tools but was stopped by the step limit.
      if (finishReason === 'tool-calls') {
        stepCapHitSessionIds.add(sessionId)
      }

      sessionStore.setSessionStatus(sessionId, 'done')
      const messagesWithElapsed = finishMessagesWithElapsed(sessionId, chat)
      await sessionStore.update(sessionId, { messages: messagesWithElapsed }).catch(() => {})
      if (activeSessionId.value === sessionId) await loadProjectFiles()
    },
  })

  return chat
}

// --- Send ---

async function handleSend({ text, attachments, contextChips }) {
  error.value = null

  const { sessionId, session: sess, created } = await ensureTargetSession()
  const chat = await getOrCreateChat(sessionId)
  if (created) engines.setActiveFromCache(sessionId)

  // Clear draft on send
  sessionStore.setDraft(sessionId, '')
  sessionStore.setDraft(NEW_CHAT_DRAFT_ID, '')

  sessionStore.setSessionStatus(sessionId, 'working')

  let resolvedAttachments = [...(attachments || [])]
  try {
    resolvedAttachments = [
      ...resolvedAttachments,
      ...await resolveContextChips(contextChips || []),
    ]
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    composerRef.value?.setAttachError?.(message)
    sessionStore.setSessionStatus(sessionId, 'ready')
    return
  }

  const taskLabelContext = taskLabelContextLabels(attachments || [], contextChips || [])
  const canRequestTaskLabel = shouldRequestTaskLabel(sess, messages.value.length)
  let replaceableTaskLabel = sess.label

  if (canRequestTaskLabel) {
    const provisionalLabel = provisionalTaskLabel(text, taskLabelContext)
    if (provisionalLabel && provisionalLabel !== sess.label) {
      try {
        await sessionStore.update(sessionId, { label: provisionalLabel })
        replaceableTaskLabel = provisionalLabel
      } catch (err) {
        logChatAi('warn', 'task-label:provisional-failed', {
          sessionId,
          message: readableError(err),
        })
      }
    }
  }

  void maybeGenerateTaskLabel({
    sessionId,
    shouldRequest: canRequestTaskLabel,
    text,
    contextLabels: taskLabelContext,
    replaceableLabel: replaceableTaskLabel,
  })

  const sendPayload = {
    parts: toUserMessageParts(text, resolvedAttachments),
  }
  const selectedSkillIds = (contextChips || [])
    .filter(chip => chip.type === 'skill' && chip.id)
    .map(chip => chip.id)

  // chat.messages/status are reactive Vue refs: streaming updates flow into the
  // messages computed (which drives auto-scroll), and completion is handled by
  // the Chat's onFinish/onError callbacks. No polling required.
  try {
    await compactChatHistoryForContext(sessionId, chat)
    sessionStore.startTurnTimer(sessionId)
    await chat.sendMessage(sendPayload, selectedSkillIds.length ? { body: { skills: selectedSkillIds } } : undefined)
  } catch (err) {
    sessionStore.clearTurnTimer(sessionId)
    logChatAi('error', 'send:failed', {
      sessionId,
      message: readableError(err),
    })
    error.value = readableError(err)
    sessionStore.setSessionStatus(sessionId, 'error')
  }
}

async function sendExternalMessage(message) {
  await handleSend({
    text: message,
    attachments: [],
    contextChips: [],
  })
}

function prepareDraft(payload) {
  composerRef.value?.prepareDraft?.(payload)
  saveActiveDraft()
}

defineExpose({ sendExternalMessage, prepareDraft })

async function maybeGenerateTaskLabel({ sessionId, shouldRequest, text, contextLabels, replaceableLabel }) {
  if (!shouldRequest) return
  try {
    const label = await requestTaskLabel(await aiApi(''), {
      userText: text,
      contextLabels,
    })
    if (!label) return

    const current = sessionStore.sessions.find(s => s.id === sessionId)
    const labelCanBeReplaced = isPlaceholderTaskLabel(current?.label) || current?.label === replaceableLabel
    if (!current || current.taskLabelGenerated || !labelCanBeReplaced) return
    await sessionStore.update(sessionId, { label, taskLabelGenerated: true })
  } catch (err) {
    logChatAi('warn', 'task-label:failed', {
      sessionId,
      message: readableError(err),
    })
  }
}

async function ensureTargetSession() {
  let sessionId = activeSessionId.value
  let created = false

  if (sessionId && !sessionStore.sessions.some(s => s.id === sessionId)) {
    await sessionStore.select(sessionId)
  }

  let sess = sessionId
    ? sessionStore.sessions.find(s => s.id === sessionId) ?? null
    : null

  if (!sessionId || !sess) {
    sess = await sessionStore.create(currentModelId.value, { reuseEmpty: false })
    sessionId = sess.id
    created = true
    emit('sessionCreated', sessionId)
    await nextTick()
  }

  return { sessionId, session: sess, created }
}

async function resolveContextChips(chips) {
  const resolved = []
  const selectedContext = []

  for (const chip of chips) {
    if (chip.type === 'project-file') {
      const path = chip.path || chip.id
      if (!path) continue
      let result
      try {
        result = await window.kernel.call('fs.read', {
          path,
          max_chars: 200000,
        })
      } catch {
        throw new Error(`Could not read ${chip.label || path}`)
      }
      const content = result?.content ?? ''
      const mediaType = chip.mediaType || mediaTypeFromFilename(path) || 'text/plain'
      resolved.push(projectFileContextAttachment({ ...chip, path }, content, mediaType))
      continue
    }

    if (chip.type === 'document') {
      const document = await getCurrentDocument()
      if (!document) throw new Error('Current document context is not available')
      const filename = document.name || document.path?.split('/').pop() || 'current-document.md'
      const mediaType = document.mediaType || mediaTypeFromFilename(filename) || 'text/plain'
      resolved.push(documentContextAttachment(chip, document, mediaType))
      continue
    }

    if (chip.type === 'skill') {
      // Activation is deterministic: the skill id travels in the request body
      // and the runtime injects the body before step one. This part is only
      // the visible trace on the user message.
      const content = `Skill activated for this request.${chip.desc ? `\n\n${chip.desc}` : ''}`
      resolved.push({
        filename: `Skill: ${chip.label}`,
        mediaType: 'text/markdown',
        content,
        type: 'text',
        size: new Blob([content]).size,
        _contextChipId: chip.id,
      })
      continue
    }

    if (chip.type === 'package-tool') {
      selectedContext.push(`Tool preference: ${chip.label}${chip.packageName ? ` (${chip.packageName})` : ''}${chip.desc ? `\n${chip.desc}` : ''}`)
    }
  }

  if (selectedContext.length) {
    const content = [
      '# Selected composer context',
      '',
      ...selectedContext.map(item => `- ${item.replace(/\n/g, '\n  ')}`),
    ].join('\n')
    resolved.push({
      filename: 'composer-context.md',
      mediaType: 'text/markdown',
      content,
      type: 'text',
      size: new Blob([content]).size,
    })
  }

  return resolved
}

// --- Stop ---

async function handleStop() {
  const chat = activeChat.value
  if (chat) {
    try {
      await chat.stop()
    } catch { /* stop may throw if not streaming */ }
    if (session.value) {
      const sid = session.value.id
      // Cancel pending approval requests so they resolve as denied in the gate
      // and the inline approval cards disappear immediately.
      try { await window.kernel.cancelGateSession(sid) } catch { /* best effort */ }
      approvalsStore.clearSession(sid)
      sessionStore.setSessionStatus(sid, 'done')
      const messagesWithElapsed = finishMessagesWithElapsed(sid, chat)
      await sessionStore.update(sid, { messages: messagesWithElapsed })
    }
  }
}

async function persistActiveChatMessages() {
  const s = session.value
  const chat = activeChat.value
  if (!s || !chat) return
  try {
    await sessionStore.update(s.id, { messages: chat.messages ?? [] })
  } catch {
    // Archiving should still work if the latest in-memory message flush fails.
  }
}

async function handleDone() {
  const s = session.value
  if (!s || !canMarkDone.value) return
  const sessionId = s.id
  await persistActiveChatMessages()
  engines.evict(sessionId)
  emit('archiveSession', sessionId)
}

async function handleRestore() {
  const s = session.value
  if (!s?.archived) return
  await sessionStore.restore(s.id)
}

// --- Start fresh from summary ---

const startingFresh = ref(false)

async function handleStartFresh() {
  if (startingFresh.value) return
  startingFresh.value = true
  try {
    const currentMessages = messages.value
    const currentChips = composerRef.value?.contextChips ?? []
    let summary = ''
    try {
      const baseUrl = await aiApi('')
      summary = await requestSummary(baseUrl, { messages: currentMessages })
    } catch {
      // summary generation failed; fall back to last user message
    }
    const fallback = lastUserMessageText(currentMessages)
    const seedText = buildSeedMessage(summary, fallback)

    // Create a new session
    const newSession = await sessionStore.create(currentModelId.value, { reuseEmpty: false })
    emit('sessionCreated', newSession.id)
    await nextTick()

    // Seed it with the summary as the first user message + carried context chips
    if (seedText) {
      const chat = await getOrCreateChat(newSession.id)
      engines.setActiveFromCache(newSession.id)
      const payload = {
        parts: toUserMessageParts(seedText, []),
      }
      sessionStore.setSessionStatus(newSession.id, 'working')
      sessionStore.startTurnTimer(newSession.id)
      await chat.sendMessage(payload)
    }

    if (!summary && fallback) {
      toastStore.push({ kind: 'info', message: 'Summary generation was not available. Continued with your last message.' })
    }
  } catch (err) {
    toastStore.push({ kind: 'error', message: 'Could not start a fresh session.' })
    logChatAi('error', 'start-fresh:failed', { message: readableError(err) })
  } finally {
    startingFresh.value = false
  }
}

// --- Continue after step cap ---

async function handleContinue() {
  const sid = activeSessionId.value
  if (!sid) return
  stepCapHitSessionIds.delete(sid)
  // Send a continuation prompt to resume the agent loop
  await handleSend({
    text: 'Continue where you left off.',
    attachments: [],
    contextChips: [],
  })
}

function onApprovalModeChange(mode) {
  settingsStore.set('automationApprovalMode', mode)
}

// --- Retry last assistant message ---

async function handleRetry() {
  const chat = activeChat.value
  if (!chat) return
  try {
    if (session.value) {
      sessionStore.setSessionStatus(session.value.id, 'working')
      sessionStore.startTurnTimer(session.value.id)
    }
    // Reactive: streaming flows through chat.messages; completion via onFinish.
    await chat.regenerate()
  } catch (err) {
    if (session.value) sessionStore.clearTurnTimer(session.value.id)
    error.value = err?.message || 'Retry failed'
  }
}

// --- Error handling ---

function dismissError() {
  error.value = null
  const chat = activeChat.value
  if (chat) {
    try { chat.clearError() } catch { /* */ }
  }
}

function retryAfterError() {
  dismissError()
  handleRetry()
}

function requestOpenSettings() {
  emit('openSettings')
}

// When keys change (e.g. the user just added one in Settings), a stale
// "no key / no model" banner is now wrong. Clear it the moment a usable model
// resolves, so the chat stops claiming there's no key without a manual retry.
watch(() => settingsStore.keyStatuses, () => {
  if (isAuthError.value && concreteModel.value) dismissError()
}, { deep: true })

function saveActiveDraft() {
  const draftId = props.draft ? NEW_CHAT_DRAFT_ID : session.value?.id
  if (!draftId || !composerRef.value) return
  sessionStore.setDraft(draftId, composerRef.value.draft || '')
}

// --- Model change ---

function onModelChange(modelId) {
  const nextModel = resolveConcreteModel(registry.value, settingsStore.keyStatuses, modelId, 'chat')
  const nextControlId = controlForModel(nextModel).id
  if (session.value) {
    sessionStore.update(session.value.id, { modelId, controlId: nextControlId })
  }
  settingsStore.set('lastChatModel', modelId)
}

function onControlChange(controlId) {
  if (session.value) {
    sessionStore.update(session.value.id, { controlId })
  }
}

// --- Open file in editor ---

function onOpenFile(path) {
  emit('openFile', path)
}

async function refreshCurrentDocumentSummary() {
  currentDocumentSummary.value = await getCurrentDocumentSummary()
}

// --- Composer context sources ---

async function loadComposerSources() {
  await Promise.all([
    loadProjectFiles(),
    loadPackageContext(),
  ])
}

async function loadProjectFiles() {
  try {
    const result = await window.kernel.call('fs.list', {
      path: '.',
      recursive: true,
      max_entries: 1000,
    })
    const entries = Array.isArray(result?.entries) ? result.entries : []
    projectFiles.value = entries
      .filter(entry => entry?.type === 'file')
      .map(entry => {
        const mediaType = mediaTypeFromFilename(entry.path)
        return {
          path: entry.path,
          name: entry.name || entry.path.split('/').pop(),
          mediaType,
        }
      })
      .filter(file => isTextType(file.mediaType))
      .slice(0, 300)
  } catch {
    projectFiles.value = []
  }
}

async function loadPackageContext() {
  const skillResult = await window.kernel.call('skill.list').catch(() => ({ skills: [] }))
  composerSkills.value = Array.isArray(skillResult?.skills)
    ? skillResult.skills.map(skill => ({
      id: skill.name || skill.id,
      name: skill.name || skill.id,
      desc: skill.description || '',
      packageName: skill.source ? `skill:${skill.source}` : 'skill',
    }))
    : []

  try {
    const result = await window.kernel.call('package.capabilities.list')
    const packages = Array.isArray(result?.packages) ? result.packages : []
    packageTools.value = packages.flatMap(pkg =>
      (Array.isArray(pkg.tools) ? pkg.tools : []).map(tool => ({
        id: tool.name || tool.id,
        name: tool.label || tool.name || tool.id,
        description: tool.description || '',
        packageName: pkg.packageId,
      }))
    )
  } catch {
    try {
      const result = await window.kernel.call('package.tools.list')
      const tools = Array.isArray(result?.tools) ? result.tools : []
      packageTools.value = tools.map(tool => ({
        id: tool.name || tool.id,
        name: tool.label || tool.name || tool.id,
        description: tool.description || '',
        packageName: tool.packageId,
      }))
    } catch {
      packageTools.value = []
    }
  }
}

// --- Last assistant index helper ---

function isLastAssistantIndex(idx) {
  const msgs = messages.value
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return i === idx
  }
  return false
}

function isActiveAssistantIndex(idx) {
  if (!['submitted', 'streaming'].includes(chatStatus.value)) return false
  const msgs = messages.value
  let latestUserIndex = -1
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') {
      latestUserIndex = i
      break
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return i === idx && i > latestUserIndex
  }
  return false
}

// --- Keyboard shortcuts ---

function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') {
    e.preventDefault()
    scrollToBottom(true)
  }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
    const target = e.target
    if (!rootEl.value?.contains(target)) return
    e.preventDefault()
    if (isArchived.value) handleRestore()
    else handleDone()
  }
}

// --- Init ---

watch(() => activeSessionId.value, async (id) => {
  if (id) {
    error.value = null
    // Surface a cached engine immediately (no flash); getOrCreateChat then
    // hydrates history and builds the engine if this was a cache miss.
    engines.setActiveFromCache(id)
    await getOrCreateChat(id)
    // Surface a stored background error when switching to this session
    const s = sessionStore.sessions.find(x => x.id === id)
    if (s?.lastError) {
      error.value = s.lastError
      sessionStore.clearSessionError(id)
    }
  } else {
    engines.setActiveFromCache(null)
  }
}, { immediate: true })

function onWorkspaceChanged() {
  loadComposerSources()
}

function onPackagesChanged() {
  loadPackageContext()
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  try {
    registry.value = await window.kernel.call('ai.registry')
    await settingsStore.refreshKeyStatuses()
    await loadComposerSources()
    await refreshCurrentDocumentSummary()
  } catch (e) {
    error.value = 'Failed to load AI configuration'
  }
  unsubscribeCurrentDocument = subscribeCurrentDocument(refreshCurrentDocumentSummary)
  window.kernel.on('workspace:changed', onWorkspaceChanged)
  window.kernel.on('packages:changed', onPackagesChanged)
})

onDeactivated(() => {
  saveActiveDraft()
})

onUnmounted(() => {
  saveActiveDraft()
  document.removeEventListener('keydown', onKeydown)
  unsubscribeCurrentDocument?.()
  unsubscribeCurrentDocument = null
  window.kernel.off('workspace:changed', onWorkspaceChanged)
  window.kernel.off('packages:changed', onPackagesChanged)
})
</script>

<template>
  <div ref="rootEl" class="flex h-full min-w-0 flex-col overflow-hidden bg-chrome-high">
    <!-- Empty landing -->
    <div v-if="isEmptyChat" class="flex min-h-0 flex-1 overflow-y-auto px-8">
      <div class="mx-auto flex min-h-full w-full max-w-[640px] flex-col items-center justify-center pb-24 pt-8">
        <h1 class="mb-5 font-brand text-[22px] font-normal leading-tight tracking-normal text-ink">
          What should we work on?
        </h1>
        <div
          v-if="needsApiKey"
          class="mb-3 flex w-full max-w-[640px] items-center gap-2 rounded-[6px] border border-rule-light bg-chrome-mid px-3 py-2 font-sans text-[12px] text-ink-2"
        >
          <span class="flex-1">Add an API key to start chatting.</span>
          <button class="font-semibold text-accent px-2 py-0.5 rounded hover:bg-accent-tint" @click="requestOpenSettings">Open Settings</button>
        </div>
        <ChatComposer
          ref="composerRef"
          layout="landing"
          :model-id="currentModelId"
          :models="selectableModels"
          :control-id="control.id"
          :control-label="control.label"
          :control-options="control.options"
          :disabled="false"
          :busy="isStreaming"
          :can-send="!isStreaming && !needsApiKey"
          :cost-label="costLabel"
          :context-percent="contextPercent"
          :context-tokens="contextTokens"
          :context-window="contextWindow"
          :show-usage-indicators="showUsageIndicators"
          :supports-vision="supportsVision"
          :skills="composerSkills"
          :project-files="projectFiles"
          :package-tools="packageTools"
          :has-document="Boolean(currentDocumentSummary)"
          :document-name="currentDocumentSummary?.name || ''"
          @send="handleSend"
          @stop="handleStop"
          @start-fresh="handleStartFresh"
          @update:model-id="onModelChange"
          @update:control-id="onControlChange"
        />
        <ChatComposerFooter
          layout="landing"
          :mode="settingsStore.automationApprovalMode"
          :modes="approvalModes"
          :can-mark-done="canMarkDone"
          :is-archived="isArchived"
          @update:mode="onApprovalModeChange"
          @done="handleDone"
          @restore="handleRestore"
        />
      </div>
    </div>

    <!-- Scroll area -->
    <div v-else class="flex-1 relative overflow-hidden min-h-0">
      <div ref="scrollEl" class="absolute inset-0 overflow-y-auto pt-6 px-8 pb-8 flex flex-col" @scroll="onScroll">
        <!-- Messages -->
        <div class="max-w-[720px] w-full mx-auto flex flex-col gap-5">
          <template v-for="(msg, idx) in messages" :key="msg.id">
            <ChatMessage
              :message="msg"
              :is-last-assistant="msg.role === 'assistant' && isLastAssistantIndex(idx)"
              :is-active-assistant="msg.role === 'assistant' && isActiveAssistantIndex(idx)"
              :chat-status="chatStatus"
              @retry="handleRetry"
              @open-file="onOpenFile"
            />
          </template>
        </div>
      </div>

      <!-- Jump to bottom button -->
      <Transition name="cv-jump-fade">
        <button
          v-if="showJumpBottom"
          class="absolute bottom-2 right-[max(12px,calc(50%-360px-12px))] w-9 h-9 rounded-full flex items-center justify-center text-ink-3 bg-surface border border-rule shadow-sm z-[5] hover:text-ink hover:bg-chrome-high"
          title="Jump to bottom"
          @click="scrollToBottom(true)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>
        </button>
      </Transition>
    </div>

    <!-- Inline approval (non-blocking, pinned above the composer) -->
    <div v-if="activeApproval" class="shrink-0 px-8 pt-2">
      <div class="mx-auto w-full max-w-[720px]">
        <InlineApproval
          :approval="activeApproval"
          :queue-length="sessionApprovals.length"
          @approve="approveActive"
          @decline="declineActive"
          @review="reviewActive"
        />
      </div>
    </div>

    <!-- Error bar -->
    <div v-if="chatError" class="flex items-center gap-2 px-8 py-2 bg-rem/6 border-t border-rem/15 font-sans text-xs text-rem shrink-0">
      <svg class="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <span class="flex-1">{{ chatError }}</span>
      <button v-if="showErrorStartFresh" class="text-[11px] font-semibold text-accent px-2 py-0.5 rounded hover:bg-accent-tint" @click="handleStartFresh">Start fresh</button>
      <button v-if="showOpenSettings" class="text-[11px] font-semibold text-accent px-2 py-0.5 rounded hover:bg-accent-tint" @click="requestOpenSettings">Open Settings</button>
      <button v-if="showRetry" class="text-[11px] font-semibold text-accent px-2 py-0.5 rounded hover:bg-accent-tint" @click="retryAfterError">Retry</button>
      <button class="text-[11px] text-ink-3 underline hover:text-ink" @click="dismissError">Dismiss</button>
    </div>

    <!-- Step-cap notice -->
    <div v-if="showStepCapNotice" class="flex items-center gap-2 px-8 py-2 bg-accent-tint border-t border-rule-light font-sans text-xs text-ink-2 shrink-0">
      <svg class="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span class="flex-1">Stopped after 100 steps. The task may not be complete.</span>
      <button class="text-[11px] font-semibold text-accent px-2 py-0.5 rounded hover:bg-chrome-mid" @click="handleContinue">Continue</button>
    </div>

    <!-- API key gate (no provider configured) -->
    <div
      v-if="!isEmptyChat && needsApiKey"
      class="flex items-center gap-2 px-8 py-2 bg-chrome-mid border-t border-rule-light font-sans text-xs text-ink-2 shrink-0"
    >
      <span class="flex-1">Add an API key to start chatting.</span>
      <button class="text-[11px] font-semibold text-accent px-2 py-0.5 rounded hover:bg-accent-tint" @click="requestOpenSettings">Open Settings</button>
    </div>

    <!-- Composer -->
    <ChatComposer
      v-if="!isEmptyChat"
      ref="composerRef"
      :model-id="currentModelId"
      :models="selectableModels"
      :control-id="control.id"
      :control-label="control.label"
      :control-options="control.options"
      :disabled="false"
      :busy="isStreaming"
      :can-send="!isStreaming && !needsApiKey"
      :cost-label="costLabel"
      :context-percent="contextPercent"
      :context-tokens="contextTokens"
      :context-window="contextWindow"
      :show-usage-indicators="showUsageIndicators"
      :supports-vision="supportsVision"
      :skills="composerSkills"
      :project-files="projectFiles"
      :package-tools="packageTools"
      :has-document="Boolean(currentDocumentSummary)"
      :document-name="currentDocumentSummary?.name || ''"
      @send="handleSend"
      @stop="handleStop"
      @update:model-id="onModelChange"
      @update:control-id="onControlChange"
    />
    <ChatComposerFooter
      v-if="!isEmptyChat"
      :mode="settingsStore.automationApprovalMode"
      :modes="approvalModes"
      :can-mark-done="canMarkDone"
      :is-archived="isArchived"
      @update:mode="onApprovalModeChange"
      @done="handleDone"
      @restore="handleRestore"
    />
  </div>
</template>

<style scoped>
.cv-jump-fade-enter-active,
.cv-jump-fade-leave-active { transition: opacity 0.2s ease; }
.cv-jump-fade-enter-from,
.cv-jump-fade-leave-to { opacity: 0; }
</style>
