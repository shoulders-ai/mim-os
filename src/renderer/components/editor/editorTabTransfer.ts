import type { FileVersion, TabState } from './editorTypes.js'

export interface TransferredTab {
  path: string | null
  kind: 'text' | 'pdf' | 'table' | 'card' | 'image'
  name: string
  dirty: boolean
  content?: string
  // Dirty file-backed tabs carry their disk baseline across the transfer so
  // the adopting window keeps exact dirty semantics and stale-write hashes:
  // originalContent is what dirty is computed against, version.hash is the
  // expected_hash for the next save. Without these, an edit-then-undo in the
  // adopting window could read clean while the disk differs (data loss on
  // close), and the first save would bypass the stale-write guard.
  originalContent?: string
  version?: FileVersion
  selection?: { anchor: number; head: number }
  scrollTop?: number
  viewMode?: string
}

export interface ViewStateSnapshot {
  selection?: { anchor: number; head: number }
  scrollTop?: number
  viewMode?: string
}

const VALID_KINDS = new Set(['text', 'pdf', 'table', 'card', 'image'])

/**
 * Serialize a TabState + captured CodeMirror view state into a TransferredTab
 * suitable for IPC transfer. Content is included only when dirty or untitled
 * (no path) — clean file-backed tabs transfer path-only for re-read on adopt.
 */
export function serializeTabForTransfer(tab: TabState, viewState: ViewStateSnapshot): TransferredTab {
  const path = tab.path || null
  const includeContent = tab.dirty || !path

  const result: TransferredTab = {
    path,
    kind: tab.kind,
    name: tab.name,
    dirty: tab.dirty,
  }

  if (includeContent) {
    result.content = tab.content
  }
  if (tab.dirty && path) {
    result.originalContent = tab.originalContent
    if (tab.version) result.version = { ...tab.version }
  }
  if (viewState.selection) {
    result.selection = { anchor: viewState.selection.anchor, head: viewState.selection.head }
  }
  if (viewState.scrollTop != null) {
    result.scrollTop = viewState.scrollTop
  }
  if (viewState.viewMode != null) {
    result.viewMode = viewState.viewMode
  }

  return result
}

/**
 * Defensively parse data arriving over IPC into a TransferredTab.
 * Returns null if the data is malformed or missing required fields.
 * Strips unknown properties and validates optional field shapes.
 */
export function validateTransferredTab(value: unknown): TransferredTab | null {
  if (value == null || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>

  // Required fields
  if (!('path' in raw)) return null
  if (typeof raw.kind !== 'string' || !VALID_KINDS.has(raw.kind)) return null
  if (typeof raw.name !== 'string') return null
  if (typeof raw.dirty !== 'boolean') return null

  const path = raw.path === null ? null : typeof raw.path === 'string' ? raw.path : null
  if (raw.path !== null && typeof raw.path !== 'string') return null

  // dirty or untitled tabs must carry content
  if (raw.dirty && typeof raw.content !== 'string') return null
  if (path === null && typeof raw.content !== 'string') return null

  const result: TransferredTab = {
    path,
    kind: raw.kind as TransferredTab['kind'],
    name: raw.name,
    dirty: raw.dirty,
  }

  if (typeof raw.content === 'string') {
    result.content = raw.content
  }

  if (typeof raw.originalContent === 'string') {
    result.originalContent = raw.originalContent
  }

  // Optional: version (stale-write baseline; hash is the load-bearing field)
  if (raw.version != null && typeof raw.version === 'object') {
    const ver = raw.version as Record<string, unknown>
    if (typeof ver.hash === 'string') {
      result.version = { hash: ver.hash }
      if (typeof ver.size === 'number') result.version.size = ver.size
      if (typeof ver.mtimeMs === 'number') result.version.mtimeMs = ver.mtimeMs
      if (typeof ver.modifiedAt === 'string') result.version.modifiedAt = ver.modifiedAt
    }
  }

  // Optional: selection (both anchor and head must be numbers)
  if (raw.selection != null && typeof raw.selection === 'object') {
    const sel = raw.selection as Record<string, unknown>
    if (typeof sel.anchor === 'number' && typeof sel.head === 'number') {
      result.selection = { anchor: sel.anchor, head: sel.head }
    }
  }

  // Optional: scrollTop
  if (typeof raw.scrollTop === 'number') {
    result.scrollTop = raw.scrollTop
  }

  // Optional: viewMode
  if (typeof raw.viewMode === 'string') {
    result.viewMode = raw.viewMode
  }

  return result
}

/**
 * Clamp a selection to a document of the given length. Used when restoring
 * a transferred selection into a document whose content may differ slightly
 * (e.g. external change between serialize and adopt for clean tabs).
 */
export function clampSelection(
  selection: { anchor: number; head: number } | undefined,
  docLength: number,
): { anchor: number; head: number } | undefined {
  if (!selection) return undefined
  return {
    anchor: Math.min(Math.max(0, selection.anchor), docLength),
    head: Math.min(Math.max(0, selection.head), docLength),
  }
}
