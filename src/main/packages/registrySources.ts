// Registry source resolution: ordered multi-source registry list, async index
// reading, and entry lookup with ownership-based collision rule.
// Security-load-bearing — see inline comments on trust, ownership, and escapes.
// No Electron imports — unit-testable.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, resolve, sep } from 'path'
import { registryMirrorDir, urlIndexCacheFile } from '@main/packages/cacheLayout.js'
import { parseRegistryIndex, type RegistryEntry } from '@main/packages/registryIndex.js'
import { compareSemver } from '@main/packages/semver.js'
import { DEFAULT_REGISTRY_URL, DEFAULT_REGISTRY_INDEX_URL, registryUrl } from '@main/userConfig.js'
import { parseMimYaml } from '@main/workspace/workspaceContract.js'
import { cloneRepo } from '@main/git.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegistrySource {
  id: string                    // 'default' | 'user' | mim.yaml key | registries.json key
  kind: 'git' | 'local' | 'url'
  location: string              // git HTTPS URL, ABSOLUTE directory path, or index.json URL
  name?: string
  origin: 'default' | 'user' | 'workspace' | 'machine'
}

export interface ReadSourceIndexResult {
  entries: RegistryEntry[]
  diagnostics: string[]
  status: 'ok' | 'missing' | 'error'
}

export type LookupResult = RegistryEntry & {
  registryId: string
  registryKind: 'git' | 'local' | 'url'
  registryLocation: string
  /** Absolute package dir for local-dir entries; absent for git/url entries. */
  localPackageDir?: string
}

// ---------------------------------------------------------------------------
// Dependency injection types (same pattern as install.ts)
// ---------------------------------------------------------------------------

export interface RegistrySourcesDeps {
  getUserRegistryUrl?: () => string
  readMimYaml?: (workspacePath: string) => string | null
  readMachineRegistries?: (workspacePath: string) => string | null
}

export interface ReadSourceIndexDeps {
  cloneRepo?: typeof cloneRepo
  fetchUrl?: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>
}

export interface LookupDeps extends RegistrySourcesDeps, ReadSourceIndexDeps {
}

// ---------------------------------------------------------------------------
// registrySources — ordered source list, highest precedence first
// ---------------------------------------------------------------------------

const RESERVED_IDS = new Set(['default', 'user'])

export function registrySources(
  workspacePath: string | null,
  deps?: RegistrySourcesDeps,
): RegistrySource[] {
  const sources: RegistrySource[] = []
  const seenIds = new Set<string>()

  // 1. workspace: mim.yaml registries in YAML order
  if (workspacePath) {
    const yamlText = deps?.readMimYaml
      ? deps.readMimYaml(workspacePath)
      : readMimYamlFromDisk(workspacePath)

    if (yamlText) {
      const config = parseMimYaml(yamlText)
      if (config.registries) {
        for (const [id, entry] of Object.entries(config.registries)) {
          if (RESERVED_IDS.has(id)) continue
          if (seenIds.has(id)) continue

          if (entry.url) {
            sources.push({ id, kind: 'url', location: entry.url, name: entry.name, origin: 'workspace' })
            seenIds.add(id)
          } else if (entry.git) {
            sources.push({ id, kind: 'git', location: entry.git, name: entry.name, origin: 'workspace' })
            seenIds.add(id)
          } else if (entry.path) {
            const abs = resolve(workspacePath, entry.path)
            // Escape guard: resolved path must stay inside workspace.
            if (!(abs + sep).startsWith(resolve(workspacePath) + sep)) continue
            sources.push({ id, kind: 'local', location: abs, name: entry.name, origin: 'workspace' })
            seenIds.add(id)
          }
        }
      }
    }

    // 2. machine: .mim/registries.json
    const machineText = deps?.readMachineRegistries
      ? deps.readMachineRegistries(workspacePath)
      : readMachineRegistriesFromDisk(workspacePath)

    if (machineText) {
      parseMachineRegistries(machineText, seenIds, sources)
    }
  }

  // 3. user: custom registry URL replaces default
  const userUrl = deps?.getUserRegistryUrl ? deps.getUserRegistryUrl() : registryUrl()
  if (userUrl !== DEFAULT_REGISTRY_URL) {
    sources.push({ id: 'user', kind: 'git', location: userUrl, origin: 'user' })
    // Replace semantics: default is omitted when user overrides.
  } else {
    // 4. default — direct HTTPS fetch, no git clone
    sources.push({ id: 'default', kind: 'url', location: DEFAULT_REGISTRY_INDEX_URL, origin: 'default' })
  }

  return sources
}

// ---------------------------------------------------------------------------
// readSourceIndex — read and parse a single source's index.json
// ---------------------------------------------------------------------------

export async function readSourceIndex(
  source: RegistrySource,
  opts: { cacheRoot: string; sync?: boolean },
  deps?: ReadSourceIndexDeps,
): Promise<ReadSourceIndexResult> {
  const doClone = deps?.cloneRepo ?? cloneRepo
  const doFetch = deps?.fetchUrl ?? defaultFetch

  if (source.kind === 'url') {
    const cacheFile = urlIndexCacheFile(source.location, opts.cacheRoot)

    if (opts.sync) {
      try {
        const res = await doFetch(source.location)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        const raw = JSON.parse(text)
        mkdirSync(dirname(cacheFile), { recursive: true })
        writeFileSync(cacheFile, text)
        const parsed = parseRegistryIndex(raw, { allowLocalDirs: false })
        return {
          entries: parsed.entries,
          diagnostics: parsed.diagnostics,
          status: parsed.diagnostics.length > 0 && parsed.entries.length === 0 ? 'error' : 'ok',
        }
      } catch (err) {
        return {
          entries: [],
          diagnostics: [`Failed to fetch registry "${source.id}" from ${source.location}: ${(err as Error).message}`],
          status: 'error',
        }
      }
    }

    // sync: false/undefined — read from cache
    if (existsSync(cacheFile)) {
      return readIndexFile(cacheFile, false, source.id)
    }
    return { entries: [], diagnostics: [], status: 'missing' }
  }

  if (source.kind === 'git') {
    const mirrorDir = registryMirrorDir(source.location, opts.cacheRoot)
    if (!existsSync(mirrorDir)) {
      if (opts.sync) {
        try {
          mkdirSync(dirname(mirrorDir), { recursive: true })
          await doClone(source.location, mirrorDir)
        } catch (err) {
          return {
            entries: [],
            diagnostics: [`Failed to clone registry "${source.id}": ${(err as Error).message}`],
            status: 'error',
          }
        }
      } else {
        return { entries: [], diagnostics: [], status: 'missing' }
      }
    }
    return readIndexFile(join(mirrorDir, 'index.json'), false, source.id)
  }

  // local source: read directly
  return readIndexFile(join(source.location, 'index.json'), true, source.id)
}

async function defaultFetch(url: string): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  return fetch(url)
}

// ---------------------------------------------------------------------------
// lookupRegistryEntry — walk sources with ownership rule
// ---------------------------------------------------------------------------

export async function lookupRegistryEntry(
  id: string,
  opts: {
    workspacePath: string | null
    cacheRoot: string
    version?: string
    isSourceTrusted?: (s: RegistrySource) => boolean
  },
  deps?: LookupDeps,
): Promise<LookupResult | undefined> {
  const sources = registrySources(opts.workspacePath, deps)

  for (const source of sources) {
    // TRUST GATE — fail closed: workspace sources require an explicit trust
    // predicate. If no predicate is provided, workspace sources are skipped
    // entirely so that an untrusted mim.yaml cannot inject packages.
    if (source.origin === 'workspace') {
      if (!opts.isSourceTrusted || !opts.isSourceTrusted(source)) continue
    }

    const result = await readSourceIndex(source, { cacheRoot: opts.cacheRoot, sync: true }, deps)
    if (result.status !== 'ok') continue

    // OWNERSHIP RULE (security-critical): the first source whose index
    // contains ANY entry with this id owns the id. We return the matching
    // version from this source, or undefined — we NEVER fall through to a
    // lower-precedence source. This is the anti-dependency-confusion
    // property: a workspace registry that claims an id prevents the default
    // registry from supplying it, even for versions it doesn't have.
    const matching = result.entries.filter(e => e.id === id)
    if (matching.length === 0) continue

    // This source owns the id. Pick the requested version or highest.
    let picked: RegistryEntry | undefined
    if (opts.version) {
      picked = matching.find(e => e.version === opts.version)
    } else {
      picked = matching.sort((a, b) => compareSemver(b.version, a.version))[0]
    }

    if (!picked) return undefined // owned but version not found

    const out: LookupResult = {
      ...picked,
      registryId: source.id,
      registryKind: source.kind,
      registryLocation: source.location,
    }

    // For local-dir entries, resolve the absolute package dir with escape guard.
    if (picked.dir && source.kind === 'local') {
      const abs = join(source.location, picked.dir)
      if (!(resolve(abs) + sep).startsWith(resolve(source.location) + sep)) {
        return undefined // dir escapes source location
      }
      out.localPackageDir = resolve(abs)
    }

    return out
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readMimYamlFromDisk(workspacePath: string): string | null {
  const path = join(workspacePath, 'mim.yaml')
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function readMachineRegistriesFromDisk(workspacePath: string): string | null {
  const path = join(workspacePath, '.mim', 'registries.json')
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

function parseMachineRegistries(
  text: string,
  seenIds: Set<string>,
  sources: RegistrySource[],
): void {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return // corrupt file → silently ignored
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const registries = (raw as Record<string, unknown>).registries
  if (!registries || typeof registries !== 'object' || Array.isArray(registries)) return

  for (const [id, value] of Object.entries(registries as Record<string, unknown>)) {
    if (RESERVED_IDS.has(id)) continue
    if (seenIds.has(id)) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    const name = typeof entry.name === 'string' ? entry.name : undefined
    if (typeof entry.url === 'string') {
      try {
        const u = new URL(entry.url)
        if (u.protocol !== 'https:') continue
      } catch { continue }
      sources.push({ id, kind: 'url', location: entry.url, name, origin: 'machine' })
      seenIds.add(id)
      continue
    }
    if (typeof entry.path !== 'string') continue
    const path = entry.path as string
    // Non-absolute paths dropped.
    if (!isAbsolute(path)) continue
    sources.push({ id, kind: 'local', location: path, name, origin: 'machine' })
    seenIds.add(id)
  }
}

function readIndexFile(
  indexPath: string,
  allowLocalDirs: boolean,
  sourceId: string,
): ReadSourceIndexResult {
  if (!existsSync(indexPath)) {
    return { entries: [], diagnostics: [], status: 'missing' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(indexPath, 'utf-8'))
  } catch (err) {
    return {
      entries: [],
      diagnostics: [`Registry "${sourceId}": failed to parse index.json: ${(err as Error).message}`],
      status: 'error',
    }
  }
  const parsed = parseRegistryIndex(raw, { allowLocalDirs })
  return {
    entries: parsed.entries,
    diagnostics: parsed.diagnostics,
    status: parsed.diagnostics.length > 0 && parsed.entries.length === 0 ? 'error' : 'ok',
  }
}
