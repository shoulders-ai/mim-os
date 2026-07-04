<script setup lang="ts">
import { ref, reactive, computed, watch, markRaw, onMounted, onBeforeUnmount, nextTick, shallowRef } from 'vue'
import EditorTabStrip from './EditorTabStrip.vue'
import EditorToolbar from './EditorToolbar.vue'
import ExportDialog from './ExportDialog.vue'
import EditorEmptyState from './EditorEmptyState.vue'
import EditorHistoryPreviewBanner from './EditorHistoryPreviewBanner.vue'
import EditorStatusBar from './EditorStatusBar.vue'
import BibliographyPopover from './BibliographyPopover.vue'
import HistoryRail from './HistoryRail.vue'
import PreviewPane from './PreviewPane.vue'
import InlineAI from './InlineAI.vue'
import DiffReviewBar from './DiffReviewBar.vue'
import DiffView from './DiffView.vue'
import ConflictBar from './ConflictBar.vue'
import CommentsMargin from './comments/CommentsMargin.vue'
import PdfArtifact from '../files/PdfArtifact.vue'
import FileCardArtifact from '../files/FileCardArtifact.vue'
import ImageArtifact from '../files/ImageArtifact.vue'
import TableArtifact from '../files/TableArtifact.vue'
import MimContextMenu from '../ui/MimContextMenu.vue'
import MimMenuItem from '../ui/MimMenuItem.vue'
import { createEditor, createEditorState, computeStats, languageCompartment } from './codemirror/core.js'
import { isMarkdownPath, languageExtensionForPath } from './codemirror/language.js'
import { livePreviewExtension } from './codemirror/livePreview.js'
import { outlineExtension } from './codemirror/outline.js'
import { ghostExtension } from './codemirror/ghost.js'
import { citationExtensions } from './codemirror/citations.js'
import { commentMutation, commentsExtension } from './codemirror/comments.js'
import { parseCodeComments, supportsCodeCommentPath } from '@main/comments/codeModel.js'
import { inlineAnchorExtension } from './codemirror/inlineAnchor.js'
import { useSettingsStore } from '../../stores/settings.js'
import { useDiffStore } from '../../stores/diff.js'
import { useApprovalsStore } from '../../stores/approvals.js'
import { useToastStore } from '../../stores/toasts.js'
import { requestGhostSuggestions } from '../../services/ai/ghost.js'
import { notifyCurrentDocumentChanged, registerCurrentDocumentProvider } from '../../services/currentDocument.js'
import {
  editorArtifactEntry,
  fileArtifactEntry,
  type ArtifactEntry,
} from '../../services/workbench/entries.js'
import { editorArtifactReplacementDecision } from '../../services/workbench/artifactReplacement.js'
import type { ArtifactReplacementDecision } from '../../stores/workbench.js'
import { marked } from 'marked'
import { IconHistory } from '@tabler/icons-vue'
import {
  VIEW_MODES,
  type FileVersion,
  type HistoryPreviewPayload,
  type TabKind,
  type TabState,
  type ViewMode,
} from './editorTypes.js'
import {
  extractFileVersion,
  fileExtensionForTelemetry,
  fileLabel,
} from './editorFileMeta.js'
import { useEditorCitations } from './useEditorCitations.js'
import { useEditorComments } from './useEditorComments.js'
import { useEditorFileSync } from './useEditorFileSync.js'
import { useEditorFormatting } from './useEditorFormatting.js'
import { useEditorInlineReview } from './useEditorInlineReview.js'
import { useEditorKeyboardShortcuts } from './useEditorKeyboardShortcuts.js'
import { useEditorSettingsEffects } from './useEditorSettingsEffects.js'
import { useEditorStatus } from './useEditorStatus.js'
import { useEditorTabPersistence } from './useEditorTabPersistence.js'
import { useEditorTableTab } from './useEditorTableTab.js'
import { getToolchainStatus, resetToolchainCache } from '../../services/toolchainStatus.js'
import { renderArgv, pickBestProduct, missingPdfEngineGuidance, type RenderProduct } from '../../services/renderDocument.js'

const viewModes = VIEW_MODES

const emit = defineEmits<{
  artifactActivated: [entry: ArtifactEntry]
  activeFileChanged: [path: string]
  allTabsClosed: []
  openFileDialogRequested: []
  prepareChatDraft: [payload: { targetSessionId?: string | null; text: string; attachments: unknown[]; contextChips?: unknown[] }]
  sendToTerminal: [payload: { text: string; language: string | null }]
}>()

const props = withDefaults(defineProps<{
  port?: number
}>(), {
  port: 0,
})

const editorContainer = ref<HTMLElement | null>(null)
const editorViewHandle = shallowRef<any>(null)
const diffViewRef = ref<InstanceType<typeof DiffView> | null>(null)
const tableArtifactRef = ref<InstanceType<typeof TableArtifact> | null>(null)
let editorView: any = null
let unregisterCurrentDocumentProvider: null | (() => void) = null
let unregisterWorkspaceFileChanges: null | (() => void) = null
let unregisterAppsChanged: null | (() => void) = null
let unregisterWorkspaceChanged: null | (() => void) = null
const watchedWorkspaceFiles = new Set<string>()

const tabs = reactive<TabState[]>([])
const activeTabIndex = ref(0)
const exportDialogOpen = ref(false)
const exportMarkdown = ref('')
const activeFormats = ref<string[]>([])
const stats = ref<{ words: number; characters: number; selected?: boolean }>({ words: 0, characters: 0 })
const historyRailOpen = ref(false)
const historyRefreshKey = ref(0)
const historyPreview = ref<HistoryPreviewPayload | null>(null)
const historyPreviewBusy = ref(false)
let historyPreviewReturnState: any = null
let historyPreviewReturnTabId = ''
let historyPreviewReturnViewMode: ViewMode | null = null
let historyPreviewReturnText: string | null = null
const historyPreviewActive = computed(() => Boolean(historyPreview.value))
const viewMode = ref<ViewMode>('source')
const showPreview = computed(() => viewMode.value !== 'source' && !historyPreviewActive.value)
const settingsStore = useSettingsStore()
const livePreviewEnabled = computed(() => settingsStore.editorLivePreview)
const diffStore = useDiffStore()
const approvalsStore = useApprovalsStore()
const toastStore = useToastStore()
const { applyEditorSettings } = useEditorSettingsEffects({
  settingsStore,
  editorContainer,
  getEditorView: () => editorView,
})

let editorFileSync: ReturnType<typeof useEditorFileSync> | null = null

const activeTab = computed(() => tabs[activeTabIndex.value] ?? null)
const activeIsText = computed(() => (activeTab.value?.kind ?? 'text') === 'text')
const activeIsTable = computed(() => activeTab.value?.kind === 'table')
const activeTabReadOnly = computed(() => activeTab.value?.readOnly === true)
const activeIsMarkdown = computed(() => activeIsText.value && isMarkdownPath(activeTab.value?.path ?? ''))
// Code and plain-text files support @mim line-marker comments when the file
// type has a known comment syntax (see commentPrefixForPath).
const activeSupportsComments = computed(() =>
  activeIsMarkdown.value ||
  (activeIsText.value && supportsCodeCommentPath(activeTab.value?.path ?? '')),
)
const {
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
  acceptActiveDiffReview,
  rejectActiveDiffReview,
  closeActiveDiffReview,
} = useEditorInlineReview({
  activeTab,
  historyPreviewActive,
  diffStore,
  toastStore,
  editorContainer,
  getEditorView: () => editorView,
  activeDocumentText,
  cancelHistoryPreview,
  initEditor,
  switchToDoc,
  scheduleAutoSave,
  notifyCurrentDocumentChanged,
  conflictOverwrite,
  conflictReload,
  getResolvedDiffContent: () => {
    const content = diffViewRef.value?.getResolvedContent?.()
    return typeof content === 'string' ? content : diffStore.effectiveContent
  },
})

// An approval preview is read-only: the Approve/Decline decision lives on the
// chat card. When the request is resolved there (or anywhere), close the stale
// preview so the panel never shows a change that has already been applied or
// dropped.
watch(
  () => approvalsStore.pending.map(item => item.requestId).join(','),
  () => {
    const meta = diffStore.reviewMeta as { type?: string; requestId?: string } | null
    if (diffStore.active && meta?.type === 'approval' && meta.requestId && !approvalsStore.get(meta.requestId)) {
      closeActiveDiffReview()
    }
  },
)

const {
  activeTableStats,
  setActiveTableDirty,
  updateActiveTableStats,
  applyTableLoadedSnapshot,
} = useEditorTableTab({ activeTab })
const {
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
  updateCommentDraftText,
  stashCommentDraftForTab,
  restoreCommentDraftForTab,
  replyToComment,
  editCommentNote,
  deleteCommentNote,
  resolveCommentThread,
  resolveAllCommentThreads,
  copyCommentAnchor,
  applyCommentAsEdit,
  sendCommentsToChat,
  requestAIReview,
} = useEditorComments({
  activeIsMarkdown,
  activeSupportsComments,
  activeFilePath: computed(() => activeTab.value?.path || ''),
  historyPreviewActive,
  activeTabTruncated: computed(() => activeTab.value?.truncated === true),
  activeTabReadOnly,
  activeDocumentLabel: computed(() => activeTab.value?.path || activeTab.value?.name || 'Untitled'),
  activeTabId: computed(() => activeTab.value?.id || ''),
  settingsStore,
  toastStore,
  getEditorView: () => editorView,
  activeDocumentText,
  openInlineAIForComment,
  onStartComment: () => { historyRailOpen.value = false },
  prepareChatDraft: payload => emit('prepareChatDraft', payload),
})
const canAddComment = computed(() =>
  activeSupportsComments.value &&
  !historyPreviewActive.value &&
  !activeTab.value?.truncated &&
  !activeTabReadOnly.value &&
  Boolean(stats.value.selected)
)
const hasComments = computed(() => commentThreads.value.length > 0)
// Explicitly opened with zero comments: shows the rail's empty state with the
// request-review action instead of nothing.
const commentRailOpenedEmpty = ref(false)
const showCommentsMargin = computed(() =>
  activeSupportsComments.value &&
  !historyPreviewActive.value &&
  !activeTabReadOnly.value &&
  viewMode.value !== 'preview' &&
  !historyRailOpen.value &&
  !commentRailCollapsed.value &&
  (hasComments.value || draftComment.value != null || commentRailOpenedEmpty.value)
)

function toggleCommentRail() {
  if (showCommentsMargin.value) {
    closeCommentRail()
    return
  }
  commentRailCollapsed.value = false
  if (!hasComments.value && !draftComment.value) commentRailOpenedEmpty.value = true
}

// Toolbar Comment button: with a selection it starts a comment; without one it
// toggles the review rail (matching the keyboard shortcut) instead of
// dead-ending in a "select text" toast.
function onToolbarComment() {
  if (selectedCommentRange()) startAddComment()
  else toggleCommentRail()
}

function closeCommentRail() {
  commentRailCollapsed.value = true
  commentRailOpenedEmpty.value = false
}

// ── Render document (R4.1 / R4.2) ──
const renderBusy = ref(false)
const renderAvailable = ref(false)

// Check whether a render engine is available for the active file.
const activeIsRenderable = computed(() => {
  if (!activeIsMarkdown.value) return false
  const path = activeTab.value?.path ?? ''
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'rmd' || ext === 'qmd'
})

// When the active file becomes renderable, check toolchain availability.
watch(activeIsRenderable, async (renderable) => {
  if (!renderable) {
    renderAvailable.value = false
    return
  }
  const status = await getToolchainStatus()
  renderAvailable.value = status.canRender
}, { immediate: true })

async function onRenderDocument() {
  const path = activeTab.value?.path
  if (!path || renderBusy.value) return

  const status = await getToolchainStatus()
  const argv = renderArgv(path, { quarto: status.hasQuarto, rscript: status.hasRscript })
  if (!argv) {
    toastStore.push({ kind: 'error', message: 'No render engine available. Install Quarto or R.' })
    return
  }

  renderBusy.value = true
  try {
    const result = await window.kernel.call('code.run', {
      argv,
      capture_plots: false,
      timeout_ms: 480000,
    }) as {
      exitCode: number | null
      timedOut: boolean
      stdout: string
      stderr: string
      products: RenderProduct[]
    }

    if (result.exitCode === 0) {
      const best = pickBestProduct(result.products ?? [])
      if (best && best.kind === 'pdf') {
        openDocument(best.path, 'pdf')
      } else if (best && best.kind === 'html') {
        await window.kernel.call('fs.openNative', { path: best.path })
      } else if (best) {
        openDocument(best.path, best.kind === 'image' ? 'image' : 'text')
      } else {
        toastStore.push({ kind: 'info', message: 'Render completed but no output file detected.' })
      }
    } else {
      const stderr = result.stderr ?? ''
      const guidance = missingPdfEngineGuidance(stderr)
      if (guidance) {
        toastStore.push({ kind: 'error', message: guidance, durationMs: 10000 })
      } else {
        const tail = stderr.length > 300 ? stderr.slice(-300) : stderr
        toastStore.push({ kind: 'error', message: `Render failed`, detail: tail || 'Unknown error', durationMs: 10000 })
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Render failed'
    toastStore.push({ kind: 'error', message: msg })
  } finally {
    renderBusy.value = false
  }
}

const showHistoryRail = computed(() => Boolean(historyRailOpen.value && activeTab.value?.path))
const activeHistoryText = computed(() => activeTab.value?.kind === 'text' ? currentTextForHistory() : '')

// Swap the syntax language whenever the active document's path changes (tab
// switch, open, Save As). Token-guarded: lazy language loads may resolve out
// of order.
let languageToken = 0
async function applyLanguageForActiveTab() {
  if (!activeIsText.value) return
  const view = editorView
  if (!view) return
  const token = ++languageToken
  const extension = await languageExtensionForPath(activeTab.value?.path ?? '')
  if (token !== languageToken || editorView !== view) return
  view.dispatch({ effects: languageCompartment.reconfigure(extension) })
}

watch(() => activeTab.value?.path ?? '', () => { void applyLanguageForActiveTab() })

// Markdown chrome (preview, formatting) is meaningless for code files; drop
// back to plain source view when a non-markdown document becomes active.
watch(activeIsMarkdown, (isMd) => {
  if (!isMd) viewMode.value = 'source'
  syncCommentThreadsFromEditor()
  refreshCitationDecorations()
})

watch(activeSupportsComments, (supports) => {
  if (!supports) draftComment.value = null
  syncCommentThreadsFromEditor()
})

const activeCitationText = computed(() =>
  activeTab.value?.kind === 'text' ? activeTab.value.content : ''
)

const {
  referenceLibraryActive,
  activeReferencePath,
  bibliographyCandidates,
  bibliographyPopoverOpen,
  showBibliographyCandidates,
  getReferences,
  getDiagnostics,
  citationActions,
  citationHealth,
  showCitationStatus,
  documentCitations,
  loadReferences,
  loadReferenceToolAvailability,
  refreshCitationDecorations,
  toggleBibliographyPopover,
  closeBibliographyPopover,
  handleBibliographyOutsidePointerDown,
  useBibliographyCandidate,
  openActiveBibliography,
  jumpToCitation,
  referencesFileChanged,
} = useEditorCitations({
  activePath: computed(() => activeTab.value?.path || ''),
  activeMarkdown: activeCitationText,
  activeIsMarkdown,
  settingsStore,
  toastStore,
  getEditorView: () => editorView,
  openDocument,
})

const {
  showWordStats,
  wordStatsLabel,
  wordStatsTitle,
  tableStatsLabel,
  tableStatsTitle,
  citationStatusLabel,
  citationStatusTitle,
} = useEditorStatus({
  tabs,
  activeTab,
  activeIsText,
  stats,
  activeTableStats,
  citationHealth,
  referenceLibraryActive,
  activeReferencePath,
})

const { handleKeydown } = useEditorKeyboardShortcuts({
  bibliographyPopoverOpen,
  closeBibliographyPopover,
  saveActiveFile,
  saveActiveFileAs,
  openExportDialog,
  selectedCommentRange,
  startAddComment,
  toggleCommentRail,
  activeSupportsComments,
  historyPreviewActive,
  createUntitledTab,
  tabs,
  activeTabIndex,
  onSelectTab,
  viewMode,
  activeIsMarkdown,
})

function trackTelemetry(event: string, props: Record<string, unknown> = {}): void {
  try {
    void window.kernel.call('telemetry.track', { event, props }).catch(() => {})
  } catch {
    // Telemetry is best-effort and must never affect editing.
  }
}

const previewHtml = computed(() => {
  if (!activeTab.value || activeTab.value.kind !== 'text') return ''
  return marked.parse(activeDocumentText()) as string
})

const tabsForStrip = computed(() =>
  tabs.map(t => ({
    id: t.id,
    kind: t.kind,
    name: t.name,
    dirty: t.readOnly ? false : t.dirty,
  }))
)

function getActiveFilePath(): string {
  return activeTab.value?.kind === 'text' ? activeTab.value.path : ''
}

function artifactEntryForTab(tab: TabState | null): ArtifactEntry {
  if (!tab || !tab.path) return editorArtifactEntry()
  return fileArtifactEntry(tab.path)
}

function notifyActiveEditorArtifactChanged() {
  notifyCurrentDocumentChanged()
  emit('activeFileChanged', activeTab.value?.path || '')
  if (activeTab.value?.kind !== 'text') return
  emit('artifactActivated', artifactEntryForTab(activeTab.value))
}

// Options shared by the initial editor and every fresh per-tab EditorState.
// A new tab must get its state from createEditorState with these options —
// never by dispatching its content into another tab's live state, which would
// splice the change into that tab's undo history.
function buildEditorStateOptions(doc: string, options: { readOnly?: boolean } = {}) {
  return {
    doc,
    readOnly: options.readOnly === true,
    onInlineAI: openInlineAI,
    extensions: [
      livePreviewExtension(
        () => livePreviewEnabled.value && activeIsMarkdown.value,
        () => getActiveFilePath()
      ),
      outlineExtension({
        onOutlineChange(_outline: any) {
          // Outline data available for future sidebar integration
        },
      }),
      citationExtensions(getReferences, getDiagnostics, citationActions),
      inlineAnchorExtension(),
      ...(activeSupportsComments.value
        ? [commentsExtension({
            parse: activeIsMarkdown.value ? undefined : parseCodeComments,
            onThreadsChange(threads: any[]) {
              commentThreads.value = threads
              if (activeCommentId.value && !threads.some(thread => thread.id === activeCommentId.value)) {
                activeCommentId.value = null
              }
            },
            onActiveComment(id: string) {
              activeCommentId.value = id
            },
            onThreadsRemovedByEdit(removed: any[]) {
              const view = editorView
              const tabId = activeTab.value?.id || ''
              const count = removed.length
              toastStore.push({
                kind: 'info',
                message: count === 1 ? 'Comment removed with edit' : `${count} comments removed with edit`,
                actionLabel: 'Undo',
                action: () => {
                  if (!view || editorView !== view || (activeTab.value?.id || '') !== tabId) return
                  void import('@codemirror/commands').then(({ undo }) => undo(view))
                },
              })
            },
          })]
        : []),
      ghostExtension({
        getSuggestions: (request: any) => requestGhostSuggestions({
          ...request,
          modelId: settingsStore.lastGhostModel,
        }),
        onAccept: (event: { mode?: string }) => {
          trackTelemetry('ghost_accept', { mode: event.mode ?? 'other' })
        },
      }),
      editorKeymaps(),
    ],
    initialSettings: {
      wordWrap: settingsStore.editorWordWrap,
      spellCheck: settingsStore.editorSpellCheck,
      lineNumbers: settingsStore.editorLineNumbers,
    },
    onChange(update: any) {
      if (historyPreviewActive.value) return
      if (!activeTab.value || activeTab.value.kind !== 'text') return
      if (activeTab.value.readOnly) return
      activeTab.value.content = update.state.doc.toString()
      activeTab.value.dirty = activeTab.value.content !== activeTab.value.originalContent
      scheduleAutoSave()
      notifyCurrentDocumentChanged()
    },
    onCursor(_info: any) {
      // cursor info no longer shown in footer
    },
    onStats(s: any) {
      stats.value = { words: s.words, characters: s.characters, selected: s.selected || false }
    },
    onActiveFormats(formats: string[]) {
      activeFormats.value = formats
    },
  }
}

function initEditor() {
  if (!editorContainer.value) return
  if (editorView) {
    editorView.destroy()
    editorView = null
    editorViewHandle.value = null
  }

  editorView = createEditor({
    parent: editorContainer.value,
    ...buildEditorStateOptions(activeTab.value?.content ?? '', { readOnly: activeTab.value?.readOnly === true }),
  })
  editorViewHandle.value = editorView
  void applyLanguageForActiveTab()
  syncCommentThreadsFromEditor()
}

function liveContentForTab(index: number): string {
  const tab = tabs[index]
  if (!tab) return ''
  if (tab.kind !== 'text') return ''
  if (index === activeTabIndex.value) {
    if (historyPreviewActive.value && historyPreviewReturnTabId === tab.id) {
      return historyPreviewReturnText ?? historyPreviewReturnState?.doc?.toString?.() ?? tab.content
    }
    return editorView?.state?.doc?.toString?.() ?? tab.content
  }
  return tab.content
}

editorFileSync = useEditorFileSync({
  tabs,
  activeTab,
  activeTabIndex,
  tableArtifactRef,
  settingsStore,
  diffStore,
  toastStore,
  historyPreviewActive,
  getEditorView: () => editorView,
  liveContentForTab,
  cancelHistoryPreview,
  switchToTabState,
  switchToDoc,
  notifyCurrentDocumentChanged,
  notifyActiveEditorArtifactChanged,
  referencesFileChanged,
  loadReferences,
})

const {
  restoreTabs,
  disposeTabPersistence,
} = useEditorTabPersistence({
  tabs,
  activeTabIndex,
  liveContentForTab,
})

function clearAutoSave() {
  editorFileSync?.clearAutoSave()
}

function writeParamsForTab(tab: TabState, path: string, content: string): Record<string, unknown> {
  return editorFileSync?.writeParamsForTab(tab, path, content) ?? { path, content }
}

function rememberSelfWrite(path: string, content: string) {
  editorFileSync?.rememberSelfWrite(path, content)
}

function applySavedSnapshotToTab(tab: TabState, index: number, path: string, savedContent: string, result: unknown) {
  editorFileSync?.applySavedSnapshotToTab(tab, index, path, savedContent, result)
}

function markTabChangedOnDisk(tab: TabState, state: 'changed' | 'deleted') {
  editorFileSync?.markTabChangedOnDisk(tab, state)
}

function isStaleWriteError(err: unknown): boolean {
  return editorFileSync?.isStaleWriteError(err) ?? false
}

function scheduleAutoSave() {
  editorFileSync?.scheduleAutoSave()
}

async function saveActiveFile(options: { forceDialog?: boolean } = {}): Promise<boolean> {
  return editorFileSync?.saveActiveFile(options) ?? false
}

async function saveActiveFileAs(): Promise<boolean> {
  return editorFileSync?.saveActiveFileAs() ?? false
}

async function conflictReload(): Promise<void> {
  await editorFileSync?.conflictReload()
}

async function conflictOverwrite(): Promise<void> {
  await editorFileSync?.conflictOverwrite()
}

async function conflictCompare(): Promise<void> {
  await editorFileSync?.conflictCompare()
}

const activeFilePath = computed(() => activeTab.value?.path || '')

const {
  editorKeymaps,
  onFormat,
} = useEditorFormatting({
  activeIsMarkdown,
  activeTabReadOnly,
  historyPreviewActive,
  activeFilePath,
  getEditorView: () => editorView,
  saveActiveFile,
  sendToTerminal: (text, language) => {
    emit('sendToTerminal', { text, language })
    // The async send chain mounts xterm which steals focus. Reclaim it
    // so the user can Cmd+Enter repeatedly to step through a file.
    setTimeout(() => editorView?.focus(), 150)
  },
})

// ── Conflict diff resolution ──
// When the diff review was opened from Compare (conflict type), Accept = overwrite,
// Reject = reload. Hook into the existing accept/reject flow.

// Replace the active document content within the same tab (preserves undo history).
function switchToDoc(content: string) {
  if (historyPreviewActive.value) cancelHistoryPreview({ restoreViewMode: false })
  if (!editorView) return
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: content },
    annotations: commentMutation.of(true),
  })
  // Recompute stats after content switch
  nextTick(() => {
    if (editorView) {
      stats.value = computeStats(editorView.state)
    }
  })
}

// Save the current EditorView state to the active tab so undo history persists.
// markRaw is load-bearing: tabs is deep-reactive, and a Vue Proxy around an
// EditorState breaks CodeMirror's identity-based internals — compartment
// reconfigures (settings toggles, language switches) silently no-op on a
// state that was stored and read back through the proxy.
function currentEditorScrollSnapshot() {
  if (!editorView || typeof editorView.scrollSnapshot !== 'function') return undefined
  const snapshot = editorView.scrollSnapshot()
  return snapshot ? markRaw(snapshot) : undefined
}

function saveActiveTabEditorState() {
  if (!editorView) return
  const tab = activeTab.value
  if (tab?.kind !== 'text') return
  if (historyPreviewActive.value && historyPreviewReturnTabId === tab.id) {
    if (historyPreviewReturnState) tab.editorState = markRaw(historyPreviewReturnState)
    return
  }
  tab.editorState = markRaw(editorView.state)
  tab.editorScrollSnapshot = currentEditorScrollSnapshot()
}

function restoreTabEditorScrollSnapshot(tab: TabState) {
  if (!editorView || !tab.editorScrollSnapshot) return
  editorView.dispatch({ effects: tab.editorScrollSnapshot })
}

// Switch the EditorView to a different tab's state. Uses view.setState() so
// each tab keeps its own undo history — Cmd+Z never leaks across tabs.
function switchToTabState(tab: TabState | null) {
  if (!editorView || !tab) return
  if (tab.kind !== 'text') {
    stats.value = { words: 0, characters: 0, selected: false }
    activeTableStats.value = { rows: 0, cols: 0 }
    commentThreads.value = []
    activeCommentId.value = null
    return
  }
  if (tab.editorState) {
    editorView.setState(tab.editorState)
  } else {
    // New tab without a saved state: build a FRESH EditorState. Dispatching
    // the content into the live view would record the swap in the previous
    // tab's undo history and Cmd+Z could resurrect the other document.
    tab.editorState = markRaw(createEditorState(buildEditorStateOptions(tab.content, { readOnly: tab.readOnly === true })))
    editorView.setState(tab.editorState)
  }
  // The restored state carries the settings it was created with; sync it to
  // the current ones so a toggle never silently reverts on tab switch.
  applyEditorSettings()
  restoreTabEditorScrollSnapshot(tab)
  nextTick(() => {
    if (editorView) {
      stats.value = computeStats(editorView.state)
      syncCommentThreadsFromEditor()
    }
  })
}

function enterHistoryPreview(payload: HistoryPreviewPayload) {
  const tab = activeTab.value
  if (!editorView || !tab || tab.kind !== 'text' || tab.path !== payload.path) return
  if (diffStore.active) closeActiveDiffReview()

  if (!historyPreviewActive.value || historyPreviewReturnTabId !== tab.id) {
    const currentText = editorView.state?.doc?.toString?.() ?? tab.content
    saveActiveTabEditorState()
    historyPreviewReturnState = markRaw(tab.editorState ?? editorView.state)
    historyPreviewReturnTabId = tab.id
    historyPreviewReturnViewMode = viewMode.value
    historyPreviewReturnText = currentText
  }

  clearAutoSave()
  inlineAIState.value = null
  draftComment.value = null
  commentContextMenu.value = null
  closeCommentRail()
  historyPreview.value = payload
  viewMode.value = 'source'
  editorView.setState(createEditorState(buildEditorStateOptions(payload.content, { readOnly: true })))
  applyEditorSettings()
  void applyLanguageForActiveTab()
  nextTick(() => {
    if (!editorView) return
    stats.value = computeStats(editorView.state)
    syncCommentThreadsFromEditor()
    editorView.focus()
  })
  notifyCurrentDocumentChanged()
}

function cancelHistoryPreview(options: { restoreViewMode?: boolean } = {}) {
  if (!historyPreviewActive.value) return
  const tab = activeTab.value
  const restoreViewMode = options.restoreViewMode !== false
  const returnState = historyPreviewReturnState
  const returnViewMode = historyPreviewReturnViewMode
  const canRestoreEditor = Boolean(
    editorView &&
    tab?.kind === 'text' &&
    tab.id === historyPreviewReturnTabId &&
    returnState,
  )

  historyPreview.value = null
  historyPreviewReturnState = null
  historyPreviewReturnTabId = ''
  historyPreviewReturnViewMode = null
  historyPreviewReturnText = null

  if (canRestoreEditor) {
    editorView.setState(returnState)
    tab!.editorState = markRaw(returnState)
    if (restoreViewMode && returnViewMode) viewMode.value = returnViewMode
    applyEditorSettings()
    restoreTabEditorScrollSnapshot(tab!)
    void applyLanguageForActiveTab()
    nextTick(() => {
      if (!editorView) return
      stats.value = computeStats(editorView.state)
      syncCommentThreadsFromEditor()
      editorView.focus()
    })
  }
  notifyCurrentDocumentChanged()
}

async function useHistoryPreviewVersion() {
  const preview = historyPreview.value
  if (!preview || historyPreviewBusy.value) return
  historyPreviewBusy.value = true
  try {
    const preserved = await preserveCurrentBufferBeforeHistoryRestore()
    if (!preserved) return
    await window.kernel.call('history.restore', {
      path: preview.path,
      version_id: preview.versionId,
    })
    historyPreview.value = null
    historyPreviewReturnState = null
    historyPreviewReturnTabId = ''
    historyPreviewReturnViewMode = null
    historyPreviewReturnText = null
    viewMode.value = 'source'
    await reloadActiveTabAfterRestore()
    toastStore.push({ kind: 'info', message: 'Version restored' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    toastStore.push({ kind: 'error', message: 'Restore failed', detail: message })
  } finally {
    historyPreviewBusy.value = false
  }
}

async function preserveCurrentBufferBeforeHistoryRestore(): Promise<boolean> {
  const tab = activeTab.value
  if (!tab || tab.kind !== 'text' || !tab.path || !tab.dirty) return true
  if (tab.readOnly) return true
  if (tab.truncated) {
    toastStore.push({ kind: 'error', message: 'Restore blocked', detail: 'Save or close the truncated file before restoring a previous version.' })
    return false
  }
  if (tab.externalState) {
    toastStore.push({ kind: 'error', message: 'Restore blocked', detail: 'Resolve the file change on disk before restoring a previous version.' })
    return false
  }

  const content = currentTextForHistory()
  tab.content = content
  try {
    rememberSelfWrite(tab.path, content)
    const result = await window.kernel.call('fs.write', writeParamsForTab(tab, tab.path, content))
    applySavedSnapshotToTab(tab, tabs.indexOf(tab), tab.path, content, result)
    notifyCurrentDocumentChanged()
    return true
  } catch (err) {
    selfWrites.delete(tab.path)
    if (isStaleWriteError(err)) markTabChangedOnDisk(tab, 'changed')
    const message = err instanceof Error ? err.message : 'Unknown error'
    toastStore.push({ kind: 'error', message: 'Restore blocked', detail: message })
    return false
  }
}

function closeHistoryRail() {
  cancelHistoryPreview()
  historyRailOpen.value = false
}

// Tab operations
function onSelectTab(index: number) {
  if (index === activeTabIndex.value) return
  if (historyPreviewActive.value) cancelHistoryPreview()
  if (diffStore.active) closeActiveDiffReview()
  stashCommentDraftForTab(activeTab.value?.id || '')
  saveActiveTabEditorState()
  activeTabIndex.value = index
  if (activeTab.value) {
    switchToTabState(activeTab.value)
  }
  nextTick(() => restoreCommentDraftForTab(activeTab.value?.id || ''))
  notifyActiveEditorArtifactChanged()
}

function onCloseTab(index: number) {
  if (index === activeTabIndex.value && historyPreviewActive.value) cancelHistoryPreview()
  const tab = tabs[index]
  if (!tab) return
  if (tab.dirty && !tab.readOnly) {
    if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return
  }
  clearAutoSave()
  tabs.splice(index, 1)
  if (tabs.length === 0) {
    activeTabIndex.value = 0
    stats.value = { words: 0, characters: 0, selected: false }
    activeTableStats.value = { rows: 0, cols: 0 }
    commentThreads.value = []
    activeCommentId.value = null
    emit('activeFileChanged', '')
    notifyCurrentDocumentChanged()
    emit('allTabsClosed')
    return
  }
  if (activeTabIndex.value >= tabs.length) {
    activeTabIndex.value = tabs.length - 1
  }
  switchToTabState(activeTab.value)
  notifyActiveEditorArtifactChanged()
}

function onReorderTab(from: number, to: number) {
  const [moved] = tabs.splice(from, 1)
  tabs.splice(to, 0, moved)
  // Adjust active index
  if (activeTabIndex.value === from) {
    activeTabIndex.value = to
  } else if (from < activeTabIndex.value && to >= activeTabIndex.value) {
    activeTabIndex.value--
  } else if (from > activeTabIndex.value && to <= activeTabIndex.value) {
    activeTabIndex.value++
  }
  notifyActiveEditorArtifactChanged()
}

// Always opens a fresh untitled tab (numbered when others already exist),
// unlike ensureUntitledTab which reuses an existing blank tab. This is what the
// tab-strip "+" and editor-focused Cmd+T do: a new tab is a blank document
// ready to type, not a file-finder landing page.
function createUntitledTab() {
  if (historyPreviewActive.value) cancelHistoryPreview()
  saveActiveTabEditorState()
  const base = 'Untitled'
  const untitledCount = tabs.filter(t => !t.path && t.name.startsWith(base)).length
  const name = untitledCount === 0 ? base : `${base} ${untitledCount + 1}`
  const id = `untitled-${Date.now()}-${tabs.length}`
  tabs.push({ id, kind: 'text', path: '', name, content: '', originalContent: '', dirty: false })
  activeTabIndex.value = tabs.length - 1
  nextTick(() => {
    if (editorView) switchToTabState(activeTab.value)
    else initEditor()
    editorView?.focus()
    notifyActiveEditorArtifactChanged()
  })
}

function onAddTab() {
  createUntitledTab()
}

function activeDocumentText(): string {
  if (activeTab.value?.kind !== 'text') return ''
  return currentTextForHistory()
}

function currentTextForHistory(): string {
  const tab = activeTab.value
  if (tab?.kind !== 'text') return ''
  if (historyPreviewActive.value && historyPreviewReturnTabId === tab.id) {
    return historyPreviewReturnText ?? historyPreviewReturnState?.doc?.toString?.() ?? tab.content
  }
  return editorView?.state?.doc?.toString?.() ?? tab.content
}

// Public API
async function openFile(path: string): Promise<void> {
  // Check if already open
  const existingIndex = tabs.findIndex(t => t.kind === 'text' && t.path === path)
  if (existingIndex >= 0) {
    onSelectTab(existingIndex)
    return
  }
  if (historyPreviewActive.value) cancelHistoryPreview()

  // Read file — request the full content so the editor never silently truncates
  let content = ''
  let version: FileVersion | undefined
  let truncated = false
  try {
    const result = await window.kernel.call('fs.read', { path, full: true }) as { content: string; truncated?: boolean }
    content = result.content
    version = extractFileVersion(result)
    truncated = result.truncated === true
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    toastStore.push({ kind: 'error', message: 'Failed to open file', detail: message })
    console.error('Failed to read file:', err)
    return
  }

  const name = path.split('/').pop() ?? path
  const id = `${path}-${Date.now()}`

  saveActiveTabEditorState()

  tabs.push({
    id,
    kind: 'text',
    path,
    name,
    content,
    originalContent: content,
    version,
    dirty: false,
    externalState: undefined,
    truncated,
  })

  activeTabIndex.value = tabs.length - 1

  await nextTick()

  if (editorView) {
    switchToTabState(activeTab.value)
  } else {
    initEditor()
  }
  settingsStore.addRecentFile(path)
  trackTelemetry('file_open', { ext: fileExtensionForTelemetry(path), surface: 'editor' })
  notifyActiveEditorArtifactChanged()
}

async function openReadOnlyTab(name: string, content: string, sourceId: string): Promise<void> {
  const id = `readonly:${sourceId || name}`
  if (historyPreviewActive.value) cancelHistoryPreview()
  if (diffStore.active) closeActiveDiffReview()
  saveActiveTabEditorState()

  const existingIndex = tabs.findIndex(tab => tab.id === id)
  if (existingIndex >= 0) {
    const tab = tabs[existingIndex]
    tab.kind = 'text'
    tab.path = ''
    tab.name = name
    tab.content = content
    tab.originalContent = content
    tab.version = undefined
    tab.dirty = false
    tab.readOnly = true
    tab.externalState = undefined
    tab.truncated = false
    tab.editorState = undefined
    activeTabIndex.value = existingIndex
  } else {
    tabs.push({
      id,
      kind: 'text',
      path: '',
      name,
      content,
      originalContent: content,
      dirty: false,
      readOnly: true,
      externalState: undefined,
      truncated: false,
    })
    activeTabIndex.value = tabs.length - 1
  }

  await nextTick()
  if (editorView) switchToTabState(activeTab.value)
  else initEditor()
  editorView?.focus()
  notifyCurrentDocumentChanged()
  notifyActiveEditorArtifactChanged()
}

async function openDocument(path: string, kind: TabKind = 'text'): Promise<void> {
  if (kind === 'text') {
    await openFile(path)
    return
  }

  const existingIndex = tabs.findIndex(t => t.kind === kind && t.path === path)
  if (existingIndex >= 0) {
    onSelectTab(existingIndex)
    return
  }

  if (historyPreviewActive.value) cancelHistoryPreview()
  saveActiveTabEditorState()
  tabs.push({
    id: `${kind}:${path}-${Date.now()}`,
    kind,
    path,
    name: fileLabel(path),
    content: '',
    originalContent: '',
    dirty: false,
    externalState: undefined,
  })
  activeTabIndex.value = tabs.length - 1
  await nextTick()
  switchToTabState(activeTab.value)
  trackTelemetry('file_open', { ext: fileExtensionForTelemetry(path), surface: kind })
  notifyActiveEditorArtifactChanged()
}

async function onWorkspaceFilesChanged(payload: unknown) {
  await editorFileSync?.onWorkspaceFilesChanged(payload)
}

function closeTabForPath(path: string) {
  const index = tabs.findIndex(t => t.path === path)
  if (index < 0) return
  if (index === activeTabIndex.value && historyPreviewActive.value) cancelHistoryPreview()
  clearAutoSave()
  tabs.splice(index, 1)
  if (tabs.length === 0) {
    activeTabIndex.value = 0
    stats.value = { words: 0, characters: 0, selected: false }
    activeTableStats.value = { rows: 0, cols: 0 }
    commentThreads.value = []
    activeCommentId.value = null
    emit('activeFileChanged', '')
    notifyCurrentDocumentChanged()
    emit('allTabsClosed')
    return
  }
  if (activeTabIndex.value >= tabs.length) {
    activeTabIndex.value = tabs.length - 1
  }
  switchToTabState(activeTab.value)
  notifyActiveEditorArtifactChanged()
}

function getOpenFiles(): string[] {
  return tabs.map(t => t.path).filter(Boolean)
}

function retargetDocumentPath(oldPath: string, newPath: string, type: 'directory' | 'file') {
  const from = oldPath.replace(/\/+$/, '')
  const to = newPath.replace(/\/+$/, '')
  if (!from || !to || from === to) return

  let changed = false
  tabs.forEach((tab, index) => {
    const nextPath = retargetedTabPath(tab.path, from, to, type)
    if (!nextPath) return
    tab.path = nextPath
    tab.name = fileLabel(nextPath)
    if (tab.kind !== 'text') tab.id = `${tab.kind}:${nextPath}-${Date.now()}-${index}`
    changed = true
  })

  if (!changed) return
  if (historyPreviewActive.value) cancelHistoryPreview()
  historyRefreshKey.value++
  notifyCurrentDocumentChanged()
  notifyActiveEditorArtifactChanged()
}

function retargetedTabPath(path: string, oldPath: string, newPath: string, type: 'directory' | 'file'): string | null {
  if (!path) return null
  if (type === 'file') return path === oldPath ? newPath : null
  const prefix = `${oldPath}/`
  if (path === oldPath) return newPath
  if (!path.startsWith(prefix)) return null
  return `${newPath}/${path.slice(prefix.length)}`
}

// Text tabs watch for conflict/reload handling; image and pdf tabs watch so
// re-generated files (plots, rendered documents) refresh in place.
const WATCHED_TAB_KINDS = new Set<TabKind>(['text', 'image', 'pdf'])

function watchedTabPaths(): string[] {
  return [...new Set(tabs
    .filter(tab => WATCHED_TAB_KINDS.has(tab.kind) && !tab.readOnly && tab.path)
    .map(tab => tab.path)
    .filter((path): path is string => Boolean(path)))]
}

function syncWatchedWorkspaceFiles(): void {
  const next = new Set(watchedTabPaths())
  for (const path of watchedWorkspaceFiles) {
    if (next.has(path)) continue
    watchedWorkspaceFiles.delete(path)
    void window.kernel.unwatchWorkspaceFile(path).catch(() => {})
  }
  for (const path of next) {
    if (watchedWorkspaceFiles.has(path)) continue
    watchedWorkspaceFiles.add(path)
    void window.kernel.watchWorkspaceFile(path).catch(() => {})
  }
}

function unwatchAllWorkspaceFiles(): void {
  const paths = [...watchedWorkspaceFiles]
  watchedWorkspaceFiles.clear()
  for (const path of paths) void window.kernel.unwatchWorkspaceFile(path).catch(() => {})
}

watch(
  () => watchedTabPaths().sort().join('\0'),
  () => { syncWatchedWorkspaceFiles() },
)

function getCurrentDocument() {
  const tab = activeTab.value
  if (!tab) return null
  if (tab.kind !== 'text') return null
  const content = activeDocumentText()
  return {
    id: tab.id,
    path: tab.path,
    name: tab.name,
    content,
    dirty: tab.readOnly ? false : content !== tab.originalContent,
  }
}

function toggleHistoryRail() {
  if (!activeTab.value?.path) return
  if (historyRailOpen.value) {
    closeHistoryRail()
    return
  }
  historyRailOpen.value = true
  closeCommentRail()
}

function openHistoryForPath(path?: string) {
  const targetPath = path || activeTab.value?.path
  if (!targetPath) return
  const index = tabs.findIndex(tab => tab.path === targetPath)
  if (index >= 0 && index !== activeTabIndex.value) onSelectTab(index)
  historyRailOpen.value = true
  closeCommentRail()
  historyRefreshKey.value++
}

async function reloadActiveTabAfterRestore() {
  if (historyPreviewActive.value) cancelHistoryPreview({ restoreViewMode: false })
  const tab = activeTab.value
  if (!tab?.path) return
  historyRefreshKey.value++
  if (tab.kind !== 'text') {
    tab.id = `${tab.kind}:${tab.path}-${Date.now()}`
    notifyActiveEditorArtifactChanged()
    return
  }
  try {
    const result = await window.kernel.call('fs.read', { path: tab.path, full: true }) as { content: string; truncated?: boolean }
    tab.content = result.content
    tab.originalContent = result.content
    tab.version = extractFileVersion(result)
    tab.dirty = false
    tab.externalState = undefined
    tab.truncated = result.truncated === true
    tab.editorState = undefined
    tab.editorScrollSnapshot = undefined
    switchToTabState(tab)
    notifyCurrentDocumentChanged()
    notifyActiveEditorArtifactChanged()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    toastStore.push({ kind: 'error', message: 'Restore applied, reload failed', detail: message })
  }
}

function closeActiveTab() {
  onCloseTab(activeTabIndex.value)
}

function getArtifactReplacementDecision(
  current: ArtifactEntry,
  next: ArtifactEntry | null,
): ArtifactReplacementDecision {
  return editorArtifactReplacementDecision(current, next, getCurrentDocument())
}

defineExpose({
  openDocument,
  openFile,
  openReadOnlyTab,
  getOpenFiles,
  retargetDocumentPath,
  getCurrentDocument,
  getArtifactReplacementDecision,
  createUntitledTab,
  closeActiveTab,
  saveActiveFile,
  saveActiveFileAs,
  openExportDialog,
  openHistoryForPath,
})

// Export the active document via the dialog. Reads the live buffer (not the
// saved file) so unsaved edits export exactly as seen.
function openExportDialog() {
  if (historyPreviewActive.value) cancelHistoryPreview()
  const tab = activeTab.value
  if (!tab || !activeIsMarkdown.value) return
  exportMarkdown.value = activeDocumentText()
  exportDialogOpen.value = true
}

onMounted(async () => {
  unregisterCurrentDocumentProvider = registerCurrentDocumentProvider(getCurrentDocument)
  const onFileChange = (payload: unknown) => { void onWorkspaceFilesChanged(payload) }
  window.kernel.on('workspace:files-changed', onFileChange)
  unregisterWorkspaceFileChanges = () => window.kernel.off('workspace:files-changed', onFileChange)
  const onAppsChanged = () => {
    void loadReferences()
    void loadReferenceToolAvailability()
  }
  window.kernel.on('apps:changed', onAppsChanged)
  unregisterAppsChanged = () => window.kernel.off('apps:changed', onAppsChanged)
  const onWorkspaceChanged = () => {
    watchedWorkspaceFiles.clear()
    syncWatchedWorkspaceFiles()
  }
  window.kernel.on('workspace:changed', onWorkspaceChanged)
  unregisterWorkspaceChanged = () => window.kernel.off('workspace:changed', onWorkspaceChanged)
  window.addEventListener('keydown', handleKeydown, true)
  document.addEventListener('pointerdown', handleBibliographyOutsidePointerDown, true)
  void loadReferences()
  void loadReferenceToolAvailability()

  // Attempt to restore persisted tabs before falling back to an untitled tab.
  const restored = await restoreTabs()

  nextTick(() => {
    if (editorContainer.value && !editorView) {
      initEditor()
    }
    if (restored && activeTab.value) {
      switchToTabState(activeTab.value)
    }
    notifyActiveEditorArtifactChanged()
  })
})

onBeforeUnmount(() => {
  unregisterCurrentDocumentProvider?.()
  unregisterCurrentDocumentProvider = null
  unregisterWorkspaceFileChanges?.()
  unregisterWorkspaceFileChanges = null
  unregisterAppsChanged?.()
  unregisterAppsChanged = null
  unregisterWorkspaceChanged?.()
  unregisterWorkspaceChanged = null
  unwatchAllWorkspaceFiles()
  clearAutoSave()
  disposeTabPersistence()
  window.removeEventListener('keydown', handleKeydown, true)
  document.removeEventListener('pointerdown', handleBibliographyOutsidePointerDown, true)
  if (editorView) {
    editorView.destroy()
    editorView = null
    editorViewHandle.value = null
  }
})
</script>

<template>
  <div class="editor-panel relative flex h-full flex-col overflow-hidden bg-surface">
    <div class="flex h-7 shrink-0 items-end overflow-hidden border-b border-rule-light bg-chrome">
      <EditorTabStrip
        :tabs="tabsForStrip"
        :active-tab="activeTabIndex"
        @select-tab="onSelectTab"
        @close-tab="onCloseTab"
        @add-tab="onAddTab"
        @reorder-tab="onReorderTab"
      />
      <button
        v-if="activeTab?.path"
        type="button"
        class="mr-2 mb-[3px] flex h-[22px] shrink-0 items-center gap-1 rounded-[4px] px-2 font-sans text-[11px] text-ink-3 hover:bg-chrome-mid hover:text-ink"
        :class="historyRailOpen ? 'bg-accent-soft text-accent' : ''"
        title="Version history"
        aria-label="Version history"
        data-testid="editor-history-button"
        @click="toggleHistoryRail"
      >
        <IconHistory :size="13" :stroke-width="1.9" />
        History
      </button>
    </div>

    <EditorToolbar
      v-if="activeIsMarkdown && !historyPreviewActive"
      :active-formats="activeFormats"
      :can-comment="canAddComment"
      :comment-count="commentThreads.length"
      :comment-rail-open="showCommentsMargin"
      :render-available="renderAvailable"
      :render-busy="renderBusy"
      @format="onFormat"
      @comment="onToolbarComment"
      @export="openExportDialog"
      @render="onRenderDocument"
    />

    <ExportDialog
      v-if="exportDialogOpen"
      v-model:open="exportDialogOpen"
      :document-path="activeTab?.path ?? ''"
      :document-name="activeTab?.name ?? ''"
      :markdown="exportMarkdown"
    />

    <ConflictBar
      v-if="activeIsText && activeTab?.externalState && !diffStore.active && !historyPreviewActive"
      :external-state="activeTab.externalState"
      @reload="conflictReload"
      @overwrite="conflictOverwrite"
      @compare="conflictCompare"
    />

    <InlineAI
      v-if="inlineAIState && !historyPreviewActive && !(diffStore.active && diffStore.reviewMeta?.type === 'inline-ai')"
      :key="inlineAIKey"
      :selection="inlineAIState"
      :initial-instruction="inlineAIState.initialInstruction || ''"
      :auto-submit="inlineAIState.autoSubmit === true"
      @apply="onInlineAIApply"
      @activate-diff="onInlineAIActivateDiff"
      @deactivate-diff="onInlineAIDeactivateDiff"
      @close="closeInlineAI"
    />

    <DiffReviewBar
      v-if="diffStore.active"
      :busy="diffReviewBusy"
      :error="diffReviewError"
      @accept="acceptActiveDiffReview"
      @reject="rejectActiveDiffReview"
      @close="closeActiveDiffReview"
      @navigate-chunk="diffViewRef?.scrollToChunk($event)"
    />

    <div
      v-if="inlineAIState && !historyPreviewActive && diffStore.active && diffStore.reviewMeta?.type === 'inline-ai'"
      class="flex shrink-0 justify-center border-b border-rule-light bg-chrome-mid px-3"
    >
      <InlineAI
        :key="inlineAIKey"
        :selection="inlineAIState"
        variant="review"
        :initial-instruction="inlineAIState.initialInstruction || ''"
        :auto-submit="false"
        @apply="onInlineAIApply"
        @activate-diff="onInlineAIActivateDiff"
        @deactivate-diff="onInlineAIDeactivateDiff"
        @close="closeInlineAI"
      />
    </div>

    <DiffView
      v-if="diffStore.active"
      ref="diffViewRef"
    />

    <EditorHistoryPreviewBanner
      v-if="historyPreview"
      :preview="historyPreview"
      :busy="historyPreviewBusy"
      @use-version="useHistoryPreviewVersion"
      @cancel="cancelHistoryPreview"
    />

    <EditorEmptyState
      v-if="tabs.length === 0 && !diffStore.active"
      @new-document="createUntitledTab"
      @open-file-dialog="emit('openFileDialogRequested')"
    />

    <div v-show="tabs.length > 0 && !diffStore.active" class="flex min-h-0 flex-1 overflow-hidden">
      <div
        v-show="activeIsText && viewMode !== 'preview'"
        class="flex min-w-0 flex-1 overflow-hidden"
        :class="{ 'border-r border-rule-light': viewMode === 'split' && !showCommentsMargin }"
      >
        <div
          ref="editorContainer"
          class="min-w-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
          :class="{ 'border-r border-rule-light': viewMode === 'split' && showCommentsMargin }"
          @contextmenu="openEditorContextMenu"
        />
        <CommentsMargin
          v-if="showCommentsMargin"
          :threads="commentThreads"
          :active-id="activeCommentId"
          :editor-view="editorViewHandle"
          :draft="draftComment"
          @active="setEditorActiveComment($event, { scroll: true })"
          @save-draft="saveCommentDraft"
          @cancel-draft="cancelCommentDraft"
          @update-draft-text="updateCommentDraftText"
          @reply="replyToComment"
          @resolve="resolveCommentThread"
          @resolve-all="resolveAllCommentThreads"
          @apply-edit="applyCommentAsEdit"
          @send-to-chat="sendCommentsToChat"
          @copy-anchor="copyCommentAnchor"
          @edit-note="editCommentNote"
          @delete-note="deleteCommentNote"
          @request-review="requestAIReview()"
          @close="closeCommentRail"
        />
      </div>

      <PreviewPane
        v-if="activeIsText && showPreview"
        :content="previewHtml"
        :file-path="activeTab?.path || ''"
      />

      <PdfArtifact
        v-if="activeTab?.kind === 'pdf'"
        :key="activeTab.id"
        class="min-w-0 flex-1"
        :path="activeTab.path"
        :port="props.port"
      />

      <TableArtifact
        v-if="activeTab?.kind === 'table'"
        :key="activeTab.id"
        ref="tableArtifactRef"
        class="min-w-0 flex-1"
        :path="activeTab.path"
        @update:dirty="setActiveTableDirty"
        @update:stats="updateActiveTableStats"
        @loaded="applyTableLoadedSnapshot"
      />

      <FileCardArtifact
        v-if="activeTab?.kind === 'card'"
        :key="activeTab.id"
        class="min-w-0 flex-1"
        :path="activeTab.path"
      />

      <ImageArtifact
        v-if="activeTab?.kind === 'image'"
        :key="activeTab.id"
        class="min-w-0 flex-1"
        :path="activeTab.path"
      />

      <HistoryRail
        v-if="showHistoryRail && activeTab?.path"
        :path="activeTab.path"
        :current-text="activeHistoryText"
        :refresh-key="historyRefreshKey"
        :previewing-version-id="historyPreview?.versionId ?? ''"
        @close="closeHistoryRail"
        @show-current="cancelHistoryPreview"
        @preview="enterHistoryPreview"
      />
    </div>

    <MimContextMenu
      v-if="commentContextMenu"
      :x="commentContextMenu.x"
      :y="commentContextMenu.y"
      :width="160"
      :height="44"
      @close="commentContextMenu = null"
      @update:open="value => { if (!value) commentContextMenu = null }"
    >
      <MimMenuItem
        :headless="false"
        item-class="h-7 px-2.5 py-0"
        @select="commentContextMenu = null; startAddComment()"
      >
        Add comment
      </MimMenuItem>
    </MimContextMenu>

    <EditorStatusBar
      v-if="activeTab"
      v-model:view-mode="viewMode"
      :active-is-table="activeIsTable"
      :table-stats-title="tableStatsTitle"
      :table-stats-label="tableStatsLabel"
      :show-word-stats="showWordStats"
      :word-stats-title="wordStatsTitle"
      :word-stats-label="wordStatsLabel"
      :show-citation-status="showCitationStatus"
      :citation-status-title="citationStatusTitle"
      :citation-status-label="citationStatusLabel"
      :citation-missing="citationHealth.unresolved.length > 0"
      :comment-rail-collapsed="commentRailCollapsed"
      :comment-count="commentThreads.length"
      :history-preview-active="historyPreviewActive"
      :diff-active="diffStore.active"
      :active-is-markdown="activeIsMarkdown"
      :active-truncated="activeTab.truncated === true"
      :external-state="activeTab.externalState"
      :active-dirty="activeTab.dirty"
      :view-modes="viewModes"
      @toggle-bibliography="toggleBibliographyPopover"
      @show-comments="commentRailCollapsed = false"
    />

    <BibliographyPopover
      v-if="bibliographyPopoverOpen"
      v-model:show-bibliography-candidates="showBibliographyCandidates"
      :reference-library-active="referenceLibraryActive"
      :active-reference-path="activeReferencePath"
      :document-citations="documentCitations"
      :bibliography-candidates="bibliographyCandidates"
      @close="closeBibliographyPopover"
      @open-active-bibliography="openActiveBibliography"
      @jump-to-citation="jumpToCitation"
      @use-bibliography-candidate="useBibliographyCandidate"
    />
  </div>
</template>

<style>
.editor-panel {
  --ink: var(--color-ink);
  --ink-strong: var(--color-ink);
  --editor-paper: var(--color-surface);
  --accent: var(--color-accent);
  --muted: var(--color-ink-3);
  --active-line: var(--color-line-soft);
  --inline-code-bg: var(--color-chrome-mid);
  --code: var(--color-ink-2);
  --quote: var(--color-ink-3);
  --line-strong: var(--color-rule);
  --panel: var(--color-chrome-mid);
  --shadow-low: 0 2px 8px rgba(0, 0, 0, 0.08);
  /* --syntax-* and --selection are theme-tuned in styles.css per data-theme. */
  --editor-size: 14px;
  --editor-line-height: 23px;
}

/* Ghost suggestion styles */
.ghost-text {
  color: var(--color-ink-3);
  font-style: italic;
  opacity: 0.6;
}
.ghost-loading {
  display: inline-flex;
  gap: 1px;
  margin-left: 4px;
  vertical-align: baseline;
}
.ghost-loading-dot {
  color: var(--color-ink-3);
  animation: ghost-pulse 1.2s ease-in-out infinite;
  font-size: 1.2em;
  line-height: 1;
}
.ghost-loading-dot:nth-child(2) { animation-delay: 0.15s; }
.ghost-loading-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes ghost-pulse {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}
.ghost-hint-line {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0 2px;
  font-family: var(--font-sans);
  font-size: 10px;
  color: var(--color-ink-3);
  user-select: none;
}
.ghost-hint-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.ghost-hint-item kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-ink-3);
  background: var(--color-chrome-mid);
  border: 1px solid var(--color-rule-light);
  border-radius: 3px;
  padding: 0 4px;
  min-width: 16px;
  height: 16px;
}
.ghost-hint-count {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-accent);
  margin-right: 4px;
}
.ghost-error-line {
  color: var(--color-ink-3);
}

/* Citation styles */
.cm-citation {
  color: var(--color-accent);
  font-weight: 500;
}
.cm-citation-missing {
  text-decoration: wavy underline;
  text-decoration-color: var(--color-rem);
}
.cm-citation-duplicate {
  text-decoration: wavy underline;
  text-decoration-color: #e6a000;
}
.citation-tooltip {
  padding: 8px 12px;
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.5;
  max-width: 320px;
}
.citation-tooltip strong {
  display: block;
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 2px;
}
.citation-tooltip span {
  display: block;
  color: var(--color-ink-2);
  font-size: 11px;
}
.citation-tooltip small {
  display: block;
  color: var(--color-ink-3);
  font-size: 10px;
  margin-top: 2px;
}
.citation-tooltip-action {
  height: 22px;
  margin-top: 7px;
  border: 1px solid var(--color-rule-light);
  border-radius: 4px;
  background: var(--color-chrome-high);
  color: var(--color-ink-2);
  padding: 0 8px;
  font-family: var(--font-sans);
  font-size: 11px;
}
.citation-tooltip-action:hover {
  background: var(--color-chrome-mid);
  color: var(--color-ink);
}
</style>
