import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { readCommittedApp, type CommittedApp } from '@main/workspace/workspaceContract.js'
import type { LoadedPackage } from '@main/packages/packages.js'
import { atomicWriteJson } from '@main/atomicJson.js'

interface EnablementFile {
  enabled?: string[]
  disabled?: string[]
  trusted?: string[]
  registries?: string[]
}

export type EnablementPackage = Pick<LoadedPackage, 'manifest' | 'source' | 'dir'>

export interface RegistryTrustSource {
  id: string
  location: string
}

export interface PackageEnablementStore {
  isEnabled(pkg: EnablementPackage): boolean
  setEnabled(packageId: string, enabled: boolean): void
  clearOverride(packageId: string): void
  localOverride(packageId: string): boolean | null
  isTrusted(pkg: EnablementPackage): boolean
  ackTrust(pkg: EnablementPackage): void
  needsTrust(pkg: EnablementPackage): boolean
  isRegistryTrusted(source: RegistryTrustSource): boolean
  ackRegistryTrust(source: RegistryTrustSource): void
  diagnostics(): string[]
}

export interface PackageEnablementOptions {
  getWorkspacePath: () => string | null
}

export function createPackageEnablementStore(options: PackageEnablementOptions): PackageEnablementStore {
  let cachedPath: string | null = null
  let cachedState: Required<EnablementFile> = { enabled: [], disabled: [], trusted: [], registries: [] }
  let cachedDiagnostics: string[] = []

  function pathForWorkspace(): string | null {
    const workspace = options.getWorkspacePath()
    return workspace ? join(workspace, '.mim', 'packages', 'enabled.json') : null
  }

  function load(): Required<EnablementFile> {
    const path = pathForWorkspace()
    if (!path) {
      cachedPath = null
      cachedState = { enabled: [], disabled: [], trusted: [], registries: [] }
      cachedDiagnostics = []
      return cachedState
    }
    if (cachedPath === path) return cachedState

    cachedPath = path
    cachedDiagnostics = []
    if (!existsSync(path)) {
      cachedState = { enabled: [], disabled: [], trusted: [], registries: [] }
      return cachedState
    }
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8')) as EnablementFile
      cachedState = {
        enabled: Array.isArray(raw.enabled) ? raw.enabled.filter(isPackageIdLike) : [],
        disabled: Array.isArray(raw.disabled) ? raw.disabled.filter(isPackageIdLike) : [],
        trusted: Array.isArray(raw.trusted) ? raw.trusted.filter(isTrustEntryLike) : [],
        registries: Array.isArray(raw.registries) ? raw.registries.filter(isRegistryTrustEntryLike) : [],
      }
    } catch (err) {
      cachedDiagnostics = [`Could not read app enablement file: ${(err as Error).message}`]
      cachedState = { enabled: [], disabled: [], trusted: [], registries: [] }
    }
    return cachedState
  }

  function save(state: Required<EnablementFile>): void {
    const path = pathForWorkspace()
    if (!path) throw new Error('No workspace open')
    const clean: Required<EnablementFile> = {
      enabled: [...new Set(state.enabled)].sort(),
      disabled: [...new Set(state.disabled)].sort(),
      trusted: [...new Set(state.trusted)].sort(),
      registries: [...new Set(state.registries)].sort(),
    }
    atomicWriteJson(path, clean)
    cachedPath = path
    cachedState = clean
  }

  function readCommitted(id: string) {
    const workspace = options.getWorkspacePath()
    return workspace ? readCommittedApp(workspace, id) : null
  }

  function requiresTrust(pkg: EnablementPackage): boolean {
    if (pkg.source !== 'workspace') return false
    return pkg.manifest.backend !== undefined || hasEffectivePermissions(pkg)
  }

  function isTrusted(pkg: EnablementPackage): boolean {
    const trusted = load().trusted
    const id = pkg.manifest.id
    return trusted.includes(`${id}@*`)
  }

  function isCommittedAuthoritative(pkg: EnablementPackage, committed: CommittedApp): boolean {
    if (pkg.source === 'global') return isProvenanceVerified(pkg.dir, committed)
    return true
  }

  return {
    isEnabled(pkg) {
      const id = pkg.manifest.id
      const trusted = !requiresTrust(pkg) || isTrusted(pkg)
      const committed = readCommitted(id)
      if (committed && trusted) {
        const authoritative = isCommittedAuthoritative(pkg, committed)
        if (authoritative) return committed.enabled
      }
      const state = load()
      if (state.disabled.includes(id)) return false
      if (state.enabled.includes(id)) return trusted
      return false
    },

    setEnabled(packageId, enabled) {
      if (!isPackageIdLike(packageId)) throw new Error(`Invalid app id: ${packageId}`)
      const state = load()
      const next = {
        enabled: state.enabled.filter(id => id !== packageId),
        disabled: state.disabled.filter(id => id !== packageId),
        trusted: state.trusted,
        registries: state.registries,
      }
      if (enabled) next.enabled.push(packageId)
      else next.disabled.push(packageId)
      save(next)
    },

    clearOverride(packageId) {
      if (!isPackageIdLike(packageId)) throw new Error(`Invalid app id: ${packageId}`)
      const state = load()
      const inEnabled = state.enabled.includes(packageId)
      const inDisabled = state.disabled.includes(packageId)
      if (!inEnabled && !inDisabled) return
      save({
        enabled: state.enabled.filter(id => id !== packageId),
        disabled: state.disabled.filter(id => id !== packageId),
        trusted: state.trusted,
        registries: state.registries,
      })
    },

    localOverride(packageId) {
      const state = load()
      if (state.disabled.includes(packageId)) return false
      if (state.enabled.includes(packageId)) return true
      return null
    },

    isTrusted,

    ackTrust(pkg) {
      const id = pkg.manifest.id
      const entry = `${id}@*`
      const state = load()
      save({
        enabled: state.enabled,
        disabled: state.disabled,
        trusted: [...state.trusted.filter(e => !e.startsWith(`${id}@`)), entry],
        registries: state.registries,
      })
    },

    needsTrust(pkg) {
      // Committed or not: any workspace copy the trust gate would block must
      // surface the prompt, or enabling it dead-ends with no path to trust.
      return requiresTrust(pkg) && !isTrusted(pkg)
    },

    isRegistryTrusted(source) {
      const state = load()
      const locationHash = createHash('sha256').update(source.location).digest('hex').slice(0, 12)
      return state.registries.includes(`${source.id}@${locationHash}`)
    },

    ackRegistryTrust(source) {
      const locationHash = createHash('sha256').update(source.location).digest('hex').slice(0, 12)
      const entry = `${source.id}@${locationHash}`
      const state = load()
      save({
        enabled: state.enabled,
        disabled: state.disabled,
        trusted: state.trusted,
        registries: [...state.registries.filter(e => !e.startsWith(`${source.id}@`)), entry],
      })
    },

    diagnostics() {
      load()
      return cachedDiagnostics
    },
  }
}

function hasEffectivePermissions(pkg: EnablementPackage): boolean {
  const p = pkg.manifest.permissions
  return p.workspace?.read === true
    || p.workspace?.write === true
    || p.ai === true
    || (p.http?.length ?? 0) > 0
    || (p.secrets?.length ?? 0) > 0
}

function isPackageIdLike(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,59}$/.test(value)
}

function isTrustEntryLike(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9_-]{0,59}@\*$/.test(value)
}

// Registry trust entries: "<id>@<sha256(location)[0..12]>"
function isRegistryTrustEntryLike(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9_-]{0,59}@[0-9a-f]{12}$/.test(value)
}

function isProvenanceVerified(dir: string, committed: CommittedApp): boolean {
  const provenancePath = join(dir, '.mim-install.json')
  if (!existsSync(provenancePath)) return false
  try {
    const raw = JSON.parse(readFileSync(provenancePath, 'utf-8')) as Record<string, unknown>
    if (typeof raw.source !== 'string') return false
    if (committed.source && committed.source !== raw.source) return false
    return true
  } catch {
    return false
  }
}
