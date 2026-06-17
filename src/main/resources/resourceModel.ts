// Shared resource collections: merge committed mim.yaml collections with
// machine-local bindings, and mount the result as symlinks under
// .mim/resources/<id>. No Electron imports — unit-testable. The git mirrors
// dir is injected by the caller (app userData in production).
// See docs/resources.md.

import { createHash } from 'crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import {
  COLLECTION_ID_PATTERN,
  type CollectionWritePolicy,
  type MimConfig,
} from '@main/workspace/workspaceContract.js'

export interface ResourceBinding {
  path: string
  name?: string
  write?: CollectionWritePolicy
}

export interface ResourceBindings {
  collections: Record<string, ResourceBinding>
}

export type CollectionStatus = 'ok' | 'missing-binding' | 'missing-source' | 'not-synced'

export interface ResourceSource {
  kind: 'local_folder' | 'git_repo'
  location: string
}

export interface ResourceCollection {
  id: string
  name: string
  source: ResourceSource | null
  // Effective policy. Git collections are always readonly (pull-only mirrors).
  write: CollectionWritePolicy
  // 'workspace' = declared in committed mim.yaml; 'machine' = personal binding only.
  origin: 'workspace' | 'machine'
  status: CollectionStatus
  // Backing folder the mount points at; null when it cannot be resolved.
  root: string | null
  // Where the symlink lives: <workspace>/.mim/resources/<id>.
  mountPath: string
}

const WRITE_POLICIES: CollectionWritePolicy[] = ['readonly', 'direct']

export const RESOURCE_BINDINGS_FILE = 'resources.json'

export function resourceMountsDir(workspaceDir: string): string {
  return join(workspaceDir, '.mim', 'resources')
}

export function resourceMountSymlinkType(platform: NodeJS.Platform = process.platform): 'dir' | 'junction' {
  return platform === 'win32' ? 'junction' : 'dir'
}

// Tolerant like the rest of the contract surface: a corrupt file means no
// bindings, and individual bad entries are dropped, never thrown on.
export function parseResourceBindings(text: string): ResourceBindings {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { collections: {} }
  }
  if (!raw || typeof raw !== 'object') return { collections: {} }
  const source = (raw as Record<string, unknown>).collections
  const collections: Record<string, ResourceBinding> = {}
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [id, value] of Object.entries(source as Record<string, unknown>)) {
      if (!COLLECTION_ID_PATTERN.test(id)) continue
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as Record<string, unknown>
      if (typeof entry.path !== 'string') continue
      const binding: ResourceBinding = { path: entry.path }
      if (typeof entry.name === 'string') binding.name = entry.name
      if (WRITE_POLICIES.includes(entry.write as CollectionWritePolicy)) {
        binding.write = entry.write as CollectionWritePolicy
      }
      collections[id] = binding
    }
  }
  return { collections }
}

export function serializeResourceBindings(bindings: ResourceBindings): string {
  return JSON.stringify(bindings, null, 2) + '\n'
}

export function readResourceBindings(workspaceDir: string): ResourceBindings {
  const path = join(workspaceDir, '.mim', RESOURCE_BINDINGS_FILE)
  if (!existsSync(path)) return { collections: {} }
  return parseResourceBindings(readFileSync(path, 'utf-8'))
}

export function writeResourceBindings(workspaceDir: string, bindings: ResourceBindings): void {
  const dir = join(workspaceDir, '.mim')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, RESOURCE_BINDINGS_FILE), serializeResourceBindings(bindings), 'utf-8')
}

// One mirror per git URL per machine, shared across workspaces.
export function mirrorDirFor(mirrorsDir: string, gitUrl: string): string {
  const hash = createHash('sha256').update(gitUrl).digest('hex').slice(0, 12)
  return join(mirrorsDir, hash, 'repo')
}

export interface ResolveCollectionsOptions {
  workspaceDir: string
  config: MimConfig
  bindings: ResourceBindings
  mirrorsDir: string
}

export function resolveCollections(options: ResolveCollectionsOptions): ResourceCollection[] {
  const { workspaceDir, config, bindings, mirrorsDir } = options
  const collections: ResourceCollection[] = []
  const committed = config.collections ?? {}

  for (const [id, entry] of Object.entries(committed)) {
    const mountPath = join(resourceMountsDir(workspaceDir), id)
    if (entry.git) {
      const root = mirrorDirFor(mirrorsDir, entry.git)
      collections.push({
        id,
        name: entry.name ?? id,
        source: { kind: 'git_repo', location: entry.git },
        // Pull-only mirrors: a direct write would diverge from origin and be
        // clobbered on the next sync, so git is readonly no matter the config.
        write: 'readonly',
        origin: 'workspace',
        status: existsSync(root) ? 'ok' : 'not-synced',
        root,
        mountPath,
      })
      continue
    }

    const binding = bindings.collections[id]
    if (!binding) {
      collections.push({
        id,
        name: entry.name ?? id,
        source: null,
        write: entry.write ?? 'readonly',
        origin: 'workspace',
        status: 'missing-binding',
        root: null,
        mountPath,
      })
      continue
    }

    collections.push({
      id,
      name: entry.name ?? binding.name ?? id,
      source: { kind: 'local_folder', location: binding.path },
      // The committed policy is the team contract; the binding only fills in
      // when the committed entry is silent.
      write: entry.write ?? binding.write ?? 'readonly',
      origin: 'workspace',
      status: existsSync(binding.path) ? 'ok' : 'missing-source',
      root: binding.path,
      mountPath,
    })
  }

  for (const [id, binding] of Object.entries(bindings.collections)) {
    if (id in committed) continue
    collections.push({
      id,
      name: binding.name ?? id,
      source: { kind: 'local_folder', location: binding.path },
      write: binding.write ?? 'readonly',
      origin: 'machine',
      status: existsSync(binding.path) ? 'ok' : 'missing-source',
      root: binding.path,
      mountPath: join(resourceMountsDir(workspaceDir), id),
    })
  }

  return collections
}

export interface SyncMountsResult {
  mounted: string[]
  removed: string[]
  conflicts: string[]
}

// Reconcile .mim/resources/* symlinks with the resolved collections. Only
// symlinks are ever created or removed; a real file/dir squatting on a mount
// path is reported as a conflict and left untouched.
export function syncMounts(workspaceDir: string, collections: ResourceCollection[]): SyncMountsResult {
  const mountsDir = resourceMountsDir(workspaceDir)
  mkdirSync(mountsDir, { recursive: true })

  const result: SyncMountsResult = { mounted: [], removed: [], conflicts: [] }
  const wanted = new Map<string, ResourceCollection>()
  for (const collection of collections) {
    if (collection.status === 'ok' && collection.root) wanted.set(collection.id, collection)
  }

  for (const entry of readdirSync(mountsDir)) {
    const linkPath = join(mountsDir, entry)
    let stat
    try {
      stat = lstatSync(linkPath)
    } catch {
      continue
    }
    if (!stat.isSymbolicLink()) {
      if (wanted.has(entry)) {
        result.conflicts.push(entry)
        wanted.delete(entry)
      }
      continue
    }
    const collection = wanted.get(entry)
    if (!collection || !collection.root) {
      unlinkSync(linkPath)
      result.removed.push(entry)
      continue
    }
    const target = readlinkSync(linkPath)
    const resolvedTarget = isAbsolute(target) ? resolve(target) : resolve(dirname(linkPath), target)
    if (resolvedTarget !== resolve(collection.root)) {
      unlinkSync(linkPath)
      symlinkSync(collection.root, linkPath, resourceMountSymlinkType())
    }
    result.mounted.push(entry)
    wanted.delete(entry)
  }

  for (const [id, collection] of wanted) {
    symlinkSync(collection.root!, join(mountsDir, id), resourceMountSymlinkType())
    result.mounted.push(id)
  }

  result.mounted.sort()
  result.removed.sort()
  result.conflicts.sort()
  return result
}
