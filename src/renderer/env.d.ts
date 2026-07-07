/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface Window {
  kernel: {
    call(tool: string, params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
    ptyWrite(id: number, data: string): void
    respondGate(requestId: string, decision: Record<string, unknown>): Promise<boolean>
    cancelGateSession(sessionId: string): Promise<void>
    on(channel: string, cb: (...args: unknown[]) => void): void
    off(channel: string, cb: (...args: unknown[]) => void): void
    getPort(): Promise<number>
    getPackages(): Promise<Array<{
      manifest: {
        id: string
        name: string
        icon?: string
        description?: string
        backend?: string
        permissions?: {
          workspace?: { read?: boolean; write?: boolean }
          ai?: boolean
          http?: string[]
          secrets?: string[]
        }
        views?: Array<{ id: string; label: string; src: string; role: 'work' | 'artifact' | 'either' }>
      }
      dir: string
      source: string
      hasReadme?: boolean
    }>>
    getWorkspace(): Promise<string | null>
    getPackageLaunchUrl(packageId: string, viewId?: string): Promise<string>
    downloadUpdate(): Promise<void>
    quitAndInstall(): Promise<void>
    openWorkspace(): Promise<string | null>
    openWorkspacePath(path: string): Promise<string | null>
    watchWorkspaceFile(path: string): Promise<{ watching: boolean }>
    unwatchWorkspaceFile(path: string): Promise<{ unwatched: boolean }>
    openFileDialog(): Promise<string | null>
    saveFileDialog(options?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }>; allowAbsolutePath?: boolean }): Promise<string | null>
    openNativeFile(path: string): Promise<{ opened: string }>
    setRecentFiles(files: string[]): Promise<{ ok: boolean }>
    pushDirtyTabCount(state: number | { count?: number; paths?: string[] }): Promise<void>
    pushEditorState(state: {
      activeDocument: { path: string | null; name: string; kind: string; dirty: boolean } | null
      openTabs: Array<{ path: string | null; name: string; kind: string; dirty: boolean; active: boolean }>
    }): Promise<void>
    openFolderDialog(): Promise<string | null>
    createDirectory(path: string): Promise<{ created: string }>
    gitClone(url: string, target: string, token?: string): Promise<{ cloned: string }>
    revealInFinder(path: string): Promise<void>
    pickAttachments(options?: { kind?: string }): Promise<{ attachments: Array<{
      filename: string
      mediaType: string
      size: number
      type: 'image' | 'text' | 'file'
      content?: string
      dataUrl?: string
    }> }>
    readAttachments(paths: string[]): Promise<{ attachments: Array<{
      filename: string
      mediaType: string
      size: number
      type: 'image' | 'text' | 'file'
      content?: string
      dataUrl?: string
    }> }>
    getPathForFile(file: File): string

    // Pop-out editor windows
    popoutOpenWithTab(tab: Record<string, unknown>): Promise<{ ok: boolean }>
    popoutReturnTab(tab: Record<string, unknown>): Promise<{ ok: boolean }>
    popoutReady(): Promise<void>
    popoutForward(command: Record<string, unknown>): Promise<{ ok: boolean }>
    popoutSetEdited(state: Record<string, unknown>): Promise<void>
  }
}
