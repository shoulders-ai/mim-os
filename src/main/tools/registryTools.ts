// Registry tools: registry.list walks multi-source registries (registrySources),
// enriches entries with install state and shadowing, and handles trust gating.
// registry.trust acks workspace registry trust via the enablement store.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import { pullRepo } from '@main/git.js'
import { registryMirrorDir } from '@main/packages/cacheLayout.js'
import type { RegistryEntry } from '@main/packages/registryIndex.js'
import { parsePackageManifest } from '@main/packages/packageManifest.js'
import { isValidSemver } from '@main/packages/semver.js'
import {
  registrySources,
  readSourceIndex,
  type RegistrySource,
  type RegistrySourcesDeps,
} from '@main/packages/registrySources.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import type { PackageLoader } from '@main/packages/packages.js'
import type { PackageEnablementStore } from '@main/packages/packageEnablement.js'
import { checkForUpdates } from '@main/packages/updateCheck.js'

export interface RegistryToolDeps {
  packages: PackageLoader
  enablement: PackageEnablementStore
  cacheRoot: string
  globalDir: string
  getWorkspacePath: () => string | null
  getAccountToken?: () => string | null
}

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/
const RESERVED_SOURCE_IDS = new Set(['default', 'user'])

export function registerRegistryTools(
  tools: ToolRegistry,
  deps: RegistryToolDeps,
): void {
  const sourceDeps: RegistrySourcesDeps = deps.getAccountToken
    ? { getAccountToken: deps.getAccountToken }
    : {}

  tools.register({
    name: 'registry.list',
    description: 'List packages available across all configured registries, with install state and shadowing.',
    execute: async () => {
      const workspacePath = deps.getWorkspacePath()
      const sources = registrySources(workspacePath, sourceDeps)

      const registries: RegistryListSourceStatus[] = []
      // Entries keyed by source index order; first trusted ok/stale source owning an id wins.
      const allEntries: EnrichedEntry[] = []
      // Track which source owns each package id (first trusted source with the id).
      const ownerByPackageId = new Map<string, string>()

      for (const source of sources) {
        const sourceStatus: RegistryListSourceStatus = {
          id: source.id,
          kind: source.kind,
          location: source.location,
          name: source.name,
          origin: source.origin,
          status: 'ok',
          diagnostics: [],
        }

        // Workspace sources require trust ack before contributing entries.
        if (source.origin === 'workspace' && !deps.enablement.isRegistryTrusted(source)) {
          sourceStatus.status = 'needs-trust'
          registries.push(sourceStatus)
          continue
        }

        let result: Awaited<ReturnType<typeof readSourceIndex>>

        if (source.kind === 'url') {
          // Fetch index.json directly via HTTPS.
          result = await readSourceIndex(source, { cacheRoot: deps.cacheRoot, sync: true })
          if (result.status === 'error' || result.status === 'missing') {
            // Fetch failed — try stale cache
            const staleResult = await readSourceIndex(source, { cacheRoot: deps.cacheRoot })
            if (staleResult.status === 'ok' || staleResult.entries.length > 0) {
              result = staleResult
              sourceStatus.status = 'stale'
              sourceStatus.diagnostics.push(`Registry fetch failed, using cached index`)
            } else {
              sourceStatus.status = 'error'
              sourceStatus.diagnostics.push(...result.diagnostics)
              registries.push(sourceStatus)
              continue
            }
          }
        } else if (source.kind === 'git') {
          // Refresh the mirror: clone if absent, pull if present.
          // Registry mirrors stay on default branches so pullRepo is correct
          // (contrast with install.ts tag mirrors which use fetch+checkout).
          try {
            result = await syncAndReadGitSource(source, deps.cacheRoot)
          } catch (err) {
            // Sync failed — try stale mirror
            const staleResult = await readSourceIndex(source, { cacheRoot: deps.cacheRoot })
            if (staleResult.status === 'ok' || staleResult.entries.length > 0) {
              result = staleResult
              sourceStatus.status = 'stale'
              sourceStatus.error = (err as Error).message
              sourceStatus.diagnostics.push(`Registry sync failed, using stale mirror: ${(err as Error).message}`)
            } else {
              sourceStatus.status = 'error'
              sourceStatus.error = (err as Error).message
              sourceStatus.diagnostics.push(`Registry sync failed: ${(err as Error).message}`)
              registries.push(sourceStatus)
              continue
            }
          }
          // readSourceIndex may have returned an error status even though sync succeeded
          // (e.g. missing or unparseable index.json after clone).
          if (result!.status === 'error' || result!.status === 'missing') {
            sourceStatus.status = 'error'
            sourceStatus.diagnostics.push(...result!.diagnostics)
            registries.push(sourceStatus)
            continue
          }
        } else {
          // Local source: read index.json directly via readSourceIndex.
          result = await readSourceIndex(source, { cacheRoot: deps.cacheRoot })
          if (result.status === 'error' || result.status === 'missing') {
            sourceStatus.status = 'error'
            sourceStatus.diagnostics.push(...result.diagnostics)
            if (result.status === 'missing') {
              sourceStatus.diagnostics.push(`Local registry "${source.id}" has no index.json at ${source.location}`)
            }
            registries.push(sourceStatus)
            continue
          }
        }

        if (sourceStatus.status === 'ok') {
          sourceStatus.diagnostics.push(...result.diagnostics)
        }
        registries.push(sourceStatus)

        // Enrich entries with install state and shadowing.
        for (const entry of result.entries) {
          const enriched = enrichEntry(entry, deps, source.id)

          const existingOwner = ownerByPackageId.get(entry.id)
          if (existingOwner && existingOwner !== source.id) {
            // This id is already owned by a higher-precedence source.
            // (Multiple versions within the owning source are NOT shadowed.)
            enriched.shadowed = true
            enriched.shadowedBy = existingOwner
          } else if (!existingOwner) {
            // This source owns the id (first trusted source with status ok/stale).
            // Ownership rule: see registrySources.ts for the anti-dependency-confusion property.
            ownerByPackageId.set(entry.id, source.id)
          }

          allEntries.push(enriched)
        }
      }

      return { registries, entries: allEntries }
    },
  })

  tools.register({
    name: 'registry.trust',
    description: 'Acknowledge trust for a workspace-declared registry source.',
    execute: async (params) => {
      const id = typeof params.id === 'string' ? params.id : ''
      if (!id) throw new Error('registry.trust requires an id parameter')

      const workspacePath = deps.getWorkspacePath()
      const sources = registrySources(workspacePath, sourceDeps)
      const source = sources.find(s => s.id === id)

      if (!source) throw new Error(`Unknown registry source: ${id}`)
      if (source.origin !== 'workspace') {
        throw new Error(`Registry "${id}" does not need trust acknowledgement (origin: ${source.origin})`)
      }

      deps.enablement.ackRegistryTrust(source)
      return { trusted: id }
    },
  })

  tools.register({
    name: 'app.updates',
    description: 'Check for available package updates by comparing installed versions against registry mirrors.',
    execute: async () => {
      return checkForUpdates({
        workspacePath: deps.getWorkspacePath(),
        cacheRoot: deps.cacheRoot,
        globalDir: deps.globalDir,
        isSourceTrusted: (s) => deps.enablement.isRegistryTrusted(s),
        getAccountToken: deps.getAccountToken ?? undefined,
      })
    },
  })

  // ---------------------------------------------------------------------------
  // Machine-local registry source management
  // ---------------------------------------------------------------------------

  tools.register({
    name: 'registry.inspectSource',
    description: 'Inspect a local folder before adding it as a machine-local registry source. Validates the path, reads index.json or auto-discovers packages.',
    execute: async (params) => {
      const path = typeof params.path === 'string' ? params.path : ''
      if (!path) throw new Error('registry.inspectSource requires a path parameter')
      if (!isAbsolute(path)) throw new Error(`Path must be absolute, got: ${path}`)
      if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`)

      let stat
      try { stat = statSync(path) } catch { throw new Error(`Cannot stat path: ${path}`) }
      if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${path}`)

      let id = typeof params.id === 'string' ? params.id : ''
      if (!id) {
        const lastSegment = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
        id = lastSegment.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/^-+/, '').replace(/-+$/, '')
      }
      if (!SOURCE_ID_RE.test(id)) throw new Error(`Invalid source id "${id}" — must match ${SOURCE_ID_RE}`)

      const name = typeof params.name === 'string' ? params.name : undefined

      const source: RegistrySource = { id, kind: 'local', location: path, name, origin: 'machine' }
      const result = await readSourceIndex(source, { cacheRoot: deps.cacheRoot })

      // If index.json exists and parsed (even with errors), use it.
      if (result.status === 'ok' || result.status === 'error') {
        return {
          id, name, kind: 'local' as const, location: path,
          appCount: result.entries.length,
          apps: result.entries.map(e => ({ id: e.id, name: e.name, description: e.description, version: e.version })),
          diagnostics: result.diagnostics, status: result.status,
        }
      }

      // No index.json — auto-discover packages from the folder.
      const discovered = discoverPackagesInFolder(path)
      return {
        id, name, kind: 'local' as const, location: path,
        appCount: discovered.apps.length,
        apps: discovered.apps,
        diagnostics: discovered.diagnostics,
        status: discovered.apps.length > 0 ? 'ok' : 'missing',
        generated: true,
      }
    },
  })

  tools.register({
    name: 'registry.addSource',
    description: 'Write a local folder as a machine-local registry source to .mim/registries.json. Auto-generates index.json if missing.',
    execute: async (params) => {
      if (params.confirmed !== true) {
        throw new Error('registry.addSource requires confirmed: true — inspect the source first')
      }

      const id = typeof params.id === 'string' ? params.id : ''
      if (!id) throw new Error('registry.addSource requires an id parameter')
      if (!SOURCE_ID_RE.test(id)) throw new Error(`Invalid source id "${id}" — must match ${SOURCE_ID_RE}`)
      if (RESERVED_SOURCE_IDS.has(id)) throw new Error(`Cannot use reserved id "${id}"`)

      const path = typeof params.path === 'string' ? params.path : ''
      if (!path) throw new Error('registry.addSource requires a path parameter')
      if (!isAbsolute(path)) throw new Error(`Path must be absolute, got: ${path}`)
      if (!existsSync(path)) throw new Error(`Path does not exist: ${path}`)

      const workspacePath = deps.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace is open')

      // Auto-generate index.json if missing so the registry system can read it.
      const indexPath = join(path, 'index.json')
      if (!existsSync(indexPath)) {
        const discovered = discoverPackagesInFolder(path)
        if (discovered.apps.length > 0) {
          const index = {
            manifestVersion: 1,
            packages: discovered.apps.map(app => ({
              id: app.id, name: app.name, description: app.description,
              dir: app.dir, version: app.version, permissions: app.permissions ?? {},
            })),
          }
          writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n')
        }
      }

      const name = typeof params.name === 'string' ? params.name : undefined

      const registriesPath = join(workspacePath, '.mim', 'registries.json')
      let data: Record<string, unknown> = {}
      if (existsSync(registriesPath)) {
        try {
          data = JSON.parse(readFileSync(registriesPath, 'utf-8')) as Record<string, unknown>
        } catch {
          data = {}
        }
      }
      if (!data.registries || typeof data.registries !== 'object' || Array.isArray(data.registries)) {
        data.registries = {}
      }
      const registries = data.registries as Record<string, unknown>
      registries[id] = { ...(name ? { name } : {}), path }

      mkdirSync(dirname(registriesPath), { recursive: true })
      writeFileSync(registriesPath, JSON.stringify(data, null, 2) + '\n')

      return { added: id, path }
    },
  })

  tools.register({
    name: 'registry.removeSource',
    description: 'Remove a machine-local registry source from .mim/registries.json.',
    execute: async (params) => {
      const id = typeof params.id === 'string' ? params.id : ''
      if (!id) throw new Error('registry.removeSource requires an id parameter')
      if (RESERVED_SOURCE_IDS.has(id)) throw new Error(`Cannot remove reserved id "${id}"`)

      const workspacePath = deps.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace is open')

      const registriesPath = join(workspacePath, '.mim', 'registries.json')
      if (!existsSync(registriesPath)) {
        return { removed: id }
      }

      let data: Record<string, unknown>
      try {
        data = JSON.parse(readFileSync(registriesPath, 'utf-8')) as Record<string, unknown>
      } catch {
        return { removed: id }
      }

      if (!data.registries || typeof data.registries !== 'object' || Array.isArray(data.registries)) {
        return { removed: id }
      }

      const registries = data.registries as Record<string, unknown>
      delete registries[id]

      writeFileSync(registriesPath, JSON.stringify(data, null, 2) + '\n')

      return { removed: id }
    },
  })
}

// ---------------------------------------------------------------------------
// Git source sync + read
// ---------------------------------------------------------------------------

async function syncAndReadGitSource(
  source: RegistrySource,
  cacheRoot: string,
): Promise<Awaited<ReturnType<typeof readSourceIndex>>> {
  const mirrorDir = registryMirrorDir(source.location, cacheRoot)
  if (existsSync(mirrorDir)) {
    // Pull throws on network failure so the caller's catch block handles stale fallback.
    await pullRepo(mirrorDir)
    return readSourceIndex(source, { cacheRoot })
  }
  // First sync: clone via readSourceIndex with sync: true.
  // readSourceIndex returns status 'error' on clone failure rather than throwing,
  // so re-throw to trigger the stale fallback path.
  const cloneResult = await readSourceIndex(source, { cacheRoot, sync: true })
  if (cloneResult.status === 'error') {
    throw new Error(cloneResult.diagnostics[0] ?? 'Clone failed')
  }
  return cloneResult
}

// ---------------------------------------------------------------------------
// Entry enrichment
// ---------------------------------------------------------------------------

interface RegistryListSourceStatus {
  id: string
  kind: 'git' | 'local' | 'url'
  location: string
  name?: string
  origin: string
  status: 'ok' | 'stale' | 'error' | 'needs-trust'
  error?: string
  diagnostics: string[]
}

interface EnrichedEntry extends RegistryEntry {
  registryId: string
  installedVersions: string[]
  enabledHere: boolean
  permissionMismatch: boolean
  shadowed?: boolean
  shadowedBy?: string
}

function enrichEntry(entry: RegistryEntry, deps: RegistryToolDeps, registryId: string): EnrichedEntry {
  const installedVersions = listInstalledVersions(entry.id, deps.globalDir)
  const pkg = deps.packages.get(entry.id)
  const enabledHere = pkg ? deps.enablement.isEnabled(pkg) : false

  let permissionMismatch = false
  if (pkg) {
    permissionMismatch = !deepEqual(pkg.manifest.permissions, entry.permissions)
  }

  return {
    ...entry,
    registryId,
    installedVersions,
    enabledHere,
    permissionMismatch,
  }
}

// List version dirs under ~/.mim/packages/<id>/ that pass isValidSemver.
export function listInstalledVersions(id: string, globalDir: string): string[] {
  const idDir = join(globalDir, id)
  if (!existsSync(idDir)) return []
  try {
    return readdirSync(idDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && isValidSemver(d.name))
      .map(d => d.name)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Auto-discover packages from a folder (no index.json required)
// ---------------------------------------------------------------------------

interface DiscoveredApp {
  id: string
  name: string
  description?: string
  dir: string
  version: string
  permissions: Record<string, unknown>
}

function discoverPackagesInFolder(root: string): { apps: DiscoveredApp[]; diagnostics: string[] } {
  const apps: DiscoveredApp[] = []
  const diagnostics: string[] = []

  // Scan for package.json files: check root, then immediate children, then packages/<dir>/
  const candidates: Array<{ dir: string; relDir: string }> = []

  // 1. Root itself might be a single package
  if (existsSync(join(root, 'package.json'))) {
    candidates.push({ dir: root, relDir: '.' })
  }

  // 2. Immediate child directories
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const childDir = join(root, entry.name)
      if (existsSync(join(childDir, 'package.json'))) {
        candidates.push({ dir: childDir, relDir: entry.name })
      }
      // 3. Two-level: packages/<id>/ or <folder>/<id>/
      try {
        for (const sub of readdirSync(childDir, { withFileTypes: true })) {
          if (!sub.isDirectory() || sub.name.startsWith('.') || sub.name === 'node_modules') continue
          const subDir = join(childDir, sub.name)
          if (existsSync(join(subDir, 'package.json'))) {
            candidates.push({ dir: subDir, relDir: `${entry.name}/${sub.name}` })
          }
        }
      } catch { /* unreadable child dir */ }
    }
  } catch (err) {
    diagnostics.push(`Could not scan folder: ${(err as Error).message}`)
    return { apps, diagnostics }
  }

  for (const { dir, relDir } of candidates) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as Record<string, unknown>
      const { manifest } = parsePackageManifest(raw, dir)
      if (!manifest) continue
      apps.push({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        dir: relDir === '.' ? '.' : relDir,
        version: manifest.version,
        permissions: manifest.permissions as unknown as Record<string, unknown>,
      })
    } catch { /* not a valid mim package */ }
  }

  if (!apps.length) {
    diagnostics.push('No packages with a valid mim manifest found in this folder')
  }

  return { apps, diagnostics }
}

// Minimal deep-equal for permission objects (plain JSON values).
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bArr = b as unknown[]
    if (a.length !== bArr.length) return false
    return a.every((v, i) => deepEqual(v, bArr[i]))
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj).sort()
  const bKeys = Object.keys(bObj).sort()
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((k, i) => k === bKeys[i] && deepEqual(aObj[k], bObj[k]))
}
