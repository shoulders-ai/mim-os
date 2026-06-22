// Update check: compares installed package versions against registry mirrors
// to surface available updates. No network — mirrors refresh via registry.list;
// this function reads cached mirrors only (sync: false).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { compareSemver } from '@main/packages/semver.js'
import {
  registrySources,
  readSourceIndex,
  type RegistrySource,
  type RegistrySourcesDeps,
} from '@main/packages/registrySources.js'
import { listInstalledVersions } from '@main/tools/registryTools.js'

export interface UpdateEntry {
  id: string
  installed: string
  latest: string
  registryId: string
}

export interface UpdateCheckResult {
  updates: UpdateEntry[]
  checkedAt: number
}

export interface CheckForUpdatesOpts {
  workspacePath: string | null
  cacheRoot: string
  globalDir: string
  isSourceTrusted: (s: RegistrySource) => boolean
  getAccountToken?: () => string | null
  force?: boolean
}

const THROTTLE_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Compare installed package versions against registry mirrors and report
 * updates. This function never does network in v1 — mirrors refresh via
 * registry.list. The throttle file mainly records checkedAt for the UI
 * (so it can show "last checked: 2h ago"). Even when throttled, the diff
 * is still computed from mirrors on disk (it is cheap).
 */
export async function checkForUpdates(opts: CheckForUpdatesOpts): Promise<UpdateCheckResult> {
  const { workspacePath, cacheRoot, globalDir, isSourceTrusted, force } = opts
  const now = Date.now()

  // Read/write the throttle file. The only thing it gates today is the
  // (future) network refresh — the diff computation always runs.
  const throttlePath = join(cacheRoot, 'registry', 'last-update-check.json')
  let shouldRefresh = true
  if (!force) {
    try {
      if (existsSync(throttlePath)) {
        const raw = JSON.parse(readFileSync(throttlePath, 'utf-8')) as { checkedAt?: number }
        if (typeof raw.checkedAt === 'number' && now - raw.checkedAt < THROTTLE_MS) {
          shouldRefresh = false
        }
      }
    } catch {
      // Corrupt throttle file — proceed as if expired.
    }
  }

  // Walk sources with the same ownership rule as registry.list:
  // the first trusted source that contains a package id owns it.
  const sourceDeps: RegistrySourcesDeps = opts.getAccountToken
    ? { getAccountToken: opts.getAccountToken }
    : {}
  const sources = registrySources(workspacePath, sourceDeps)
  const ownerByPackageId = new Map<string, { registryId: string; latestVersion: string }>()

  for (const source of sources) {
    // Trust gate: workspace sources need explicit trust.
    if (source.origin === 'workspace' && !isSourceTrusted(source)) continue

    // sync: false — never clone/pull, just read cached mirrors.
    const result = await readSourceIndex(source, { cacheRoot })
    if (result.status !== 'ok') continue

    for (const entry of result.entries) {
      if (ownerByPackageId.has(entry.id)) continue
      // First trusted source with this id owns it (anti-dependency-confusion).
      // Track the highest version from this source.
      const existing = ownerByPackageId.get(entry.id)
      if (!existing) {
        ownerByPackageId.set(entry.id, { registryId: source.id, latestVersion: entry.version })
      }
    }

    // A source may have multiple versions of the same id; pick the highest.
    for (const entry of result.entries) {
      const owned = ownerByPackageId.get(entry.id)
      if (!owned || owned.registryId !== source.id) continue
      if (compareSemver(entry.version, owned.latestVersion) > 0) {
        owned.latestVersion = entry.version
      }
    }
  }

  // Compare against installed versions.
  const updates: UpdateEntry[] = []
  for (const [id, { registryId, latestVersion }] of ownerByPackageId) {
    const installed = listInstalledVersions(id, globalDir)
    if (installed.length === 0) continue
    const highestInstalled = installed.sort((a, b) => compareSemver(b, a))[0]
    if (compareSemver(latestVersion, highestInstalled) > 0) {
      updates.push({ id, installed: highestInstalled, latest: latestVersion, registryId })
    }
  }

  // Always write the throttle file (even when we did not refresh network,
  // the checkedAt records when the diff was last computed).
  if (shouldRefresh || force) {
    try {
      mkdirSync(dirname(throttlePath), { recursive: true })
      writeFileSync(throttlePath, JSON.stringify({ checkedAt: now }))
    } catch {
      // Non-fatal: the throttle file is a convenience, not a correctness requirement.
    }
  }

  return { updates, checkedAt: now }
}
