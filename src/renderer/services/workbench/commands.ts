import {
  chatWorkEntry,
  editorArtifactEntry,
  fileArtifactEntry,
  terminalWorkEntry,
  type ArtifactEntry,
  type WorkEntry,
} from './entries.js'

export type WorkbenchCommand =
  | { type: 'editor.open'; path: string }
  | { type: 'terminal.run'; command: string; reveal?: boolean }
  | { type: 'chat.send'; sessionId: string; message: string }

export interface WorkbenchCommandDeps {
  openWork(entry: WorkEntry): Promise<unknown> | unknown
  openArtifact(entry: ArtifactEntry): Promise<unknown> | unknown
  runTerminal(command: string): Promise<unknown> | unknown
  sendChat(payload: { sessionId: string; message: string }): Promise<unknown> | unknown
}

export interface UntitledEditorArtifactDeps {
  openArtifact(entry: ArtifactEntry): Promise<unknown> | unknown
  createUntitled(): Promise<unknown> | unknown
}

export async function routeWorkbenchCommand(
  command: WorkbenchCommand,
  deps: WorkbenchCommandDeps,
): Promise<void> {
  if (command.type === 'editor.open') {
    await deps.openArtifact(fileArtifactEntry(command.path))
    return
  }

  if (command.type === 'terminal.run') {
    if (command.reveal === false) {
      await deps.runTerminal(command.command)
      return
    }

    const result = await deps.openWork(terminalWorkEntry())
    if (!navigationDidOpen(result)) return
    await deps.runTerminal(command.command)
    return
  }

  const result = await deps.openWork(chatWorkEntry(command.sessionId))
  if (!navigationDidOpen(result)) return
  await deps.sendChat({ sessionId: command.sessionId, message: command.message })
}

export async function openUntitledEditorArtifact(
  deps: UntitledEditorArtifactDeps,
): Promise<unknown> {
  const result = await deps.openArtifact(editorArtifactEntry())
  if (!navigationDidOpen(result)) return result
  await deps.createUntitled()
  return result
}

export function navigationDidOpen(result: unknown): boolean {
  return !(isRecord(result) && result.opened === false)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
