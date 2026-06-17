import { ref, type ComputedRef } from 'vue'
import type { TableStats } from '../files/tableArtifactModel.js'
import type { FileVersion, TabState } from './editorTypes.js'

interface UseEditorTableTabOptions {
  activeTab: ComputedRef<TabState | null>
}

export function useEditorTableTab(options: UseEditorTableTabOptions) {
  const activeTableStats = ref<TableStats>({ rows: 0, cols: 0 })

  function setActiveTableDirty(dirty: boolean) {
    const tab = options.activeTab.value
    if (tab?.kind !== 'table') return
    tab.dirty = dirty
  }

  function updateActiveTableStats(next: TableStats) {
    activeTableStats.value = next
  }

  function applyTableLoadedSnapshot(payload: { content: string; version?: FileVersion }) {
    const tab = options.activeTab.value
    if (tab?.kind !== 'table') return
    tab.content = payload.content
    tab.originalContent = payload.content
    tab.version = payload.version
    tab.dirty = false
    tab.externalState = undefined
  }

  return {
    activeTableStats,
    setActiveTableDirty,
    updateActiveTableStats,
    applyTableLoadedSnapshot,
  }
}
