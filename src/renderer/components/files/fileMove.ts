import { baseName, parentDir } from './fileDisplay.js'
import type { FileRow } from './fileTypes.js'

export const WORKSPACE_DRAG_MIME = 'application/x-mim-workspace-path+json'

export interface WorkspaceDragItem {
  path: string
  type: 'directory' | 'file'
}

// A drag always carries the full list of items being moved: a single row, or
// the whole multi-selection when the dragged row is part of one.
export interface WorkspaceDragPayload {
  items: WorkspaceDragItem[]
}

export interface WorkspaceMoveResult {
  oldPath: string
  newPath: string
  type: 'directory' | 'file'
}

export type WorkspaceMovePlan =
  | { ok: true; move: WorkspaceMoveResult }
  | { ok: false; reason: string }

export function encodeWorkspaceDragPayload(items: WorkspaceDragItem[]): string {
  return JSON.stringify({ items: items.map(item => ({ path: item.path, type: item.type })) })
}

export function parseWorkspaceDragPayload(value: string): WorkspaceDragPayload | null {
  try {
    const parsed = JSON.parse(value) as { items?: unknown }
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null
    const items: WorkspaceDragItem[] = []
    for (const item of parsed.items as Array<Partial<WorkspaceDragItem>>) {
      if (typeof item?.path !== 'string') return null
      if (item.type !== 'directory' && item.type !== 'file') return null
      items.push({ path: item.path, type: item.type })
    }
    return { items }
  } catch {
    return null
  }
}

// When a folder and its descendants are both selected, moving (or trashing)
// the folder already covers the descendants; acting on them separately would
// fail or double-apply.
export function pruneNestedDragItems(items: WorkspaceDragItem[]): WorkspaceDragItem[] {
  const dirs = items.filter(item => item.type === 'directory').map(item => item.path)
  return items.filter(item => !dirs.some(dir => item.path !== dir && item.path.startsWith(`${dir}/`)))
}

export function isWorkspaceDragRow(row: FileRow): boolean {
  return !row.disabled && !isProtectedMimPath(row.path)
}

export function isWorkspaceDropDir(row: FileRow): boolean {
  return row.type === 'directory'
    && !row.disabled
    && !isProtectedMimPath(row.path, true)
}

export function buildWorkspaceMovePlan(
  source: WorkspaceDragItem,
  targetDir: string,
): WorkspaceMovePlan {
  const dir = normalizeDir(targetDir)
  if (!source.path || isProtectedMimPath(source.path)) {
    return { ok: false, reason: 'Managed Mim folders cannot be moved from Files.' }
  }
  if (isProtectedMimPath(dir, true)) {
    return { ok: false, reason: 'Managed Mim folders are not move targets.' }
  }
  if (source.type === 'directory' && (dir === source.path || dir.startsWith(`${source.path}/`))) {
    return { ok: false, reason: 'A folder cannot be moved into itself.' }
  }
  if (parentDir(source.path) === dir) {
    return { ok: false, reason: 'Already in this folder.' }
  }
  return {
    ok: true,
    move: {
      oldPath: source.path,
      newPath: joinWorkspacePath(dir, baseName(source.path)),
      type: source.type,
    },
  }
}

export function joinWorkspacePath(dir: string, name: string): string {
  const normalized = normalizeDir(dir)
  return normalized === '.' || normalized === '' ? name : `${normalized}/${name}`
}

function normalizeDir(dir: string): string {
  return dir === '' ? '.' : dir.replace(/\/+$/, '') || '.'
}

function isProtectedMimPath(path: string, allowTeamFilesRoot = false): boolean {
  if (path === '.mim/team/files') return !allowTeamFilesRoot
  if (path.startsWith('.mim/team/files/')) return false
  return path === '.mim' || path.startsWith('.mim/')
}
