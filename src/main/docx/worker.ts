import { execFile } from 'child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'
import { electronBuilderOsName } from '@main/platform.js'

export interface DocxWorkerRequest {
  command: 'annotate' | 'read_comments' | 'validate'
  inputPath?: string
  outputPath?: string
  path?: string
  operations?: DocxOperation[]
}

export interface DocxOperation {
  type: 'add_comment' | 'reply_comment' | 'resolve_comment' | 'tracked_insertion' | 'tracked_deletion'
  anchorText?: string
  commentText?: string
  author?: string
  occurrenceIndex?: number
  parentCommentId?: string
  replyText?: string
  commentId?: string
  insertionText?: string
  position?: 'before' | 'after' | 'replace'
  deleteText?: string
}

export interface DocxWorkerResult {
  success: boolean
  error?: string
  outputPath?: string
  results?: Array<Record<string, unknown>>
  validationErrors?: string[]
  summary?: Record<string, unknown>
  comments?: unknown[]
}

const WORKER_TIMEOUT_MS = 120_000

export async function runDocxWorker(request: DocxWorkerRequest): Promise<DocxWorkerResult> {
  const executable = resolveDocxWorkerPath()
  const tempDir = mkdtempSync(join(tmpdir(), 'mim-docx-worker-'))
  const requestPath = join(tempDir, 'request.json')
  writeFileSync(requestPath, JSON.stringify(request), 'utf-8')

  try {
    const stdout = await execFileText(executable, ['--json', requestPath], WORKER_TIMEOUT_MS)
    return parseWorkerJson(stdout)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function getDocxWorkerStatus(): { available: boolean; path?: string; error?: string } {
  try {
    return { available: true, path: resolveDocxWorkerPath() }
  } catch (err) {
    return { available: false, error: (err as Error).message }
  }
}

export function resolveDocxWorkerPath(): string {
  const override = process.env.DOCX_WORKER_PATH
  if (override && existsSync(override)) return override

  const executableName = process.platform === 'win32' ? 'docx-worker.exe' : 'docx-worker'
  const legacyName = process.platform === 'win32' ? 'DocxWorker.exe' : 'DocxWorker'
  const platformArch = `${process.platform}-${process.arch}`
  const builderPlatformArch = `${electronBuilderOsName()}-${process.arch}`
  const rid = dotnetRuntimeIdentifier()
  const appRoots = Array.from(new Set([
    process.cwd(),
    resolve(import.meta.dirname, '../..'),
    resolve(import.meta.dirname, '..'),
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    typeof process.resourcesPath === 'string' ? resolve(process.resourcesPath, '..') : '',
  ].filter(Boolean)))

  const candidates = appRoots.flatMap(root => [
    join(root, 'resources', 'docx-worker', builderPlatformArch, executableName),
    join(root, 'resources', 'docx-worker', platformArch, executableName),
    join(root, 'resources', 'docx-worker', rid, executableName),
    join(root, 'docx-worker', builderPlatformArch, executableName),
    join(root, 'docx-worker', platformArch, executableName),
    join(root, 'docx-worker', rid, executableName),
    join(root, 'sidecar', 'docx-worker', 'DocxWorker', 'bin', 'Release', 'net8.0', rid, 'publish', executableName),
    join(root, 'sidecar', 'docx-worker', 'DocxWorker', 'bin', 'Release', 'net8.0', rid, 'publish', legacyName),
  ])

  const found = candidates.find(candidate => existsSync(candidate))
  if (found) return found

  throw new Error(
    `DOCX worker binary not found. Run "npm run docx-worker:build" or set DOCX_WORKER_PATH. Checked: ${candidates.slice(0, 8).join(', ')}`,
  )
}

function execFileText(file: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (stdout?.trim().startsWith('{')) {
          resolve(stdout)
          return
        }
        const detail = stderr?.trim() || stdout?.trim() || error.message
        reject(new Error(`docx-worker failed: ${detail}`))
        return
      }
      resolve(stdout)
    })
  })
}

function parseWorkerJson(stdout: string): DocxWorkerResult {
  const text = stdout.trim()
  if (!text) return { success: false, error: 'docx-worker returned no output' }
  try {
    return JSON.parse(text) as DocxWorkerResult
  } catch {
    return { success: false, error: `docx-worker returned invalid JSON: ${text.slice(0, 500)}` }
  }
}

function dotnetRuntimeIdentifier(): string {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'osx-arm64' : 'osx-x64'
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64'
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64'
  return `${process.platform}-${process.arch}`
}
