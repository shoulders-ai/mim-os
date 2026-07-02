import { isAbsolute, relative, resolve } from 'path'
import { watch as chokidarWatch } from 'chokidar'

export type WorkspaceFileChangeKind = 'add' | 'change' | 'unlink'

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

interface WatchedFile {
  count: number
  watcher: WatcherHandle
}

export function createWorkspaceFileWatcher(options: {
  emit: (channel: 'workspace:files-changed', payload: WorkspaceFilesChangedPayload) => void
  watch?: WatchFn
  debounceMs?: number
}) {
  const watch = options.watch ?? (chokidarWatch as unknown as WatchFn)
  const debounceMs = options.debounceMs ?? 100
  let workspace: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, WorkspaceFileChangeKind>()
  const watched = new Map<string, WatchedFile>()

  async function setWorkspace(nextWorkspace: string | null): Promise<void> {
    clearPending()
    await closeAllWatchers()
    workspace = nextWorkspace ? resolve(nextWorkspace) : null
  }

  function watchFile(path: string): boolean {
    const relPath = normalizeRequestedPath(path)
    if (!workspace || !relPath) return false
    const existing = watched.get(relPath)
    if (existing) {
      existing.count++
      return true
    }

    const absPath = resolve(workspace, relPath)
    const watcher = watch(absPath, { ignoreInitial: true })
    watcher.on('all', (event, changedPath) => {
      const change = normalizeChange(workspace, event, changedPath)
      if (!change || change.path !== relPath) return
      pending.set(change.path, coalesceKind(pending.get(change.path), change.kind))
      scheduleFlush()
    })
    watched.set(relPath, { count: 1, watcher })
    return true
  }

  async function unwatchFile(path: string): Promise<boolean> {
    const relPath = normalizeRequestedPath(path)
    if (!relPath) return false
    const existing = watched.get(relPath)
    if (!existing) return false
    existing.count--
    if (existing.count > 0) return true
    watched.delete(relPath)
    await existing.watcher.close()
    return true
  }

  async function close(): Promise<void> {
    clearPending()
    await closeAllWatchers()
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

  async function closeAllWatchers(): Promise<void> {
    const current = [...watched.values()]
    watched.clear()
    await Promise.all(current.map(item => item.watcher.close()))
  }

  function normalizeRequestedPath(path: string): string | null {
    if (!workspace || typeof path !== 'string' || path.length === 0) return null
    const resolvedPath = resolve(workspace, path)
    const rel = relative(workspace, resolvedPath)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
    const normalized = toSlashPath(rel)
    if (normalized.split('/').some(segment => IGNORED_SEGMENTS.has(segment))) return null
    return normalized
  }

  return { setWorkspace, watchFile, unwatchFile, close }
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
  return event === 'add' || event === 'change' || event === 'unlink'
}

function coalesceKind(
  existing: WorkspaceFileChangeKind | undefined,
  next: WorkspaceFileChangeKind,
): WorkspaceFileChangeKind {
  if (!existing) return next
  if (existing === 'add' && next === 'change') return existing
  if (existing === 'unlink' && next === 'add') return 'change'
  return next
}

function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}
