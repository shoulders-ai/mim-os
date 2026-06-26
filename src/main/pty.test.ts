import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ptyMock = vi.hoisted(() => {
  const state = {
    userDataDir: '',
    spawn: vi.fn(),
    getPath: vi.fn((name: string) => {
      if (name !== 'userData') throw new Error(`Unexpected app path: ${name}`)
      return state.userDataDir
    }),
  }

  return state
})

vi.mock('node-pty', () => ({
  spawn: ptyMock.spawn,
}))

vi.mock('electron', () => ({
  app: {
    getPath: ptyMock.getPath,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}))

import { registerPtyTools, spawnPtyProcess } from '@main/pty.js'

describe('pty shell integration wiring', () => {
  const dirs: string[] = []

  beforeEach(() => {
    ptyMock.userDataDir = mkdtempSync(join(tmpdir(), 'mim-pty-userdata-'))
    dirs.push(ptyMock.userDataDir)
    ptyMock.spawn.mockReset()
    ptyMock.getPath.mockClear()
    ptyMock.spawn.mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    })
  })

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('keeps generic pty spawns free of scratch-shell zsh integration by default', () => {
    spawnPtyProcess({ file: '/bin/zsh', args: [], cwd: '/tmp' })

    expect(ptyMock.getPath).not.toHaveBeenCalled()
    expect(ptyMock.spawn).toHaveBeenCalledWith('/bin/zsh', [], expect.objectContaining({
      env: expect.not.objectContaining({
        MIM_ZSH_INTEGRATION_DIR: expect.any(String),
        MIM_SHELL_INTEGRATION: 'zsh',
      }),
    }))
  })

  it('enables zsh integration for terminal.spawn scratch terminals', async () => {
    const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>()
    registerPtyTools({
      getWorkspacePath: () => '/workspace',
      register: (tool: { name: string, execute: (params: Record<string, unknown>) => Promise<unknown> }) => {
        handlers.set(tool.name, tool.execute)
      },
    } as never)

    await handlers.get('terminal.spawn')?.({ shell: '/bin/zsh', cwd: '/workspace' })

    expect(ptyMock.spawn).toHaveBeenCalledWith('/bin/zsh', [], expect.objectContaining({
      env: expect.objectContaining({
        ZDOTDIR: join(ptyMock.userDataDir, 'shell', 'zsh'),
        MIM_SHELL_INTEGRATION: 'zsh',
      }),
    }))
  })
})
