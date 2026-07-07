import type { ToolRegistry } from '@main/tools/registry.js'

// Last-known editor tab state, pushed by the renderer (useEditorStatus) over
// the `editor:state` IPC channel. Main never asks the renderer; it serves this
// cache so the tool also answers instantly for MCP clients while the window is
// busy. Cleared on workspace switch; the remounted editor re-pushes.

export interface EditorTabInfo {
  path: string | null
  name: string
  kind: string
  dirty: boolean
  active: boolean
  /** Present only when state comes from per-window updates (Phase 0+). */
  window?: 'main' | 'popout'
}

export interface EditorStateSnapshot {
  activeDocument: Omit<EditorTabInfo, 'active'> | null
  openTabs: EditorTabInfo[]
}

const MAX_TABS = 200

// ── Legacy single-window path (backward compat) ──

let legacySnapshot: EditorStateSnapshot | null = null

// ── Per-window state (Phase 0+) ──

const windowSnapshots = new Map<number, EditorStateSnapshot>()
let mainWindowId: number | null = null
let lastFocusedWindowId: number | null = null

// ── Public API ──

/** Identify which webContents id is the main window. */
export function setMainWindowId(id: number): void {
  mainWindowId = id
}

/** Record that a window received focus (drives activeDocument selection). */
export function noteWindowFocused(id: number): void {
  lastFocusedWindowId = id
}

/** Remove a window's snapshot on close/destroy. */
export function dropWindow(id: number): void {
  windowSnapshots.delete(id)
  if (lastFocusedWindowId === id) {
    // Fall back to any remaining window (prefer main)
    if (mainWindowId !== null && windowSnapshots.has(mainWindowId)) {
      lastFocusedWindowId = mainWindowId
    } else {
      const remaining = windowSnapshots.keys().next()
      lastFocusedWindowId = remaining.done ? null : remaining.value
    }
  }
}

/** Legacy single-window update (no window field on tabs). */
export function updateEditorState(payload: unknown): void {
  legacySnapshot = normalizeSnapshot(payload)
}

/** Per-window update — tabs gain a `window` field in the merged read. */
export function updateWindowEditorState(webContentsId: number, payload: unknown): void {
  const snap = normalizeSnapshot(payload)
  if (snap) {
    windowSnapshots.set(webContentsId, snap)
  } else {
    windowSnapshots.delete(webContentsId)
  }
}

export function clearEditorState(): void {
  legacySnapshot = null
  windowSnapshots.clear()
  lastFocusedWindowId = null
}

/**
 * Find the webContents id of a pop-out window that has the given path open.
 * Returns null if no pop-out has it, or if only the main window has it.
 * Paths are compared as workspace-relative strings (case-sensitive).
 */
export function findWindowIdForPath(path: string): number | null {
  if (!path) return null
  for (const [id, snap] of windowSnapshots) {
    if (id === mainWindowId) continue
    for (const tab of snap.openTabs) {
      if (tab.path === path) return id
    }
  }
  return null
}

export function getEditorState(): { available: boolean } & EditorStateSnapshot {
  // If per-window snapshots exist, produce a merged view.
  if (windowSnapshots.size > 0) {
    return mergedState()
  }
  // Otherwise fall back to legacy single-window path.
  if (!legacySnapshot) return { available: false, activeDocument: null, openTabs: [] }
  return { available: true, activeDocument: legacySnapshot.activeDocument, openTabs: legacySnapshot.openTabs }
}

export function registerEditorStateTools(tools: ToolRegistry): void {
  tools.register({
    name: 'editor.state',
    description: 'See what the user has open in the desktop editor: open tabs and the active (focused) document, with workspace-relative paths. dirty=true means the tab has unsaved changes, so the file on disk may be behind what the user sees. available=false means no editor is reporting (headless or window not ready).',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => getEditorState(),
  })
}

// ── Internals ──

function mergedState(): { available: boolean } & EditorStateSnapshot {
  const allTabs: EditorTabInfo[] = []

  for (const [id, snap] of windowSnapshots) {
    const role = windowRole(id)
    for (const tab of snap.openTabs) {
      allTabs.push({ ...tab, window: role })
    }
  }

  // activeDocument comes from the most recently focused window that has one
  const focusedSnap = lastFocusedWindowId !== null ? windowSnapshots.get(lastFocusedWindowId) : undefined
  let activeDocument: EditorStateSnapshot['activeDocument'] = null
  if (focusedSnap?.activeDocument) {
    activeDocument = focusedSnap.activeDocument
  } else {
    // Fall back: find any window that has an activeDocument
    for (const snap of windowSnapshots.values()) {
      if (snap.activeDocument) {
        activeDocument = snap.activeDocument
        break
      }
    }
  }

  // Cap total tabs
  if (allTabs.length > MAX_TABS) allTabs.length = MAX_TABS

  return { available: true, activeDocument, openTabs: allTabs }
}

function windowRole(webContentsId: number): 'main' | 'popout' {
  return webContentsId === mainWindowId ? 'main' : 'popout'
}

function normalizeSnapshot(payload: unknown): EditorStateSnapshot | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raw = payload as Record<string, unknown>
  const active = normalizeTab(raw.activeDocument)
  const openTabs = Array.isArray(raw.openTabs)
    ? raw.openTabs.slice(0, MAX_TABS).map(entry => normalizeTab(entry)).filter((tab): tab is EditorTabInfo => tab !== null)
    : []
  if (active) {
    const { active: _ignored, ...activeDocument } = active
    return { activeDocument, openTabs }
  }
  return { activeDocument: null, openTabs }
}

function normalizeTab(value: unknown): EditorTabInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const path = typeof raw.path === 'string' && raw.path.length > 0 ? raw.path : null
  const name = typeof raw.name === 'string' && raw.name.length > 0
    ? raw.name
    : path?.split('/').pop() || 'Untitled'
  return {
    path,
    name,
    kind: typeof raw.kind === 'string' && raw.kind.length > 0 ? raw.kind : 'text',
    dirty: Boolean(raw.dirty),
    active: Boolean(raw.active),
  }
}
