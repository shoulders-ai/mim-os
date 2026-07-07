export interface CloseTabSession {
  id: string
  archived?: boolean
}

export interface CloseTabActionsDeps {
  /**
   * Focus anywhere in the Artifact pane — not just CodeMirror. PDF, table,
   * image, and file-card tabs must close via Cmd+W the same as text tabs.
   */
  editorPaneFocused(): boolean
  activeWorkHost(): string
  closeActiveArtifactTab(): void
  closeTerminalTab(): void
  artifactVisible(): boolean
  activeArtifactHostId(): string
  activeSession(): CloseTabSession | null
  archiveSession(sessionId: string): void
  activeAgentSessionId(): string | null
  archiveAgentSession(sessionId: string): void
  activePackageRun(): { packageId: string; runId: string } | null
  archivePackageRun(packageId: string, runId: string): void
}

export function handleCloseTab(deps: CloseTabActionsDeps): void {
  if (deps.editorPaneFocused()) {
    deps.closeActiveArtifactTab()
    return
  }
  if (deps.activeWorkHost() === 'terminal') {
    deps.closeTerminalTab()
    return
  }

  const host = deps.activeWorkHost()

  if (host === 'chat') {
    const session = deps.activeSession()
    if (session && !session.archived) deps.archiveSession(session.id)
    return
  }
  if (host === 'agent-session') {
    const sessionId = deps.activeAgentSessionId()
    if (sessionId) deps.archiveAgentSession(sessionId)
    return
  }
  if (host === 'package-run') {
    const run = deps.activePackageRun()
    if (run) deps.archivePackageRun(run.packageId, run.runId)
    return
  }

  if (deps.artifactVisible() && deps.activeArtifactHostId() === 'editor') {
    deps.closeActiveArtifactTab()
    return
  }

  const session = deps.activeSession()
  if (session && !session.archived) deps.archiveSession(session.id)
}
