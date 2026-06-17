import { readdirSync, existsSync, readFileSync, lstatSync } from 'fs'
import { basename, join } from 'path'
import { watch } from 'chokidar'
import type { ToolRegistry } from '@main/tools/registry.js'
import { isValidSemver, compareSemver } from '@main/packages/semver.js'
import { MIM_RUNTIME_VERSION } from '@main/packages/runtimeVersion.js'
import { parse as parseYaml } from 'yaml'
import { LEGACY_APP_KEYS, readCommittedApp } from '@main/workspace/workspaceContract.js'
import {
  parsePackageManifest,
  type PackageDiagnostic,
  type PackageSource,
  type MimPackageManifest,
} from '@main/packages/packageManifest.js'
import { userHomeDir } from '@main/platform.js'

export interface LoadedPackage {
  manifest: MimPackageManifest
  dir: string
  source: PackageSource
  hasReadme: boolean
  shadowedSources?: PackageSource[]
}

export interface PackageLoader {
  list(): LoadedPackage[]
  get(id: string): LoadedPackage | undefined
  diagnostics(): PackageDiagnostic[]
  onChange(cb: () => void): void
  rescan(): Promise<void>
  close?(): Promise<void>
}

export interface PackageLoaderOptions {
  globalDir?: string
}

const SOURCE_RANK: Record<PackageSource, number> = {
  global: 1,
  workspace: 2,
}

export async function createPackageLoader(
  tools: ToolRegistry,
  options?: PackageLoaderOptions,
): Promise<PackageLoader> {
  const registry = new Map<string, LoadedPackage>()
  const allCopies = new Map<string, Map<PackageSource, LoadedPackage>>()
  let diagnostics: PackageDiagnostic[] = []
  const listeners: Array<() => void> = []
  const watchers: ReturnType<typeof watch>[] = []
  let closed = false

  const globalDir = options?.globalDir ?? join(userHomeDir(), '.mim', 'packages')

  function record(pkg: LoadedPackage, manifestPath: string): void {
    const id = pkg.manifest.id

    if (pkg.manifest.engines?.mim && pkg.manifest.engines.mim !== MIM_RUNTIME_VERSION) {
      diagnostics.push({
        path: manifestPath,
        message: `Skipping "${id}": engine incompatible — requires "${pkg.manifest.engines.mim}" but this runtime is "${MIM_RUNTIME_VERSION}"`,
        packageId: id,
      })
      return
    }

    let copies = allCopies.get(id)
    if (!copies) {
      copies = new Map()
      allCopies.set(id, copies)
    }
    if (copies.has(pkg.source)) {
      diagnostics.push({
        path: manifestPath,
        message: `Duplicate package id within ${pkg.source}: ${id}`,
        packageId: id,
      })
      return
    }
    copies.set(pkg.source, pkg)
  }

  function resolveWinners(): void {
    registry.clear()
    for (const [id, copies] of allCopies) {
      let winner: LoadedPackage | null = null
      for (const pkg of copies.values()) {
        if (!winner || SOURCE_RANK[pkg.source] > SOURCE_RANK[winner.source]) {
          winner = pkg
        }
      }
      if (!winner) continue
      registry.set(id, winner)

      if (copies.size > 1) {
        const shadowed = [...copies.values()]
          .filter(p => p !== winner)
          .map(p => p.source)
          .sort()
        winner.shadowedSources = shadowed
        diagnostics.push({
          path: join(winner.dir, 'package.json'),
          message: `Package "${id}" (${winner.source}) shadowed copies from: ${shadowed.join(', ')}`,
          packageId: id,
        })
      }
    }
  }

  async function scanDirFlat(dir: string, source: PackageSource): Promise<void> {
    if (!existsSync(dir)) return
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const pkgDir = join(dir, entry.name)
      const manifestPath = join(pkgDir, 'package.json')
      if (!existsSync(manifestPath)) continue

      try {
        const raw = readFileSync(manifestPath, 'utf-8')
        const packageJson = JSON.parse(raw) as Record<string, unknown>
        const parsed = parsePackageManifest(packageJson, pkgDir)
        diagnostics.push(...parsed.diagnostics.map(diagnostic => ({
          ...diagnostic,
          packageId: parsed.manifest?.id ?? entry.name,
        })))
        if (!parsed.manifest) continue
        record({ manifest: parsed.manifest, dir: pkgDir, source, hasReadme: packageHasReadme(pkgDir) }, manifestPath)
      } catch (err) {
        diagnostics.push({
          path: manifestPath,
          message: `Failed to load package manifest: ${(err as Error).message}`,
          packageId: entry.name,
        })
      }
    }
  }

  async function scanDirGlobal(dir: string): Promise<void> {
    if (!existsSync(dir)) return
    const idEntries = readdirSync(dir, { withFileTypes: true })

    const workspacePath = tools.getWorkspacePath()

    for (const idEntry of idEntries) {
      if (!idEntry.isDirectory()) continue
      const idDir = join(dir, idEntry.name)

      if (existsSync(join(idDir, 'package.json'))) {
        diagnostics.push({
          path: join(idDir, 'package.json'),
          message: `Skipping flat global package dir "${idEntry.name}" — expected versioned layout <id>/<version>/package.json`,
          packageId: idEntry.name,
        })
        continue
      }

      const versionEntries = readdirSync(idDir, { withFileTypes: true })

      const validVersions: Array<{ version: string; pkg: LoadedPackage }> = []

      for (const vEntry of versionEntries) {
        if (!vEntry.isDirectory()) continue
        const vName = vEntry.name

        if (!isValidSemver(vName)) {
          diagnostics.push({
            path: join(idDir, vName),
            message: `Skipping invalid version dir name "${vName}" under global package "${idEntry.name}"`,
            packageId: idEntry.name,
          })
          continue
        }

        const vDir = join(idDir, vName)
        const manifestPath = join(vDir, 'package.json')
        if (!existsSync(manifestPath)) continue

        try {
          const raw = readFileSync(manifestPath, 'utf-8')
          const packageJson = JSON.parse(raw) as Record<string, unknown>
          const parsed = parsePackageManifest(packageJson, vDir)
          diagnostics.push(...parsed.diagnostics.map(diagnostic => ({
            ...diagnostic,
            packageId: parsed.manifest?.id ?? idEntry.name,
          })))
          if (!parsed.manifest) continue
          validVersions.push({
            version: vName,
            pkg: { manifest: parsed.manifest, dir: vDir, source: 'global', hasReadme: packageHasReadme(vDir) },
          })
        } catch (err) {
          diagnostics.push({
            path: manifestPath,
            message: `Failed to load package manifest: ${(err as Error).message}`,
            packageId: idEntry.name,
          })
        }
      }

      if (validVersions.length === 0) continue

      const pinnedVersion = workspacePath
        ? readCommittedApp(workspacePath, idEntry.name)?.version
        : undefined
      let selected: (typeof validVersions)[0] | undefined

      if (pinnedVersion) {
        selected = validVersions.find(v => v.version === pinnedVersion)
        if (!selected) {
          diagnostics.push({
            path: idDir,
            message: `Workspace pin "${pinnedVersion}" for "${idEntry.name}" not found on disk; falling back to highest installed version`,
            packageId: idEntry.name,
          })
        }
      }

      if (!selected) {
        selected = validVersions.reduce((best, cur) =>
          compareSemver(cur.version, best.version) > 0 ? cur : best,
        )
      }

      record(selected.pkg, join(selected.pkg.dir, 'package.json'))
    }
  }

  function packageHasReadme(packageDir: string): boolean {
    try {
      return lstatSync(join(packageDir, 'README.md')).isFile()
    } catch {
      return false
    }
  }

  async function runFullScan(): Promise<void> {
    registry.clear()
    allCopies.clear()
    diagnostics = []

    await scanDirGlobal(globalDir)

    const workspacePath = tools.getWorkspacePath()
    if (workspacePath) {
      await scanDirFlat(join(workspacePath, 'packages'), 'workspace')
      reportLegacyAppKeys(workspacePath)
    }

    resolveWinners()
  }

  // runFullScan resets and rebuilds shared scan state across await points, so
  // two of them interleaving corrupts that state (e.g. records the same id
  // twice -> phantom "Duplicate package id" diagnostics). Many triggers fire
  // scans at once (per-source watchers, mim.yaml watcher, UI refreshes), so we
  // serialize here: at most one scan runs, and any requests arriving while it
  // runs collapse into a single follow-up scan that observes their changes.
  let activeScan: Promise<void> | null = null
  let pendingScan: Promise<void> | null = null

  function fullScan(): Promise<void> {
    if (!activeScan) {
      activeScan = runFullScan().finally(() => { activeScan = null })
      return activeScan
    }
    if (!pendingScan) {
      pendingScan = activeScan.then(() => {
        pendingScan = null
        return fullScan()
      })
    }
    return pendingScan
  }

  function reportLegacyAppKeys(workspacePath: string): void {
    const mimYamlPath = join(workspacePath, 'mim.yaml')
    if (!existsSync(mimYamlPath)) return
    try {
      const raw = (parseYaml(readFileSync(mimYamlPath, 'utf-8')) ?? {}) as Record<string, unknown>
      const apps = raw.apps
      if (!apps || typeof apps !== 'object' || Array.isArray(apps)) return
      for (const key of Object.keys(apps)) {
        if ((LEGACY_APP_KEYS as readonly string[]).includes(key)) {
          diagnostics.push({
            path: mimYamlPath,
            message: `mim.yaml apps: legacy key "${key}" is ignored — the apps map is keyed by package id; use "board"`,
          })
        }
      }
    } catch { /* unparseable mim.yaml is reported elsewhere */ }
  }

  async function runSetupWatchers(): Promise<void> {
    await Promise.all(watchers.map(w => w.close()))
    watchers.length = 0
    if (closed) return

    const ready: Array<Promise<void>> = []

    const sources: Array<{ dir: string; depth: number }> = [
      { dir: globalDir, depth: 3 },
    ]
    const workspacePath = tools.getWorkspacePath()
    if (workspacePath) {
      sources.push({ dir: join(workspacePath, 'packages'), depth: 2 })
    }

    for (const { dir: watchDir, depth } of sources) {
      if (!existsSync(watchDir)) continue
      const watcher = watch(watchDir, {
        depth,
        ignoreInitial: true,
        ignored: /(^|[\/\\])\../
      })
      watcher.on('all', async () => {
        await fullScan()
        listeners.forEach(cb => cb())
      })
      watchers.push(watcher)
      ready.push(new Promise(resolve => watcher.on('ready', resolve)))
    }

    if (workspacePath) {
      const yamlWatcher = watch(workspacePath, { depth: 0, ignoreInitial: true })
      yamlWatcher.on('all', async (_event, changedPath) => {
        if (basename(changedPath) !== 'mim.yaml') return
        await fullScan()
        listeners.forEach(cb => cb())
      })
      watchers.push(yamlWatcher)
      ready.push(new Promise(resolve => yamlWatcher.on('ready', resolve)))
    }

    await Promise.all(ready)
  }

  // runSetupWatchers tears down and rebuilds the shared `watchers` array across
  // await points; overlapping runs close watchers another run is awaiting
  // `ready` on, which can hang. Serialize the same way as fullScan: at most one
  // setup runs, concurrent requests collapse into a single follow-up.
  let activeSetup: Promise<void> | null = null
  let pendingSetup: Promise<void> | null = null

  function setupWatchers(): Promise<void> {
    if (closed) return Promise.resolve()
    if (!activeSetup) {
      activeSetup = runSetupWatchers().finally(() => { activeSetup = null })
      return activeSetup
    }
    if (!pendingSetup) {
      pendingSetup = activeSetup.then(() => {
        pendingSetup = null
        return setupWatchers()
      })
    }
    return pendingSetup
  }

  await fullScan()
  await setupWatchers()

  return {
    list: () => Array.from(registry.values()),
    get: (id) => registry.get(id),
    diagnostics: () => diagnostics,
    onChange: (cb) => {
      if (!closed) listeners.push(cb)
    },
    rescan: async () => {
      if (closed) return
      await fullScan()
      await setupWatchers()
      listeners.forEach(cb => cb())
    },
    close: async () => {
      closed = true
      listeners.length = 0
      await Promise.all(watchers.map(w => w.close()))
      watchers.length = 0
    },
  }
}
