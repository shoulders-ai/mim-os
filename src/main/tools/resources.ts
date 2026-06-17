// Shared resource collection management. File access inside mounts goes
// through the ordinary fs.* tools; these tools only manage the collections
// themselves (registry, mounts, git mirrors). See docs/resources.md.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, isAbsolute, join } from 'path'
import { cloneRepo, pullRepo } from '@main/git.js'
import {
  readResourceBindings,
  resolveCollections,
  syncMounts,
  writeResourceBindings,
  type ResourceCollection,
} from '@main/resources/resourceModel.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import {
  COLLECTION_ID_PATTERN,
  parseMimYaml,
  serializeMimYaml,
  type CollectionWritePolicy,
  type MimConfig,
} from '@main/workspace/workspaceContract.js'

export interface ResourceToolOptions {
  mirrorsDir: string
  emit?: (channel: string) => void
}

interface SyncResult {
  id: string
  action: 'cloned' | 'pulled' | 'refreshed'
  ok: boolean
  error?: string
}

export function registerResourceTools(tools: ToolRegistry, options: ResourceToolOptions): void {
  const { mirrorsDir } = options

  function workspaceDir(): string {
    const dir = tools.getWorkspacePath()
    if (!dir) throw new Error('No workspace open')
    return dir
  }

  function readConfig(dir: string): MimConfig {
    const path = join(dir, 'mim.yaml')
    if (!existsSync(path)) return { name: '' }
    return parseMimYaml(readFileSync(path, 'utf-8'))
  }

  // Round-trips parse → serialize like setAppEnabled: comments and unknown
  // top-level keys in mim.yaml are not preserved by this v1 path.
  function writeConfig(dir: string, config: MimConfig): void {
    writeFileSync(join(dir, 'mim.yaml'), serializeMimYaml(config))
  }

  function resolveAll(dir: string): ResourceCollection[] {
    return resolveCollections({
      workspaceDir: dir,
      config: readConfig(dir),
      bindings: readResourceBindings(dir),
      mirrorsDir,
    })
  }

  function refresh(dir: string): ResourceCollection[] {
    const collections = resolveAll(dir)
    syncMounts(dir, collections)
    options.emit?.('resources:changed')
    return collections
  }

  function publicView(collection: ResourceCollection, dir: string) {
    return {
      id: collection.id,
      name: collection.name,
      source: collection.source,
      write: collection.write,
      origin: collection.origin,
      status: collection.status,
      root: collection.root,
      // Workspace-relative slash path agents can use with fs.* directly.
      mountPath: collection.mountPath.startsWith(dir)
        ? collection.mountPath.slice(dir.length + 1).split('\\').join('/')
        : collection.mountPath,
    }
  }

  tools.register({
    name: 'resources.collections',
    description: 'List shared resource collections with source, write policy, status, and mount path. Files inside mounts are read with the normal fs.* tools.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      const dir = workspaceDir()
      const collections = resolveAll(dir)
      syncMounts(dir, collections)
      return { collections: collections.map(c => publicView(c, dir)) }
    },
  })

  tools.register({
    name: 'resources.add',
    description: 'Register a shared resource collection: a local folder (machine-local binding) or a git URL (committed to mim.yaml; run resources.sync to clone). Exactly one of path/git is required.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'kebab-case slug; derived from name when omitted' },
        name: { type: 'string' },
        path: { type: 'string', description: 'absolute path to an existing local folder' },
        git: { type: 'string', description: 'git URL; collection becomes a pull-only readonly mirror' },
        write: { type: 'string', enum: ['readonly', 'direct'], description: 'local folders only; default readonly' },
      },
      required: [],
    },
    execute: async (params) => {
      const dir = workspaceDir()
      const path = optionalString(params, 'path')
      const git = optionalString(params, 'git')
      if ((path === undefined) === (git === undefined)) {
        throw new Error('Provide either path (local folder) or git (repository URL), not both')
      }

      const name = optionalString(params, 'name')
      const id = optionalString(params, 'id') ?? slugify(name ?? (path ? basename(path) : repoSlug(git!)))
      if (!COLLECTION_ID_PATTERN.test(id)) {
        throw new Error(`Invalid collection id "${id}": use a kebab-case slug (a-z, 0-9, -)`)
      }

      const config = readConfig(dir)
      const bindings = readResourceBindings(dir)
      const committed = config.collections?.[id]
      // A committed entry without git is an expectation: adding a path for that
      // id binds it on this machine rather than colliding with it.
      if (bindings.collections[id] || (committed && (git !== undefined || committed.git))) {
        throw new Error(`Collection "${id}" already exists`)
      }

      const write = optionalWritePolicy(params)

      if (git) {
        if (write === 'direct') throw new Error('Git collections are always readonly (pull-only mirrors)')
        config.collections = { ...(config.collections ?? {}), [id]: compact({ name, git }) }
        writeConfig(dir, config)
      } else {
        if (!isAbsolute(path!)) throw new Error('path must be absolute')
        if (!existsSync(path!) || !statSync(path!).isDirectory()) {
          throw new Error(`Folder does not exist: ${path}`)
        }
        bindings.collections[id] = compact({ path: path!, name, write })
        writeResourceBindings(dir, bindings)
      }

      const collections = refresh(dir)
      const collection = collections.find(c => c.id === id)!
      return { collection: publicView(collection, dir) }
    },
  })

  tools.register({
    name: 'resources.setPolicy',
    description: 'Set a collection write policy in place: readonly or direct. Git collections are always readonly.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        write: { type: 'string', enum: ['readonly', 'direct'] },
      },
      required: ['id', 'write'],
    },
    execute: async (params) => {
      const dir = workspaceDir()
      const id = requireString(params, 'id')
      const write = optionalWritePolicy(params)
      if (!write) throw new Error('write must be "readonly" or "direct"')

      const config = readConfig(dir)
      const bindings = readResourceBindings(dir)
      const committed = config.collections?.[id]
      const binding = bindings.collections[id]
      if (!committed && !binding) throw new Error(`Unknown collection: ${id}`)
      if (committed?.git) throw new Error('Git collections are always readonly (pull-only mirrors)')

      // Committed write wins in the merge, so set the policy everywhere the
      // entry exists — otherwise a stale binding value could shadow the change.
      if (committed) {
        config.collections = { ...config.collections, [id]: { ...committed, write } }
        writeConfig(dir, config)
      }
      if (binding) {
        bindings.collections[id] = { ...binding, write }
        writeResourceBindings(dir, bindings)
      }

      const collections = refresh(dir)
      const collection = collections.find(c => c.id === id)!
      return { collection: publicView(collection, dir) }
    },
  })

  tools.register({
    name: 'resources.remove',
    description: 'Unregister a resource collection and remove its mount. Never deletes the source folder or mirror contents.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    execute: async (params) => {
      const dir = workspaceDir()
      const id = requireString(params, 'id')
      const config = readConfig(dir)
      const bindings = readResourceBindings(dir)
      let found = false

      if (config.collections?.[id]) {
        found = true
        const next = { ...config.collections }
        delete next[id]
        config.collections = Object.keys(next).length > 0 ? next : undefined
        writeConfig(dir, config)
      }
      if (bindings.collections[id]) {
        found = true
        delete bindings.collections[id]
        writeResourceBindings(dir, bindings)
      }
      if (!found) throw new Error(`Unknown collection: ${id}`)

      refresh(dir)
      return { removed: id }
    },
  })

  tools.register({
    name: 'resources.sync',
    description: 'Sync resource collections: clone/pull git mirrors and refresh mounts. Without id, syncs all collections.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: [] },
    execute: async (params) => {
      const dir = workspaceDir()
      const id = optionalString(params, 'id')
      const collections = resolveAll(dir)
      const targets = id ? collections.filter(c => c.id === id) : collections
      if (id && targets.length === 0) throw new Error(`Unknown collection: ${id}`)

      const results: SyncResult[] = []
      for (const collection of targets) {
        if (collection.source?.kind !== 'git_repo' || !collection.root) {
          results.push({ id: collection.id, action: 'refreshed', ok: true })
          continue
        }
        try {
          if (existsSync(collection.root)) {
            await pullRepo(collection.root)
            results.push({ id: collection.id, action: 'pulled', ok: true })
          } else {
            mkdirSync(dirname(collection.root), { recursive: true })
            await cloneRepo(collection.source.location, collection.root)
            results.push({ id: collection.id, action: 'cloned', ok: true })
          }
        } catch (err) {
          results.push({ id: collection.id, action: existsSync(collection.root) ? 'pulled' : 'cloned', ok: false, error: (err as Error).message })
        }
      }

      refresh(dir)
      return { results }
    },
  })

  tools.register({
    name: 'resources.resolvePath',
    description: 'Resolve a collection id to its workspace-relative mount path and absolute backing root.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    execute: async (params) => {
      const dir = workspaceDir()
      const id = requireString(params, 'id')
      const collection = resolveAll(dir).find(c => c.id === id)
      if (!collection) throw new Error(`Unknown collection: ${id}`)
      const view = publicView(collection, dir)
      return { mountPath: view.mountPath, root: view.root, status: view.status, write: view.write }
    },
  })
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function repoSlug(gitUrl: string): string {
  const tail = gitUrl.split('/').pop() ?? gitUrl
  return tail.replace(/\.git$/, '')
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) out[key] = child
  }
  return out as T
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string`)
  return value
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key]
  if (value == null) return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function optionalWritePolicy(params: Record<string, unknown>): CollectionWritePolicy | undefined {
  const value = params.write
  if (value == null) return undefined
  if (value !== 'readonly' && value !== 'direct') throw new Error('write must be "readonly" or "direct"')
  return value
}
