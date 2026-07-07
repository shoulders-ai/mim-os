/**
 * Window registry — pure data + helpers for multi-window dirty-state aggregation.
 *
 * Phase 0: tracks per-window dirty counts and paths so the quit guard and
 * comment-tool isDirtyOpenPath callback can aggregate across windows.
 * Phase 1 will extend this with actual BrowserWindow lifecycle management.
 *
 * Electron imports are kept out of this module so all logic is testable
 * without mocks.
 */

export type WindowRole = 'main' | 'popout'

interface WindowEntry {
  role: WindowRole
  dirtyCount: number
  dirtyPaths: Set<string>
}

const windows = new Map<number, WindowEntry>()

// ── Registration ──

export function registerWindow(webContentsId: number, role: WindowRole): void {
  windows.set(webContentsId, { role, dirtyCount: 0, dirtyPaths: new Set() })
}

export function unregisterWindow(webContentsId: number): void {
  windows.delete(webContentsId)
}

// ── Dirty state ──

export function updateWindowDirtyState(
  webContentsId: number,
  count: number,
  paths: string[],
): void {
  const entry = windows.get(webContentsId)
  if (!entry) return
  entry.dirtyCount = count >= 0 ? count : 0
  entry.dirtyPaths = new Set(paths)
}

export function getWindowDirtyState(webContentsId: number): { count: number; paths: Set<string> } | null {
  const entry = windows.get(webContentsId)
  if (!entry) return null
  return { count: entry.dirtyCount, paths: entry.dirtyPaths }
}

// ── Aggregation (used by quit guard + isDirtyOpenPath) ──

export function totalDirtyCount(): number {
  let total = 0
  for (const entry of windows.values()) {
    total += entry.dirtyCount
  }
  return total
}

export function unionDirtyPaths(): Set<string> {
  const union = new Set<string>()
  for (const entry of windows.values()) {
    for (const path of entry.dirtyPaths) {
      union.add(path)
    }
  }
  return union
}

// ── Cascade positioning ──

export function cascadePosition(
  existingBounds: Array<{ x: number; y: number }>,
  fallbackOrigin: { x: number; y: number },
  offset = 28,
): { x: number; y: number } {
  if (existingBounds.length > 0) {
    const last = existingBounds[existingBounds.length - 1]
    return { x: last.x + offset, y: last.y + offset }
  }
  return { x: fallbackOrigin.x + offset, y: fallbackOrigin.y + offset }
}

// ── Close guard ──

export function popoutCloseGuardMessage(dirtyCount: number): { shouldPrompt: boolean; message: string } {
  if (dirtyCount <= 0) return { shouldPrompt: false, message: '' }
  const noun = dirtyCount === 1 ? 'tab' : 'tabs'
  return {
    shouldPrompt: true,
    message: `You have ${dirtyCount} unsaved ${noun}. Close this window anyway?`,
  }
}

// ── Ready resolvers ──

export interface ReadyResolver {
  resolve: (value: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

const readyResolvers = new Map<number, ReadyResolver>()

export function addReadyResolver(webContentsId: number, resolve: (value: boolean) => void, timeoutMs = 10_000): void {
  removeReadyResolver(webContentsId)
  const timer = setTimeout(() => {
    readyResolvers.delete(webContentsId)
    resolve(false)
  }, timeoutMs)
  readyResolvers.set(webContentsId, { resolve, timer })
}

export function resolveReady(webContentsId: number): boolean {
  const entry = readyResolvers.get(webContentsId)
  if (!entry) return false
  clearTimeout(entry.timer)
  readyResolvers.delete(webContentsId)
  entry.resolve(true)
  return true
}

export function removeReadyResolver(webContentsId: number): void {
  const entry = readyResolvers.get(webContentsId)
  if (!entry) return
  clearTimeout(entry.timer)
  readyResolvers.delete(webContentsId)
}

export function resetReadyResolvers(): void {
  for (const entry of readyResolvers.values()) {
    clearTimeout(entry.timer)
  }
  readyResolvers.clear()
}

// ── Menu routing ──

const editorScopedCommands = new Set([
  'menu:new-document',
  'menu:open-file',
  'menu:save-file',
  'menu:save-file-as',
  'menu:export-document',
  'menu:close-tab',
  'menu:open-recent',
])

/**
 * Decide which window should receive a menu command.
 *
 * Editor-scoped commands go to whichever window is focused when that window
 * is a pop-out; app-scoped commands always target the main window.
 */
export function resolveMenuTarget(
  command: string,
  focusedIsPopout: boolean,
): 'focused' | 'main' {
  if (focusedIsPopout && editorScopedCommands.has(command)) return 'focused'
  return 'main'
}

// ── Payload normalization ──

export interface SetEditedPayload {
  title: string
  dirty: boolean
  path: string
}

/**
 * Validate and normalize the `popout:set-edited` payload.
 * Returns null for invalid input.
 */
export function normalizeSetEditedPayload(raw: unknown): SetEditedPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const title = typeof r.title === 'string' ? r.title : ''
  const dirty = Boolean(r.dirty)
  const path = typeof r.path === 'string' ? r.path : ''
  return { title, dirty, path }
}

// ── Testing ──

export function resetRegistry(): void {
  windows.clear()
  resetReadyResolvers()
}
