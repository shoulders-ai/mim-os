import { createPackageDataApi } from '@main/packages/packageData.js'
import { createPackageSecretsApi, type PackageSecretsApi } from '@main/packages/packageSecrets.js'
import type { SecretStore } from '@main/integrations/secrets.js'
import type { PackageJobRunner } from '@main/packages/packageJobs.js'
import type { PackageRuntime } from '@main/packages/packageRuntime.js'
import type { PackageLoader } from '@main/packages/packages.js'
import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'

export interface PackageRuntimeToolOptions {
  onDeletedRun?: (runId: string) => void
  secretStore?: SecretStore
}

export function registerPackageRuntimeTools(
  tools: ToolRegistry,
  packages: PackageLoader,
  runtime: PackageRuntime,
  jobs: PackageJobRunner,
  options: PackageRuntimeToolOptions = {},
): void {
  tools.register({
    name: 'package.capabilities.list',
    description: 'List enabled app jobs and tools',
    inputSchema: objectSchema({}),
    execute: async () => {
      const capabilities = await runtime.listCapabilities()
      return {
        packages: capabilities.map(capability => ({
          packageId: capability.packageId,
          jobs: capability.jobs.map(job => ({
            id: job.id,
            label: job.label,
            inputSchema: job.inputSchema,
            concurrency: job.concurrency,
          })),
          tools: capability.tools.map(tool => toolSummary(tool)),
          skills: packageSkillSummaries(packages.get(capability.packageId)?.dir),
          diagnostics: capability.diagnostics,
        })),
      }
    },
  })

  tools.register({
    name: 'package.tools.list',
    description: 'List enabled app tools available to chat',
    inputSchema: objectSchema({}),
    execute: async () => {
      const packageTools = await runtime.listChatTools()
      return { tools: packageTools.map(tool => toolSummary(tool)) }
    },
  })

  tools.register({
    name: 'package.tools.execute',
    description: 'Execute an enabled app-owned AI tool',
    inputSchema: objectSchema({
      name: { type: 'string' },
      input: { type: 'object' },
    }, ['name']),
    execute: async (params, ctx) => {
      const name = requireString(params, 'name')
      const input = typeof params.input === 'object' && params.input != null && !Array.isArray(params.input)
        ? params.input as Record<string, unknown>
        : {}
      return runtime.executeTool(name, input, ctx)
    },
  })

  tools.register({
    name: 'package.jobs.start',
    description: 'Start an app backend job',
    inputSchema: objectSchema({
      packageId: { type: 'string' },
      jobId: { type: 'string' },
      inputs: { type: 'object' },
    }, ['jobId']),
    execute: async (params, ctx) => {
      const { packageId, jobId, inputs } = packageJobParams(params, ctx)
      return jobs.start(packageId, jobId, inputs)
    },
  })

  tools.register({
    name: 'package.jobs.cancel',
    description: 'Cancel an app backend job run',
    inputSchema: objectSchema({ runId: { type: 'string' } }, ['runId']),
    execute: async (params) => jobs.cancel(requireString(params, 'runId')),
  })

  tools.register({
    name: 'package.jobs.get',
    description: 'Get an app backend job run',
    inputSchema: objectSchema({ runId: { type: 'string' } }, ['runId']),
    execute: async (params) => {
      const run = jobs.get(requireString(params, 'runId'))
      if (!run) throw new Error(`App run not found: ${params.runId}`)
      return { run }
    },
  })

  tools.register({
    name: 'package.jobs.list',
    description: 'List app backend job runs',
    inputSchema: objectSchema({
      packageId: { type: 'string' },
      includeArchived: { type: 'boolean' },
      archived: { type: 'boolean' },
    }),
    execute: async (params, ctx) => {
      const requestedPackageId = typeof params.packageId === 'string' ? params.packageId : undefined
      if (ctx.actor === 'package' && requestedPackageId && requestedPackageId !== ctx.package_id) {
        throw new Error('App jobs must use the authenticated app identity')
      }
      const packageId = ctx.actor === 'package' ? ctx.package_id : requestedPackageId
      return {
        runs: jobs.list(packageId, {
          includeArchived: params.includeArchived === true,
          archived: typeof params.archived === 'boolean' ? params.archived : undefined,
        }),
      }
    },
  })

  tools.register({
    name: 'package.jobs.rename',
    description: 'Rename an app backend job run',
    inputSchema: objectSchema({
      runId: { type: 'string' },
      label: { type: 'string' },
    }, ['runId', 'label']),
    execute: async (params) => ({
      run: jobs.rename(requireString(params, 'runId'), requireString(params, 'label')),
    }),
  })

  tools.register({
    name: 'package.jobs.archive',
    description: 'Archive or restore an app backend job run',
    inputSchema: objectSchema({ runId: { type: 'string' }, archived: { type: 'boolean' } }, ['runId']),
    execute: async (params) => ({
      run: jobs.archive(requireString(params, 'runId'), params.archived !== false),
    }),
  })

  tools.register({
    name: 'package.jobs.restore',
    description: 'Restore an archived app backend job run',
    inputSchema: objectSchema({ runId: { type: 'string' } }, ['runId']),
    execute: async (params) => ({
      run: jobs.archive(requireString(params, 'runId'), false),
    }),
  })

  tools.register({
    name: 'package.jobs.delete',
    description: 'Delete an app backend job run',
    inputSchema: objectSchema({ runId: { type: 'string' } }, ['runId']),
    execute: async (params) => {
      const runId = requireString(params, 'runId')
      const result = jobs.delete(runId)
      options.onDeletedRun?.(runId)
      return result
    },
  })

  tools.register({
    name: 'package.data.kv.get',
    description: 'Read app-scoped key-value data',
    inputSchema: objectSchema({ key: { type: 'string' } }, ['key']),
    execute: async (params, ctx) => packageData(tools, ctx).kv.get(requireString(params, 'key')),
  })

  tools.register({
    name: 'package.data.kv.set',
    description: 'Write app-scoped key-value data',
    inputSchema: objectSchema({ key: { type: 'string' }, value: {} }, ['key']),
    execute: async (params, ctx) => {
      packageData(tools, ctx).kv.set(requireString(params, 'key'), params.value)
      return { ok: true }
    },
  })

  tools.register({
    name: 'package.data.kv.delete',
    description: 'Delete app-scoped key-value data',
    inputSchema: objectSchema({ key: { type: 'string' } }, ['key']),
    execute: async (params, ctx) => {
      packageData(tools, ctx).kv.delete(requireString(params, 'key'))
      return { ok: true }
    },
  })

  tools.register({
    name: 'package.data.kv.keys',
    description: 'List app-scoped key-value keys',
    inputSchema: objectSchema({}),
    execute: async (_params, ctx) => ({ keys: packageData(tools, ctx).kv.keys() }),
  })

  tools.register({
    name: 'package.data.collection.list',
    description: 'List app-scoped collection records',
    inputSchema: objectSchema({ collection: { type: 'string' } }, ['collection']),
    execute: async (params, ctx) => ({
      records: packageData(tools, ctx).collection(requireString(params, 'collection')).list(),
    }),
  })

  tools.register({
    name: 'package.data.collection.get',
    description: 'Read an app-scoped collection record',
    inputSchema: objectSchema({ collection: { type: 'string' }, id: { type: 'string' } }, ['collection', 'id']),
    execute: async (params, ctx) =>
      packageData(tools, ctx).collection(requireString(params, 'collection')).get(requireString(params, 'id')),
  })

  tools.register({
    name: 'package.data.collection.put',
    description: 'Write an app-scoped collection record',
    inputSchema: objectSchema({ collection: { type: 'string' }, id: { type: 'string' }, value: {} }, ['collection', 'id']),
    execute: async (params, ctx) => {
      packageData(tools, ctx).collection(requireString(params, 'collection')).put(requireString(params, 'id'), params.value)
      return { ok: true }
    },
  })

  tools.register({
    name: 'package.data.collection.delete',
    description: 'Delete an app-scoped collection record',
    inputSchema: objectSchema({ collection: { type: 'string' }, id: { type: 'string' } }, ['collection', 'id']),
    execute: async (params, ctx) => {
      packageData(tools, ctx).collection(requireString(params, 'collection')).delete(requireString(params, 'id'))
      return { ok: true }
    },
  })

  // App secret tools store and report manifest-declared secrets in the OS
  // keychain. There is deliberately no value-returning read at the tool layer:
  // app UI iframes can set, delete, and check existence, but secret values
  // are only readable from backend code through ctx.secrets in the main process.
  tools.register({
    name: 'package.secrets.set',
    description: 'Store a manifest-declared app secret in the OS keychain',
    inputSchema: objectSchema({ name: { type: 'string' }, secret: { type: 'string' } }, ['name', 'secret']),
    execute: async (params, ctx) => {
      await packageSecrets(packages, ctx, options.secretStore).api
        .set(requireString(params, 'name'), requireString(params, 'secret'))
      return { ok: true }
    },
  })

  tools.register({
    name: 'package.secrets.delete',
    description: 'Delete a manifest-declared app secret from the OS keychain',
    inputSchema: objectSchema({ name: { type: 'string' } }, ['name']),
    execute: async (params, ctx) => {
      await packageSecrets(packages, ctx, options.secretStore).api.delete(requireString(params, 'name'))
      return { ok: true }
    },
  })

  tools.register({
    name: 'package.secrets.status',
    description: 'Report which manifest-declared app secrets exist in the keychain',
    inputSchema: objectSchema({}),
    execute: async (_params, ctx) => {
      const { api, declared } = packageSecrets(packages, ctx, options.secretStore)
      const secrets = await Promise.all(declared.map(async name => ({ name, exists: await api.has(name) })))
      return { secrets }
    },
  })
}

function packageJobParams(params: Record<string, unknown>, ctx: ToolContext) {
  const requestedPackageId = typeof params.packageId === 'string' ? params.packageId : undefined
  const packageId = ctx.actor === 'package'
    ? ctx.package_id
    : requestedPackageId
  if (!packageId) throw new Error('Missing app id')
  if (ctx.actor === 'package' && requestedPackageId && requestedPackageId !== packageId) {
    throw new Error('App jobs must use the authenticated app identity')
  }
  const jobId = requireString(params, 'jobId')
  const inputs = typeof params.inputs === 'object' && params.inputs != null && !Array.isArray(params.inputs)
    ? params.inputs as Record<string, unknown>
    : {}
  return { packageId, jobId, inputs }
}

function packageData(tools: ToolRegistry, ctx: ToolContext) {
  if (!ctx.package_id) throw new Error('App data tools require app identity')
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  return createPackageDataApi(workspace, ctx.package_id)
}

function packageSecrets(packages: PackageLoader, ctx: ToolContext, store: SecretStore | undefined): { api: PackageSecretsApi; declared: string[] } {
  if (!ctx.package_id) throw new Error('App secret tools require app identity')
  if (!store) throw new Error('Secret store is not available in this runtime')
  const pkg = packages.get(ctx.package_id)
  if (!pkg) throw new Error(`App not found: ${ctx.package_id}`)
  const declared = pkg.manifest.permissions.secrets ?? []
  return { api: createPackageSecretsApi({ packageId: ctx.package_id, declared, store }), declared }
}

function toolSummary(tool: { id: string; publicName: string; packageId: string; label: string; description: string; inputSchema: Record<string, unknown> }) {
  return {
    name: tool.publicName,
    id: tool.id,
    packageId: tool.packageId,
    label: tool.label,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }
}

function packageSkillSummaries(packageDir: string | undefined): Array<{ id: string; label: string }> {
  if (!packageDir) return []
  const skillsDir = join(packageDir, 'skills')
  if (!existsSync(skillsDir)) return []

  const skills: Array<{ id: string; label: string }> = []
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(skillsDir, entry.name, 'SKILL.md')
    if (!existsSync(path) || !statSync(path).isFile()) continue
    skills.push({ id: entry.name, label: readSkillLabel(path) ?? entry.name })
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id))
}

function readSkillLabel(path: string): string | null {
  try {
    const raw = readFileSync(path, 'utf-8')
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
    if (!match) return null
    const meta = parseYaml(match[1]) as Record<string, unknown> | null
    return typeof meta?.name === 'string' && meta.name.trim() ? meta.name.trim() : null
  } catch {
    return null
  }
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required parameter: ${key}`)
  return value
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}
