import type { ComputedRef, Ref } from 'vue'
import type { TabState, ViewMode } from './editorTypes.js'

interface UseEditorKeyboardShortcutsOptions {
  bibliographyPopoverOpen: Ref<boolean>
  closeBibliographyPopover: () => void
  saveActiveFile: () => Promise<boolean> | boolean
  saveActiveFileAs: () => Promise<boolean> | boolean
  openExportDialog: () => void
  selectedCommentRange: () => { from: number; to: number; anchor: string } | null
  startAddComment: () => void
  toggleCommentRail: () => void
  activeSupportsComments: ComputedRef<boolean>
  historyPreviewActive: ComputedRef<boolean>
  createUntitledTab: () => void
  tabs: TabState[]
  activeTabIndex: Ref<number>
  onSelectTab: (index: number) => void
  viewMode: Ref<ViewMode>
  activeIsMarkdown: ComputedRef<boolean>
}

export function useEditorKeyboardShortcuts(options: UseEditorKeyboardShortcutsOptions) {
  function cycleViewMode() {
    if (options.historyPreviewActive.value) return
    if (!options.activeIsMarkdown.value) return
    const modes: ViewMode[] = ['source', 'split', 'preview']
    const idx = modes.indexOf(options.viewMode.value)
    options.viewMode.value = modes[(idx + 1) % modes.length]
  }

  function isEditorFocused(): boolean {
    return !!document.activeElement?.closest('.cm-editor')
  }

  function handleKeydown(e: KeyboardEvent) {
    if (options.bibliographyPopoverOpen.value && e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      options.closeBibliographyPopover()
      return
    }

    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (e.shiftKey) options.saveActiveFileAs()
      else options.saveActiveFile()
    }
    if (meta && !e.shiftKey && e.key === 'e') {
      e.preventDefault()
      cycleViewMode()
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      options.openExportDialog()
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'm' && isEditorFocused()) {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (options.selectedCommentRange()) {
        options.startAddComment()
      } else if (!options.historyPreviewActive.value && options.activeSupportsComments.value) {
        options.toggleCommentRail()
      }
    }
    if (meta && !e.shiftKey && !e.altKey && (e.key === 'n' || e.key === 't') && isEditorFocused()) {
      e.preventDefault()
      e.stopImmediatePropagation()
      options.createUntitledTab()
    }
  }

  return { handleKeydown }
}
