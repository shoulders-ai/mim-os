import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'
import type { ToolContext } from '@main/tools/registry.js'

export type HistoryActor = 'user' | 'agent' | 'package' | 'external' | 'system'

export type HistoryEvent =
  | 'baseline'
  | 'save'
  | 'external'
  | 'create'
  | 'after-write'
  | 'after-edit'
  | 'before-write'
  | 'before-edit'
  | 'before-delete'
  | 'delete'
  | 'before-rename'
  | 'rename'
  | 'copy'
  | 'import'
  | 'before-restore'
  | 'restore'

export type HistoryKind = 'text' | 'binary' | 'deleted'

export interface HistoryCaptureMeta {
  actor: HistoryActor
  event: HistoryEvent
  anchor?: boolean
  tool?: string
  traceId?: string
  spanId?: string
  sessionId?: string
  packageId?: string
}

export interface HistoryVersion {
  id: string
  path: string
  at: string
  actor: HistoryActor
  event: HistoryEvent
  kind: HistoryKind
  hash: string
  bytes: number
  deleted: boolean
  anchor: boolean
  tool?: string
  traceId?: string
  spanId?: string
  sessionId?: string
  packageId?: string
  foldedCount?: number
}

export interface HistoryCurrentVersion {
  path: string
  hash: string
  bytes: number
  kind: HistoryKind
  deleted: boolean
  modifiedAt?: string
}

export interface HistoryListResult {
  path: string
  current: HistoryCurrentVersion | null
  versions: HistoryVersion[]
  totalVersions: number
  foldedCount: number
}

export interface HistoryPreviewResult {
  path: string
  versionId: string
  kind: HistoryKind
  bytes: number
  deleted: boolean
  content?: string
}

export interface HistoryStats {
  bytes: number
  blobBytes: number
  fileCount: number
  versionCount: number
  prunedVersionCount?: number
}

export interface HistoryBaselineResult {
  scanned: number
  captured: number
  skipped: number
  truncated: boolean
}

export interface HistoryBaselineOptions {
  maxScanned?: number
  maxCaptured?: number
  maxDurationMs?: number
}

export interface HistoryPruneResult {
  beforeVersions: number
  afterVersions: number
  removedVersions: number
  removedBlobs: number
  bytesBefore: number
  bytesAfter: number
}

export interface HistoryTempOpenResult {
  path: string
  expiresOnRestart: true
}

export interface HistoryToolObserver {
  beforeToolCall(workspacePath: string | null, tool: string, params: Record<string, unknown>, ctx: ToolContext): unknown
  afterToolCall(workspacePath: string | null, tool: string, params: Record<string, unknown>, result: unknown, ctx: ToolContext, pending: unknown): void
}

export interface HistoryStore {
  captureFile(path: string, meta: HistoryCaptureMeta): HistoryVersion | null
  captureDeletion(path: string, meta: HistoryCaptureMeta): HistoryVersion | null
  baselineWorkspace(options?: HistoryBaselineOptions): HistoryBaselineResult
  observeFileChange(change: { path: string; kind: string }): void
  listFileVersions(path: string, options?: { includeFolded?: boolean }): HistoryListResult
  previewVersion(path: string, versionId: string): HistoryPreviewResult
  writeVersionTempFile(path: string, versionId: string): HistoryTempOpenResult
  restoreVersion(path: string, versionId: string): HistoryVersion | null
  prune(): HistoryPruneResult
  stats(): HistoryStats
  clear(): void
  toolObserver(): HistoryToolObserver
}

export interface HistoryStoreOptions {
  getWorkspacePath: () => string | null
  clock?: () => number
  maxFileBytes?: number
}

interface HistoryIndex {
  schemaVersion: 1
  files: Record<string, { versions: HistoryVersion[] }>
}

interface Snapshot {
  path: string
  kind: HistoryKind
  hash: string
  bytes: number
  deleted: boolean
  buffer?: Buffer
}

interface PendingSnapshot {
  snapshot: Snapshot
  meta: HistoryCaptureMeta
}

const HISTORY_SCHEMA_VERSION = 1
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024
const DISPLAY_TARGET = 30
const RECENT_VISIBLE_COUNT = 8
const DAILY_ANCHOR_DAYS = 30

const GENERATED_SEGMENTS = new Set([
  '.git',
  '.mim',
  'node_modules',
  'dist',
  'build',
  'out',
  '.cache',
  '.next',
  '.nuxt',
  '__pycache__',
  'target',
  '.venv',
  'venv',
])

const HISTORY_EXTENSIONS = new Set([
  'bib',
  'csv',
  'do',
  'doc',
  'docx',
  'docm',
  'html',
  'htm',
  'json',
  'jsonl',
  'md',
  'markdown',
  'mdx',
  'pdf',
  'py',
  'r',
  'rmd',
  'sql',
  'tex',
  'tsv',
  'txt',
  'xls',
  'xlsx',
  'xlsm',
  'yaml',
  'yml',
])

const TEXT_EXTENSIONS = new Set([
  'bib',
  'csv',
  'do',
  'html',
  'htm',
  'json',
  'jsonl',
  'md',
  'markdown',
  'mdx',
  'py',
  'r',
  'rmd',
  'sql',
  'tex',
  'tsv',
  'txt',
  'yaml',
  'yml',
])

const HISTORY_BASENAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'README',
  'README.md',
])

export function isHistoryEligiblePath(path: string): boolean {
  const normalized = normalizeRelPath(path)
  if (!normalized || normalized.startsWith('../') || normalized === '..') return false
  const segments = normalized.split('/')
  if (segments.some(segment => GENERATED_SEGMENTS.has(segment))) return false
  const name = segments[segments.length - 1] ?? ''
  if (HISTORY_BASENAMES.has(name)) return true
  const ext = extensionOf(name)
  return HISTORY_EXTENSIONS.has(ext)
}

export function createHistoryStore(options: HistoryStoreOptions): HistoryStore {
  const clock = options.clock ?? Date.now
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES

  function workspace(): string {
    const path = options.getWorkspacePath()
    if (!path) throw new Error('No workspace open')
    return path
  }

  function captureFile(path: string, meta: HistoryCaptureMeta): HistoryVersion | null {
    const ws = workspace()
    const snapshot = snapshotFile(ws, path)
    if (!snapshot || snapshot.bytes > maxFileBytes) return null
    return persistSnapshot(ws, snapshot, meta)
  }

  function captureDeletion(path: string, meta: HistoryCaptureMeta): HistoryVersion | null {
    const ws = workspace()
    const relPath = normalizeWorkspaceRelPath(ws, path)
    if (!isHistoryEligibleForWorkspace(ws, relPath)) return null
    return persistSnapshot(ws, {
      path: relPath,
      kind: 'deleted',
      hash: '',
      bytes: 0,
      deleted: true,
    }, { ...meta, anchor: meta.anchor ?? true })
  }

  function baselineWorkspace(options: HistoryBaselineOptions = {}): HistoryBaselineResult {
    const ws = workspace()
    const ignore = loadIgnoreMatcher(ws)
    const index = readIndex(ws)
    const startedAt = Date.now()
    let scanned = 0
    let captured = 0
    let skipped = 0
    let truncated = false
    let changed = false

    function hitLimit(): boolean {
      if (options.maxScanned !== undefined && scanned >= options.maxScanned) return true
      if (options.maxCaptured !== undefined && captured >= options.maxCaptured) return true
      if (options.maxDurationMs !== undefined && Date.now() - startedAt >= options.maxDurationMs) return true
      return false
    }

    function walk(dir: string): void {
      if (hitLimit()) {
        truncated = true
        return
      }
      let entries: ReturnType<typeof readdirSync>
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (hitLimit()) {
          truncated = true
          return
        }
        const fullPath = join(dir, entry.name)
        const relPath = toSlashPath(relative(ws, fullPath))
        if (!relPath || shouldSkipGenerated(relPath) || ignore(relPath)) {
          skipped++
          continue
        }
        if (entry.isDirectory()) {
          walk(fullPath)
          continue
        }
        if (!entry.isFile()) {
          skipped++
          continue
        }
        scanned++
        const before = statsSafe(fullPath)
        if (!before || before.size > maxFileBytes || !isHistoryEligiblePath(relPath)) {
          skipped++
          continue
        }
        const snapshot = snapshotExistingFile(relPath, fullPath, before.size)
        if (!snapshot) {
          skipped++
          continue
        }
        if (appendSnapshotVersion(index, ws, snapshot, { actor: 'system', event: 'baseline' }, { assumeEligible: true })) {
          captured++
          changed = true
        }
      }
    }

    walk(ws)
    if (changed) writeIndex(ws, index)
    return { scanned, captured, skipped, truncated }
  }

  function observeFileChange(change: { path: string; kind: string }): void {
    try {
      if (change.kind === 'unlink') {
        captureDeletion(change.path, { actor: 'external', event: 'delete', anchor: true })
        return
      }
      if (change.kind === 'change' || change.kind === 'add') {
        captureFile(change.path, {
          actor: 'external',
          event: 'external',
          anchor: change.kind === 'add',
        })
      }
    } catch {
      // Local recovery should never break the file watcher.
    }
  }

  function listFileVersions(path: string, listOptions: { includeFolded?: boolean } = {}): HistoryListResult {
    const ws = workspace()
    const relPath = normalizeWorkspaceRelPath(ws, path)
    const index = readIndex(ws)
    const raw = (index.files[relPath]?.versions ?? [])
      .map((version, index) => ({ version, index }))
      .sort((a, b) => b.version.at.localeCompare(a.version.at) || b.index - a.index)
      .map(item => item.version)
    const versions = listOptions.includeFolded ? raw : foldVisibleVersions(raw)
    return {
      path: relPath,
      current: currentVersion(ws, relPath),
      versions,
      totalVersions: raw.length,
      foldedCount: Math.max(0, raw.length - versions.length),
    }
  }

  function previewVersion(path: string, versionId: string): HistoryPreviewResult {
    const ws = workspace()
    const relPath = normalizeWorkspaceRelPath(ws, path)
    const version = findVersion(ws, relPath, versionId)
    if (version.deleted) {
      return { path: relPath, versionId, kind: 'deleted', bytes: 0, deleted: true }
    }
    const buffer = readBlob(ws, version.hash)
    if (version.kind === 'text') {
      return {
        path: relPath,
        versionId,
        kind: 'text',
        bytes: version.bytes,
        deleted: false,
        content: buffer.toString('utf-8'),
      }
    }
    return {
      path: relPath,
      versionId,
      kind: 'binary',
      bytes: version.bytes,
      deleted: false,
    }
  }

  function writeVersionTempFile(path: string, versionId: string): HistoryTempOpenResult {
    const ws = workspace()
    const relPath = normalizeWorkspaceRelPath(ws, path)
    const version = findVersion(ws, relPath, versionId)
    if (version.deleted) throw new Error('Cannot open a deleted version')
    const buffer = readBlob(ws, version.hash)
    const dir = join(tmpdir(), 'mim-history')
    mkdirSync(dir, { recursive: true })
    const safeName = basename(relPath).replace(/[^A-Za-z0-9._-]/g, '_') || 'version'
    const ext = extname(safeName)
    const stem = ext ? safeName.slice(0, -ext.length) : safeName
    const tempPath = join(dir, `${stem}.${version.id}${ext}`)
    writeFileSync(tempPath, buffer)
    return { path: tempPath, expiresOnRestart: true }
  }

  function restoreVersion(path: string, versionId: string): HistoryVersion | null {
    const ws = workspace()
    const relPath = normalizeWorkspaceRelPath(ws, path)
    const version = findVersion(ws, relPath, versionId)

    const current = snapshotFile(ws, relPath)
    if (current) {
      persistSnapshot(ws, current, { actor: 'user', event: 'before-restore', anchor: true })
    } else {
      persistSnapshot(ws, {
        path: relPath,
        kind: 'deleted',
        hash: '',
        bytes: 0,
        deleted: true,
      }, { actor: 'user', event: 'before-restore', anchor: true })
    }

    const target = resolveWorkspaceFilePath(ws, relPath)
    if (version.deleted) {
      if (existsSync(target)) unlinkSync(target)
      return captureDeletion(relPath, { actor: 'user', event: 'restore', anchor: true })
    }

    const buffer = readBlob(ws, version.hash)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, buffer)
    return captureFile(relPath, { actor: 'user', event: 'restore', anchor: true })
  }

  function stats(): HistoryStats {
    const ws = workspace()
    const index = readIndex(ws)
    const hashes = new Set<string>()
    let versionCount = 0
    for (const file of Object.values(index.files)) {
      versionCount += file.versions.length
      for (const version of file.versions) {
        if (version.hash) hashes.add(version.hash)
      }
    }
    let blobBytes = 0
    for (const hash of hashes) {
      const stat = statsSafe(blobPath(ws, hash))
      if (stat) blobBytes += stat.size
    }
    return {
      bytes: directorySize(historyDir(ws)),
      blobBytes,
      fileCount: Object.keys(index.files).length,
      versionCount,
      prunedVersionCount: countPrunableVersions(index),
    }
  }

  function prune(): HistoryPruneResult {
    const ws = workspace()
    const bytesBefore = directorySize(historyDir(ws))
    const index = readIndex(ws)
    const beforeVersions = countVersions(index)
    const next = emptyIndex()

    for (const [path, file] of Object.entries(index.files)) {
      const raw = file.versions
        .map((version, index) => ({ version, index }))
        .sort((a, b) => b.version.at.localeCompare(a.version.at) || b.index - a.index)
        .map(item => item.version)
      const kept = foldVisibleVersions(raw)
      const ordered = [...kept].sort((a, b) => a.at.localeCompare(b.at))
      if (ordered.length > 0) next.files[path] = { versions: ordered.map(({ foldedCount, ...version }) => version) }
    }

    writeIndex(ws, next)
    const removedBlobs = collectGarbageBlobs(ws, next)
    const afterVersions = countVersions(next)
    const bytesAfter = directorySize(historyDir(ws))
    return {
      beforeVersions,
      afterVersions,
      removedVersions: Math.max(0, beforeVersions - afterVersions),
      removedBlobs,
      bytesBefore,
      bytesAfter,
    }
  }

  function clear(): void {
    const ws = workspace()
    rmSync(historyDir(ws), { recursive: true, force: true })
  }

  function toolObserver(): HistoryToolObserver {
    return {
      beforeToolCall(workspacePath, tool, params, ctx) {
        if (!workspacePath) return []
        return buildPendingSnapshots(workspacePath, tool, params, ctx)
      },
      afterToolCall(workspacePath, tool, params, result, ctx, pending) {
        if (!workspacePath) return
        try {
          for (const item of Array.isArray(pending) ? pending as PendingSnapshot[] : []) {
            persistSnapshot(workspacePath, item.snapshot, item.meta)
          }
          captureAfterTool(workspacePath, tool, params, result, ctx, pending)
        } catch {
          // Recovery capture is best-effort and must not make a successful tool fail.
        }
      },
    }
  }

  function buildPendingSnapshots(
    ws: string,
    tool: string,
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): PendingSnapshot[] {
    const actor = actorFromContext(ctx)
    const out: PendingSnapshot[] = []
    const add = (path: unknown, event: HistoryEvent, anchor = actor !== 'user') => {
      if (typeof path !== 'string') return
      const snapshot = snapshotFile(ws, path)
      if (!snapshot || snapshot.bytes > maxFileBytes) return
      out.push({
        snapshot,
        meta: metaFromContext(ctx, actor, event, tool, anchor),
      })
    }

    if (tool === 'fs.write' || tool === 'fs.writeBytes') add(params.path, 'before-write')
    else if (tool === 'fs.edit' || isCommentMutationTool(tool)) add(params.path, 'before-edit')
    else if (tool === 'fs.delete' || tool === 'fs.trash') add(params.path, 'before-delete', true)
    else if (tool === 'fs.rename') add(params.old_path, 'before-rename', true)
    else if (tool === 'documents.importMarkdown') add(params.output_path, 'before-write')
    return out
  }

  function captureAfterTool(
    ws: string,
    tool: string,
    params: Record<string, unknown>,
    result: unknown,
    ctx: ToolContext,
    pending: unknown,
  ): void {
    const actor = actorFromContext(ctx)
    const meta = (event: HistoryEvent, anchor = actor !== 'user') =>
      metaFromContext(ctx, actor, event, tool, anchor)
    const capture = (path: unknown, event: HistoryEvent, anchor = actor !== 'user') => {
      if (typeof path !== 'string') return
      const snapshot = snapshotFile(ws, path)
      if (!snapshot || snapshot.bytes > maxFileBytes) return
      persistSnapshot(ws, snapshot, meta(event, anchor))
    }
    const deletion = (path: unknown, event: HistoryEvent, anchor = true) => {
      if (typeof path !== 'string') return
      const relPath = normalizeWorkspaceRelPath(ws, path)
      if (!isHistoryEligibleForWorkspace(ws, relPath)) return
      persistSnapshot(ws, {
        path: relPath,
        kind: 'deleted',
        hash: '',
        bytes: 0,
        deleted: true,
      }, meta(event, anchor))
    }

    const pendingCount = Array.isArray(pending) ? pending.length : 0

    if (tool === 'fs.write' || tool === 'fs.writeBytes') capture(params.path, pendingCount === 0 ? 'create' : 'after-write')
    else if (tool === 'fs.edit' || isCommentMutationTool(tool)) capture(params.path, 'after-edit')
    else if (tool === 'fs.create') capture(params.path, 'create', true)
    else if (tool === 'fs.delete' || tool === 'fs.trash') deletion(params.path, 'delete', true)
    else if (tool === 'fs.rename') {
      deletion(params.old_path, 'rename', true)
      capture(params.new_path, 'rename', true)
    } else if (tool === 'fs.copy') {
      capture(copiedTo(result) ?? params.new_path, 'copy', true)
    } else if (tool === 'fs.import') {
      capture(importedPath(result), 'import', true)
    } else if (tool === 'documents.importMarkdown') {
      capture(params.output_path, 'after-write')
    }
  }

  function isCommentMutationTool(tool: string): boolean {
    return tool === 'comments.add' || tool === 'comments.reply' || tool === 'comments.resolve'
  }

  function persistSnapshot(ws: string, snapshot: Snapshot, meta: HistoryCaptureMeta): HistoryVersion | null {
    const index = readIndex(ws)
    const version = appendSnapshotVersion(index, ws, snapshot, meta)
    if (!version) return null
    writeIndex(ws, index)
    return version
  }

  function appendSnapshotVersion(
    index: HistoryIndex,
    ws: string,
    snapshot: Snapshot,
    meta: HistoryCaptureMeta,
    options: { assumeEligible?: boolean } = {},
  ): HistoryVersion | null {
    const relPath = snapshot.path
    if (!snapshot.deleted && snapshot.bytes > maxFileBytes) return null
    if (!options.assumeEligible && !isHistoryEligibleForWorkspace(ws, relPath)) return null

    const file = index.files[relPath] ?? { versions: [] }
    const latest = file.versions[file.versions.length - 1]
    if (
      latest
      && latest.hash === snapshot.hash
      && latest.deleted === snapshot.deleted
      && !meta.anchor
    ) {
      return null
    }

    if (!snapshot.deleted && snapshot.buffer) writeBlob(ws, snapshot.hash, snapshot.buffer)

    const atMs = clock()
    const version: HistoryVersion = {
      id: versionId(relPath, snapshot.hash, atMs, file.versions.length, meta.event),
      path: relPath,
      at: new Date(atMs).toISOString(),
      actor: meta.actor,
      event: meta.event,
      kind: snapshot.kind,
      hash: snapshot.hash,
      bytes: snapshot.bytes,
      deleted: snapshot.deleted,
      anchor: Boolean(meta.anchor),
      ...(meta.tool ? { tool: meta.tool } : {}),
      ...(meta.traceId ? { traceId: meta.traceId } : {}),
      ...(meta.spanId ? { spanId: meta.spanId } : {}),
      ...(meta.sessionId ? { sessionId: meta.sessionId } : {}),
      ...(meta.packageId ? { packageId: meta.packageId } : {}),
    }
    file.versions.push(version)
    index.files[relPath] = file
    return version
  }

  return {
    captureFile,
    captureDeletion,
    baselineWorkspace,
    observeFileChange,
    listFileVersions,
    previewVersion,
    writeVersionTempFile,
    restoreVersion,
    prune,
    stats,
    clear,
    toolObserver,
  }
}

function snapshotFile(workspacePath: string, path: string): Snapshot | null {
  const relPath = normalizeWorkspaceRelPath(workspacePath, path)
  if (!isHistoryEligibleForWorkspace(workspacePath, relPath)) return null
  const fullPath = resolveWorkspaceFilePath(workspacePath, relPath)
  const stat = statsSafe(fullPath)
  if (!stat || !stat.isFile()) return null
  if (resolvesOutsideWorkspace(workspacePath, fullPath)) return null
  return snapshotExistingFile(relPath, fullPath, stat.size)
}

function snapshotExistingFile(relPath: string, fullPath: string, size?: number): Snapshot | null {
  let buffer: Buffer
  try {
    buffer = readFileSync(fullPath)
  } catch {
    return null
  }
  const hash = hashBuffer(buffer)
  const kind: HistoryKind = TEXT_EXTENSIONS.has(extensionOf(relPath)) ? 'text' : 'binary'
  return {
    path: relPath,
    kind,
    hash,
    bytes: size ?? buffer.length,
    deleted: false,
    buffer,
  }
}

function currentVersion(workspacePath: string, relPath: string): HistoryCurrentVersion | null {
  const fullPath = resolveWorkspaceFilePath(workspacePath, relPath)
  const stat = statsSafe(fullPath)
  if (!stat || !stat.isFile()) {
    return {
      path: relPath,
      hash: '',
      bytes: 0,
      kind: 'deleted',
      deleted: true,
    }
  }
  const buffer = readFileSync(fullPath)
  return {
    path: relPath,
    hash: hashBuffer(buffer),
    bytes: buffer.length,
    kind: TEXT_EXTENSIONS.has(extensionOf(relPath)) ? 'text' : 'binary',
    deleted: false,
    modifiedAt: stat.mtime.toISOString(),
  }
}

function foldVisibleVersions(versions: HistoryVersion[]): HistoryVersion[] {
  if (versions.length <= DISPLAY_TARGET) return versions

  const visible = new Map<string, { version: HistoryVersion; priority: number }>()
  const add = (version: HistoryVersion, priority: number) => {
    const existing = visible.get(version.id)
    if (!existing || existing.priority < priority) visible.set(version.id, { version, priority })
  }

  const nowMs = Date.now()
  for (let index = 0; index < versions.length; index++) {
    const version = versions[index]
    const atMs = Date.parse(version.at)
    if (index === 0) add(version, 1000)
    if (version.anchor) add(version, 900)
    if (index < RECENT_VISIBLE_COUNT) add(version, 800 - index)
    const ageDays = Number.isFinite(atMs) ? Math.max(0, Math.floor((nowMs - atMs) / 86400000)) : 0
    if (ageDays <= DAILY_ANCHOR_DAYS && firstForDay(versions, index)) add(version, 600 - ageDays)
    if (ageDays > DAILY_ANCHOR_DAYS && firstForWeek(versions, index)) add(version, 400 - Math.min(ageDays, 365))
  }

  const anchors = [...visible.values()]
    .filter(item => item.version.anchor)
    .map(item => item.version)
  const fill = [...visible.values()]
    .filter(item => !item.version.anchor)
    .sort((a, b) => b.priority - a.priority || b.version.at.localeCompare(a.version.at))
    .slice(0, Math.max(0, DISPLAY_TARGET - anchors.length))
    .map(item => item.version)

  const out = [...anchors, ...fill]
    .sort((a, b) => b.at.localeCompare(a.at))
  const visibleIds = new Set(out.map(version => version.id))
  return out.map((version, index) => ({
    ...version,
    foldedCount: countFoldedAfter(versions, visibleIds, version.id, index === out.length - 1 ? null : out[index + 1].id),
  }))
}

function countFoldedAfter(
  versions: HistoryVersion[],
  visibleIds: Set<string>,
  fromId: string,
  toId: string | null,
): number {
  const from = versions.findIndex(version => version.id === fromId)
  const to = toId ? versions.findIndex(version => version.id === toId) : versions.length
  if (from < 0 || to < 0 || to <= from) return 0
  return versions.slice(from + 1, to).filter(version => !visibleIds.has(version.id)).length
}

function firstForDay(versions: HistoryVersion[], index: number): boolean {
  const day = versions[index].at.slice(0, 10)
  return !versions.slice(0, index).some(version => version.at.slice(0, 10) === day)
}

function firstForWeek(versions: HistoryVersion[], index: number): boolean {
  const week = weekKey(versions[index].at)
  return !versions.slice(0, index).some(version => weekKey(version.at) === week)
}

function weekKey(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso.slice(0, 10)
  const day = Math.floor(date.getTime() / 86400000)
  return String(Math.floor(day / 7))
}

function findVersion(workspacePath: string, relPath: string, versionId: string): HistoryVersion {
  const version = readIndex(workspacePath).files[relPath]?.versions.find(item => item.id === versionId)
  if (!version) throw new Error(`History version not found: ${versionId}`)
  return version
}

function readIndex(workspacePath: string): HistoryIndex {
  const path = indexPath(workspacePath)
  if (!existsSync(path)) return emptyIndex()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as HistoryIndex
    if (parsed.schemaVersion !== HISTORY_SCHEMA_VERSION || !parsed.files || typeof parsed.files !== 'object') {
      return emptyIndex()
    }
    return parsed
  } catch {
    return emptyIndex()
  }
}

function countVersions(index: HistoryIndex): number {
  return Object.values(index.files).reduce((sum, file) => sum + file.versions.length, 0)
}

function countPrunableVersions(index: HistoryIndex): number {
  let count = 0
  for (const file of Object.values(index.files)) {
    const raw = file.versions
      .map((version, index) => ({ version, index }))
      .sort((a, b) => b.version.at.localeCompare(a.version.at) || b.index - a.index)
      .map(item => item.version)
    count += Math.max(0, raw.length - foldVisibleVersions(raw).length)
  }
  return count
}

function writeIndex(workspacePath: string, index: HistoryIndex): void {
  atomicWriteJson(indexPath(workspacePath), index)
}

function emptyIndex(): HistoryIndex {
  return { schemaVersion: HISTORY_SCHEMA_VERSION, files: {} }
}

function historyDir(workspacePath: string): string {
  return join(workspacePath, '.mim', 'history')
}

function indexPath(workspacePath: string): string {
  return join(historyDir(workspacePath), 'index.json')
}

function blobPath(workspacePath: string, hash: string): string {
  return join(historyDir(workspacePath), 'blobs', hash.slice(0, 2), hash)
}

function writeBlob(workspacePath: string, hash: string, buffer: Buffer): void {
  const path = blobPath(workspacePath, hash)
  if (existsSync(path)) return
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, buffer)
}

function readBlob(workspacePath: string, hash: string): Buffer {
  return readFileSync(blobPath(workspacePath, hash))
}

function collectGarbageBlobs(workspacePath: string, index: HistoryIndex): number {
  const used = new Set<string>()
  for (const file of Object.values(index.files)) {
    for (const version of file.versions) if (version.hash) used.add(version.hash)
  }
  const root = join(historyDir(workspacePath), 'blobs')
  let removed = 0
  function walk(dir: string): void {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        try { readdirSync(fullPath).length === 0 && rmdirSync(fullPath) } catch { /* best effort */ }
        continue
      }
      if (!entry.isFile()) continue
      if (used.has(entry.name)) continue
      try {
        unlinkSync(fullPath)
        removed++
      } catch {
        // Best-effort garbage collection.
      }
    }
  }
  walk(root)
  return removed
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function versionId(path: string, hash: string, atMs: number, index: number, event: string): string {
  return createHash('sha1')
    .update(`${path}\n${hash}\n${atMs}\n${index}\n${event}`)
    .digest('hex')
    .slice(0, 16)
}

function isHistoryEligibleForWorkspace(workspacePath: string, relPath: string): boolean {
  return isHistoryEligiblePath(relPath) && !loadIgnoreMatcher(workspacePath)(relPath)
}

function shouldSkipGenerated(relPath: string): boolean {
  return normalizeRelPath(relPath).split('/').some(segment => GENERATED_SEGMENTS.has(segment))
}

function loadIgnoreMatcher(workspacePath: string): (relPath: string) => boolean {
  const patterns = [
    ...readIgnorePatterns(join(workspacePath, '.gitignore')),
    ...readIgnorePatterns(join(workspacePath, '.mim', 'historyignore')),
  ]
  return (relPath: string) => {
    const normalized = normalizeRelPath(relPath)
    return patterns.some(pattern => matchesIgnorePattern(normalized, pattern))
  }
}

function readIgnorePatterns(path: string): string[] {
  try {
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf-8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('!'))
  } catch {
    return []
  }
}

function matchesIgnorePattern(relPath: string, rawPattern: string): boolean {
  let pattern = normalizeRelPath(rawPattern)
  if (!pattern) return false
  if (pattern.startsWith('/')) pattern = pattern.slice(1)
  if (pattern.endsWith('/')) {
    const dir = pattern.slice(0, -1)
    return relPath === dir || relPath.startsWith(`${dir}/`) || relPath.split('/').includes(dir)
  }
  if (pattern.includes('*')) return globToRegex(pattern).test(relPath)
  if (pattern.includes('/')) return relPath === pattern || relPath.startsWith(`${pattern}/`)
  return relPath.split('/').includes(pattern) || basename(relPath) === pattern
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map(part => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
    .join('.*')
  return new RegExp(`(^|/)${escaped}($|/)`)
}

function normalizeWorkspaceRelPath(workspacePath: string, path: string): string {
  if (isAbsolute(path)) {
    const rel = relative(resolve(workspacePath), resolve(path))
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside workspace')
    return normalizeRelPath(rel)
  }
  const rel = normalizeRelPath(path)
  if (!rel || rel === '..' || rel.startsWith('../')) throw new Error('Path is outside workspace')
  return rel
}

function resolveWorkspaceFilePath(workspacePath: string, relPath: string): string {
  const root = resolve(workspacePath)
  const resolved = resolve(root, relPath)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside workspace')
  return resolved
}

function resolvesOutsideWorkspace(workspacePath: string, filePath: string): boolean {
  try {
    const root = resolve(workspacePath)
    const real = resolve(filePath)
    const rel = relative(root, real)
    return rel.startsWith('..') || isAbsolute(rel)
  } catch {
    return true
  }
}

function normalizeRelPath(path: string): string {
  return path.split('\\').join('/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}

function extensionOf(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

function actorFromContext(ctx: ToolContext): HistoryActor {
  if (ctx.actor === 'ai') return 'agent'
  if (ctx.actor === 'package') return 'package'
  if (ctx.actor === 'system') return 'system'
  return 'user'
}

function metaFromContext(
  ctx: ToolContext,
  actor: HistoryActor,
  event: HistoryEvent,
  tool: string,
  anchor: boolean,
): HistoryCaptureMeta {
  return {
    actor,
    event,
    anchor,
    tool,
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
    ...(ctx.spanId ? { spanId: ctx.spanId } : {}),
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    ...(ctx.package_id ? { packageId: ctx.package_id } : {}),
  }
}

function copiedTo(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined
  const copied = result.copied
  if (!isRecord(copied)) return undefined
  return typeof copied.to === 'string' ? copied.to : undefined
}

function importedPath(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined
  return typeof result.imported === 'string' ? result.imported : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function statsSafe(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function directorySize(path: string): number {
  const stat = statsSafe(path)
  if (!stat) return 0
  if (stat.isFile()) return stat.size
  if (!stat.isDirectory()) return 0
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += directorySize(join(path, entry.name))
  }
  return total
}
