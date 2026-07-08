import type { SettingsSection } from '../../components/settings/sections.js'
import type { ShellAction } from './routing.js'

export interface ShellActionDeps {
  openDraftChatWork(options?: { agentId?: string }): Promise<unknown> | unknown
  openRoutinesWork(): Promise<unknown> | unknown
  openFilesWork(): Promise<unknown> | unknown
  openActivityTrustWork(): Promise<unknown> | unknown
  openTerminalWork(): Promise<unknown> | unknown
  openArchiveWork(): Promise<unknown> | unknown
  openPackageViewWork(packageId: string, viewId?: string): Promise<unknown> | unknown
  openSettings(section?: SettingsSection): void
  createUntitledInEditor(): Promise<unknown> | unknown
  openFileViaDialog(): Promise<unknown> | unknown
  openExportDialog(): void
  popOutActiveTab(): Promise<unknown> | unknown
  openShortcuts(): void
  openChatWork(sessionId: string): Promise<unknown> | unknown
  openFileInEditor(path: string): Promise<unknown> | unknown
}

export async function runShellAction(action: ShellAction, deps: ShellActionDeps): Promise<void> {
  switch (action.type) {
    case 'open-draft-chat':
      await deps.openDraftChatWork(action.agentId ? { agentId: action.agentId } : undefined)
      break
    case 'open-routines':
      await deps.openRoutinesWork()
      break
    case 'open-files':
      await deps.openFilesWork()
      break
    case 'open-monitor':
      await deps.openActivityTrustWork()
      break
    case 'open-terminal':
      await deps.openTerminalWork()
      break
    case 'open-archive':
      await deps.openArchiveWork()
      break
    case 'open-package-work':
      await deps.openPackageViewWork(action.packageId, action.viewId)
      break
    case 'open-settings':
      deps.openSettings(action.section)
      break
    case 'new-document':
      await deps.createUntitledInEditor()
      break
    case 'open-file-dialog':
      await deps.openFileViaDialog()
      break
    case 'export-document':
      deps.openExportDialog()
      break
    case 'pop-out-tab':
      await deps.popOutActiveTab()
      break
    case 'open-shortcuts':
      deps.openShortcuts()
      break
    case 'open-session':
      await deps.openChatWork(action.sessionId)
      break
    case 'open-file':
      await deps.openFileInEditor(action.path)
      break
    case 'none':
      break
  }
}
