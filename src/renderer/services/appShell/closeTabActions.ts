export interface CloseTabSession {
  id: string
  archived?: boolean
}

export interface CloseTabActionsDeps {
  editorFocused(): boolean
  activeWorkHost(): string
  closeActiveArtifactTab(): void
  closeTerminalTab(): void
  artifactVisible(): boolean
  activeArtifactHostId(): string
  activeSession(): CloseTabSession | null
  archiveSession(sessionId: string): void
}

export function handleCloseTab(deps: CloseTabActionsDeps): void {
  if (deps.editorFocused()) {
    deps.closeActiveArtifactTab()
    return
  }
  if (deps.activeWorkHost() === 'terminal') {
    deps.closeTerminalTab()
    return
  }
  if (deps.artifactVisible() && deps.activeArtifactHostId() === 'editor') {
    deps.closeActiveArtifactTab()
    return
  }
  const session = deps.activeSession()
  if (session && !session.archived) deps.archiveSession(session.id)
}
