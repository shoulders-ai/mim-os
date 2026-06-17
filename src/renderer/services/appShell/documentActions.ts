import {
  editorArtifactEntry,
  type ArtifactEntry,
} from '../workbench/entries.js'
import {
  navigationDidOpen,
  openUntitledEditorArtifact,
} from '../workbench/commands.js'
import { isAbsoluteFilePath, resolveSniffTarget } from '../fileOpenPolicy.js'

export interface DocumentArtifactHost {
  openDocument?: (path: string, kind: 'text' | 'pdf' | 'card' | 'table') => Promise<void> | void
  openHistoryForPath?: (path: string) => void
  newUntitledTab?: () => void
  saveActiveFile?: () => Promise<boolean> | boolean
  saveActiveFileAs?: () => Promise<boolean> | boolean
}

export interface DocumentActionsDeps {
  activeArtifactHostId(): string
  rightVisible(): boolean
  artifactHost(): DocumentArtifactHost | null
  openEditorFileArtifact(path: string): Promise<unknown> | unknown
  openArtifactEntry(entry: ArtifactEntry, options?: { replace?: boolean }): Promise<unknown> | unknown
  setArtifactVisible(visible: boolean): void
  railArtifactPane(): void
  readFileHead(path: string): Promise<string>
  openNativeFile(path: string): Promise<unknown>
  openFileDialog(): Promise<string | null>
  addRecentFile(path: string): void
  setArtifactNavigationError(error: unknown): void
  nextTick(): Promise<void>
  trackTelemetry(event: string, props?: Record<string, unknown>): void
}

export function createDocumentActions(deps: DocumentActionsDeps) {
  async function openFileInEditor(path: string) {
    if (!path) return
    if (isAbsoluteFilePath(path)) {
      await openFileInNativeApp(path)
      return
    }

    const target = await resolveSniffTarget(path, deps.readFileHead)
    if (target === 'editor') {
      await deps.openEditorFileArtifact(path)
      return
    }

    if (target === 'pdf') {
      if (await ensureDocumentHostVisible()) {
        await deps.artifactHost()?.openDocument?.(path, 'pdf')
      }
      return
    }

    if (target === 'table') {
      if (await ensureDocumentHostVisible()) {
        await deps.artifactHost()?.openDocument?.(path, 'table')
      }
      return
    }

    if (await ensureDocumentHostVisible()) {
      await deps.artifactHost()?.openDocument?.(path, 'card')
    }
  }

  async function openFileHistory(path: string) {
    await openFileInEditor(path)
    await deps.nextTick()
    deps.artifactHost()?.openHistoryForPath?.(path)
  }

  async function ensureDocumentHostVisible(): Promise<boolean> {
    if (deps.activeArtifactHostId() !== 'editor') {
      const result = await deps.openArtifactEntry(editorArtifactEntry(), { replace: true })
      if (!navigationDidOpen(result)) return false
    }
    deps.setArtifactVisible(true)
    await deps.nextTick()
    return true
  }

  async function openFileInNativeApp(path: string) {
    try {
      await deps.openNativeFile(path)
      deps.addRecentFile(path)
      deps.trackTelemetry('file_open', { ext: fileExtensionForTelemetry(path), surface: 'native' })
    } catch (err) {
      deps.setArtifactNavigationError(err)
      console.error('[files] open native', err)
    }
  }

  async function openFileViaDialog() {
    const path = await deps.openFileDialog()
    if (path) await openFileInEditor(path)
  }

  async function createUntitledInEditor() {
    await openUntitledEditorArtifact({
      openArtifact: deps.openArtifactEntry,
      createUntitled: async () => {
        await deps.nextTick()
        deps.artifactHost()?.newUntitledTab?.()
      },
    })
  }

  function handleAllDocumentTabsClosed() {
    deps.railArtifactPane()
  }

  function handleSaveFile(forceDialog = false) {
    if (!deps.rightVisible() || deps.activeArtifactHostId() !== 'editor') return
    if (forceDialog) void deps.artifactHost()?.saveActiveFileAs?.()
    else void deps.artifactHost()?.saveActiveFile?.()
  }

  return {
    openFileInEditor,
    openFileHistory,
    ensureDocumentHostVisible,
    openFileInNativeApp,
    openFileViaDialog,
    createUntitledInEditor,
    handleAllDocumentTabsClosed,
    handleSaveFile,
  }
}

export function fileExtensionForTelemetry(path: string): string {
  const name = path.split(/[\\/]/).pop() || path
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : 'none'
}
