/**
 * Editor tab persistence: serialize/deserialize open tab state for restore on launch.
 * Stored as `.mim/editor-tabs.json` via kernel tools.
 */

export type PersistedTabKind = 'text' | 'pdf' | 'card' | 'table' | 'image'

export interface PersistedTab {
  /** Workspace-relative path, empty for untitled */
  path: string
  /** Display name */
  name: string
  /** Document surface hosted by the editor tab strip */
  kind: PersistedTabKind
  /** Buffer content for untitled tabs (pathless) only */
  content?: string
}

export interface PersistedTabState {
  version: 1
  tabs: PersistedTab[]
  activeIndex: number
}

export interface LiveTab {
  path: string
  name: string
  kind?: PersistedTabKind
  content: string
  readOnly?: boolean
}

export function serializeTabState(tabs: LiveTab[], activeIndex: number): PersistedTabState {
  const persistable = tabs
    .map((tab, index) => ({ tab, index }))
    .filter(item => item.tab.readOnly !== true)
  const persistedActiveIndex = activeIndexForPersistedTabs(persistable.map(item => item.index), activeIndex)
  return {
    version: 1,
    tabs: persistable.map(({ tab }) => {
      const kind = tab.kind ?? 'text'
      const entry: PersistedTab = { path: tab.path, name: tab.name, kind }
      // Only persist buffer content for untitled text tabs (no path on disk).
      if (kind === 'text' && !tab.path && tab.content.length > 0) {
        entry.content = tab.content
      }
      return entry
    }),
    activeIndex: persistedActiveIndex,
  }
}

export function deserializeTabState(raw: unknown): PersistedTabState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.version !== 1) return null
  if (!Array.isArray(record.tabs)) return null

  const tabs: PersistedTab[] = []
  for (const item of record.tabs) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const entry = item as Record<string, unknown>
    if (typeof entry.name !== 'string') continue
    const kind = parseTabKind(entry.kind)
    if (!kind) continue
    const tab: PersistedTab = {
      path: typeof entry.path === 'string' ? entry.path : '',
      name: entry.name,
      kind,
    }
    if (kind === 'text' && typeof entry.content === 'string') {
      tab.content = entry.content
    }
    tabs.push({
      ...tab,
    })
  }

  if (tabs.length === 0) return null

  const activeIndex = typeof record.activeIndex === 'number'
    ? Math.max(0, Math.min(Math.floor(record.activeIndex), tabs.length - 1))
    : 0

  return { version: 1, tabs, activeIndex }
}

function parseTabKind(kind: unknown): PersistedTabKind | null {
  if (kind === undefined) return 'text'
  if (kind === 'text' || kind === 'pdf' || kind === 'card' || kind === 'table' || kind === 'image') return kind
  return null
}

function activeIndexForPersistedTabs(originalIndexes: number[], activeIndex: number): number {
  if (originalIndexes.length === 0) return 0
  const exact = originalIndexes.indexOf(activeIndex)
  if (exact >= 0) return exact
  for (let i = originalIndexes.length - 1; i >= 0; i--) {
    if (originalIndexes[i] < activeIndex) return i
  }
  return 0
}
