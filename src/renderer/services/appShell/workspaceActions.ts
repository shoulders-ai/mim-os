export interface WorkspaceStatus {
  initialized: boolean
  missing: string[]
}

export interface WorkspaceActionsDeps {
  workspacePath(): string | null
  setWorkspaceStatus(status: WorkspaceStatus | null): void
  setWorkspaceAuthoritativeName(name: string | null): void
  callKernel(tool: string, params?: unknown): Promise<unknown>
  openWorkspaceDialog(): Promise<string | null | undefined>
  openWorkspacePathInKernel(path: string): Promise<string | null | undefined>
  addRecentWorkspace(path: string): void
}

export function workspaceDisplayName(input: {
  authoritativeName: string | null
  path: string | null
}): string | null {
  return input.authoritativeName ?? input.path?.split('/').pop() ?? null
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
    const opened = await deps.openWorkspacePathInKernel(path)
    if (opened) deps.addRecentWorkspace(opened)
  }

  return {
    refreshWorkspaceStatus,
    initializeWorkspace,
    openWorkspace,
    openWorkspacePath,
  }
}
