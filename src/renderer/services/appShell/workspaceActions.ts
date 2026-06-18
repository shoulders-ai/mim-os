export interface WorkspaceStatus {
  initialized: boolean
  missing: string[]
}

export interface WorkspaceToast {
  kind: 'error' | 'info'
  message: string
  detail?: string
}

export interface WorkspaceActionsDeps {
  workspacePath(): string | null
  setWorkspaceStatus(status: WorkspaceStatus | null): void
  setWorkspaceAuthoritativeName(name: string | null): void
  callKernel(tool: string, params?: unknown): Promise<unknown>
  openWorkspaceDialog(): Promise<string | null | undefined>
  openWorkspacePathInKernel(path: string): Promise<string | null | undefined>
  addRecentWorkspace(path: string): void
  removeRecentWorkspace(path: string): void
  pushToast(toast: WorkspaceToast): void
}

export function workspaceDisplayName(input: {
  authoritativeName: string | null
  path: string | null
}): string | null {
  return input.authoritativeName ?? input.path?.split('/').pop() ?? null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingWorkspacePathError(error: unknown): boolean {
  return errorMessage(error).includes('Path does not exist:')
}

export function createWorkspaceActions(deps: WorkspaceActionsDeps) {
  async function refreshWorkspaceStatus() {
    if (!deps.workspacePath()) {
      deps.setWorkspaceStatus(null)
      deps.setWorkspaceAuthoritativeName(null)
      return
    }
    try {
      deps.setWorkspaceStatus(await deps.callKernel('workspace.status') as WorkspaceStatus)
    } catch {
      deps.setWorkspaceStatus(null)
    }
    try {
      const info = await deps.callKernel('workspace.info') as { name?: unknown }
      deps.setWorkspaceAuthoritativeName(typeof info?.name === 'string' ? info.name : null)
    } catch {
      deps.setWorkspaceAuthoritativeName(null)
    }
  }

  async function initializeWorkspace() {
    try {
      await deps.callKernel('workspace.init', {})
    } catch {
      // Status refresh below reflects the outcome and keeps init best-effort.
    }
    await refreshWorkspaceStatus()
  }

  async function openWorkspace() {
    const path = await deps.openWorkspaceDialog()
    if (path) deps.addRecentWorkspace(path)
  }

  async function openWorkspacePath(path: string) {
    if (!path) return
    try {
      const opened = await deps.openWorkspacePathInKernel(path)
      if (opened) deps.addRecentWorkspace(opened)
    } catch (error) {
      if (isMissingWorkspacePathError(error)) {
        deps.removeRecentWorkspace(path)
        deps.pushToast({
          kind: 'error',
          message: 'Folder not found',
          detail: 'Removed from recent workspaces.',
        })
        return
      }
      deps.pushToast({
        kind: 'error',
        message: 'Workspace open failed',
        detail: errorMessage(error),
      })
    }
  }

  return {
    refreshWorkspaceStatus,
    initializeWorkspace,
    openWorkspace,
    openWorkspacePath,
  }
}
