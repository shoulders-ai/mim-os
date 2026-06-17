// Registry tools: registry.list walks multi-source registries (registrySources),
// enriches entries with install state and shadowing, and handles trust gating.
// registry.trust acks workspace registry trust via the enablement store.

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { pullRepo } from '@main/git.js'
import { registryMirrorDir } from '@main/packages/cacheLayout.js'
import type { RegistryEntry } from '@main/packages/registryIndex.js'
import { isValidSemver } from '@main/packages/semver.js'
import {
  registrySources,
  readSourceIndex,
  type RegistrySource,
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
}

export function registerRegistryTools(
  tools: ToolRegistry,
  deps: RegistryToolDeps,
): void {

  tools.register({
    name: 'registry.list',
    description: 'List packages available across all configured registries, with install state and shadowing.',
    execute: async () => {
      const workspacePath = deps.getWorkspacePath()
      const sources = registrySources(workspacePath)

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
      const sources = registrySources(workspacePath)
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
      })
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
