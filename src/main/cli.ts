#!/usr/bin/env node

import { existsSync } from 'fs'
import { basename, dirname, isAbsolute, resolve } from 'path'
import { spawn } from 'child_process'
import { createInterface } from 'readline/promises'
import { fileURLToPath } from 'url'
import { createHeadlessKernel, type HeadlessKernel } from '@main/headless.js'
import type { PermissionApprovalRequest } from '@main/security/gate.js'
import { runMcpStdio } from '@main/mcp/stdio.js'
import {
  createServeToken,
  listServeCallers,
  revokeServeToken,
  rotateServeToken,
} from '@main/serve/tokens.js'
import { listServeDeniedRequests } from '@main/serve/denials.js'
import { migrateServeStructuredState } from '@main/serve/stateMigration.js'
import { createServeBackup, restoreServeBackup } from '@main/serve/backup.js'
import { startMimServe } from '@main/serve/start.js'

export interface CliIO {
  cwd: string
  stdout: (text: string) => void
  stderr: (text: string) => void
  stdin?: () => Promise<string>
  isTTY?: boolean
  confirmApproval?: (request: PermissionApprovalRequest) => Promise<boolean>
  spawn?: typeof spawn
  runMcp?: () => Promise<number>
  runServe?: (options: { workspacePath: string; host: string; port: number; home?: string }) => Promise<number>
  platform?: NodeJS.Platform
  home?: string
}

interface ParsedArgs {
  command: string
  args: string[]
  workspace?: string
  json: boolean
  yes: boolean
}

const HELP = `mim

Usage:
  mim init [path] [--name name]
  mim status [--workspace path]
  mim orient [--workspace path] [--json]
  mim log <message> [--workspace path]
  mim log --read [--workspace path] [--json]
  mim tool <name> [json|--stdin] [--workspace path] [--json] [--yes]
  mim list-tools [--json]
  mim go [--workspace path] [-- command ...]
  mim mcp
  mim serve [--host host] [--port port] [--workspace path]
  mim serve token create --name name [--workspace path] [--json]
  mim serve token list [--workspace path] [--json]
  mim serve token rotate <id> [--workspace path] [--json]
  mim serve token revoke <id> [--workspace path]
  mim serve denials list [--workspace path] [--json]
  mim serve state migrate --from workspace [--apps ids] [--workspace path] [--json]
  mim serve backup create --output dir [--workspace path] [--json]
  mim serve backup restore --from dir [--workspace path] [--json]
`

export async function runCli(argv: string[], io: CliIO = defaultIO()): Promise<number> {
  let kernel: HeadlessKernel | null = null
  try {
    const parsed = parseArgs(argv)

    if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
      io.stdout(HELP)
      return 0
    }

    if (parsed.command === 'list-tools') {
      kernel = createHeadlessKernel(headlessOptions(parsed, io))
      const tools = kernel.tools.list().map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
      writeResult(io, parsed, { tools })
      return 0
    }

    if (parsed.command === 'mcp') {
      if (parsed.args.length > 0) throw new Error('Usage: mim mcp')
      return io.runMcp ? io.runMcp() : runMcpStdio()
    }

    if (parsed.command === 'serve') {
      return runServeCommand(parsed, io)
    }

    if (parsed.command === 'init') {
      const { path, name } = parseInitArgs(parsed.args, io.cwd, parsed.workspace)
      kernel = createHeadlessKernel(headlessOptions(parsed, io))
      await kernel.openWorkspace(path)
      const result = await kernel.tools.call('workspace.init', { name: name ?? basename(path) }, { actor: 'user' })
      writeResult(io, parsed, result)
      return 0
    }

    if (parsed.command === 'status') {
      kernel = await openKernelForWorkspace(parsed, io)
      const status = await kernel.tools.call('workspace.status', {}, { actor: 'user' })
      const info = await kernel.tools.call('workspace.info', {}, { actor: 'user' })
      writeResult(io, parsed, { status, info })
      return 0
    }

    if (parsed.command === 'orient') {
      kernel = await openKernelForWorkspace(parsed, io)
      const result = await kernel.tools.call('workspace.orient', {}, { actor: 'user' }) as { content?: string }
      if (parsed.json) writeResult(io, parsed, result)
      else io.stdout(result.content ?? '')
      return 0
    }

    if (parsed.command === 'log') {
      kernel = await openKernelForWorkspace(parsed, io)
      if (parsed.args[0] === '--read') {
        const result = await kernel.tools.call('log.read', {}, { actor: 'user' }) as { content?: string }
        if (parsed.json) writeResult(io, parsed, result)
        else io.stdout(result.content ?? '')
        return 0
      }
      const message = parsed.args.join(' ').trim()
      if (!message) throw new Error('Usage: mim log <message>')
      const result = await kernel.tools.call('log.append', { message }, { actor: 'user' })
      writeResult(io, parsed, result)
      return 0
    }

    if (parsed.command === 'tool') {
      const { name, rawJson, useStdin } = parseToolArgs(parsed.args)
      if (!name) throw new Error('Usage: mim tool <name> [json]')
      const params = rawJson || useStdin ? parseJson(rawJson ?? await readStdin(io)) : {}
      kernel = await openKernelForWorkspace(parsed, io)
      const result = await kernel.tools.call(name, params, { actor: 'ai', sessionId: 'cli' })
      writeResult(io, parsed, result)
      return 0
    }

    if (parsed.command === 'go') {
      const separator = parsed.args.indexOf('--')
      const command = separator >= 0 ? parsed.args.slice(separator + 1) : parsed.args
      const external = command.length > 0 ? command : ['claude']
      kernel = await openKernelForWorkspace(parsed, io)
      await kernel.tools.call('workspace.orient', {}, { actor: 'user' })
      return runExternal(external, kernel.tools.getWorkspacePath() ?? io.cwd, io)
    }

    io.stderr(HELP)
    return 1
  } catch (err) {
    io.stderr(`${(err as Error).message}\n`)
    return 1
  } finally {
    try {
      await kernel?.shutdown()
    } catch {
      // Shutdown is best-effort; the command result has already been decided.
    }
  }
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv]
  let workspace: string | undefined
  let json = false
  let yes = false

  for (let i = 0; i < args.length;) {
    const arg = args[i]
    if (arg === '--') break
    if (arg === '--workspace' || arg === '-w') {
      const value = args[i + 1]
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${arg}`)
      }
      workspace = value
      args.splice(i, 2)
      continue
    }
    if (arg === '--json') {
      json = true
      args.splice(i, 1)
      continue
    }
    if (arg === '--yes') {
      yes = true
      args.splice(i, 1)
      continue
    }
    i++
  }

  return {
    command: args[0] ?? 'help',
    args: args.slice(1),
    workspace,
    json,
    yes,
  }
}

export function findWorkspaceRoot(start: string): string | null {
  let current = resolve(start)
  while (true) {
    if (existsSync(resolve(current, 'mim.yaml'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function openKernelForWorkspace(parsed: ParsedArgs, io: CliIO) {
  const path = resolveWorkspacePath(parsed.workspace, io.cwd)
  const kernel = createHeadlessKernel(headlessOptions(parsed, io))
  await kernel.openWorkspace(path)
  return kernel
}

function resolveWorkspacePath(workspace: string | undefined, cwd: string): string {
  if (workspace) return resolvePath(cwd, workspace)
  return findWorkspaceRoot(cwd) ?? cwd
}

function parseInitArgs(args: string[], cwd: string, workspace?: string): { path: string; name?: string } {
  let name: string | undefined
  const rest = [...args]
  for (let i = 0; i < rest.length;) {
    if (rest[i] === '--name') {
      name = rest[i + 1]
      rest.splice(i, 2)
      continue
    }
    i++
  }
  return {
    path: resolvePath(cwd, workspace ?? rest[0] ?? cwd),
    name,
  }
}

function parseToolArgs(args: string[]): { name?: string; rawJson?: string; useStdin: boolean } {
  const [name, ...rest] = args
  const useStdin = rest.includes('--stdin')
  const jsonArgs = rest.filter(arg => arg !== '--stdin')
  if (useStdin && jsonArgs.length > 0) {
    throw new Error('Usage: mim tool <name> [json|--stdin]')
  }
  if (jsonArgs.length > 1) {
    throw new Error('Usage: mim tool <name> [json|--stdin]')
  }
  return { name, rawJson: jsonArgs[0], useStdin }
}

function resolvePath(cwd: string, value: string): string {
  return isAbsolute(value) ? value : resolve(cwd, value)
}

function parseJson(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool params must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function writeResult(io: CliIO, parsed: ParsedArgs, value: unknown): void {
  if (parsed.json) {
    io.stdout(`${JSON.stringify(value, null, 2)}\n`)
    return
  }
  if (typeof value === 'string') {
    io.stdout(`${value}\n`)
    return
  }
  io.stdout(`${JSON.stringify(value, null, 2)}\n`)
}

async function runServeCommand(parsed: ParsedArgs, io: CliIO): Promise<number> {
  const workspacePath = resolveWorkspacePath(parsed.workspace, io.cwd)
  if (parsed.args[0] === 'token') {
    return runServeTokenCommand(parsed, io, workspacePath, parsed.args.slice(1))
  }
  if (parsed.args[0] === 'denials') {
    return runServeDenialsCommand(parsed, io, workspacePath, parsed.args.slice(1))
  }
  if (parsed.args[0] === 'state') {
    return runServeStateCommand(parsed, io, workspacePath, parsed.args.slice(1))
  }
  if (parsed.args[0] === 'backup') {
    return runServeBackupCommand(parsed, io, workspacePath, parsed.args.slice(1))
  }

  const listen = parseServeListenArgs(parsed.args)
  if (io.runServe) {
    return io.runServe({
      workspacePath,
      host: listen.host,
      port: listen.port,
      home: io.home,
    })
  }
  return startMimServe({
    workspacePath,
    host: listen.host,
    port: listen.port,
    home: io.home,
    stdout: io.stdout,
  })
}

async function runServeTokenCommand(
  parsed: ParsedArgs,
  io: CliIO,
  workspacePath: string,
  args: string[],
): Promise<number> {
  const subcommand = args[0]
  if (subcommand === 'create') {
    const { name, url } = parseServeTokenCreateArgs(args.slice(1))
    const result = createServeToken({ home: io.home, workspacePath, name, url })
    writeServeTokenResult(io, parsed, result)
    return 0
  }
  if (subcommand === 'list') {
    if (args.length !== 1) throw new Error('Usage: mim serve token list')
    writeResult(io, parsed, { callers: listServeCallers({ home: io.home, workspacePath }) })
    return 0
  }
  if (subcommand === 'rotate') {
    const id = args[1]
    if (!id || args.length > 2) throw new Error('Usage: mim serve token rotate <id>')
    const result = rotateServeToken({ home: io.home, workspacePath, id })
    writeServeTokenResult(io, parsed, result)
    return 0
  }
  if (subcommand === 'revoke') {
    const id = args[1]
    if (!id || args.length > 2) throw new Error('Usage: mim serve token revoke <id>')
    const revoked = revokeServeToken({ home: io.home, workspacePath, id })
    if (!revoked) throw new Error(`Unknown serve caller: ${id}`)
    writeResult(io, parsed, { revoked: id })
    return 0
  }
  throw new Error('Usage: mim serve token <create|list|rotate|revoke>')
}

async function runServeDenialsCommand(
  parsed: ParsedArgs,
  io: CliIO,
  workspacePath: string,
  args: string[],
): Promise<number> {
  if (args.length !== 1 || args[0] !== 'list') throw new Error('Usage: mim serve denials list')
  const deniedRequests = listServeDeniedRequests({ home: io.home, workspacePath })
  if (parsed.json) {
    writeResult(io, parsed, { deniedRequests })
    return 0
  }
  if (deniedRequests.length === 0) {
    io.stdout('No denied serve requests.\n')
    return 0
  }
  io.stdout(deniedRequests.map(entry => {
    const who = entry.callerName ?? entry.principal ?? 'unknown caller'
    return `${entry.createdAt} ${who} ${entry.tool}: ${entry.reason}`
  }).join('\n') + '\n')
  return 0
}

async function runServeStateCommand(
  parsed: ParsedArgs,
  io: CliIO,
  workspacePath: string,
  args: string[],
): Promise<number> {
  if (args[0] !== 'migrate') throw new Error('Usage: mim serve state migrate --from workspace')
  const { from, packageIds } = parseServeStateMigrateArgs(args.slice(1), io.cwd)
  const result = migrateServeStructuredState({
    sourceWorkspacePath: from,
    targetWorkspacePath: workspacePath,
    packageIds,
  })
  writeResult(io, parsed, result)
  return 0
}

function parseServeStateMigrateArgs(args: string[], cwd: string): { from: string; packageIds?: string[] } {
  const rest = [...args]
  let from: string | undefined
  let packageIds: string[] | undefined
  for (let i = 0; i < rest.length;) {
    const arg = rest[i]
    if (arg === '--from') {
      const value = rest[i + 1]
      if (!value || value.startsWith('-')) throw new Error('Missing value for --from')
      from = resolvePath(cwd, value)
      rest.splice(i, 2)
      continue
    }
    if (arg === '--apps') {
      const value = rest[i + 1]
      if (!value || value.startsWith('-')) throw new Error('Missing value for --apps')
      packageIds = value.split(',').map(item => item.trim()).filter(Boolean)
      rest.splice(i, 2)
      continue
    }
    i++
  }
  if (rest.length > 0 || !from) throw new Error('Usage: mim serve state migrate --from workspace')
  return { from, packageIds }
}

async function runServeBackupCommand(
  parsed: ParsedArgs,
  io: CliIO,
  workspacePath: string,
  args: string[],
): Promise<number> {
  const subcommand = args[0]
  if (subcommand === 'create') {
    const outputPath = parseRequiredPathFlag(args.slice(1), '--output', io.cwd, 'Usage: mim serve backup create --output dir')
    const result = createServeBackup({ home: io.home, workspacePath, outputPath })
    writeResult(io, parsed, result)
    return 0
  }
  if (subcommand === 'restore') {
    const backupPath = parseRequiredPathFlag(args.slice(1), '--from', io.cwd, 'Usage: mim serve backup restore --from dir')
    const result = restoreServeBackup({ home: io.home, workspacePath, backupPath })
    writeResult(io, parsed, result)
    return 0
  }
  throw new Error('Usage: mim serve backup <create|restore>')
}

function parseRequiredPathFlag(args: string[], flag: string, cwd: string, usage: string): string {
  const rest = [...args]
  let value: string | undefined
  for (let i = 0; i < rest.length;) {
    if (rest[i] === flag) {
      const raw = rest[i + 1]
      if (!raw || raw.startsWith('-')) throw new Error(`Missing value for ${flag}`)
      value = resolvePath(cwd, raw)
      rest.splice(i, 2)
      continue
    }
    i++
  }
  if (rest.length > 0 || !value) throw new Error(usage)
  return value
}

function parseServeListenArgs(args: string[]): { host: string; port: number } {
  const rest = [...args]
  let host = '127.0.0.1'
  let port = 4780
  for (let i = 0; i < rest.length;) {
    const arg = rest[i]
    if (arg === '--host') {
      const value = rest[i + 1]
      if (!value || value.startsWith('-')) throw new Error('Missing value for --host')
      host = value
      rest.splice(i, 2)
      continue
    }
    if (arg === '--port') {
      const value = rest[i + 1]
      if (!value || value.startsWith('-')) throw new Error('Missing value for --port')
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error('--port must be a valid TCP port')
      }
      port = parsed
      rest.splice(i, 2)
      continue
    }
    i++
  }
  if (rest.length > 0) throw new Error('Usage: mim serve [--host host] [--port port]')
  return { host, port }
}

function parseServeTokenCreateArgs(args: string[]): { name: string; url?: string } {
  const rest = [...args]
  let name = ''
  let url: string | undefined
  for (let i = 0; i < rest.length;) {
    const arg = rest[i]
    if (arg === '--name') {
      const value = rest[i + 1]
      if (!value || value.startsWith('-')) throw new Error('Missing value for --name')
      name = value
      rest.splice(i, 2)
      continue
    }
    if (arg === '--url') {
      const value = rest[i + 1]
      if (!value || value.startsWith('-')) throw new Error('Missing value for --url')
      url = value
      rest.splice(i, 2)
      continue
    }
    i++
  }
  if (rest.length > 0 || !name) throw new Error('Usage: mim serve token create --name name')
  return { name, url }
}

function writeServeTokenResult(io: CliIO, parsed: ParsedArgs, result: ReturnType<typeof createServeToken>): void {
  if (parsed.json) {
    writeResult(io, parsed, result)
    return
  }
  io.stdout([
    `Created token for ${result.record.name}`,
    '',
    result.token,
    '',
    'Claude:',
    result.snippets.claude,
    '',
    'Codex:',
    result.snippets.codex,
    '',
    'curl:',
    result.snippets.curl,
    '',
  ].join('\n'))
}

function headlessOptions(parsed: ParsedArgs, io: CliIO) {
  return {
    approvals: parsed.yes ? 'allow' as const : io.isTTY ? 'prompt' as const : 'deny' as const,
    confirmApproval: io.confirmApproval ?? defaultConfirmApproval,
  }
}

async function defaultConfirmApproval(request: PermissionApprovalRequest): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const target = request.target ? ` ${request.target}` : ''
    const answer = await rl.question(
      `Approve ${request.risk}-risk ${request.toolName}${target}? Type "yes" to continue: `,
    )
    return answer.trim().toLowerCase() === 'yes'
  } finally {
    rl.close()
  }
}

async function readStdin(io: CliIO): Promise<string> {
  if (io.stdin) return io.stdin()
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function runExternal(command: string[], cwd: string, io: CliIO): Promise<number> {
  const spawnImpl = io.spawn ?? spawn
  const platform = io.platform ?? process.platform
  return new Promise<number>((resolveCode) => {
    const child = spawnImpl(command[0], command.slice(1), {
      cwd,
      stdio: 'inherit',
      shell: platform === 'win32',
    })
    child.on('error', (err) => {
      io.stderr(`${err.message}\n`)
      resolveCode(1)
    })
    child.on('exit', (code) => resolveCode(code ?? 0))
  })
}

function defaultIO(): CliIO {
  return {
    cwd: process.cwd(),
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
    isTTY: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli(process.argv.slice(2)).then(code => {
    process.exitCode = code
  })
}
