import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

// The app must always boot into a real, existing workspace. We remember the last
// folder the user opened (app-level, in ~/.mim) and restore it; if it's gone, we
// create and open a default workspace. Without this, a missing default left the
// process with no workspace path and every `session.list` returned zero sessions.

export function lastWorkspaceFile(homeDir: string): string {
  return join(homeDir, '.mim', 'last-workspace')
}

export function recordLastWorkspace(homeDir: string, workspacePath: string): void {
  const file = lastWorkspaceFile(homeDir)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, workspacePath, 'utf-8')
}

export function defaultWorkspacePath(homeDir: string): string {
  return join(homeDir, 'mim-workspace')
}

/**
 * True when `workspacePath` is the app-created default workspace. Used at boot
 * to auto-initialize the workspace contract so the InitWorkspaceBanner never
 * nags about a folder Mim itself created.
 */
export function isDefaultWorkspace(homeDir: string, workspacePath: string): boolean {
  return workspacePath === defaultWorkspacePath(homeDir)
}

export function resolveBootWorkspace(homeDir: string): string {
  const file = lastWorkspaceFile(homeDir)
  if (existsSync(file)) {
    const last = readFileSync(file, 'utf-8').trim()
    if (last && existsSync(last)) return last
  }

  const fallback = defaultWorkspacePath(homeDir)
  mkdirSync(fallback, { recursive: true })
  return fallback
}
