import { describe, expect, it, vi } from 'vitest'
import {
  handleCloseTab,
  type CloseTabActionsDeps,
} from './closeTabActions.js'

function makeDeps(overrides: Partial<CloseTabActionsDeps> = {}) {
  const deps: CloseTabActionsDeps = {
    editorFocused: vi.fn(() => false),
    activeWorkHost: vi.fn(() => 'chat'),
    closeActiveArtifactTab: vi.fn(),
    closeTerminalTab: vi.fn(),
    artifactVisible: vi.fn(() => false),
    activeArtifactHostId: vi.fn(() => ''),
    activeSession: vi.fn(() => ({ id: 's1', archived: false })),
    archiveSession: vi.fn(),
    ...overrides,
  }
  return deps
}

describe('app shell close-tab actions', () => {
  it('closes the focused editor tab first', () => {
    const deps = makeDeps({
      editorFocused: vi.fn(() => true),
      activeWorkHost: vi.fn(() => 'terminal'),
    })

    handleCloseTab(deps)

    expect(deps.closeActiveArtifactTab).toHaveBeenCalledOnce()
    expect(deps.closeTerminalTab).not.toHaveBeenCalled()
    expect(deps.archiveSession).not.toHaveBeenCalled()
  })

  it('closes the active terminal tab when Terminal Work is active', () => {
    const deps = makeDeps({
      activeWorkHost: vi.fn(() => 'terminal'),
    })

    handleCloseTab(deps)

    expect(deps.closeTerminalTab).toHaveBeenCalledOnce()
    expect(deps.closeActiveArtifactTab).not.toHaveBeenCalled()
    expect(deps.archiveSession).not.toHaveBeenCalled()
  })

  it('closes the visible editor Artifact tab before archiving chat', () => {
    const deps = makeDeps({
      artifactVisible: vi.fn(() => true),
      activeArtifactHostId: vi.fn(() => 'editor'),
    })

    handleCloseTab(deps)

    expect(deps.closeActiveArtifactTab).toHaveBeenCalledOnce()
    expect(deps.archiveSession).not.toHaveBeenCalled()
  })

  it('archives the active unarchived session as the fallback', () => {
    const deps = makeDeps()

    handleCloseTab(deps)

    expect(deps.archiveSession).toHaveBeenCalledWith('s1')
  })

  it('does nothing without an active unarchived session', () => {
    const archived = makeDeps({
      activeSession: vi.fn(() => ({ id: 's1', archived: true })),
    })
    const missing = makeDeps({
      activeSession: vi.fn(() => null),
    })

    handleCloseTab(archived)
    handleCloseTab(missing)

    expect(archived.archiveSession).not.toHaveBeenCalled()
    expect(missing.archiveSession).not.toHaveBeenCalled()
  })
})
