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

const toolchainMock = vi.hoisted(() => ({
  resolveInterpreter: vi.fn(),
}))

vi.mock('@main/toolchain/toolchain.js', () => ({
  resolveInterpreter: toolchainMock.resolveInterpreter,
}))

import { registerPtyTools, spawnPtyProcess, PROGRAM_DEFAULT_ARGS } from '@main/pty.js'

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

    const result = await handlers.get('terminal.spawn')?.({ shell: '/bin/zsh', cwd: '/workspace' })

    expect(ptyMock.spawn).toHaveBeenCalledWith('/bin/zsh', [], expect.objectContaining({
      env: expect.objectContaining({
        ZDOTDIR: join(ptyMock.userDataDir, 'shell', 'zsh'),
        MIM_SHELL_INTEGRATION: 'zsh',
      }),
    }))
    expect(result).toMatchObject({ id: expect.any(Number), shellIntegration: 'zsh' })
  })
})

describe('terminal.spawn program mode', () => {
  const dirs: string[] = []

  function makeRegistry() {
    const handlers = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>()
    registerPtyTools({
      getWorkspacePath: () => '/workspace',
      register: (tool: { name: string, execute: (params: Record<string, unknown>) => Promise<unknown> }) => {
        handlers.set(tool.name, tool.execute)
      },
    } as never)
    return handlers
  }

  beforeEach(() => {
    ptyMock.userDataDir = mkdtempSync(join(tmpdir(), 'mim-pty-program-'))
    dirs.push(ptyMock.userDataDir)
    ptyMock.spawn.mockReset()
    ptyMock.spawn.mockReturnValue({
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    })
    toolchainMock.resolveInterpreter.mockReset()
  })

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  it('spawns program R with --no-save default args from PROGRAM_DEFAULT_ARGS', async () => {
    toolchainMock.resolveInterpreter.mockResolvedValue({
      id: 'r',
      bin: 'R',
      installed: true,
      binPath: '/usr/local/bin/R',
      version: 'R version 4.3.1',
    })

    const handlers = makeRegistry()
    const result = await handlers.get('terminal.spawn')!({ program: 'r', cols: 80, rows: 24 })

    expect(toolchainMock.resolveInterpreter).toHaveBeenCalledWith('r')
    expect(ptyMock.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/R',
      ['--no-save'],
      expect.objectContaining({ cols: 80, rows: 24, cwd: '/workspace' }),
    )
    expect(result).toMatchObject({ id: expect.any(Number), program: 'r' })
  })

  it('appends extra args after default args', async () => {
    toolchainMock.resolveInterpreter.mockResolvedValue({
      id: 'r',
      bin: 'R',
      installed: true,
      binPath: '/usr/local/bin/R',
    })

    const handlers = makeRegistry()
    await handlers.get('terminal.spawn')!({ program: 'r', args: ['--vanilla'] })

    expect(ptyMock.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/R',
      ['--no-save', '--vanilla'],
      expect.anything(),
    )
  })

  it('throws when program is not detected in toolchain', async () => {
    toolchainMock.resolveInterpreter.mockResolvedValue(null)

    const handlers = makeRegistry()
    await expect(handlers.get('terminal.spawn')!({ program: 'julia' }))
      .rejects.toThrow('Program "julia" not detected in toolchain')
  })

  it('spawns quarto without default args (no PROGRAM_DEFAULT_ARGS entry)', async () => {
    toolchainMock.resolveInterpreter.mockResolvedValue({
      id: 'quarto',
      bin: 'quarto',
      installed: true,
      binPath: '/usr/local/bin/quarto',
    })

    const handlers = makeRegistry()
    await handlers.get('terminal.spawn')!({ program: 'quarto' })

    expect(ptyMock.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/quarto',
      [],
      expect.anything(),
    )
  })

  it('does not enable shell integration for program spawns', async () => {
    toolchainMock.resolveInterpreter.mockResolvedValue({
      id: 'r',
      bin: 'R',
      installed: true,
      binPath: '/usr/local/bin/R',
    })

    const handlers = makeRegistry()
    await handlers.get('terminal.spawn')!({ program: 'r' })

    // Shell integration env vars should NOT be present for program spawns
    expect(ptyMock.spawn).toHaveBeenCalledWith(
      '/usr/local/bin/R',
      expect.anything(),
      expect.objectContaining({
        env: expect.not.objectContaining({
          MIM_SHELL_INTEGRATION: expect.any(String),
        }),
      }),
    )
  })
})

describe('PROGRAM_DEFAULT_ARGS', () => {
  it('defines --no-save for R', () => {
    expect(PROGRAM_DEFAULT_ARGS.r).toEqual(['--no-save'])
  })
})
