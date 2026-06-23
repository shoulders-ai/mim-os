import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { PackageEnablementStore } from '@main/packages/packageEnablement.js'
import type { LoadedPackage, PackageLoader } from '@main/packages/packages.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import { parseMimYaml, readCommittedApp, removeApp } from '@main/workspace/workspaceContract.js'

export type AppLayer = 'workspace' | 'local' | 'default'

export interface AppStatus {
  id: string
  enabled: boolean
  layer: AppLayer
  installed: boolean
  installedVersions: string[]
  source?: string
  /** For committed-but-missing apps: repo subdirectory of the declared source. */
  path?: string
  /** For committed-but-missing apps: declared version from mim.yaml. */
  version?: string
  shadowed: boolean
  needsTrust: boolean
  needsInstall: boolean
  folderPresent: boolean
}

export interface CoreAppToolsDeps {
  packages: PackageLoader
  enablement: PackageEnablementStore
  invalidate?: (packageId: string) => void
  emit?: (channel: string) => void
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function workspace(tools: ToolRegistry): string {
  const ws = tools.getWorkspacePath()
  if (!ws) throw new Error('No workspace open')
  return ws
}

function requireId(params: Record<string, unknown>): string {
  const id = params.id
  if (typeof id !== 'string' || id.length === 0) throw new Error('Missing required parameter: id')
  return id
}

function resolveWriteLayer(params: Record<string, unknown>): 'local' {
  const layer = params.layer
  if (layer === undefined || layer === 'local') return 'local'
  if (layer === 'workspace') {
    throw new Error('Sidebar enablement is personal; use app.share to share an app with the workspace')
  }
  throw new Error(`Invalid layer: ${String(layer)} (expected 'workspace' or 'local')`)
}

function folderPresent(ws: string, id: string, deps: CoreAppToolsDeps): boolean {
  const folder = deps.packages.get(id)?.manifest.dataFolder
  return folder !== undefined && existsSync(join(ws, folder))
}

function committedAppIds(ws: string): string[] {
  const path = join(ws, 'mim.yaml')
  if (!existsSync(path)) return []
  try {
    return Object.keys(parseMimYaml(readFileSync(path, 'utf-8')).apps ?? {})
  } catch {
    return []
  }
}

function loadedStatus(ws: string, pkg: LoadedPackage, deps: CoreAppToolsDeps): AppStatus {
  const id = pkg.manifest.id
  const needsTrust = deps.enablement.needsTrust(pkg)
  const committed = readCommittedApp(ws, id)
  const layer: AppLayer = committed
    ? 'workspace'
    : deps.enablement.localOverride(id) !== null ? 'local' : 'default'
  return {
    id,
    enabled: deps.enablement.isEnabled(pkg),
    layer,
    installed: true,
    installedVersions: [pkg.manifest.version],
    source: pkg.source,
    shadowed: (pkg.shadowedSources?.length ?? 0) > 0,
    needsTrust,
    needsInstall: false,
    folderPresent: folderPresent(ws, id, deps),
  }
}

function missingStatus(ws: string, id: string, deps: CoreAppToolsDeps): AppStatus | null {
  const committed = readCommittedApp(ws, id)
  if (!committed) return null
  const status: AppStatus = {
    id,
    enabled: false,
    layer: 'workspace',
    installed: false,
    installedVersions: [],
    shadowed: false,
    needsTrust: false,
    needsInstall: true,
    // An uninstalled app has no manifest, so its data folder is unknowable here.
    folderPresent: folderPresent(ws, id, deps),
  }
  if (committed.source !== undefined) status.source = committed.source
  if (committed.path !== undefined) status.path = committed.path
  if (committed.version !== undefined) status.version = committed.version
  return status
}

export function registerCoreAppTools(tools: ToolRegistry, deps?: CoreAppToolsDeps): void {
  function requireDeps(): CoreAppToolsDeps {
    if (!deps) throw new Error('App tools are not wired to an app loader in this runtime')
    return deps
  }

  tools.register({
    name: 'app.status',
    description: 'Resolved app state for every known app: personal enablement, workspace sharing layer, install and trust state, and folderPresent for apps with a data folder.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const d = requireDeps()
      const ws = workspace(tools)
      const apps = new Map<string, AppStatus>()
      for (const pkg of d.packages.list()) {
        apps.set(pkg.manifest.id, loadedStatus(ws, pkg, d))
      }
      for (const id of committedAppIds(ws)) {
        if (apps.has(id)) continue
        const status = missingStatus(ws, id, d)
        if (status) apps.set(id, status)
      }
      return { apps: [...apps.values()].sort((a, b) => a.id.localeCompare(b.id)) }
    },
  })

  tools.register({
    name: 'app.enable',
    description: 'Add an installed app to the current user sidebar/capability set. Enablement is personal/local; layer "workspace" is rejected. Creates the app data folder if one is registered.',
    inputSchema: objectSchema({
      id: { type: 'string' },
      layer: { type: 'string', enum: ['workspace', 'local'] },
    }, ['id']),
    execute: async (params) => {
      const { packages, enablement, invalidate, emit } = requireDeps()
      const ws = workspace(tools)
      const id = requireId(params)
      const layer = resolveWriteLayer(params)
      const pkg = packages.get(id)
      if (!pkg) throw new Error(`App is not installed: ${id}`)
      if (pkg && enablement.needsTrust(pkg)) {
        throw new Error(`"${pkg.manifest.name}" needs trust before it can be enabled — review its access and trust it first`)
      }
      enablement.setEnabled(id, true)
      // The trust gate or malformed local state can still keep the resolved
      // state disabled. Fail loudly rather than letting the toggle snap back.
      if (pkg && !enablement.isEnabled(pkg)) {
        throw new Error(`Enabling "${id}" did not take effect — check the app's diagnostics`)
      }
      const folder = pkg?.manifest.dataFolder
      if (folder) mkdirSync(join(ws, folder), { recursive: true })
      invalidate?.(id)
      emit?.('apps:changed')
      return { ok: true, id, layer }
    },
  })

  tools.register({
    name: 'app.disable',
    description: 'Remove an app from the current user sidebar/capability set. Never touches data folders, install dirs, or workspace sharing.',
    inputSchema: objectSchema({
      id: { type: 'string' },
      layer: { type: 'string', enum: ['workspace', 'local'] },
    }, ['id']),
    execute: async (params) => {
      const { packages, enablement, invalidate, emit } = requireDeps()
      const ws = workspace(tools)
      const id = requireId(params)
      const layer = resolveWriteLayer(params)
      enablement.clearOverride(id)
      const pkg = packages.get(id)
      if (pkg && enablement.isEnabled(pkg)) {
        throw new Error(`Disabling "${id}" did not take effect — check the app's local enablement state`)
      }
      invalidate?.(id)
      emit?.('apps:changed')
      return { ok: true, id, layer }
    },
  })

  tools.register({
    name: 'app.trust',
    description: 'Acknowledge trust for a vendored workspace app on this machine. User-only.',
    inputSchema: objectSchema({
      id: { type: 'string' },
    }, ['id']),
    execute: async (params) => {
      const { packages, enablement, invalidate, emit } = requireDeps()
      workspace(tools)
      const id = requireId(params)
      const pkg = packages.get(id)
      if (!pkg) throw new Error(`App not found: ${id}`)
      enablement.ackTrust(pkg)
      invalidate?.(id)
      emit?.('apps:changed')
      return { ok: true, id }
    },
  })

  tools.register({
    name: 'app.remove',
    description: 'Remove an app from workspace sharing by deleting the committed mim.yaml pin. Keeps install dirs, data folders, and personal sidebar enablement.',
    inputSchema: objectSchema({
      id: { type: 'string' },
    }, ['id']),
    execute: async (params) => {
      const { packages, enablement, invalidate, emit } = requireDeps()
      const ws = workspace(tools)
      const id = requireId(params)

      const pkg = packages.get(id)

      const committed = readCommittedApp(ws, id)

      // If there is no committed entry and no loaded app, nothing to remove.
      if (!committed && !pkg) {
        throw new Error(`Unknown app: ${id}`)
      }
      if (!committed) {
        throw new Error(`App is not shared with this workspace: ${id}`)
      }

      // 1. Delete the mim.yaml apps entry (no-op if absent).
      removeApp(ws, id)

      invalidate?.(id)
      emit?.('apps:changed')
      return { ok: true, id }
    },
  })
}
