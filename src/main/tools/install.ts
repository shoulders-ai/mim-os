// Install tools: package.install, package.update, package.uninstall.
// Supply-chain-critical: every step fails loudly, credentials are rejected,
// .gitmodules and symlinks are refused, provenance never contains tokens.
// See docs/registry-and-packages-plan.md §5.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { dirname, join, resolve, sep } from 'path'
import { cloneRepo, fetchRepo, checkoutRef, checkoutRemoteDefault, resolveHead } from '@main/git.js'
import { isValidPackagePath } from '@main/packages/registryIndex.js'
import { packageMirrorDir } from '@main/packages/cacheLayout.js'
import { parsePackageManifest } from '@main/packages/packageManifest.js'
import { isValidSemver } from '@main/packages/semver.js'
import { MIM_RUNTIME_VERSION } from '@main/packages/runtimeVersion.js'
import {
  parseMimYaml,
  serializeMimYaml,
  writeAppPin,
  PACKAGE_ID_PATTERN,
  type MimAppEntry,
} from '@main/workspace/workspaceContract.js'
import type { RegistryEntry } from '@main/packages/registryIndex.js'
import type { LookupResult } from '@main/packages/registrySources.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import type { PackageLoader } from '@main/packages/packages.js'
import type { PackageEnablementStore } from '@main/packages/packageEnablement.js'

export interface InstallToolDeps {
  packages: PackageLoader
  enablement: PackageEnablementStore
  cacheRoot: string
  globalDir: string
  /** Injectable clock for testability; production default is Date.now. */
  clock: () => number
  /** Resolve a registry entry for an app id (and optional version). */
  lookupRegistryEntry: (id: string, version?: string) => Promise<LookupResult | undefined>
  /** Injectable fetch for testability; defaults to global fetch. */
  fetchUrl?: (url: string, opts?: { headers?: Record<string, string> }) => Promise<Response>
}

export function registerInstallTools(
  tools: ToolRegistry,
  deps: InstallToolDeps,
): void {

  // ---- package.install ----

  tools.register({
    name: 'package.install',
    description: 'Install an app from the registry or a direct repo URL.',
    execute: async (params) => {
      const id = typeof params.id === 'string' ? params.id : undefined
      const repo = typeof params.repo === 'string' ? params.repo : undefined
      const ref = typeof params.ref === 'string' ? params.ref : undefined
      const version = typeof params.version === 'string' ? params.version : undefined
      const pathParam = typeof params.path === 'string' ? params.path : undefined

      if (!id && !repo) throw new Error('Missing required parameter: id or repo')

      // Resolve the registry entry (if installing by id).
      let lookupResult: LookupResult | undefined
      let registryEntry: RegistryEntry | undefined
      let sourceUrl: string
      let targetRef: string | undefined
      let expectedCommit: string | undefined
      let packagePath: string | undefined
      let isLocal = false

      if (id) {
        lookupResult = await deps.lookupRegistryEntry(id, version)
        if (!lookupResult) throw new Error(`App "${id}" not found in registry`)
        registryEntry = lookupResult
        isLocal = lookupResult.registryKind === 'local' && !!lookupResult.localPackageDir
        if (!isLocal && !lookupResult.archive) {
          // Git entries must have repo/ref/commit.
          if (!lookupResult.repo) throw new Error(`Git registry entry for app "${id}" is missing repo`)
          sourceUrl = lookupResult.repo
          targetRef = lookupResult.ref
          expectedCommit = lookupResult.commit
          packagePath = lookupResult.path
        }
      } else {
        sourceUrl = repo!
        targetRef = ref
        packagePath = pathParam
      }

      const isArchive = !isLocal && !!lookupResult?.archive && !!lookupResult?.hash

      // ---- Resolve packageRoot: git checkout vs local dir ----
      let packageRoot: string
      let resolvedCommit: string | undefined
      let provenanceSource: string
      let provenancePath: string | null
      let provenanceRef: string | null
      let provenanceCommit: string | null

      // Temp files to clean up after archive installs.
      let archiveTmpFile: string | undefined
      let archiveExtractDir: string | undefined

      if (isLocal) {
        // Local-dir entry: no git work, no commit verification.
        packageRoot = lookupResult!.localPackageDir!
        resolvedCommit = undefined
        provenanceSource = 'file://' + lookupResult!.registryLocation
        provenancePath = lookupResult!.dir ?? null
        provenanceRef = null
        provenanceCommit = null
      } else if (isArchive) {
        // ---- Archive entry: download, verify, extract ----

        const archiveUrl = lookupResult!.archive!

        // SECURITY: archive URL must be HTTPS.
        if (!isHttpsUrl(archiveUrl)) {
          throw new Error(
            `Archive URL must be HTTPS, got: ${archiveUrl}`,
          )
        }

        // SECURITY: reject archive URLs carrying credentials.
        rejectCredentialUrl(archiveUrl)

        // Download the tarball to a temp file.
        const tmpDir = join(deps.cacheRoot, 'tmp')
        mkdirSync(tmpDir, { recursive: true })
        const tmpFile = join(tmpDir, `${id}-${lookupResult!.version}.tar.gz`)
        archiveTmpFile = tmpFile

        const fetchHeaders: Record<string, string> = {}
        if (lookupResult!.auth?.token) {
          fetchHeaders['Authorization'] = `Bearer ${lookupResult!.auth.token}`
        }

        const doFetch = deps.fetchUrl ?? globalThis.fetch
        const response = await doFetch(archiveUrl, { headers: fetchHeaders })
        if (!response.ok) throw new Error(`Failed to download archive: HTTP ${response.status}`)

        const buffer = Buffer.from(await response.arrayBuffer())
        writeFileSync(tmpFile, buffer)

        // Verify SHA-256 hash.
        const computedHash = createHash('sha256').update(readFileSync(tmpFile)).digest('hex')
        const expectedHash = lookupResult!.hash!.replace(/^sha256:/, '')
        if (computedHash !== expectedHash) {
          rmSync(tmpFile, { force: true })
          throw new Error(`Hash mismatch for "${id}": expected ${expectedHash}, got ${computedHash}`)
        }

        // Extract to a temp directory.
        const extractDir = join(tmpDir, `${id}-${lookupResult!.version}`)
        archiveExtractDir = extractDir
        if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true })
        mkdirSync(extractDir, { recursive: true })
        execFileSync('tar', ['xzf', tmpFile, '-C', extractDir])

        packageRoot = resolveArchivePackageRoot(extractDir)
        resolvedCommit = undefined
        provenanceSource = archiveUrl
        provenancePath = null
        provenanceRef = null
        provenanceCommit = null
      } else {
        // SECURITY: the subdirectory path must be repo-relative with no "." or
        // ".." segments, so it can never resolve outside the mirror checkout.
        if (packagePath !== undefined && !isValidPackagePath(packagePath)) {
          throw new Error(
            `Invalid app path "${packagePath}" — must be a repo-relative path ` +
            `with no "." or ".." segments`,
          )
        }

        // SECURITY: reject source URLs carrying credentials.
        rejectCredentialUrl(sourceUrl!)

        // Clone or refresh the app mirror. Mirrors end up on detached
        // HEADs (tag checkouts), so refresh is fetch + explicit checkout —
        // never pull.
        const mirrorDir = packageMirrorDir(sourceUrl!, deps.cacheRoot)
        const mirrorExisted = existsSync(mirrorDir)
        if (mirrorExisted) {
          await fetchRepo(mirrorDir)
        } else {
          mkdirSync(dirname(mirrorDir), { recursive: true })
          await cloneRepo(sourceUrl!, mirrorDir)
        }

        // Checkout the target ref; with no ref, a reused mirror moves back to
        // the remote default branch tip (a fresh clone is already there).
        if (targetRef) {
          await checkoutRef(mirrorDir, targetRef)
        } else if (mirrorExisted) {
          await checkoutRemoteDefault(mirrorDir)
        }

        // Verify commit integrity for registry installs.
        resolvedCommit = await resolveHead(mirrorDir)
        if (expectedCommit && resolvedCommit !== expectedCommit) {
          throw new Error(
            `Commit mismatch for "${id}": expected ${expectedCommit}, got ${resolvedCommit}. ` +
            `The tag may have been moved or the mirror tampered with.`,
          )
        }

        // SECURITY: refuse .gitmodules.
        if (existsSync(join(mirrorDir, '.gitmodules'))) {
          throw new Error(
            'Checkout contains .gitmodules — submodules are not supported. ' +
            'They are either silently missing or unpinned content.',
          )
        }

        // Resolve the app root (repo root, or a subdirectory for monorepos).
        packageRoot = packagePath ? join(mirrorDir, packagePath) : mirrorDir
        // Defense in depth: even with the segment validation above, the
        // resolved root must stay inside the mirror checkout.
        if (!(resolve(packageRoot) + sep).startsWith(resolve(mirrorDir) + sep)) {
          throw new Error(`App path "${packagePath}" escapes the checkout`)
        }
        if (packagePath && !existsSync(packageRoot)) {
          throw new Error(`Checkout does not contain the app path "${packagePath}"`)
        }

        provenanceSource = sourceUrl!
        provenancePath = packagePath ?? null
        provenanceRef = targetRef ?? null
        provenanceCommit = resolvedCommit
      }

      // ---- Content verification (shared by git and local paths) ----

      // SECURITY: refuse any symlink in the tree that will be copied.
      assertNoSymlinks(packageRoot)

      // Parse and validate the manifest.
      const manifestPath = join(packageRoot, 'package.json')
      if (!existsSync(manifestPath)) {
        throw new Error(
          packagePath
            ? `App path "${packagePath}" does not contain a package.json`
            : isLocal
              ? `Local app dir does not contain a package.json`
              : 'Checkout does not contain a package.json',
        )
      }
      const packageJson = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
      const parsed = parsePackageManifest(packageJson, packageRoot)
      if (!parsed.manifest) {
        throw new Error(
          `Invalid app manifest: ${parsed.diagnostics.map(d => d.message).join('; ')}`,
        )
      }

      const manifest = parsed.manifest
      const manifestId = manifest.id

      // Manifest id must equal the requested id (for registry installs).
      if (id && manifestId !== id) {
        throw new Error(
          `Manifest id mismatch: expected "${id}", got "${manifestId}". ` +
          `The manifest id must equal the requested app id.`,
        )
      }

      // Determine the version for the install dir.
      const installVersion = registryEntry?.version ?? manifest.version

      // Validate version against semver regex.
      if (!isValidSemver(installVersion)) {
        throw new Error(`Invalid version "${installVersion}" — must match semver pattern`)
      }

      // For registry installs: validate that the manifest version matches the
      // registry-declared version.
      if (registryEntry && manifest.version !== registryEntry.version) {
        throw new Error(
          `Version mismatch: manifest declares "${manifest.version}" ` +
          `but registry entry declares "${registryEntry.version}"`,
        )
      }

      // Enforce engines.mim against the runtime version.
      if (manifest.engines?.mim && manifest.engines.mim !== MIM_RUNTIME_VERSION) {
        throw new Error(
          `Engine incompatible: app requires "${manifest.engines.mim}" ` +
          `but this runtime is "${MIM_RUNTIME_VERSION}"`,
        )
      }

      // For registry installs: deep-compare permissions.
      if (registryEntry) {
        if (!deepEqual(manifest.permissions, registryEntry.permissions)) {
          throw new Error(
            `Permission mismatch for "${manifestId}": ` +
            `manifest declares ${JSON.stringify(manifest.permissions)}, ` +
            `registry entry declares ${JSON.stringify(registryEntry.permissions)}`,
          )
        }
      }

      // Copy the worktree to <globalDir>/<id>/<version>/, excluding .git and
      // any .mim-install.json inside the app.
      const installDir = join(deps.globalDir, manifestId, installVersion)
      if (existsSync(installDir)) {
        rmSync(installDir, { recursive: true, force: true })
      }
      mkdirSync(installDir, { recursive: true })

      // The copy+provenance block is atomic: if anything throws mid-copy
      // (disk full, permission error) or during provenance write, clean up
      // the partial install directory so the loader never sees a broken
      // app with no provenance.
      try {
        copyTree(packageRoot, installDir)

        // Write provenance (never tokens).
        const provenance = {
          source: provenanceSource,
          path: provenancePath,
          ref: provenanceRef,
          commit: provenanceCommit,
          installedAt: deps.clock(),
        }
        writeFileSync(join(installDir, '.mim-install.json'), JSON.stringify(provenance, null, 2))
      } catch (err) {
        // Remove the partial install directory before rethrowing.
        try { rmSync(installDir, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
        throw err
      }

      // Rescan so the loader picks up the new app.
      await deps.packages.rescan()

      // Clean up archive temp files after successful install.
      if (archiveTmpFile) rmSync(archiveTmpFile, { force: true })
      if (archiveExtractDir) rmSync(archiveExtractDir, { recursive: true, force: true })

      return { installed: manifestId, version: installVersion, dir: installDir }
    },
  })

  // ---- app.add ----

  async function ensureInstalled(id: string, entry: LookupResult): Promise<void> {
    const installDir = join(deps.globalDir, id, entry.version)
    const expectedSource = entry.repo ?? entry.archive
    const provenanceCheck = expectedSource
      ? provenanceSourceChanged(installDir, expectedSource)
      : false
    if (!existsSync(join(installDir, 'package.json')) || provenanceCheck) {
      await tools.call('package.install', { id, version: entry.version }, { actor: 'system' })
    } else {
      await deps.packages.rescan()
    }
    if (!deps.packages.get(id)) {
      throw new Error(`Installed app "${id}" was not loaded after install`)
    }
  }

  function restoreLocalOverride(id: string, previous: boolean | null): void {
    if (previous === null) deps.enablement.clearOverride(id)
    else deps.enablement.setEnabled(id, previous)
  }

  // The personal add flow: install if needed, then add the app to this user's
  // sidebar in the current workspace. Sharing with teammates is the separate
  // app.share action below.
  tools.register({
    name: 'app.add',
    description: 'Add a registry app to my sidebar in this workspace: install if needed, then enable locally.',
    execute: async (params) => {
      const id = typeof params.id === 'string' ? params.id : undefined
      const version = typeof params.version === 'string' ? params.version : undefined
      if (!id) throw new Error('Missing required parameter: id')
      if (!PACKAGE_ID_PATTERN.test(id)) throw new Error(`Invalid app id: ${id}`)

      const entry = await deps.lookupRegistryEntry(id, version)
      if (!entry) throw new Error(`App "${id}" not found in registry`)

      const workspacePath = tools.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace open')

      const previousOverride = deps.enablement.localOverride(id)
      await ensureInstalled(id, entry)
      try {
        await tools.call('app.enable', { id, layer: 'local' }, { actor: 'system' })
      } catch (err) {
        restoreLocalOverride(id, previousOverride)
        throw err
      }

      return { added: id, version: entry.version, local: true }
    },
  })

  // ---- app.share ----

  tools.register({
    name: 'app.share',
    description: "Share a registry app with this workspace without enabling it in anyone's sidebar.",
    execute: async (params) => {
      const id = typeof params.id === 'string' ? params.id : undefined
      const version = typeof params.version === 'string' ? params.version : undefined
      if (!id) throw new Error('Missing required parameter: id')
      if (!PACKAGE_ID_PATTERN.test(id)) throw new Error(`Invalid app id: ${id}`)

      const entry = await deps.lookupRegistryEntry(id, version)
      if (!entry) throw new Error(`App "${id}" not found in registry`)
      if (entry.registryKind === 'local') {
        throw new Error(`Local app sources cannot be shared with the workspace`)
      }

      const workspacePath = tools.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace open')

      await ensureInstalled(id, entry)

      const sharedSource = entry.repo ?? entry.registryLocation
      if (!sharedSource) throw new Error(`Registry entry for app "${id}" has no shareable source`)
      writeAppPin(workspacePath, id, {
        source: sharedSource,
        path: entry.path,
        version: entry.version,
      })
      await deps.packages.rescan()

      return { shared: id, version: entry.version }
    },
  })

  // ---- package.update ----

  tools.register({
    name: 'package.update',
    description: 'Update an installed app to a newer registry version.',
    execute: async (params) => {
      const id = typeof params.id === 'string' ? params.id : undefined
      if (!id) throw new Error('Missing required parameter: id')
      if (!PACKAGE_ID_PATTERN.test(id)) throw new Error(`Invalid app id: ${id}`)

      // Re-resolve from registry (gets the latest entry).
      const registryEntry = await deps.lookupRegistryEntry(id)
      if (!registryEntry) throw new Error(`App "${id}" not found in registry`)

      // Install the new version (side-by-side).
      const installResult = (await tools.call(
        'package.install',
        { id, version: registryEntry.version },
        { actor: 'system' },
      )) as { installed: string; version: string; dir: string }

      // Repoint the workspace pin in mim.yaml if one exists.
      const workspacePath = tools.getWorkspacePath()
      if (workspacePath) {
        repointVersionPin(workspacePath, id, installResult.version)
      }

      // Rescan.
      await deps.packages.rescan()

      return installResult
    },
  })

  // ---- package.uninstall ----

  tools.register({
    name: 'package.uninstall',
    description: 'Remove an installed app version from the global apps directory.',
    execute: async (params) => {
      const id = typeof params.id === 'string' ? params.id : undefined
      const version = typeof params.version === 'string' ? params.version : undefined
      if (!id) throw new Error('Missing required parameter: id')
      if (!version) throw new Error('Missing required parameter: version')
      if (!PACKAGE_ID_PATTERN.test(id)) throw new Error(`Invalid app id: ${id}`)
      if (!isValidSemver(version)) throw new Error(`Invalid version: ${version}`)

      const installDir = join(deps.globalDir, id, version)
      if (!existsSync(installDir)) {
        throw new Error(`App "${id}@${version}" is not installed`)
      }

      // No refusal when enabled somewhere — fix-forward. Enabled-but-missing
      // surfaces in the UI later.
      rmSync(installDir, { recursive: true, force: true })

      await deps.packages.rescan()

      return { uninstalled: id, version }
    },
  })
}

// ---- Helpers ----

/** Check that a URL uses HTTPS, or HTTP localhost in dev. */
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

/** Reject URLs that carry embedded credentials (username, password, token). */
function rejectCredentialUrl(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      throw new Error(
        `Source URL contains embedded credentials — this is not allowed. ` +
        `Use system-git credential helpers for private sources.`,
      )
    }
  } catch (err) {
    if ((err as Error).message.includes('credential')) throw err
    // Unparseable URL — will fail at clone time, not a credential issue.
  }
}

/** Recursively assert no symlinks in the tree (skipping .git). */
function assertNoSymlinks(dir: string, prefix = ''): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Symlink found in checkout: ${rel} — apps must not contain symlinks`,
      )
    }
    if (entry.isDirectory()) {
      assertNoSymlinks(join(dir, entry.name), rel)
    }
  }
}

/** Copy the worktree, excluding .git and .mim-install.json. */
function copyTree(src: string, dst: string): void {
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git') continue
    if (entry.name === '.mim-install.json') continue
    const srcPath = join(src, entry.name)
    const dstPath = join(dst, entry.name)
    if (entry.isDirectory()) {
      mkdirSync(dstPath, { recursive: true })
      copyTree(srcPath, dstPath)
    } else if (entry.isFile()) {
      cpSync(srcPath, dstPath)
    }
  }
}

/** Minimal deep-equal for permission objects (plain JSON values). */
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

function provenanceSourceChanged(installDir: string, expectedSource: string): boolean {
  const path = join(installDir, '.mim-install.json')
  if (!existsSync(path)) return false
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    return typeof raw.source === 'string' && raw.source !== expectedSource
  } catch {
    return false
  }
}

function resolveArchivePackageRoot(extractDir: string): string {
  if (existsSync(join(extractDir, 'package.json'))) return extractDir

  const childDirs = readdirSync(extractDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(extractDir, entry.name))

  const packageDirs = childDirs.filter(dir => existsSync(join(dir, 'package.json')))
  if (packageDirs.length === 1) return packageDirs[0]

  throw new Error(
    packageDirs.length === 0
      ? 'Archive does not contain a package.json at its root or inside one top-level folder'
      : 'Archive contains multiple top-level package.json files',
  )
}

/**
 * Repoint the version pin for an app in the workspace's mim.yaml.
 * Only acts when a committed entry already exists; does not create a new one.
 */
function repointVersionPin(workspacePath: string, id: string, newVersion: string): void {
  const mimYamlPath = join(workspacePath, 'mim.yaml')
  if (!existsSync(mimYamlPath)) return

  const text = readFileSync(mimYamlPath, 'utf-8')
  const config = parseMimYaml(text)
  const existing = config.apps?.[id]
  if (existing === undefined) return

  // Only repoint if the entry is an object form with a version field.
  if (typeof existing === 'boolean') return

  const updated: MimAppEntry = { ...existing, version: newVersion }
  const apps = { ...(config.apps ?? {}), [id]: updated }
  config.apps = apps
  writeFileSync(mimYamlPath, serializeMimYaml(config))
}
