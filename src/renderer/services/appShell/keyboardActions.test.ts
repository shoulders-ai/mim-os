import { describe, expect, it, vi } from 'vitest'
import {
  runKeyAction,
  type KeyboardActionDeps,
} from './keyboardActions.js'

function makeDeps(overrides: Partial<KeyboardActionDeps> = {}) {
  const deps: KeyboardActionDeps = {
    openCommandPalette: vi.fn(),
    openDraftChatWork: vi.fn(async () => ({ opened: true })),
    openTerminalWork: vi.fn(async () => ({ opened: true })),
    addTerminalTab: vi.fn(async () => undefined),
    toggleNavigator: vi.fn(),
    navigateWorkHistory: vi.fn(async () => undefined),
    navigateArtifactHistory: vi.fn(async () => undefined),
    cycleSession: vi.fn(),
    nextTick: vi.fn(async () => undefined),
    ...overrides,
  }
  return deps
}

describe('app shell keyboard actions', () => {
  it('opens command palette and draft chat directly', async () => {
    const deps = makeDeps()

    await runKeyAction({ action: 'open-command-palette' }, deps)
    await runKeyAction({ action: 'new-chat' }, deps)

    expect(deps.openCommandPalette).toHaveBeenCalledOnce()
    expect(deps.openDraftChatWork).toHaveBeenCalledOnce()
  })

  it('opens Terminal Work before adding a terminal tab', async () => {
    const deps = makeDeps()

    await runKeyAction({ action: 'new-terminal-tab' }, deps)

    expect(deps.openTerminalWork).toHaveBeenCalledOnce()
    expect(deps.nextTick).toHaveBeenCalledOnce()
    expect(deps.addTerminalTab).toHaveBeenCalledOnce()
  })

  it('does not add a terminal tab when Terminal Work navigation is blocked', async () => {
    const deps = makeDeps({
      openTerminalWork: vi.fn(async () => ({ opened: false, reason: 'needs-confirmation' })),
    })

    await runKeyAction({ action: 'new-terminal-tab' }, deps)

    expect(deps.openTerminalWork).toHaveBeenCalledOnce()
    expect(deps.nextTick).not.toHaveBeenCalled()
    expect(deps.addTerminalTab).not.toHaveBeenCalled()
  })

  it('routes pane history and session cycling actions', async () => {
    const deps = makeDeps()

    await runKeyAction({ action: 'toggle-navigator' }, deps)
    await runKeyAction({ action: 'work-history-back' }, deps)
    await runKeyAction({ action: 'work-history-forward' }, deps)
    await runKeyAction({ action: 'artifact-history-back' }, deps)
    await runKeyAction({ action: 'artifact-history-forward' }, deps)
    await runKeyAction({ action: 'session-next' }, deps)
    await runKeyAction({ action: 'session-prev' }, deps)

    expect(deps.toggleNavigator).toHaveBeenCalledOnce()
    expect(deps.navigateWorkHistory).toHaveBeenNthCalledWith(1, 'back')
    expect(deps.navigateWorkHistory).toHaveBeenNthCalledWith(2, 'forward')
    expect(deps.navigateArtifactHistory).toHaveBeenNthCalledWith(1, 'back')
    expect(deps.navigateArtifactHistory).toHaveBeenNthCalledWith(2, 'forward')
    expect(deps.cycleSession).toHaveBeenNthCalledWith(1, 1)
    expect(deps.cycleSession).toHaveBeenNthCalledWith(2, -1)
  })
})
