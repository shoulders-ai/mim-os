import { nextTick, ref, type ComputedRef } from 'vue'
import {
  addCommentAtRawRange,
  appendCommentReply,
  findCommentById,
  resolveComment,
  serializeComment,
  type CommentThread,
} from '@main/comments/model.js'
import type { useSettingsStore } from '../../stores/settings.js'
import type { useToastStore } from '../../stores/toasts.js'
import {
  buildCommentsContextAttachment,
  buildCommentsInstruction,
  toCommentThreadContext,
} from '../../services/comments/sendToChat.js'
import { commentMutation, getCommentState, setActiveComment } from './codemirror/comments.js'

type SettingsStore = ReturnType<typeof useSettingsStore>
type ToastStore = ReturnType<typeof useToastStore>

interface ChatDraftPayload {
  targetSessionId?: string | null
  text: string
  attachments: unknown[]
  contextChips?: unknown[]
}

interface UseEditorCommentsOptions {
  activeIsMarkdown: ComputedRef<boolean>
  historyPreviewActive: ComputedRef<boolean>
  activeTabTruncated: ComputedRef<boolean>
  activeTabReadOnly: ComputedRef<boolean>
  activeDocumentLabel: ComputedRef<string>
  activeTabId: ComputedRef<string>
  settingsStore: SettingsStore
  toastStore: ToastStore
  getEditorView: () => any
  activeDocumentText: () => string
  openInlineAIForComment: (selection: Record<string, unknown>) => void
  onStartComment?: () => void
  prepareChatDraft: (payload: ChatDraftPayload) => void
}

export function useEditorComments(options: UseEditorCommentsOptions) {
  const commentThreads = ref<CommentThread[]>([])
  const activeCommentId = ref<string | null>(null)
  const draftComment = ref<{ from: number; to: number; anchor: string } | null>(null)
  const commentContextMenu = ref<{ x: number; y: number } | null>(null)
  const commentRailCollapsed = ref(false)

  function currentCommentAuthor(): string {
    return options.settingsStore.configUserName || options.settingsStore.configUserEmail || 'user'
  }

  function syncCommentThreadsFromEditor() {
    const editorView = options.getEditorView()
    if (!editorView || !options.activeIsMarkdown.value || options.activeTabReadOnly.value) {
      commentThreads.value = []
      activeCommentId.value = null
      return
    }
    const state = getCommentState(editorView.state)
    commentThreads.value = state.threads
    if (activeCommentId.value && !state.threads.some((thread: any) => thread.id === activeCommentId.value)) {
      activeCommentId.value = null
    }
  }

  function selectedCommentRange(): { from: number; to: number; anchor: string } | null {
    const editorView = options.getEditorView()
    if (
      !editorView ||
      options.historyPreviewActive.value ||
      !options.activeIsMarkdown.value ||
      options.activeTabTruncated.value ||
      options.activeTabReadOnly.value
    ) {
      return null
    }
    const selection = editorView.state.selection?.main
    if (!selection || selection.empty) return null
    const from = Math.min(selection.from, selection.to)
    const to = Math.max(selection.from, selection.to)
    if (to <= from) return null
    const text = options.activeDocumentText().slice(from, to)
    if (!text.trim()) return null
    return { from, to, anchor: text }
  }

  function setEditorActiveComment(id: string | null, params: { scroll?: boolean } = {}) {
    activeCommentId.value = id
    const editorView = options.getEditorView()
    if (!editorView) return
    const effects = [setActiveComment.of(id)]
    const thread = id ? findCommentById(options.activeDocumentText(), id) : null
    if (thread && params.scroll) {
      editorView.dispatch({
        selection: { anchor: thread.anchorFrom },
        effects,
        scrollIntoView: true,
      })
    } else {
      editorView.dispatch({ effects })
    }
  }

  function afterCommentMutation(id: string | null = activeCommentId.value) {
    nextTick(() => {
      syncCommentThreadsFromEditor()
      setEditorActiveComment(id)
      options.getEditorView()?.focus()
    })
  }

  function startAddComment() {
    if (options.historyPreviewActive.value || options.activeTabReadOnly.value) return
    const range = selectedCommentRange()
    if (!range) {
      options.toastStore.push({ kind: 'info', message: 'Select text to comment' })
      return
    }
    options.onStartComment?.()
    commentRailCollapsed.value = false
    draftComment.value = range
    setEditorActiveComment(null)
  }

  function openEditorContextMenu(event: MouseEvent) {
    if (options.historyPreviewActive.value || options.activeTabReadOnly.value) return
    if (!options.activeIsMarkdown.value || !selectedCommentRange()) return
    event.preventDefault()
    event.stopPropagation()
    commentContextMenu.value = { x: event.clientX, y: event.clientY }
  }

  function cancelCommentDraft() {
    draftComment.value = null
    nextTick(() => options.getEditorView()?.focus())
  }

  function saveCommentDraft(text: string) {
    const editorView = options.getEditorView()
    if (!draftComment.value || !editorView) return
    const range = draftComment.value
    const raw = options.activeDocumentText()
    if (raw.slice(range.from, range.to) !== range.anchor) {
      options.toastStore.push({ kind: 'error', message: 'Comment range changed', detail: 'Select the text again and add the comment.' })
      draftComment.value = null
      return
    }

    try {
      const result = addCommentAtRawRange(raw, {
        from: range.from,
        to: range.to,
        text,
        by: currentCommentAuthor(),
      })
      const inserted = result.text.slice(range.from, result.text.length - (raw.length - range.to))
      draftComment.value = null
      editorView.dispatch({
        changes: { from: range.from, to: range.to, insert: inserted },
        annotations: commentMutation.of(true),
        effects: setActiveComment.of(result.thread.id),
        scrollIntoView: true,
      })
      activeCommentId.value = result.thread.id
      afterCommentMutation(result.thread.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Comment not added', detail: message })
    }
  }

  function replaceDocumentForComment(nextText: string, nextActiveId: string | null) {
    const editorView = options.getEditorView()
    if (!editorView) return
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: nextText },
      annotations: commentMutation.of(true),
      effects: setActiveComment.of(nextActiveId),
      scrollIntoView: Boolean(nextActiveId),
    })
    activeCommentId.value = nextActiveId
    afterCommentMutation(nextActiveId)
  }

  function replyToComment(id: string, text: string) {
    try {
      const result = appendCommentReply(options.activeDocumentText(), {
        id,
        text,
        by: currentCommentAuthor(),
      })
      replaceDocumentForComment(result.text, result.thread.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Reply failed', detail: message })
    }
  }

  function editCommentNote(id: string, noteIndex: number, text: string) {
    const editorView = options.getEditorView()
    if (!editorView) return
    try {
      const raw = options.activeDocumentText()
      const thread = findCommentById(raw, id)
      if (!thread) throw new Error(`Comment not found: ${id}`)
      if (noteIndex < 0 || noteIndex >= thread.notes.length) throw new Error('Note not found')
      const notes = thread.notes.map((note, index) => index === noteIndex ? { ...note, text } : note)
      const replacement = serializeComment(thread.id, thread.anchor, notes)
      editorView.dispatch({
        changes: { from: thread.tagFrom, to: thread.tagTo, insert: replacement },
        annotations: commentMutation.of(true),
        effects: setActiveComment.of(id),
        scrollIntoView: true,
      })
      activeCommentId.value = id
      afterCommentMutation(id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Edit failed', detail: message })
    }
  }

  function resolveCommentThread(id: string) {
    const editorView = options.getEditorView()
    if (!editorView) return
    try {
      const raw = options.activeDocumentText()
      const thread = findCommentById(raw, id)
      if (!thread) throw new Error(`Comment not found: ${id}`)
      resolveComment(raw, id)
      editorView.dispatch({
        changes: { from: thread.tagFrom, to: thread.tagTo, insert: thread.anchor },
        annotations: commentMutation.of(true),
        effects: setActiveComment.of(null),
      })
      activeCommentId.value = null
      afterCommentMutation(null)
      const viewAtResolve = editorView
      const tabId = options.activeTabId.value
      options.toastStore.push({
        kind: 'info',
        message: 'Comment resolved',
        actionLabel: 'Undo',
        action: () => {
          if (!viewAtResolve || options.activeTabId.value !== tabId) return
          void import('@codemirror/commands').then(({ undo }) => {
            undo(viewAtResolve)
            afterCommentMutation(id)
          })
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Resolve failed', detail: message })
    }
  }

  async function copyCommentAnchor(id: string) {
    const thread = findCommentById(options.activeDocumentText(), id)
    if (!thread) return
    try {
      await navigator.clipboard?.writeText(thread.anchor)
      options.toastStore.push({ kind: 'info', message: 'Anchor copied' })
    } catch {
      options.toastStore.push({ kind: 'error', message: 'Copy failed' })
    }
  }

  function commentInstruction(thread: CommentThread): string {
    const lines = [
      'Resolve this comment thread by editing the selected passage. Return the replacement text with the suggest_edit tool.',
      '',
      `Anchor: ${thread.anchor}`,
      '',
      'Thread:',
      ...thread.notes.map(note => `${note.by}: ${note.text}`),
    ]
    return lines.join('\n')
  }

  function applyCommentAsEdit(id: string) {
    const thread = findCommentById(options.activeDocumentText(), id)
    if (!thread) return
    setEditorActiveComment(id, { scroll: true })
    options.openInlineAIForComment({
      from: thread.anchorFrom,
      to: thread.anchorTo,
      text: thread.anchor,
      commentId: id,
      initialInstruction: commentInstruction(thread),
      autoSubmit: true,
    })
  }

  function sendCommentsToChat(ids: string[], targetSessionId: string | null = null) {
    const selected = ids.length
      ? commentThreads.value.filter(thread => ids.includes(thread.id))
      : commentThreads.value
    if (!selected.length) return
    const context = {
      path: options.activeDocumentLabel.value,
      threads: selected.map(toCommentThreadContext),
      document: options.activeDocumentText(),
    }
    options.prepareChatDraft({
      targetSessionId,
      text: buildCommentsInstruction(context),
      attachments: [buildCommentsContextAttachment(context)],
    })
  }

  return {
    commentThreads,
    activeCommentId,
    draftComment,
    commentContextMenu,
    commentRailCollapsed,
    selectedCommentRange,
    syncCommentThreadsFromEditor,
    setEditorActiveComment,
    startAddComment,
    openEditorContextMenu,
    cancelCommentDraft,
    saveCommentDraft,
    replyToComment,
    editCommentNote,
    resolveCommentThread,
    copyCommentAnchor,
    applyCommentAsEdit,
    sendCommentsToChat,
  }
}
