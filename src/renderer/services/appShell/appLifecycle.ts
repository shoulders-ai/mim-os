import type { LoadedPackage } from './types.js'

export interface AppLifecycleDeps {
  loadSettings(): Promise<unknown> | unknown
  restoreWorkbenchSettings(): Promise<unknown> | unknown
  installArtifactReplacementGuard(): void
  getPort(): Promise<number> | number
  setPort(port: number): void
  getPackages(): Promise<LoadedPackage[]> | LoadedPackage[]
  setPackages(packages: LoadedPackage[]): void
  getWorkspace(): Promise<string | null> | string | null
  setWorkspacePath(path: string | null): void
  addRecentWorkspace(path: string): void
  refreshWorkspaceStatus(): Promise<unknown> | unknown
  refreshPackageRuns(): Promise<unknown> | unknown
  refreshAgentSessions(): Promise<unknown> | unknown
  refreshApps(): Promise<unknown> | unknown
  refreshAgents(): Promise<unknown> | unknown
  refreshAppAgents(): Promise<unknown> | unknown
  restoreInitialWork(): Promise<unknown> | unknown
  loadFileIndex(): Promise<unknown> | unknown
  welcomeDismissed(): boolean
  markWelcomeDismissed(): void
  openWelcome(): void
  resetWorkbenchForWorkspace(): void
}

export function createAppLifecycleActions(deps: AppLifecycleDeps) {
  async function bootstrapAppShell() {
    await deps.loadSettings()
    await deps.restoreWorkbenchSettings()
    deps.installArtifactReplacementGuard()

    deps.setPort(await deps.getPort())
    deps.setPackages(await deps.getPackages())
    const workspace = await deps.getWorkspace()
    deps.setWorkspacePath(workspace)
    if (workspace) {
      deps.addRecentWorkspace(workspace)
      await deps.refreshWorkspaceStatus()
      await deps.refreshPackageRuns()
      await deps.refreshAgentSessions()
      await deps.refreshApps()
      await deps.refreshAgents()
      await deps.refreshAppAgents()
    }
    await deps.restoreInitialWork()

    void deps.loadFileIndex()

    if (!deps.welcomeDismissed()) {
      deps.openWelcome()
      deps.markWelcomeDismissed()
    }
  }

  async function handleWorkspaceChanged(path: unknown) {
    deps.setWorkspacePath(path as string | null)
    if (typeof path === 'string') deps.addRecentWorkspace(path)
    await deps.loadSettings()
    deps.resetWorkbenchForWorkspace()
    await deps.restoreWorkbenchSettings()
    deps.installArtifactReplacementGuard()
    void deps.restoreInitialWork()
    void deps.refreshPackageRuns()
    void deps.refreshAgentSessions()
    void deps.refreshWorkspaceStatus()
    void deps.refreshApps()
    void deps.refreshAgents()
    void deps.refreshAppAgents()
    void deps.loadFileIndex()
  }

  return {
    bootstrapAppShell,
    handleWorkspaceChanged,
  }
}
