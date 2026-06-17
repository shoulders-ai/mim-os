import { watch, type Ref } from 'vue'
import { serializeTabState, deserializeTabState, type PersistedTabState } from '../../services/editorTabPersistence.js'
import { extractFileVersion, fileLabel } from './editorFileMeta.js'
import type { TabState } from './editorTypes.js'

const TAB_PERSIST_PATH = '.mim/editor-tabs.json'
const TAB_PERSIST_DEBOUNCE_MS = 1500

interface UseEditorTabPersistenceOptions {
  tabs: TabState[]
  activeTabIndex: Ref<number>
  liveContentForTab: (index: number) => string
}

export function useEditorTabPersistence(options: UseEditorTabPersistenceOptions) {
  let tabPersistTimer: ReturnType<typeof setTimeout> | null = null

  function clearTabPersistTimer() {
    if (tabPersistTimer != null) {
      clearTimeout(tabPersistTimer)
      tabPersistTimer = null
    }
  }

  function scheduleTabPersist() {
    clearTabPersistTimer()
    tabPersistTimer = setTimeout(() => {
      tabPersistTimer = null
      void persistTabs()
    }, TAB_PERSIST_DEBOUNCE_MS)
  }

  async function persistTabs(): Promise<void> {
    const liveTabs = options.tabs.map((tab, i) => ({
      path: tab.path,
      name: tab.name,
      kind: tab.kind,
      content: options.liveContentForTab(i),
      readOnly: tab.readOnly,
    }))
    const state = serializeTabState(liveTabs, options.activeTabIndex.value)
    try {
      await window.kernel.call('fs.write', {
        path: TAB_PERSIST_PATH,
        content: JSON.stringify(state, null, 2),
      })
    } catch {
      // Tab persistence is best-effort; never block the editor.
    }
  }

  async function restoreTabs(): Promise<boolean> {
    let raw: PersistedTabState | null = null
    try {
      const result = await window.kernel.call('fs.read', { path: TAB_PERSIST_PATH }) as { content?: string }
      if (typeof result?.content === 'string') {
        raw = deserializeTabState(JSON.parse(result.content))
      }
    } catch {
      return false
    }

    if (!raw || raw.tabs.length === 0) return false

    for (const persisted of raw.tabs) {
      if (persisted.kind === 'text' && persisted.path) {
        try {
          const result = await window.kernel.call('fs.read', { path: persisted.path, full: true }) as { content: string; truncated?: boolean }
          const id = `${persisted.path}-${Date.now()}-${options.tabs.length}`
          options.tabs.push({
            id,
            kind: 'text',
            path: persisted.path,
            name: persisted.name || fileLabel(persisted.path),
            content: result.content,
            originalContent: result.content,
            version: extractFileVersion(result),
            dirty: false,
            externalState: undefined,
            truncated: result.truncated === true,
          })
        } catch {
          // File may have been deleted; skip silently.
        }
      } else if (persisted.kind === 'pdf' || persisted.kind === 'card' || persisted.kind === 'table') {
        if (!persisted.path) continue
        options.tabs.push({
          id: `${persisted.kind}:${persisted.path}-${Date.now()}-${options.tabs.length}`,
          kind: persisted.kind,
          path: persisted.path,
          name: persisted.name || fileLabel(persisted.path),
          content: '',
          originalContent: '',
          dirty: false,
          externalState: undefined,
        })
      } else if (persisted.kind === 'text' && persisted.content) {
        const id = `untitled-${Date.now()}-${options.tabs.length}`
        options.tabs.push({
          id,
          kind: 'text',
          path: '',
          name: persisted.name || 'Untitled',
          content: persisted.content,
          originalContent: '',
          dirty: true,
          externalState: undefined,
        })
      }
    }

    if (options.tabs.length === 0) return false

    options.activeTabIndex.value = Math.min(raw.activeIndex, options.tabs.length - 1)
    return true
  }

  const stopPersistenceWatch = watch(
    () => [options.tabs.length, options.activeTabIndex.value, ...options.tabs.map(t => `${t.path}:${t.dirty}`)],
    () => { scheduleTabPersist() },
  )

  function disposeTabPersistence() {
    stopPersistenceWatch()
    clearTabPersistTimer()
  }

  return {
    scheduleTabPersist,
    persistTabs,
    restoreTabs,
    disposeTabPersistence,
  }
}
