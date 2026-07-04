import type { ComputedRef, Ref } from 'vue'
import { diffCommentThreads } from '@main/comments/model.js'
import { isMarkdownPath } from './codemirror/language.js'
import type { useDiffStore } from '../../stores/diff.js'
import type { useSettingsStore } from '../../stores/settings.js'
import type { useToastStore } from '../../stores/toasts.js'
import {
  extractFileVersion,
  fileLabel,
  suggestedSavePath,
} from './editorFileMeta.js'
import type { FileVersion, TabState } from './editorTypes.js'

type DiffStore = ReturnType<typeof useDiffStore>
type SettingsStore = ReturnType<typeof useSettingsStore>
type ToastStore = ReturnType<typeof useToastStore>

interface TableArtifactLike {
  serialize: () => string
  markSaved: (content: string, version?: FileVersion) => void
}

interface SaveOptions {
  forceDialog?: boolean
}

interface UseEditorFileSyncOptions {
  tabs: TabState[]
  activeTab: ComputedRef<TabState | null>
  activeTabIndex: Ref<number>
  tableArtifactRef: Ref<TableArtifactLike | null>
  settingsStore: SettingsStore
  diffStore: DiffStore
  toastStore: ToastStore
  historyPreviewActive: ComputedRef<boolean>
  getEditorView: () => any
  liveContentForTab: (index: number) => string
  cancelHistoryPreview: (options?: { restoreViewMode?: boolean }) => void
  switchToTabState: (tab: TabState | null) => void
  switchToDoc: (content: string) => void
  notifyCurrentDocumentChanged: () => void
  notifyActiveEditorArtifactChanged: () => void
  referencesFileChanged: (changes: Map<string, string>) => boolean
  loadReferences: () => Promise<void> | void
}

const AUTO_SAVE_DELAY = 1000
const SELF_WRITE_TTL_MS = 5000

export function useEditorFileSync(options: UseEditorFileSyncOptions) {
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
  const selfWrites = new Map<string, { content: string; expiresAt: number }>()

  function clearAutoSave() {
    if (autoSaveTimer != null) {
      clearTimeout(autoSaveTimer)
      autoSaveTimer = null
    }
  }

  function writeParamsForTab(tab: TabState, path: string, content: string): Record<string, unknown> {
    const params: Record<string, unknown> = { path, content }
    if (path === tab.path && tab.version?.hash) params.expected_hash = tab.version.hash
    return params
  }

  function rememberSelfWrite(path: string, content: string) {
    if (!path) return
    selfWrites.set(path, { content, expiresAt: Date.now() + SELF_WRITE_TTL_MS })
  }

  function pendingSelfWrite(path: string): { content: string; expiresAt: number } | null {
    const now = Date.now()
    for (const [key, entry] of selfWrites) {
      if (entry.expiresAt <= now) selfWrites.delete(key)
    }
    const entry = selfWrites.get(path)
    return entry && entry.expiresAt > now ? entry : null
  }

  function applySavedSnapshotToTab(tab: TabState, index: number, path: string, savedContent: string, result: unknown) {
    const liveContent = index >= 0 ? options.liveContentForTab(index) : tab.content
    tab.path = path
    tab.name = fileLabel(path)
    tab.content = liveContent
    tab.originalContent = savedContent
    tab.version = extractFileVersion(result)
    tab.dirty = liveContent !== savedContent
    tab.externalState = undefined
  }

  function markTabChangedOnDisk(tab: TabState, state: 'changed' | 'deleted') {
    if (tab.readOnly) return
    if (tab.kind !== 'text' && tab.kind !== 'table') return
    tab.externalState = state
    tab.dirty = true
    options.notifyCurrentDocumentChanged()
  }

  function markOpenTabChangedOnDisk(index: number, state: 'changed' | 'deleted') {
    const tab = options.tabs[index]
    if (!tab) return
    if (tab.readOnly) return
    if (tab.kind !== 'text') return
    if (index === options.activeTabIndex.value) {
      tab.content = options.liveContentForTab(index)
      clearAutoSave()
    }
    tab.externalState = state
    tab.dirty = true
    if (index === options.activeTabIndex.value) options.notifyCurrentDocumentChanged()
  }

  function isStaleWriteError(err: unknown): boolean {
    return err instanceof Error && /changed on disk/i.test(err.message)
  }

  function scheduleAutoSave() {
    clearAutoSave()
    const tab = options.activeTab.value
    if (tab?.kind !== 'text') return
    if (tab.readOnly) return
    if (!tab?.path || !tab.dirty || tab.externalState || tab.truncated) return
    autoSaveTimer = setTimeout(async () => {
      autoSaveTimer = null
      const t = options.activeTab.value
      if (t?.readOnly) return
      if (!t?.path || !t.dirty || t.externalState || t.truncated) return
      const path = t.path
      const content = t.content
      rememberSelfWrite(path, content)
      try {
        const result = await window.kernel.call('fs.write', writeParamsForTab(t, path, content))
        const index = options.tabs.indexOf(t)
        if (index < 0 || t.path !== path) return
        applySavedSnapshotToTab(t, index, path, content, result)
        options.notifyCurrentDocumentChanged()
      } catch (err) {
        selfWrites.delete(path)
        if (isStaleWriteError(err)) markTabChangedOnDisk(t, 'changed')
        console.error('Auto-save failed:', err)
      }
    }, AUTO_SAVE_DELAY)
  }

  async function saveActiveFile(saveOptions: SaveOptions = {}): Promise<boolean> {
    if (options.historyPreviewActive.value) options.cancelHistoryPreview()
    clearAutoSave()
    const tab = options.activeTab.value
    if (!tab) return false
    if (tab.kind === 'table') return saveActiveTableFile(tab, saveOptions)
    if (tab.kind !== 'text') return false
    if (tab.readOnly) return false
    if (tab.truncated) return false
    if (!saveOptions.forceDialog && tab.path && !tab.dirty) return true

    const editorView = options.getEditorView()
    const liveContent = editorView?.state?.doc?.toString?.() ?? tab.content
    tab.content = liveContent
    let path = tab.path
    if (saveOptions.forceDialog || !path) {
      const selected = await window.kernel.saveFileDialog({ defaultPath: suggestedSavePath(tab) })
      if (!selected) return false
      path = selected
    }

    try {
      if (path === tab.path && tab.externalState) {
        const reason = tab.externalState === 'deleted'
          ? 'File was deleted on disk. Use the conflict bar to overwrite or reload.'
          : 'File was changed on disk. Use the conflict bar to overwrite or reload.'
        options.toastStore.push({ kind: 'error', message: 'Save blocked', detail: reason })
        return false
      }
      const savedContent = tab.content
      rememberSelfWrite(path, savedContent)
      const result = await window.kernel.call('fs.write', writeParamsForTab(tab, path, savedContent))
      applySavedSnapshotToTab(tab, options.tabs.indexOf(tab), path, savedContent, result)
      options.settingsStore.addRecentFile(path)
      options.notifyCurrentDocumentChanged()
      options.notifyActiveEditorArtifactChanged()
      return true
    } catch (err) {
      selfWrites.delete(path)
      if (isStaleWriteError(err)) markTabChangedOnDisk(tab, 'changed')
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Save failed', detail: message })
      console.error('Save failed:', err)
      return false
    }
  }

  async function saveActiveTableFile(tab: TabState, saveOptions: SaveOptions = {}): Promise<boolean> {
    const table = options.tableArtifactRef.value
    if (!table) return false
    if (!saveOptions.forceDialog && tab.path && !tab.dirty) return true

    let path = tab.path
    if (saveOptions.forceDialog || !path) {
      const selected = await window.kernel.saveFileDialog({ defaultPath: suggestedSavePath(tab) })
      if (!selected) return false
      path = selected
    }

    try {
      if (path === tab.path && tab.externalState) {
        const reason = tab.externalState === 'deleted'
          ? 'File was deleted on disk. Reopen the table or save it under a new name.'
          : 'File was changed on disk. Reopen the table before saving.'
        options.toastStore.push({ kind: 'error', message: 'Save blocked', detail: reason })
        return false
      }
      const content = table.serialize()
      if (!saveOptions.forceDialog && path === tab.path && content === tab.originalContent) {
        table.markSaved(content, tab.version)
        tab.content = content
        tab.originalContent = content
        tab.dirty = false
        tab.externalState = undefined
        options.notifyActiveEditorArtifactChanged()
        return true
      }
      rememberSelfWrite(path, content)
      const result = await window.kernel.call('fs.write', writeParamsForTab(tab, path, content))
      const version = extractFileVersion(result)
      table.markSaved(content, version)
      tab.path = path
      tab.name = fileLabel(path)
      tab.content = content
      tab.originalContent = content
      tab.version = version
      tab.dirty = false
      tab.externalState = undefined
      options.settingsStore.addRecentFile(path)
      options.notifyActiveEditorArtifactChanged()
      return true
    } catch (err) {
      selfWrites.delete(path)
      if (isStaleWriteError(err)) markTabChangedOnDisk(tab, 'changed')
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Save failed', detail: message })
      console.error('Table save failed:', err)
      return false
    }
  }

  async function saveActiveFileAs(): Promise<boolean> {
    return saveActiveFile({ forceDialog: true })
  }

  async function conflictReload(): Promise<void> {
    const tab = options.activeTab.value
    if (!tab) return
    if (tab.readOnly) return
    if (tab.kind !== 'text') return

    if (tab.externalState === 'deleted') {
      await conflictOverwrite()
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
      if (options.activeTabIndex.value === options.tabs.indexOf(tab)) {
        options.switchToTabState(tab)
      }
      options.notifyCurrentDocumentChanged()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Reload failed', detail: message })
      console.error('Conflict reload failed:', err)
    }
  }

  async function conflictOverwrite(): Promise<void> {
    if (options.historyPreviewActive.value) options.cancelHistoryPreview()
    const tab = options.activeTab.value
    if (!tab?.path) return
    if (tab.readOnly) return
    if (tab.kind !== 'text') return

    const editorView = options.getEditorView()
    const liveContent = editorView?.state?.doc?.toString?.() ?? tab.content
    tab.content = liveContent

    try {
      const savedContent = tab.content
      rememberSelfWrite(tab.path, savedContent)
      const result = await window.kernel.call('fs.write', { path: tab.path, content: savedContent })
      applySavedSnapshotToTab(tab, options.tabs.indexOf(tab), tab.path, savedContent, result)
      options.notifyCurrentDocumentChanged()
      options.notifyActiveEditorArtifactChanged()
    } catch (err) {
      selfWrites.delete(tab.path)
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Overwrite failed', detail: message })
      console.error('Conflict overwrite failed:', err)
    }
  }

  async function conflictCompare(): Promise<void> {
    if (options.historyPreviewActive.value) options.cancelHistoryPreview()
    const tab = options.activeTab.value
    if (!tab?.path || tab.externalState !== 'changed') return
    if (tab.readOnly) return
    if (tab.kind !== 'text') return

    let diskContent: string
    try {
      const result = await window.kernel.call('fs.read', { path: tab.path, full: true }) as { content: string }
      diskContent = result.content
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      options.toastStore.push({ kind: 'error', message: 'Failed to read disk content', detail: message })
      console.error('Conflict compare failed:', err)
      return
    }

    const editorView = options.getEditorView()
    const bufferContent = editorView?.state?.doc?.toString?.() ?? tab.content

    options.diffStore.activate({
      source: 'conflict',
      original: diskContent,
      modified: bufferContent,
      path: tab.path,
      review: {
        type: 'conflict',
        tabId: tab.id,
      },
      layout: 'unified',
    })
  }

  async function onWorkspaceFilesChanged(payload: unknown) {
    const changes = workspaceFileChangeMap(payload)
    if (changes.size === 0) return
    if (options.referencesFileChanged(changes)) void options.loadReferences()
    if (options.historyPreviewActive.value && options.activeTab.value?.path && changes.has(options.activeTab.value.path)) {
      options.cancelHistoryPreview()
    }

    for (const [path, kind] of changes) {
      const index = options.tabs.findIndex(tab => tab.path === path)
      if (index < 0) continue
      const tab = options.tabs[index]
      if (tab?.readOnly) continue
      if (tab && (tab.kind === 'image' || tab.kind === 'pdf')) {
        // Binary viewers refresh by forced remount; they are never dirty and
        // never show the conflict bar. Deletions keep the last rendered state.
        if (kind !== 'unlink' && kind !== 'unlinkDir') refreshBinaryTabFromDisk(tab)
        continue
      }
      if (tab?.kind !== 'text') continue
      if (kind === 'unlink' || kind === 'unlinkDir') {
        markOpenTabChangedOnDisk(index, 'deleted')
        continue
      }
      await reloadCleanOpenTabFromDisk(index)
    }
  }

  function refreshBinaryTabFromDisk(tab: TabState) {
    tab.id = `${tab.kind}:${tab.path}-${Date.now()}`
  }

  async function reloadCleanOpenTabFromDisk(index: number) {
    const tab = options.tabs[index]
    if (!tab?.path) return
    if (tab.readOnly) return
    const selfWrite = pendingSelfWrite(tab.path)
    if (options.liveContentForTab(index) !== tab.originalContent && !selfWrite) {
      markOpenTabChangedOnDisk(index, 'changed')
      return
    }

    let content = ''
    let version: FileVersion | undefined
    try {
      const result = await window.kernel.call('fs.read', { path: tab.path, full: true }) as { content: string }
      content = result.content
      version = extractFileVersion(result)
    } catch (err) {
      markOpenTabChangedOnDisk(index, 'deleted')
      console.error('Failed to reload changed file:', err)
      return
    }

    const latestIndex = options.tabs.findIndex(candidate => candidate.id === tab.id && candidate.path === tab.path)
    if (latestIndex < 0) return
    const latest = options.tabs[latestIndex]
    if (latest.readOnly) return
    const latestLiveContent = options.liveContentForTab(latestIndex)
    const latestSelfWrite = pendingSelfWrite(latest.path)
    if (latestSelfWrite && content === latestSelfWrite.content) {
      applySavedSnapshotToTab(latest, latestIndex, latest.path, content, { version })
      if (latestIndex === options.activeTabIndex.value) options.notifyCurrentDocumentChanged()
      return
    }
    if (latestLiveContent !== latest.originalContent) {
      markOpenTabChangedOnDisk(latestIndex, 'changed')
      return
    }

    if (content === latestLiveContent) {
      applySavedSnapshotToTab(latest, latestIndex, latest.path, content, { version })
      if (latestIndex === options.activeTabIndex.value) options.notifyCurrentDocumentChanged()
      return
    }

    notifyCommentDelta(latest.path, latestLiveContent, content)
    latest.content = content
    latest.originalContent = content
    latest.version = version
    latest.dirty = false
    latest.externalState = undefined
    latest.editorState = undefined
    if (latestIndex === options.activeTabIndex.value) {
      options.switchToDoc(content)
      options.notifyCurrentDocumentChanged()
    }
  }

  // External edits (agents working through the comment tools) reload silently;
  // surface what happened to the review threads so the round is visible.
  function notifyCommentDelta(path: string, before: string, after: string) {
    if (!isMarkdownPath(path)) return
    const delta = diffCommentThreads(before, after)
    const parts: string[] = []
    if (delta.resolved) parts.push(`${delta.resolved} resolved`)
    if (delta.replied) parts.push(`${delta.replied} repl${delta.replied === 1 ? 'y' : 'ies'}`)
    if (delta.added) parts.push(`${delta.added} new`)
    if (!parts.length) return
    const basename = path.split('/').pop() || path
    options.toastStore.push({
      kind: 'info',
      message: `Comments updated in ${basename}`,
      detail: parts.join(' · '),
    })
  }

  return {
    clearAutoSave,
    writeParamsForTab,
    rememberSelfWrite,
    applySavedSnapshotToTab,
    markTabChangedOnDisk,
    isStaleWriteError,
    scheduleAutoSave,
    saveActiveFile,
    saveActiveFileAs,
    conflictReload,
    conflictOverwrite,
    conflictCompare,
    onWorkspaceFilesChanged,
  }
}

function workspaceFileChangeMap(payload: unknown): Map<string, string> {
  const out = new Map<string, string>()
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return out
  const record = payload as Record<string, unknown>

  if (Array.isArray(record.changes)) {
    for (const item of record.changes) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const change = item as Record<string, unknown>
      if (typeof change.path !== 'string' || !change.path) continue
      out.set(change.path, typeof change.kind === 'string' ? change.kind : 'change')
    }
  }

  if (Array.isArray(record.paths)) {
    for (const path of record.paths) {
      if (typeof path === 'string' && path && !out.has(path)) out.set(path, 'change')
    }
  }

  return out
}
