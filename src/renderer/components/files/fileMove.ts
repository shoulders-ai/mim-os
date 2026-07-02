import { baseName, parentDir } from './fileDisplay.js'
import type { FileRow } from './fileTypes.js'

export const WORKSPACE_DRAG_MIME = 'application/x-mim-workspace-path+json'

export interface WorkspaceDragPayload {
  path: string
  type: 'directory' | 'file'
}

export interface WorkspaceMoveResult {
  oldPath: string
  newPath: string
  type: 'directory' | 'file'
}

export type WorkspaceMovePlan =
  | { ok: true; move: WorkspaceMoveResult }
  | { ok: false; reason: string }

export function encodeWorkspaceDragPayload(row: Pick<FileRow, 'path' | 'type'>): string {
  return JSON.stringify({ path: row.path, type: row.type })
}

export function parseWorkspaceDragPayload(value: string): WorkspaceDragPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<WorkspaceDragPayload>
    if (typeof parsed.path !== 'string') return null
    if (parsed.type !== 'directory' && parsed.type !== 'file') return null
    return { path: parsed.path, type: parsed.type }
  } catch {
    return null
  }
}

export function isWorkspaceDragRow(row: FileRow): boolean {
  return !row.disabled && !isManagedMimPath(row.path)
}

export function isWorkspaceDropDir(row: FileRow): boolean {
  return row.type === 'directory'
    && !row.disabled
    && !row.collection
    && !isManagedMimPath(row.path)
}

export function buildWorkspaceMovePlan(
  source: WorkspaceDragPayload,
  targetDir: string,
): WorkspaceMovePlan {
  const dir = normalizeDir(targetDir)
  if (!source.path || isManagedMimPath(source.path)) {
    return { ok: false, reason: 'Managed Mim folders cannot be moved from Files.' }
  }
  if (isManagedMimPath(dir)) {
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

function isManagedMimPath(path: string): boolean {
  return path === '.mim' || path.startsWith('.mim/')
}
