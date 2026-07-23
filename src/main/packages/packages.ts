import { existsSync, lstatSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { watch } from 'chokidar'
import type { ToolRegistry } from '@main/tools/registry.js'
import { MIM_RUNTIME_VERSION } from './runtimeVersion.js'
import {
  parsePackageManifest,
  type MimPackageManifest,
  type PackageDiagnostic,
  type PackageSource,
} from './packageManifest.js'
import { teamCheckoutPath } from '@main/team/teamSource.js'
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
  root(source: PackageSource): string | null
  onChange(cb: () => void): void
  rescan(): Promise<void>
  close?(): Promise<void>
}

export interface PackageLoaderOptions {
  teamDir?: string
  mimDir?: string
}

const SOURCE_RANK: Record<PackageSource, number> = {
  mim: 1,
  team: 2,
  project: 3,
}

function defaultMimAppsDir(): string {
  return join(process.resourcesPath ?? process.cwd(), 'apps')
}

export async function createPackageLoader(
  tools: ToolRegistry,
  options: PackageLoaderOptions = {},
): Promise<PackageLoader> {
  const winners = new Map<string, LoadedPackage>()
  const copies = new Map<string, Map<PackageSource, LoadedPackage>>()
  const listeners: Array<() => void> = []
  const watchers: ReturnType<typeof watch>[] = []
  let diagnostics: PackageDiagnostic[] = []
  let closed = false

  const roots = (): Record<PackageSource, string | null> => {
    const teamRoot = teamCheckoutPath(userHomeDir())
    return {
      mim: options.mimDir ?? defaultMimAppsDir(),
      team: options.teamDir ?? (existsSync(join(teamRoot, 'team.yaml')) ? join(teamRoot, 'apps') : null),
      project: tools.getWorkspacePath() ? join(tools.getWorkspacePath()!, 'packages') : null,
    }
  }

  function packageHasReadme(dir: string): boolean {
    try {
      return lstatSync(join(dir, 'README.md')).isFile()
    } catch {
      return false
    }
  }

  function record(pkg: LoadedPackage, manifestPath: string): void {
    const id = pkg.manifest.id
    if (pkg.manifest.engines?.mim && pkg.manifest.engines.mim !== MIM_RUNTIME_VERSION) {
      diagnostics.push({
        path: manifestPath,
        packageId: id,
        message: `Skipping "${id}": engine incompatible — requires "${pkg.manifest.engines.mim}" but this runtime is "${MIM_RUNTIME_VERSION}"`,
      })
      return
    }
    const bySource = copies.get(id) ?? new Map<PackageSource, LoadedPackage>()
    if (bySource.has(pkg.source)) {
      diagnostics.push({
        path: manifestPath,
        packageId: id,
        message: `Duplicate package id within ${pkg.source}: ${id}`,
      })
      return
    }
    bySource.set(pkg.source, pkg)
    copies.set(id, bySource)
  }

  function scanRoot(root: string | null, source: PackageSource): void {
    if (!root || !existsSync(root)) return
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const dir = join(root, entry.name)
      const manifestPath = join(dir, 'package.json')
      if (!existsSync(manifestPath)) continue
      try {
        const parsed = parsePackageManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')), dir)
        diagnostics.push(...parsed.diagnostics.map(diagnostic => ({
          ...diagnostic,
          packageId: parsed.manifest?.id ?? entry.name,
        })))
        if (parsed.manifest) {
          record({
            manifest: parsed.manifest,
            dir,
            source,
            hasReadme: packageHasReadme(dir),
          }, manifestPath)
        }
      } catch (error) {
        diagnostics.push({
          path: manifestPath,
          packageId: entry.name,
          message: `Failed to load package manifest: ${(error as Error).message}`,
        })
      }
    }
  }

  function resolveWinners(): void {
    winners.clear()
    for (const [id, candidates] of copies) {
      const ordered = [...candidates.values()]
        .sort((a, b) => SOURCE_RANK[b.source] - SOURCE_RANK[a.source])
      const winner = ordered[0]
      if (!winner) continue
      if (ordered.length > 1) {
        winner.shadowedSources = ordered.slice(1).map(candidate => candidate.source).sort()
        diagnostics.push({
          path: join(winner.dir, 'package.json'),
          packageId: id,
          message: `Package "${id}" (${winner.source}) shadowed copies from: ${winner.shadowedSources.join(', ')}`,
        })
      }
      winners.set(id, winner)
    }
  }

  async function scan(): Promise<void> {
    copies.clear()
    diagnostics = []
    const current = roots()
    scanRoot(current.mim, 'mim')
    scanRoot(current.team, 'team')
    scanRoot(current.project, 'project')
    resolveWinners()
  }

  let activeScan: Promise<void> | null = null
  let queuedScan: Promise<void> | null = null
  function fullScan(): Promise<void> {
    if (!activeScan) {
      activeScan = scan().finally(() => { activeScan = null })
      return activeScan
    }
    if (!queuedScan) {
      queuedScan = activeScan.then(() => {
        queuedScan = null
        return fullScan()
      })
    }
    return queuedScan
  }

  async function setupWatchers(): Promise<void> {
    await Promise.all(watchers.map(item => item.close()))
    watchers.length = 0
    if (closed) return
    const ready: Array<Promise<void>> = []
    for (const root of Object.values(roots())) {
      if (!root || !existsSync(root)) continue
      const watcher = watch(root, { depth: 2, ignoreInitial: true, ignored: /(^|[/\\])\../ })
      watcher.on('all', async () => {
        await fullScan()
        listeners.forEach(listener => listener())
      })
      watchers.push(watcher)
      ready.push(new Promise(resolve => watcher.on('ready', resolve)))
    }
    await Promise.all(ready)
  }

  await fullScan()
  await setupWatchers()

  return {
    list: () => [...winners.values()],
    get: id => winners.get(id),
    diagnostics: () => diagnostics,
    root: source => roots()[source],
    onChange: listener => {
      if (!closed) listeners.push(listener)
    },
    rescan: async () => {
      if (closed) return
      await fullScan()
      await setupWatchers()
      listeners.forEach(listener => listener())
    },
    close: async () => {
      closed = true
      listeners.length = 0
      await Promise.all(watchers.map(item => item.close()))
      watchers.length = 0
    },
  }
}
