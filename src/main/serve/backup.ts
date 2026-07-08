import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { serveCallersPath, serveStateDir } from '@main/serve/tokens.js'

export interface CreateServeBackupOptions {
  home?: string
  workspacePath: string
  outputPath: string
  now?: () => Date
}

export interface CreateServeBackupResult {
  path: string
  copied: string[]
}

export interface RestoreServeBackupOptions {
  home?: string
  workspacePath: string
  backupPath: string
}

export interface RestoreServeBackupResult {
  restored: string[]
  servePath: string
}

const WORKSPACE_STATE_ENTRIES = [
  'packages',
  'sessions',
  'traces',
  'settings.json',
  'workspace.json',
]

export function createServeBackup(options: CreateServeBackupOptions): CreateServeBackupResult {
  const workspacePath = resolve(options.workspacePath)
  const outputPath = resolve(options.outputPath)
  if (existsSync(outputPath)) throw new Error(`Backup path already exists: ${outputPath}`)

  const copied: string[] = []
  mkdirSync(outputPath, { recursive: true })
  for (const entry of WORKSPACE_STATE_ENTRIES) {
    const source = join(workspacePath, '.mim', entry)
    if (!existsSync(source)) continue
    copyPath(source, join(outputPath, 'workspace', entry))
    copied.push(entry)
  }

  const serveSource = serveStateDir({ home: options.home, workspacePath })
  if (existsSync(serveSource)) {
    copyPath(serveSource, join(outputPath, 'serve'))
    copied.push('serve')
  }

  writeFileSync(join(outputPath, 'manifest.json'), JSON.stringify({
    version: 1,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    workspace: basename(workspacePath),
    copied,
  }, null, 2), 'utf-8')

  return { path: outputPath, copied }
}

export function restoreServeBackup(options: RestoreServeBackupOptions): RestoreServeBackupResult {
  const backupPath = resolve(options.backupPath)
  const workspacePath = resolve(options.workspacePath)
  if (!existsSync(backupPath)) throw new Error(`Backup path not found: ${backupPath}`)

  const restored: string[] = []
  for (const entry of WORKSPACE_STATE_ENTRIES) {
    const source = join(backupPath, 'workspace', entry)
    if (!existsSync(source)) continue
    const target = join(workspacePath, '.mim', entry)
    rmSync(target, { recursive: true, force: true })
    copyPath(source, target)
    restored.push(entry)
  }

  const serveSource = join(backupPath, 'serve')
  const serveTarget = serveStateDir({ home: options.home, workspacePath })
  if (existsSync(serveSource)) {
    rmSync(serveTarget, { recursive: true, force: true })
    copyPath(serveSource, serveTarget)
    restored.push('serve')
  }

  return {
    restored,
    servePath: serveCallersPath({ home: options.home, workspacePath }),
  }
}

function copyPath(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true, force: true, errorOnExist: false })
}
