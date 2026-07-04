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
}

export interface EditorStateSnapshot {
  activeDocument: Omit<EditorTabInfo, 'active'> | null
  openTabs: EditorTabInfo[]
}

const MAX_TABS = 200

let snapshot: EditorStateSnapshot | null = null

export function updateEditorState(payload: unknown): void {
  snapshot = normalizeSnapshot(payload)
}

export function clearEditorState(): void {
  snapshot = null
}

export function getEditorState(): { available: boolean } & EditorStateSnapshot {
  if (!snapshot) return { available: false, activeDocument: null, openTabs: [] }
  return { available: true, activeDocument: snapshot.activeDocument, openTabs: snapshot.openTabs }
}

export function registerEditorStateTools(tools: ToolRegistry): void {
  tools.register({
    name: 'editor.state',
    description: 'See what the user has open in the desktop editor: open tabs and the active (focused) document, with workspace-relative paths. dirty=true means the tab has unsaved changes, so the file on disk may be behind what the user sees. available=false means no editor is reporting (headless or window not ready).',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => getEditorState(),
  })
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
