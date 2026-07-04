import * as nodePty from 'node-pty'
import { app, BrowserWindow } from 'electron'
import type { ToolRegistry } from '@main/tools/registry.js'
import { defaultShell, userHomeDir } from '@main/platform.js'
import { normalizePtySpawnCommand } from '@main/ptyCommand.js'
import { preparePtyShellIntegration } from '@main/ptyShellIntegration.js'
import { resolveInterpreter } from '@main/toolchain/toolchain.js'

/**
 * Default args appended main-side when spawning a program pty by catalog id.
 * These live on the main side so the renderer never needs to know interpreter
 * CLI conventions.
 */
export const PROGRAM_DEFAULT_ARGS: Record<string, string[]> = {
  r: ['--no-save'],
}

// Shared pty spawn helper. Scratch terminals (terminal.spawn) and agent
// sessions (agents/agentSessions.ts) both go through spawnPtyProcess, so every
// pty lives in the same instances map and forwards on the same
// `pty:output:<id>` / `pty:exit:<id>` channels — terminal.write/resize/kill
// and the renderer's xterm attachment work uniformly on both kinds.

export interface PtySpawnOptions {
  file: string
  args: string[]
  cwd: string
  env?: Record<string, string>
  cols?: number
  rows?: number
  // Observers for callers that track the process beyond IPC forwarding
  // (agent sessions append scrollback and classify exits).
  onData?: (data: string) => void
  onExit?: (exitCode: number) => void
  shellIntegration?: boolean
}

export interface PtyHandle {
  ptyId: number
  shellIntegration?: 'zsh'
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

let nextId = 1
const instances = new Map<number, nodePty.IPty>()

export function writePty(id: number, data: string): void {
  const pty = instances.get(id)
  if (pty) pty.write(data)
}

export function spawnPtyProcess(options: PtySpawnOptions): PtyHandle {
  const id = nextId++
  const command = normalizePtySpawnCommand(options.file, options.args)
  const prepared = preparePtyShellIntegration({
    enabled: options.shellIntegration === true,
    file: command.file,
    args: command.args,
    env: { ...process.env, TERM: 'xterm-256color', ...options.env },
    userDataDir: options.shellIntegration === true ? app.getPath('userData') : '',
  })
  const pty = nodePty.spawn(prepared.file, prepared.args, {
    name: 'xterm-256color',
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
    cwd: options.cwd,
    env: prepared.env,
  })

  instances.set(id, pty)

  pty.onData((data: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(`pty:output:${id}`, data)
    }
    options.onData?.(data)
  })

  pty.onExit(({ exitCode }: { exitCode: number }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(`pty:exit:${id}`, exitCode)
    }
    instances.delete(id)
    options.onExit?.(exitCode)
  })

  return {
    ptyId: id,
    shellIntegration: prepared.shellIntegration,
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: () => pty.kill(),
  }
}

export function registerPtyTools(tools: ToolRegistry): void {

  tools.register({
    name: 'terminal.spawn',
    description: 'Spawn a new terminal process',
    execute: async (params) => {
      const program = params.program as string | undefined
      const extraArgs = (params.args as string[] | undefined) ?? []
      const cwd = params.cwd as string || tools.getWorkspacePath() || userHomeDir()
      const cols = (params.cols as number) || 80
      const rows = (params.rows as number) || 24

      if (program) {
        // Program mode: resolve via toolchain catalog
        const entry = await resolveInterpreter(program)
        if (!entry || !entry.binPath) {
          throw new Error(`Program "${program}" not detected in toolchain`)
        }
        const defaultArgs = PROGRAM_DEFAULT_ARGS[entry.id] ?? []
        const args = [...defaultArgs, ...extraArgs]
        const handle = spawnPtyProcess({ file: entry.binPath, args, cwd, cols, rows })
        return { id: handle.ptyId, program: entry.id }
      }

      // Default shell mode
      const shell = params.shell as string || defaultShell()
      const handle = spawnPtyProcess({ file: shell, args: [], cwd, cols, rows, shellIntegration: true })

      return { id: handle.ptyId, shellIntegration: handle.shellIntegration }
    }
  })

  tools.register({
    name: 'terminal.write',
    description: 'Write data to a terminal',
    execute: async (params) => {
      const id = params.id as number
      const data = params.data as string
      const pty = instances.get(id)
      if (!pty) throw new Error(`No terminal with id ${id}`)
      pty.write(data)
      return { ok: true }
    }
  })

  tools.register({
    name: 'terminal.resize',
    description: 'Resize a terminal',
    execute: async (params) => {
      const id = params.id as number
      const cols = params.cols as number
      const rows = params.rows as number
      const pty = instances.get(id)
      if (!pty) throw new Error(`No terminal with id ${id}`)
      pty.resize(cols, rows)
      return { ok: true }
    }
  })

  tools.register({
    name: 'terminal.kill',
    description: 'Kill a terminal process',
    execute: async (params) => {
      const id = params.id as number
      const pty = instances.get(id)
      if (!pty) throw new Error(`No terminal with id ${id}`)
      pty.kill()
      instances.delete(id)
      return { killed: id }
    }
  })
}
