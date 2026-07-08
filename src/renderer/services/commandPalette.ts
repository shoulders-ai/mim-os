// Command palette ranking and filtering logic.
// Reuses the existing fuzzy scorer for consistency with the Files search.

import { fuzzyScore, type FuzzyMatch } from './fuzzy.js'
import { shortcutLabel } from './shortcutLabels.js'

export type PaletteItemKind = 'file' | 'action' | 'session' | 'surface'

export interface PaletteItem {
  id: string
  kind: PaletteItemKind
  /** Primary label shown in the palette. */
  label: string
  /** Optional secondary hint (shortcut, path, etc.). */
  hint?: string
  /** Optional group header text for visual separation. */
  group?: string
}

export interface RankedPaletteItem {
  item: PaletteItem
  score: number
  /** Character positions matched in the label for highlighting. */
  positions: number[]
}

// Action items get a boost so they rank above similarly-named files.
const ACTION_BONUS = 8
// Surface items (Chat, Files, Terminal, Monitor) get a stronger boost — they're the
// most common palette targets.
const SURFACE_BONUS = 12
// Session items get a small penalty relative to actions since they're usually
// searched by name, not by prefix.
const SESSION_PENALTY = -3

function kindBonus(kind: PaletteItemKind): number {
  if (kind === 'surface') return SURFACE_BONUS
  if (kind === 'action') return ACTION_BONUS
  if (kind === 'session') return SESSION_PENALTY
  return 0
}

/**
 * Rank palette items against a query string. Returns matches sorted by score
 * (best first), capped to `limit`. An empty query returns all items in their
 * natural order (surfaces first, then actions, then sessions, then files).
 */
export function rankPaletteItems(
  query: string,
  items: PaletteItem[],
  limit = 50,
): RankedPaletteItem[] {
  const q = query.trim()

  if (!q) {
    // No query: return all items in kind priority order.
    const kindOrder: Record<PaletteItemKind, number> = {
      surface: 0,
      action: 1,
      session: 2,
      file: 3,
    }
    const sorted = [...items]
      .sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9))
    return sorted.slice(0, limit).map(item => ({
      item,
      score: 0,
      positions: [],
    }))
  }

  const results: RankedPaletteItem[] = []
  for (const item of items) {
    const match: FuzzyMatch | null = fuzzyScore(q, item.label)
    if (!match) continue
    results.push({
      item,
      score: match.score + kindBonus(item.kind),
      positions: match.positions,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// ── Static action items ──

export function coreActions(
  platform?: string,
  options?: { hasActiveEditorTab?: boolean },
): PaletteItem[] {
  const items: PaletteItem[] = [
    { id: 'action:new-chat', kind: 'action', label: 'New chat', hint: shortcutLabel(['Mod', 'N'], platform) },
    { id: 'action:new-document', kind: 'action', label: 'New document', hint: shortcutLabel(['Mod', 'T'], platform) },
    { id: 'action:open-file', kind: 'action', label: 'Open file', hint: shortcutLabel(['Mod', 'O'], platform) },
    { id: 'action:export-document', kind: 'action', label: 'Export document (PDF, Word)', hint: shortcutLabel(['Shift', 'Mod', 'E'], platform) },
  ]
  // Only offered while an editor tab is active — moving a tab needs a tab.
  if (options?.hasActiveEditorTab) {
    items.push({ id: 'action:pop-out-tab', kind: 'action', label: 'Move Tab to New Window', hint: '' })
  }
  items.push(
    { id: 'action:settings', kind: 'action', label: 'Settings', hint: shortcutLabel(['Mod', ','], platform) },
    { id: 'action:shortcuts', kind: 'action', label: 'Keyboard shortcuts', hint: '' },
  )
  return items
}

export function coreSurfaces(): PaletteItem[] {
  return [
    { id: 'surface:chat', kind: 'surface', label: 'Chat', hint: '' },
    { id: 'surface:routines', kind: 'surface', label: 'Routines', hint: '' },
    { id: 'surface:files', kind: 'surface', label: 'Files', hint: '' },
    { id: 'surface:terminal', kind: 'surface', label: 'Terminal', hint: '' },
    { id: 'surface:trust', kind: 'surface', label: 'Monitor', hint: '' },
    { id: 'surface:history', kind: 'surface', label: 'History', hint: '' },
  ]
}

// One palette item per mounted app agent, so the user can launch a new
// agent chat from Cmd+K.
export function agentActions(
  agents: Array<{ id: string; name: string }>,
): PaletteItem[] {
  return agents.map(agent => ({
    id: `action:new-agent-chat:${agent.id}`,
    kind: 'action' as PaletteItemKind,
    label: `New ${agent.name} chat`,
    hint: '',
  }))
}
