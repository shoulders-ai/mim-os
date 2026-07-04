import { describe, expect, it, vi } from 'vitest'
import {
  navigationDidOpen,
  openUntitledEditorArtifact,
  routeWorkbenchCommand,
} from './commands.js'

describe('workbench command router', () => {
  it('routes editor.open through the explicit Artifact command path', async () => {
    const deps = {
      openWork: vi.fn(),
      openArtifact: vi.fn(async () => ({ opened: true as const })),
      sendChat: vi.fn(),
      runTerminal: vi.fn(),
    }

    await routeWorkbenchCommand({ type: 'editor.open', path: 'docs/a.md' }, deps)

    expect(deps.openArtifact).toHaveBeenCalledWith({
      id: 'file:docs/a.md',
      kind: 'file',
      title: 'a.md',
      path: 'docs/a.md',
    })
    expect(deps.openWork).not.toHaveBeenCalled()
  })

  it('routes terminal.run through Work before writing the command', async () => {
    const deps = {
      openWork: vi.fn(async () => ({ opened: true as const })),
      openArtifact: vi.fn(),
      sendChat: vi.fn(),
      runTerminal: vi.fn(),
    }

    await routeWorkbenchCommand({ type: 'terminal.run', command: 'npm test' }, deps)

    expect(deps.openWork).toHaveBeenCalledWith({
      id: 'work:terminal',
      kind: 'terminal',
      title: 'Terminal',
    })
    expect(deps.runTerminal).toHaveBeenCalledWith('npm test')
    expect(deps.openArtifact).not.toHaveBeenCalled()
  })

  it('does not run a terminal command when Work navigation is blocked', async () => {
    const deps = {
      openWork: vi.fn(async () => ({ opened: false as const, reason: 'needs-confirmation' as const })),
      openArtifact: vi.fn(),
      sendChat: vi.fn(),
      runTerminal: vi.fn(),
    }

    await routeWorkbenchCommand({ type: 'terminal.run', command: 'npm test' }, deps)

    expect(deps.openWork).toHaveBeenCalledWith({
      id: 'work:terminal',
      kind: 'terminal',
      title: 'Terminal',
    })
    expect(deps.runTerminal).not.toHaveBeenCalled()
  })

  it('runs terminal commands without Work navigation when reveal is false', async () => {
    const deps = {
      openWork: vi.fn(),
      openArtifact: vi.fn(),
      sendChat: vi.fn(),
      runTerminal: vi.fn(),
    }

    await routeWorkbenchCommand({ type: 'terminal.run', command: 'npm test', reveal: false }, deps)

    expect(deps.openWork).not.toHaveBeenCalled()
    expect(deps.runTerminal).toHaveBeenCalledWith('npm test')
    expect(deps.openArtifact).not.toHaveBeenCalled()
  })

  it('routes chat.send through Work before sending the message', async () => {
    const deps = {
      openWork: vi.fn(async () => ({ opened: true as const })),
      openArtifact: vi.fn(),
      sendChat: vi.fn(),
      runTerminal: vi.fn(),
    }

    await routeWorkbenchCommand({ type: 'chat.send', sessionId: 's1', message: 'hello' }, deps)

    expect(deps.openWork).toHaveBeenCalledWith({
      id: 'work:chat:s1',
      kind: 'chat',
      title: 'Chat',
      sessionId: 's1',
    })
    expect(deps.sendChat).toHaveBeenCalledWith({ sessionId: 's1', message: 'hello' })
    expect(deps.openArtifact).not.toHaveBeenCalled()
  })

  it('does not send chat messages when Work navigation is blocked', async () => {
    const deps = {
      openWork: vi.fn(async () => ({ opened: false as const, reason: 'blocked' as const })),
      openArtifact: vi.fn(),
      sendChat: vi.fn(),
      runTerminal: vi.fn(),
    }

    await routeWorkbenchCommand({ type: 'chat.send', sessionId: 's1', message: 'hello' }, deps)

    expect(deps.openWork).toHaveBeenCalledWith({
      id: 'work:chat:s1',
      kind: 'chat',
      title: 'Chat',
      sessionId: 's1',
    })
    expect(deps.sendChat).not.toHaveBeenCalled()
  })

  it('opens the editor Artifact before creating an untitled editor tab', async () => {
    const deps = {
      openArtifact: vi.fn(async () => ({ opened: true as const })),
      createUntitled: vi.fn(),
    }

    await openUntitledEditorArtifact(deps)

    expect(deps.openArtifact).toHaveBeenCalledWith({
      id: 'artifact:editor',
      kind: 'editor',
      title: 'Editor',
    })
    expect(deps.createUntitled).toHaveBeenCalledOnce()
  })

  it('does not create an untitled editor tab when Artifact navigation is blocked', async () => {
    const deps = {
      openArtifact: vi.fn(async () => ({ opened: false as const, reason: 'needs-confirmation' as const })),
      createUntitled: vi.fn(),
    }

    const result = await openUntitledEditorArtifact(deps)

    expect(result).toEqual({ opened: false, reason: 'needs-confirmation' })
    expect(deps.createUntitled).not.toHaveBeenCalled()
  })

  it('opens terminal with preserveArtifact so the editor keeps focus', async () => {
    const deps = {
      openWork: vi.fn(async () => ({ opened: true as const })),
      openArtifact: vi.fn(),
      sendChat: vi.fn(),
      runTerminal: vi.fn(),
      sendTerminal: vi.fn(),
    }

    await routeWorkbenchCommand({ type: 'terminal.send', text: 'x <- 1', language: 'r' }, deps)

    expect(deps.openWork).toHaveBeenCalledWith(
      { id: 'work:terminal', kind: 'terminal', title: 'Terminal' },
      { preserveArtifact: true },
    )
    expect(deps.sendTerminal).toHaveBeenCalledWith('x <- 1', { spawn: { program: 'r' } })
  })

  it('routes terminal.send without spawn opts for non-R languages', async () => {
    const deps = {
      openWork: vi.fn(async () => ({ opened: true as const })),
      openArtifact: vi.fn(),
      sendChat: vi.fn(),
      runTerminal: vi.fn(),
      sendTerminal: vi.fn(),
    }

    await routeWorkbenchCommand({ type: 'terminal.send', text: 'print(1)', language: 'python' }, deps)

    expect(deps.openWork).toHaveBeenCalledWith(
      { id: 'work:terminal', kind: 'terminal', title: 'Terminal' },
      { preserveArtifact: true },
    )
    expect(deps.sendTerminal).toHaveBeenCalledWith('print(1)', undefined)
  })

  it('treats non-navigation command results as open for compatibility', () => {
    expect(navigationDidOpen(undefined)).toBe(true)
    expect(navigationDidOpen({ opened: true })).toBe(true)
    expect(navigationDidOpen({ opened: false, reason: 'blocked' })).toBe(false)
  })
})
