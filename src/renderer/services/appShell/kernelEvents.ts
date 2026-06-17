import type { LoadedPackage } from './types.js'

export interface KernelEventBus {
  on(channel: string, cb: (...args: unknown[]) => void): void
  off(channel: string, cb: (...args: unknown[]) => void): void
}

export interface AppUpdate {
  id: string
  installed: string
  latest: string
  registryId: string
}

export interface AppKernelEventDeps {
  setPackages(packages: LoadedPackage[]): void
  refreshApps(): Promise<unknown> | unknown
  handleWorkspaceChanged(path: unknown): Promise<unknown> | unknown
  setAppUpdates(updates: Record<string, { installed: string; latest: string; registryId: string }>): void
  refreshKeyStatuses(): Promise<unknown> | unknown
  enqueueApproval(request: unknown): void
  openFileInEditor(path: string): Promise<unknown> | unknown
  routeBridgeChatSend(data: unknown): Promise<unknown> | unknown
  routeBridgeWorkbenchOpenWork(data: unknown): Promise<unknown> | unknown
  routeBridgeWorkbenchOpenArtifact(data: unknown): Promise<unknown> | unknown
  openFileViaDialog(): Promise<unknown> | unknown
  createUntitledInEditor(): Promise<unknown> | unknown
  handleSaveFile(forceDialog: boolean): void
  openExportDialog(): void
  clearRecentFiles(): void
  handleCloseTab(): void
  openSettings(): void
  openShortcuts(): void
  openWelcome(): void
  dispatchTerminalRun(command: string): Promise<unknown> | unknown
  onPackageJobEvent(payload: unknown): void
  onAgentSessionEvent(payload: unknown): void
}

export function registerAppKernelEvents(
  kernel: KernelEventBus,
  deps: AppKernelEventDeps,
): () => void {
  const registrations: Array<[string, (...args: unknown[]) => void]> = [
    ['packages:changed', (pkgs: unknown) => {
      deps.setPackages(pkgs as LoadedPackage[])
      void deps.refreshApps()
    }],
    ['workspace:changed', (path: unknown) => {
      void deps.handleWorkspaceChanged(path)
    }],
    ['apps:changed', () => {
      void deps.refreshApps()
    }],
    ['apps:updates', (payload: unknown) => {
      deps.setAppUpdates(appUpdatesMap(payload))
    }],
    ['ai:keys-changed', () => {
      void deps.refreshKeyStatuses()
    }],
    ['gate:request', (request: unknown) => {
      deps.enqueueApproval(request)
    }],
    ['bridge:editor:open', (data: unknown) => {
      const path = isRecord(data) ? data.path : undefined
      if (typeof path === 'string') void deps.openFileInEditor(path)
    }],
    ['bridge:chat:send', (data: unknown) => {
      void deps.routeBridgeChatSend(data)
    }],
    ['bridge:workbench:open-work', (data: unknown) => {
      void deps.routeBridgeWorkbenchOpenWork(data)
    }],
    ['bridge:workbench:open-artifact', (data: unknown) => {
      void deps.routeBridgeWorkbenchOpenArtifact(data)
    }],
    ['menu:open-file', () => { void deps.openFileViaDialog() }],
    ['menu:new-document', () => { void deps.createUntitledInEditor() }],
    ['menu:save-file', () => { deps.handleSaveFile(false) }],
    ['menu:save-file-as', () => { deps.handleSaveFile(true) }],
    ['menu:export-document', () => { deps.openExportDialog() }],
    ['menu:open-recent', (path: unknown) => {
      if (typeof path === 'string') void deps.openFileInEditor(path)
    }],
    ['menu:clear-recent', () => { deps.clearRecentFiles() }],
    ['menu:close-tab', () => { deps.handleCloseTab() }],
    ['menu:settings', () => { deps.openSettings() }],
    ['menu:shortcuts', () => { deps.openShortcuts() }],
    ['menu:welcome', () => { deps.openWelcome() }],
    ['bridge:terminal:run', (data: unknown) => {
      const command = isRecord(data) ? data.command : undefined
      if (typeof command === 'string') void deps.dispatchTerminalRun(command)
    }],
    ['package:job:event', deps.onPackageJobEvent],
    ['agent:session-event', deps.onAgentSessionEvent],
  ]

  for (const [channel, handler] of registrations) {
    kernel.on(channel, handler)
  }

  return () => {
    for (const [channel, handler] of registrations) {
      kernel.off(channel, handler)
    }
  }
}

function appUpdatesMap(payload: unknown): Record<string, { installed: string; latest: string; registryId: string }> {
  const updates = isRecord(payload) && Array.isArray(payload.updates)
    ? payload.updates
    : []
  const map: Record<string, { installed: string; latest: string; registryId: string }> = {}
  for (const item of updates) {
    if (!isRecord(item)) continue
    const { id, installed, latest, registryId } = item
    if (
      typeof id === 'string'
      && typeof installed === 'string'
      && typeof latest === 'string'
      && typeof registryId === 'string'
    ) {
      map[id] = { installed, latest, registryId }
    }
  }
  return map
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
