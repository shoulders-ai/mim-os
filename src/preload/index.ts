import { contextBridge, ipcRenderer, webUtils } from 'electron'

const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

contextBridge.exposeInMainWorld('kernel', {
  // Tool registry — same surface as SDK, but via IPC
  call: (
    tool: string,
    params: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
  ) => ipcRenderer.invoke('kernel:call', tool, params, options),
  respondGate: (requestId: string, decision: Record<string, unknown>) =>
    ipcRenderer.invoke('gate:respond', requestId, decision),
  cancelGateSession: (sessionId: string) =>
    ipcRenderer.invoke('gate:cancel-session', sessionId),

  // Fast-path pty input — bypasses the tool registry so keystrokes don't
  // generate trace entries or gate evaluations.
  ptyWrite: (id: number, data: string) => ipcRenderer.send('pty:input', id, data),

  // Events
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    if (!listeners.has(channel)) {
      listeners.set(channel, new Set())
      ipcRenderer.on(channel, (_event, ...args) => {
        for (const fn of listeners.get(channel)!) fn(...args)
      })
    }
    listeners.get(channel)!.add(cb)
  },
  off: (channel: string, cb: (...args: unknown[]) => void) => {
    listeners.get(channel)?.delete(cb)
  },

  // Shell-specific
  getPort: () => ipcRenderer.invoke('kernel:port'),
  getPackages: () => ipcRenderer.invoke('kernel:packages'),
  getWorkspace: () => ipcRenderer.invoke('kernel:workspace'),
  getPackageLaunchUrl: (packageId: string, viewId?: string) =>
    ipcRenderer.invoke('kernel:package-launch-url', packageId, viewId),
  downloadUpdate: () => ipcRenderer.invoke('kernel:download-update'),
  quitAndInstall: () => ipcRenderer.invoke('kernel:quit-and-install'),
  openWorkspace: () => ipcRenderer.invoke('kernel:open-workspace'),
  openWorkspacePath: (path: string) => ipcRenderer.invoke('kernel:open-workspace-path', path),
  watchWorkspaceFile: (path: string) => ipcRenderer.invoke('kernel:watch-workspace-file', path),
  unwatchWorkspaceFile: (path: string) => ipcRenderer.invoke('kernel:unwatch-workspace-file', path),

  // Editor file open + recent files (native menu integration)
  openFileDialog: () => ipcRenderer.invoke('kernel:open-file-dialog'),
  saveFileDialog: (options: { defaultPath?: string } = {}) =>
    ipcRenderer.invoke('kernel:save-file-dialog', options),
  openNativeFile: (path: string) => ipcRenderer.invoke('kernel:open-native-file', path),
  setRecentFiles: (files: string[]) => ipcRenderer.invoke('kernel:set-recent-files', files),

  // Add-project workflow
  openFolderDialog: () => ipcRenderer.invoke('kernel:open-folder-dialog'),
  createDirectory: (path: string) => ipcRenderer.invoke('kernel:create-directory', path),
  gitClone: (url: string, target: string, token?: string) =>
    ipcRenderer.invoke('kernel:git-clone', url, target, token),
  revealInFinder: (path: string) => ipcRenderer.invoke('kernel:reveal-in-finder', path),

  // Editor dirty-state push — lets main show a quit guard when tabs are unsaved.
  pushDirtyTabCount: (state: number | { count?: number; paths?: string[] }) =>
    ipcRenderer.invoke('editor:dirty-state', state),

  // Local attachments. File bytes are read in main; renderer only passes
  // user-selected paths from dialogs or drag/drop.
  pickAttachments: (options: { kind?: string } = {}) =>
    ipcRenderer.invoke('kernel:pick-attachments', options),
  readAttachments: (paths: string[]) =>
    ipcRenderer.invoke('kernel:read-attachments', paths),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
