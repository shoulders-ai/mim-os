import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  resolveComment,
} from '@main/comments/model.js'
import { resolveCodeComment } from '@main/comments/codeModel.js'
import { isMarkdownPath } from './codemirror/language.js'
import type { useDiffStore } from '../../stores/diff.js'
import type { useToastStore } from '../../stores/toasts.js'
import { commentMutation } from './codemirror/comments.js'
import { setInlineAnchor } from './codemirror/inlineAnchor.js'
import type { TabState } from './editorTypes.js'

type DiffStore = ReturnType<typeof useDiffStore>
type ToastStore = ReturnType<typeof useToastStore>

interface UseEditorInlineReviewOptions {
  activeTab: ComputedRef<TabState | null>
  historyPreviewActive: ComputedRef<boolean>
  diffStore: DiffStore
  toastStore: ToastStore
  editorContainer: Ref<HTMLElement | null>
  getEditorView: () => any
  activeDocumentText: () => string
  cancelHistoryPreview: (options?: { restoreViewMode?: boolean }) => void
  initEditor: () => void
  switchToDoc: (content: string) => void
  scheduleAutoSave: () => void
  notifyCurrentDocumentChanged: () => void
  conflictOverwrite: () => Promise<void>
  conflictReload: () => Promise<void>
  getResolvedDiffContent: () => string
}

export function useEditorInlineReview(options: UseEditorInlineReviewOptions) {
  const inlineAIState = ref<any>(null)
  const inlineAIKey = ref(0)
  const diffReviewBusy = ref(false)
  const diffReviewError = ref('')

  function buildSelectionContext(sel: any) {
    const doc = options.activeDocumentText()
    return {
      ...sel,
      contextBefore: doc.slice(Math.max(0, sel.from - 3000), sel.from),
      contextAfter: doc.slice(sel.to, Math.min(doc.length, sel.to + 1000)),
    }
  }

  function openInlineAI(sel: any) {
    if (options.historyPreviewActive.value) return
    if (options.activeTab.value?.readOnly) return
    if (options.diffStore.reviewMeta?.type === 'inline-ai') options.diffStore.deactivate()
    if (inlineAIState.value) inlineAIState.value = null
    inlineAIState.value = buildSelectionContext(sel)
    inlineAIKey.value++
  }

  function openInlineAIForComment(sel: Record<string, unknown>) {
    if (options.activeTab.value?.readOnly) return
    if (options.diffStore.reviewMeta?.type === 'inline-ai') options.diffStore.deactivate()
    inlineAIState.value = buildSelectionContext(sel)
    inlineAIKey.value++
  }

  function onInlineAIApply(replacement: string, from: number, to: number) {
    if (options.activeTab.value?.readOnly) return
    if (options.diffStore.active && options.diffStore.reviewMeta?.type === 'inline-ai') {
      void acceptActiveDiffReview()
      return
    }
    const editorView = options.getEditorView()
    if (editorView) {
      editorView.dispatch({ changes: { from, to, insert: replacement } })
    }
    inlineAIState.value = null
  }

  function onInlineAIActivateDiff(payload: { from: number; to: number; replacement: string }) {
    const tab = options.activeTab.value
    if (tab?.readOnly) return
    const editorView = options.getEditorView()
    const original = editorView?.state?.doc?.toString?.() ?? tab?.content ?? ''
    const modified = original.slice(0, payload.from) + payload.replacement + original.slice(payload.to)
    const commentId = typeof inlineAIState.value?.commentId === 'string' ? inlineAIState.value.commentId : undefined
    diffReviewError.value = ''
    options.diffStore.activate({
      source: 'inline-ai',
      original,
      modified,
      path: tab?.path || tab?.name || '',
      review: {
        type: 'inline-ai',
        from: payload.from,
        to: payload.to,
        tabId: tab?.id,
        commentId,
      },
      layout: 'unified',
    })
  }

  function onInlineAIDeactivateDiff() {
    if (options.diffStore.reviewMeta?.type === 'inline-ai') options.diffStore.deactivate()
  }

  function closeInlineAI() {
    onInlineAIDeactivateDiff()
    inlineAIState.value = null
    nextTick(() => options.getEditorView()?.focus())
  }

  function applyResolvedContentToActiveTab(content: string) {
    if (options.historyPreviewActive.value) options.cancelHistoryPreview({ restoreViewMode: false })
    const tab = options.activeTab.value
    if (!tab) return
    if (tab.kind !== 'text') return
    const editorView = options.getEditorView()
    if (editorView) {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: content },
        annotations: commentMutation.of(true),
      })
    } else {
      tab.content = content
      tab.dirty = tab.content !== tab.originalContent
      options.scheduleAutoSave()
      options.notifyCurrentDocumentChanged()
    }
  }

  function getActiveDiffResolvedContent(): string {
    return options.getResolvedDiffContent()
  }

  async function acceptActiveDiffReview() {
    if (!options.diffStore.active || diffReviewBusy.value) return

    const resolvedContent = getActiveDiffResolvedContent()
    options.diffStore.setResolvedContent(resolvedContent)

    if (options.diffStore.reviewMeta?.type === 'conflict') {
      // Accept in conflict review = overwrite disk with the resolved content.
      options.diffStore.deactivate()
      restoreEditorAfterDiffReview()
      await options.conflictOverwrite()
      return
    }

    if (options.diffStore.reviewMeta?.type === 'inline-ai') {
      let finalContent = resolvedContent
      const meta = options.diffStore.reviewMeta as { commentId?: string } | null
      if (meta?.commentId) {
        try {
          const isMd = isMarkdownPath(options.activeTab.value?.path ?? '')
          finalContent = isMd
            ? resolveComment(resolvedContent, meta.commentId).text
            : resolveCodeComment(resolvedContent, meta.commentId).text
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          options.toastStore.push({ kind: 'error', message: 'Comment resolve failed', detail: message })
        }
      }
      applyResolvedContentToActiveTab(finalContent)
      options.diffStore.deactivate()
      inlineAIState.value = null
      nextTick(() => options.getEditorView()?.focus())
    }
  }

  async function rejectActiveDiffReview() {
    if (!options.diffStore.active || diffReviewBusy.value) return

    if (options.diffStore.reviewMeta?.type === 'conflict') {
      // Reject in conflict review = reload from disk.
      options.diffStore.deactivate()
      restoreEditorAfterDiffReview()
      await options.conflictReload()
      return
    }

    if (options.diffStore.reviewMeta?.type === 'inline-ai') {
      options.diffStore.deactivate()
      inlineAIState.value = null
      nextTick(() => options.getEditorView()?.focus())
    }
  }

  function closeActiveDiffReview() {
    options.diffStore.deactivate()
    restoreEditorAfterDiffReview()
  }

  function restoreEditorAfterDiffReview() {
    nextTick(() => {
      if (options.editorContainer.value && !options.getEditorView()) {
        options.initEditor()
      } else if (options.getEditorView()) {
        options.switchToDoc(options.activeTab.value?.content ?? '')
      }
      options.notifyCurrentDocumentChanged()
    })
  }

  // Highlight the anchored text while the floating Cmd+K dialog is open, so
  // the dialog reads as attached to a target. Inline diff review provides its
  // own highlight, so clear this anchor while review mode is active.
  const inlineAnchorRange = computed(() => {
    const state = inlineAIState.value
    const inDiffReview = options.diffStore.active && options.diffStore.reviewMeta?.type === 'inline-ai'
    if (!state || inDiffReview) return null
    const from = Number(state.from)
    const to = Number(state.to)
    return Number.isFinite(from) && Number.isFinite(to) && from < to ? { from, to } : null
  })

  watch(inlineAnchorRange, (range) => {
    options.getEditorView()?.dispatch({ effects: setInlineAnchor.of(range) })
  })

  return {
    inlineAIState,
    inlineAIKey,
    diffReviewBusy,
    diffReviewError,
    openInlineAI,
    openInlineAIForComment,
    onInlineAIApply,
    onInlineAIActivateDiff,
    onInlineAIDeactivateDiff,
    closeInlineAI,
    applyResolvedContentToActiveTab,
    getActiveDiffResolvedContent,
    acceptActiveDiffReview,
    rejectActiveDiffReview,
    closeActiveDiffReview,
    restoreEditorAfterDiffReview,
  }
}
