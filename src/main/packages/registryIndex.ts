import { isValidSemver } from '@main/packages/semver.js'

const GIT_SHA_RE = /^[0-9a-f]{40}$/

// Each segment must start with an alphanumeric, which also excludes "." and
// ".." segments — the traversal guard for monorepo subdirectory installs.
const PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Validate a repo-relative package path (e.g. "packages/slides"). */
export function isValidPackagePath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false
  return path.split('/').every(segment => PATH_SEGMENT_RE.test(segment))
}

const HASH_RE = /^sha256:[0-9a-f]{64}$/

export interface RegistryEntry {
  id: string
  name: string
  description?: string
  repo?: string
  /** Repo-relative subdirectory holding the package; repo root when absent. */
  path?: string
  /** Registry-relative directory containing the package (local-folder registries only). */
  dir?: string
  /** HTTPS URL to a downloadable archive (.tar.gz). */
  archive?: string
  /** Content hash of the archive (sha256:<64 hex chars>). */
  hash?: string
  version: string
  ref?: string
  commit?: string
  permissions: Record<string, unknown>
  engines?: { mim?: string }
}

export interface RegistryIndex {
  entries: RegistryEntry[]
  diagnostics: string[]
}

export interface ParseRegistryIndexOptions {
  /** When true, entries with `dir` (registry-relative path) are accepted. Default: false. */
  allowLocalDirs?: boolean
}

export function parseRegistryIndex(raw: unknown, options?: ParseRegistryIndexOptions): RegistryIndex {
  const allowLocalDirs = options?.allowLocalDirs ?? false
  const diagnostics: string[] = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    diagnostics.push('Registry index must be a JSON object')
    return { entries: [], diagnostics }
  }

  const obj = raw as Record<string, unknown>

  if (obj.manifestVersion !== 1) {
    diagnostics.push('Registry index manifestVersion must be 1')
    return { entries: [], diagnostics }
  }

  if (!Array.isArray(obj.packages)) {
    diagnostics.push('Registry index packages must be an array')
    return { entries: [], diagnostics }
  }

  const entries: RegistryEntry[] = []

  for (const [i, item] of (obj.packages as unknown[]).entries()) {
    const entryDiags: string[] = []

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      diagnostics.push(`Registry entry [${i}] must be an object`)
      continue
    }
    const e = item as Record<string, unknown>

    const id = typeof e.id === 'string' ? e.id : undefined
    if (!id || !/^[a-z0-9][a-z0-9_-]{0,59}$/.test(id)) {
      entryDiags.push(`Registry entry [${i}]: invalid or missing id`)
    }

    const name = typeof e.name === 'string' ? e.name : undefined
    if (!name) {
      entryDiags.push(`Registry entry [${i}]${id ? ` (${id})` : ''}: missing name`)
    }

    const hasDir = typeof e.dir === 'string'
    const hasRepo = typeof e.repo === 'string'
    const hasArchive = typeof e.archive === 'string'

    // An entry must use exactly one source type — reject ambiguous combinations
    const sourceCount = [hasDir, hasRepo, hasArchive].filter(Boolean).length
    if (sourceCount > 1) {
      entryDiags.push(`Registry entry "${id ?? `[${i}]`}": ambiguous source — entry must use exactly one of repo, dir, or archive`)
    } else if (hasDir) {
      // --- dir entry (local-folder registry) ---
      if (!allowLocalDirs) {
        entryDiags.push(`Registry entry "${id ?? `[${i}]`}": local dir entries are not allowed in this registry`)
      } else {
        const dir = e.dir as string
        if (dir !== '.' && !isValidPackagePath(dir)) {
          entryDiags.push(`Registry entry "${id ?? `[${i}]`}": invalid dir "${dir}" — must be a relative path with no "." or ".." segments`)
        }
      }
    } else if (hasArchive) {
      // --- archive entry ---
      const archive = e.archive as string
      if (!isHttpsUrl(archive)) {
        entryDiags.push(`Registry entry "${id ?? `[${i}]`}": archive URL must be HTTPS, got: ${archive}`)
      }
      const hash = typeof e.hash === 'string' ? e.hash : undefined
      if (!hash || !HASH_RE.test(hash)) {
        entryDiags.push(`Registry entry "${id ?? `[${i}]`}": hash must be sha256:<64 lowercase hex chars>`)
      }
    } else {
      // --- git entry (existing behaviour) ---
      const repo = hasRepo ? (e.repo as string) : undefined
      if (!repo) {
        entryDiags.push(`Registry entry [${i}]${id ? ` (${id})` : ''}: missing repo`)
      } else if (!isHttpsUrl(repo)) {
        entryDiags.push(`Registry entry "${id ?? `[${i}]`}": repo URL must be HTTPS, got: ${repo}`)
      }

      const path = typeof e.path === 'string' ? e.path : undefined
      if (path !== undefined && !isValidPackagePath(path)) {
        entryDiags.push(`Registry entry "${id ?? `[${i}]`}": invalid path "${path}" — must be a repo-relative path with no "." or ".." segments`)
      }

      const ref = typeof e.ref === 'string' ? e.ref : undefined
      if (!ref) {
        entryDiags.push(`Registry entry "${id ?? `[${i}]`}": missing ref`)
      }

      const commit = typeof e.commit === 'string' ? e.commit : undefined
      if (!commit || !GIT_SHA_RE.test(commit)) {
        entryDiags.push(`Registry entry "${id ?? `[${i}]`}": commit must be a full 40-character hex SHA`)
      }
    }

    const version = typeof e.version === 'string' ? e.version : undefined
    if (!version || !isValidSemver(version)) {
      entryDiags.push(`Registry entry "${id ?? `[${i}]`}": invalid or missing version`)
    }

    if (entryDiags.length > 0) {
      diagnostics.push(...entryDiags)
      continue
    }

    const permissions = (e.permissions && typeof e.permissions === 'object' && !Array.isArray(e.permissions))
      ? e.permissions as Record<string, unknown>
      : {}

    const engines = parseEngines(e.engines)

    const description = typeof e.description === 'string' ? e.description : undefined

    if (hasDir) {
      entries.push({
        id: id!,
        name: name!,
        description,
        dir: e.dir as string,
        version: version!,
        permissions,
        engines,
      })
    } else if (hasArchive) {
      entries.push({
        id: id!,
        name: name!,
        description,
        archive: e.archive as string,
        hash: e.hash as string,
        version: version!,
        permissions,
        engines,
      })
    } else {
      entries.push({
        id: id!,
        name: name!,
        description,
        repo: e.repo as string,
        path: typeof e.path === 'string' ? e.path : undefined,
        version: version!,
        ref: e.ref as string,
        commit: e.commit as string,
        permissions,
        engines,
      })
    }
  }

  return { entries, diagnostics }
}

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
    return false
  } catch {
    return false
  }
}

function parseEngines(value: unknown): RegistryEntry['engines'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const mim = (value as Record<string, unknown>).mim
  return typeof mim === 'string' ? { mim } : undefined
}
