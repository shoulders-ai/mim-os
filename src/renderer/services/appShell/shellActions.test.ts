import { describe, expect, it, vi } from 'vitest'
import {
  runShellAction,
  type ShellActionDeps,
} from './shellActions.js'
import type { ShellAction } from './routing.js'

function makeDeps(overrides: Partial<ShellActionDeps> = {}) {
  const deps: ShellActionDeps = {
    openDraftChatWork: vi.fn(async () => undefined),
    openFilesWork: vi.fn(async () => undefined),
    openActivityTrustWork: vi.fn(async () => undefined),
    openTerminalWork: vi.fn(async () => undefined),
    openArchiveWork: vi.fn(async () => undefined),
    openPackageViewWork: vi.fn(async () => undefined),
    openSettings: vi.fn(),
    createUntitledInEditor: vi.fn(async () => undefined),
    openFileViaDialog: vi.fn(async () => undefined),
    openExportDialog: vi.fn(),
    popOutActiveTab: vi.fn(async () => undefined),
    openShortcuts: vi.fn(),
    openChatWork: vi.fn(async () => undefined),
    openFileInEditor: vi.fn(async () => undefined),
    ...overrides,
  }
  return deps
}

describe('app shell actions', () => {
  it('routes Work surface actions to their launchers', async () => {
    const deps = makeDeps()
    const actions: ShellAction[] = [
      { type: 'open-draft-chat' },
      { type: 'open-files' },
      { type: 'open-monitor' },
      { type: 'open-terminal' },
      { type: 'open-archive' },
      { type: 'open-package-work', packageId: 'pkg', viewId: 'main' },
    ]

    for (const action of actions) {
      await runShellAction(action, deps)
    }

    expect(deps.openDraftChatWork).toHaveBeenCalledOnce()
    expect(deps.openFilesWork).toHaveBeenCalledOnce()
    expect(deps.openActivityTrustWork).toHaveBeenCalledOnce()
    expect(deps.openTerminalWork).toHaveBeenCalledOnce()
    expect(deps.openArchiveWork).toHaveBeenCalledOnce()
    expect(deps.openPackageViewWork).toHaveBeenCalledWith('pkg', 'main')
  })

  it('routes document and settings actions to their shell effects', async () => {
    const deps = makeDeps()

    await runShellAction({ type: 'open-settings', section: 'ai' }, deps)
    await runShellAction({ type: 'new-document' }, deps)
    await runShellAction({ type: 'open-file-dialog' }, deps)
    await runShellAction({ type: 'export-document' }, deps)
    await runShellAction({ type: 'pop-out-tab' }, deps)
    await runShellAction({ type: 'open-shortcuts' }, deps)

    expect(deps.openSettings).toHaveBeenCalledWith('ai')
    expect(deps.createUntitledInEditor).toHaveBeenCalledOnce()
    expect(deps.openFileViaDialog).toHaveBeenCalledOnce()
    expect(deps.openExportDialog).toHaveBeenCalledOnce()
    expect(deps.popOutActiveTab).toHaveBeenCalledOnce()
    expect(deps.openShortcuts).toHaveBeenCalledOnce()
  })

  it('routes concrete session and file actions', async () => {
    const deps = makeDeps()

    await runShellAction({ type: 'open-session', sessionId: 's1' }, deps)
    await runShellAction({ type: 'open-file', path: 'docs/a.md' }, deps)

    expect(deps.openChatWork).toHaveBeenCalledWith('s1')
    expect(deps.openFileInEditor).toHaveBeenCalledWith('docs/a.md')
  })

  it('does nothing for a none action', async () => {
    const deps = makeDeps()

    await runShellAction({ type: 'none' }, deps)

    expect(deps.openDraftChatWork).not.toHaveBeenCalled()
    expect(deps.openSettings).not.toHaveBeenCalled()
  })
})
