import type { KeyAction } from '../workbench/keyRouter.js'
import { navigationDidOpen } from '../workbench/commands.js'

export interface KeyboardActionDeps {
  openCommandPalette(): void
  openDraftChatWork(): Promise<unknown> | unknown
  openTerminalWork(): Promise<unknown> | unknown
  addTerminalTab(): Promise<unknown> | unknown
  toggleNavigator(): void
  navigateWorkHistory(direction: 'back' | 'forward'): Promise<unknown> | unknown
  navigateArtifactHistory(direction: 'back' | 'forward'): Promise<unknown> | unknown
  cycleSession(direction: 1 | -1): void
  cycleActivity(direction: 1 | -1): void
  cycleEditorTab(direction: 1 | -1): void
  nextTick(): Promise<void>
}

export async function runKeyAction(action: Exclude<KeyAction, null>, deps: KeyboardActionDeps): Promise<void> {
  switch (action.action) {
    case 'open-command-palette':
      deps.openCommandPalette()
      break
    case 'new-chat':
      await deps.openDraftChatWork()
      break
    case 'new-terminal-tab': {
      const nav = await deps.openTerminalWork()
      if (!navigationDidOpen(nav)) return
      await deps.nextTick()
      await deps.addTerminalTab()
      break
    }
    case 'toggle-navigator':
      deps.toggleNavigator()
      break
    case 'work-history-back':
      await deps.navigateWorkHistory('back')
      break
    case 'work-history-forward':
      await deps.navigateWorkHistory('forward')
      break
    case 'artifact-history-back':
      await deps.navigateArtifactHistory('back')
      break
    case 'artifact-history-forward':
      await deps.navigateArtifactHistory('forward')
      break
    case 'session-next':
      deps.cycleSession(1)
      break
    case 'session-prev':
      deps.cycleSession(-1)
      break
    case 'activity-next':
      deps.cycleActivity(1)
      break
    case 'activity-prev':
      deps.cycleActivity(-1)
      break
    case 'editor-tab-next':
      deps.cycleEditorTab(1)
      break
    case 'editor-tab-prev':
      deps.cycleEditorTab(-1)
      break
  }
}
