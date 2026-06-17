import { existsSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'
import { watch as chokidarWatch } from 'chokidar'

export type WorkspaceFileChangeKind = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'

export interface WorkspaceFileChange {
  path: string
  kind: WorkspaceFileChangeKind
}

export interface WorkspaceFilesChangedPayload {
  paths: string[]
  changes: WorkspaceFileChange[]
}

interface WatcherHandle {
  on(event: 'all', cb: (event: string, path: string) => void): unknown
  close(): Promise<unknown> | unknown
}

type WatchFn = (
  path: string,
  options: {
    ignoreInitial: boolean
    ignored: (path: string) => boolean
  },
) => WatcherHandle

const IGNORED_SEGMENTS = new Set([
  '.git',
  '.mim',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  '.next',
  '.nuxt',
  '__pycache__',
  '.DS_Store',
  'target',
  '.venv',
  'venv',
  '.env',
])

export function createWorkspaceFileWatcher(options: {
  emit: (channel: 'workspace:files-changed', payload: WorkspaceFilesChangedPayload) => void
  watch?: WatchFn
  debounceMs?: number
}) {
  const watch = options.watch ?? (chokidarWatch as unknown as WatchFn)
  const debounceMs = options.debounceMs ?? 100
  let workspace: string | null = null
  let watcher: WatcherHandle | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, WorkspaceFileChangeKind>()

  async function setWorkspace(nextWorkspace: string | null): Promise<void> {
    clearPending()
    await closeWatcher()
    workspace = nextWorkspace ? resolve(nextWorkspace) : null
    if (!workspace || !existsSync(workspace)) return

    watcher = watch(workspace, {
      ignoreInitial: true,
      ignored: (path) => isIgnoredWorkspacePath(workspace!, path),
    })
    watcher.on('all', (event, path) => {
      const change = normalizeChange(workspace, event, path)
      if (!change) return
      pending.set(change.path, coalesceKind(pending.get(change.path), change.kind))
      scheduleFlush()
    })
  }

  async function close(): Promise<void> {
    clearPending()
    await closeWatcher()
    workspace = null
  }

  function scheduleFlush(): void {
    if (timer != null) return
    timer = setTimeout(flush, debounceMs)
  }

  function flush(): void {
    timer = null
    const changes = Array.from(pending.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, kind]) => ({ path, kind }))
    pending.clear()
    if (changes.length === 0) return
    options.emit('workspace:files-changed', {
      paths: changes.map(change => change.path),
      changes,
    })
  }

  function clearPending(): void {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
    pending.clear()
  }

  async function closeWatcher(): Promise<void> {
    const current = watcher
    watcher = null
    if (current) await current.close()
  }

  return { setWorkspace, close }
}

export function isIgnoredWorkspacePath(workspace: string, path: string): boolean {
  const resolvedWorkspace = resolve(workspace)
  const resolvedPath = resolve(path)
  const rel = relative(resolvedWorkspace, resolvedPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false
  return toSlashPath(rel).split('/').some(segment => IGNORED_SEGMENTS.has(segment))
}

function normalizeChange(
  workspace: string | null,
  event: string,
  path: string,
): WorkspaceFileChange | null {
  if (!workspace || !isWorkspaceFileChangeKind(event)) return null
  const resolvedPath = resolve(path)
  const rel = relative(workspace, resolvedPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  const normalized = toSlashPath(rel)
  if (normalized.split('/').some(segment => IGNORED_SEGMENTS.has(segment))) return null
  return { path: normalized, kind: event }
}

function isWorkspaceFileChangeKind(event: string): event is WorkspaceFileChangeKind {
  return event === 'add'
    || event === 'addDir'
    || event === 'change'
    || event === 'unlink'
    || event === 'unlinkDir'
}

function coalesceKind(
  existing: WorkspaceFileChangeKind | undefined,
  next: WorkspaceFileChangeKind,
): WorkspaceFileChangeKind {
  if (!existing) return next
  if (existing === 'add' && next === 'change') return existing
  if (existing === 'addDir' && next === 'change') return existing
  if (existing === 'unlink' && next === 'add') return 'change'
  if (existing === 'unlinkDir' && next === 'addDir') return 'change'
  return next
}

function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}
