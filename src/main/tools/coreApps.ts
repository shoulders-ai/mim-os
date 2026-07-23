import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { MountedAgentSummary } from '@main/ai/agentMounts.js'
import type { PackageEnablementStore } from '@main/packages/packageEnablement.js'
import type { LoadedPackage, PackageLoader } from '@main/packages/packages.js'
import type { ToolRegistry } from './registry.js'

export interface AppStatus {
  id: string
  enabled: boolean
  layer: 'local' | 'default'
  source: LoadedPackage['source']
  version: string
  shadowed: boolean
  needsTrust: boolean
  folderPresent: boolean
}

export interface CoreAppToolsDeps {
  packages: PackageLoader
  enablement: PackageEnablementStore
  invalidate?: (packageId: string) => void
  emit?: (channel: string) => void
  agentMounts?: { list(): Promise<MountedAgentSummary[]> }
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}

function project(tools: ToolRegistry): string {
  const path = tools.getWorkspacePath()
  if (!path) throw new Error('No Project open')
  return path
}

function requireId(params: Record<string, unknown>): string {
  if (typeof params.id !== 'string' || !params.id) throw new Error('Missing required parameter: id')
  return params.id
}

function status(path: string, pkg: LoadedPackage, deps: CoreAppToolsDeps): AppStatus {
  const folder = pkg.manifest.dataFolder
  return {
    id: pkg.manifest.id,
    enabled: deps.enablement.isEnabled(pkg),
    layer: deps.enablement.localOverride(pkg.manifest.id) === null ? 'default' : 'local',
    source: pkg.source,
    version: pkg.manifest.version,
    shadowed: (pkg.shadowedSources?.length ?? 0) > 0,
    needsTrust: deps.enablement.needsTrust(pkg),
    folderPresent: folder !== undefined && existsSync(join(path, folder)),
  }
}

export function registerCoreAppTools(tools: ToolRegistry, deps?: CoreAppToolsDeps): void {
  const requireDeps = () => {
    if (!deps) throw new Error('App tools are not wired to an app loader in this runtime')
    return deps
  }

  tools.register({
    name: 'app.status',
    description: 'List available Mim, Team, and Project apps with this person’s local activation state.',
    inputSchema: objectSchema({}),
    execute: async () => {
      const current = requireDeps()
      const path = project(tools)
      return {
        apps: current.packages.list()
          .map(pkg => status(path, pkg, current))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }
    },
  })

  tools.register({
    name: 'app.enable',
    description: 'Enable an available app for this person in the current local Project checkout.',
    inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
    execute: async params => {
      const current = requireDeps()
      const path = project(tools)
      const id = requireId(params)
      const pkg = current.packages.get(id)
      if (!pkg) throw new Error(`App is not available: ${id}`)
      if (current.enablement.needsTrust(pkg)) {
        throw new Error(`"${pkg.manifest.name}" needs permission review before it can be enabled`)
      }
      current.enablement.setEnabled(id, true)
      if (pkg.manifest.dataFolder) mkdirSync(join(path, pkg.manifest.dataFolder), { recursive: true })
      current.invalidate?.(id)
      current.emit?.('apps:changed')
      return { ok: true, id, layer: 'local' }
    },
  })

  tools.register({
    name: 'app.disable',
    description: 'Disable an app for this person in the current local Project checkout.',
    inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
    execute: async params => {
      const current = requireDeps()
      project(tools)
      const id = requireId(params)
      if (!current.packages.get(id)) throw new Error(`App is not available: ${id}`)
      current.enablement.setEnabled(id, false)
      current.invalidate?.(id)
      current.emit?.('apps:changed')
      return { ok: true, id, layer: 'local' }
    },
  })

  tools.register({
    name: 'app.trust',
    description: 'Approve the declared access of a Team or Project app on this machine.',
    inputSchema: objectSchema({ id: { type: 'string' } }, ['id']),
    execute: async params => {
      const current = requireDeps()
      project(tools)
      const id = requireId(params)
      const pkg = current.packages.get(id)
      if (!pkg) throw new Error(`App is not available: ${id}`)
      current.enablement.ackTrust(pkg)
      current.invalidate?.(id)
      current.emit?.('apps:changed')
      return { ok: true, id }
    },
  })

  tools.register({
    name: 'app.agents.list',
    description: 'List agent profiles supplied by enabled apps.',
    inputSchema: objectSchema({}),
    execute: async () => ({
      agents: deps?.agentMounts ? await deps.agentMounts.list() : [],
    }),
  })
}
