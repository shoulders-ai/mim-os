import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@main/atomicJson.js'

/**
 * Lightweight session metadata stored in a single manifest file so
 * session.list never has to parse full message bodies.
 *
 * The manifest is a _cache_ of metadata already present in the individual
 * session JSON files. It self-heals when missing or corrupt. Individual
 * session files remain the source of truth for session.get.
 *
 * Designed for composability with future incremental turn-saving: the
 * manifest tracks per-session metadata independently of message storage.
 */

export interface ManifestEntry {
  id: string
  label: string
  modelId: string
  controlId: string
  usage: { inputTokens: number; outputTokens: number; estimatedCost: number }
  lastContextTokens: number
  lastInputTokens: number
  archived: boolean
  sortOrder?: number
  taskLabelGenerated?: boolean
  agentId?: string
  createdAt: string
  updatedAt: string
}

export type Manifest = Record<string, ManifestEntry>

const MANIFEST_FILE = '_manifest.json'

function manifestPath(sessionsDir: string): string {
  return join(sessionsDir, MANIFEST_FILE)
}

/**
 * Read the manifest from disk. Returns null if missing or corrupt.
 */
export function readManifestFile(sessionsDir: string): Manifest | null {
  const path = manifestPath(sessionsDir)
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Manifest
  } catch {
    return null
  }
}

/**
 * Build a manifest by scanning individual session files.
 * Used for self-healing when the manifest is missing or corrupt.
 */
export function rebuildManifest(sessionsDir: string): Manifest {
  const manifest: Manifest = {}

  if (!existsSync(sessionsDir)) return manifest

  const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json') && f !== MANIFEST_FILE)

  for (const file of files) {
    const filePath = join(sessionsDir, file)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const session = JSON.parse(raw)
      if (!session.id) continue
      manifest[session.id] = extractManifestEntry(session)
    } catch {
      // Skip corrupt files — the list tool handles quarantine
    }
  }

  return manifest
}

/**
 * Read the manifest, self-healing from individual session files if needed.
 * Writes the rebuilt manifest to disk when self-healing occurs.
 */
export function loadManifest(sessionsDir: string): Manifest {
  const existing = readManifestFile(sessionsDir)
  if (existing !== null) return existing

  const rebuilt = rebuildManifest(sessionsDir)
  try {
    writeManifest(sessionsDir, rebuilt)
  } catch {
    // Best-effort write; the manifest is a cache
  }
  return rebuilt
}

/**
 * Write the full manifest to disk atomically.
 */
export function writeManifest(sessionsDir: string, manifest: Manifest): void {
  atomicWriteJson(manifestPath(sessionsDir), manifest)
}

/**
 * Update a single entry in the manifest (read-modify-write).
 */
export function upsertManifestEntry(sessionsDir: string, id: string, entry: ManifestEntry): void {
  const manifest = loadManifest(sessionsDir)
  manifest[id] = entry
  writeManifest(sessionsDir, manifest)
}

/**
 * Remove a single entry from the manifest.
 */
export function removeManifestEntry(sessionsDir: string, id: string): void {
  const manifest = loadManifest(sessionsDir)
  delete manifest[id]
  writeManifest(sessionsDir, manifest)
}

/**
 * Extract a ManifestEntry from a full session object (strips messages).
 */
export function extractManifestEntry(session: Record<string, unknown>): ManifestEntry {
  const usage = (session.usage as Record<string, number>) ?? {}
  const entry: ManifestEntry = {
    id: session.id as string,
    label: (session.label as string) || '',
    modelId: (session.modelId as string) || '',
    controlId: (session.controlId as string) || '',
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      estimatedCost: usage.estimatedCost ?? 0,
    },
    lastContextTokens: typeof session.lastContextTokens === 'number' ? session.lastContextTokens : 0,
    lastInputTokens: typeof session.lastInputTokens === 'number' ? session.lastInputTokens : 0,
    archived: !!session.archived,
    createdAt: (session.createdAt as string) || new Date().toISOString(),
    updatedAt: (session.updatedAt as string) || new Date().toISOString(),
  }
  if (typeof session.sortOrder === 'number') entry.sortOrder = session.sortOrder
  if (session.taskLabelGenerated === true) entry.taskLabelGenerated = true
  if (typeof session.agentId === 'string') entry.agentId = session.agentId
  return entry
}

/**
 * Get the mtime of a session file, or null if missing.
 */
export function sessionFileMtime(sessionsDir: string, sessionId: string): number | null {
  const path = join(sessionsDir, `${sessionId}.json`)
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}
