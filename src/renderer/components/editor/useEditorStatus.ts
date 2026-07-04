import { computed, watch, type ComputedRef, type Ref } from 'vue'
import { isMarkdownPath } from './codemirror/language.js'
import { formatCompactNumber, formatNumber } from './editorFileMeta.js'
import type { TabState } from './editorTypes.js'
import type { TableStats } from '../files/tableArtifactModel.js'

interface CitationHealthLike {
  total: number
  unresolved: unknown[]
}

interface UseEditorStatusOptions {
  tabs: TabState[]
  activeTab: ComputedRef<TabState | null>
  activeIsText: ComputedRef<boolean>
  stats: Ref<{ words: number; characters: number; selected?: boolean }>
  activeTableStats: Ref<TableStats>
  citationHealth: ComputedRef<CitationHealthLike>
  referenceLibraryActive: Ref<boolean>
  activeReferencePath: Ref<string>
}

function tabDirty(tab: TabState): boolean {
  if (tab.readOnly) return false
  if (tab.dirty) return true
  return tab.kind === 'text' && !tab.path && tab.content.length > 0
}

export function useEditorStatus(options: UseEditorStatusOptions) {
  const showWordStats = computed(() => {
    if (!options.activeIsText.value) return false
    const path = options.activeTab.value?.path ?? ''
    if (isMarkdownPath(path)) return true
    const name = path.split('/').pop() ?? ''
    const dot = name.lastIndexOf('.')
    if (dot <= 0 || dot === name.length - 1) return true
    const ext = name.slice(dot + 1).toLowerCase()
    return ext === 'txt'
  })

  const dirtyTabCount = computed(() => {
    let count = 0
    for (const tab of options.tabs) {
      if (tab.readOnly) continue
      if (tab.kind === 'text' && (tab.dirty || (!tab.path && tab.content.length > 0))) count++
      else if (tab.kind === 'table' && tab.path && tab.dirty) count++
    }
    return count
  })

  const dirtyTabPaths = computed(() =>
    options.tabs
      .filter(tab => !tab.readOnly && (tab.kind === 'text' || tab.kind === 'table') && tab.path && tab.dirty)
      .map(tab => tab.path)
  )

  watch(() => [dirtyTabCount.value, dirtyTabPaths.value.join('\n')], () => {
    window.kernel.pushDirtyTabCount?.({
      count: dirtyTabCount.value,
      paths: dirtyTabPaths.value,
    })
  }, { immediate: true })

  // Tab snapshot for the editor.state tool (MCP: editor_state) — main caches
  // the last push so external agents can see what is open in the editor.
  const editorStateSnapshot = computed(() => {
    const active = options.activeTab.value
    const openTabs = options.tabs.map(tab => ({
      path: tab.path || null,
      name: tab.name,
      kind: tab.kind,
      dirty: tabDirty(tab),
      active: tab === active,
    }))
    const activeEntry = openTabs.find(tab => tab.active) ?? null
    return {
      activeDocument: activeEntry
        ? { path: activeEntry.path, name: activeEntry.name, kind: activeEntry.kind, dirty: activeEntry.dirty }
        : null,
      openTabs,
    }
  })

  watch(() => JSON.stringify(editorStateSnapshot.value), () => {
    window.kernel.pushEditorState?.(editorStateSnapshot.value)
  }, { immediate: true })

  const wordStatsLabel = computed(() => {
    const suffix = options.stats.value.selected ? ' sel' : ''
    return `${formatCompactNumber(options.stats.value.words)}w ${formatCompactNumber(options.stats.value.characters)}ch${suffix}`
  })

  const wordStatsTitle = computed(() => {
    const selected = options.stats.value.selected ? ' selected' : ''
    return `${formatNumber(options.stats.value.words)} words · ${formatNumber(options.stats.value.characters)} characters${selected}`
  })

  const tableStatsLabel = computed(() =>
    `${formatCompactNumber(options.activeTableStats.value.rows)}r x ${formatCompactNumber(options.activeTableStats.value.cols)}c`
  )

  const tableStatsTitle = computed(() =>
    `${formatNumber(options.activeTableStats.value.rows)} rows x ${formatNumber(options.activeTableStats.value.cols)} columns`
  )

  const citationStatusLabel = computed(() => {
    const health = options.citationHealth.value
    if (health.unresolved.length > 0) {
      return `${formatCompactNumber(health.unresolved.length)} missing`
    }
    return `${formatCompactNumber(health.total)} cite${health.total === 1 ? '' : 's'}`
  })

  const citationStatusFullLabel = computed(() => {
    const health = options.citationHealth.value
    if (health.unresolved.length > 0) {
      const word = health.unresolved.length === 1 ? 'citation' : 'citations'
      return `${formatNumber(health.unresolved.length)} ${word} not found`
    }
    const word = health.total === 1 ? 'citation' : 'citations'
    return `${formatNumber(health.total)} ${word}`
  })

  const citationStatusTitle = computed(() =>
    options.referenceLibraryActive.value
      ? `${citationStatusFullLabel.value} · Bibliography: ${options.activeReferencePath.value}`
      : `${citationStatusFullLabel.value} · No bibliography found`,
  )

  return {
    showWordStats,
    wordStatsLabel,
    wordStatsTitle,
    tableStatsLabel,
    tableStatsTitle,
    citationStatusLabel,
    citationStatusTitle,
  }
}
