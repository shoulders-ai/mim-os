import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'
import { resolveInsidePackage, isValidCapabilityId, isValidPublicToolName, matchesToolGrant } from '@main/packages/packageManifest.js'
import { createPackageDataApi, type PackageDataApi } from '@main/packages/packageData.js'
import { createPackageHttpApi, type PackageHttpApi } from '@main/packages/packageHttp.js'
import { createPackageSecretsApi, type PackageSecretsApi } from '@main/packages/packageSecrets.js'
import { fetchHttpClient, type HttpClient } from '@main/integrations/http.js'
import type { SecretStore } from '@main/integrations/secrets.js'
import type { TraceLog } from '@main/trace/trace.js'
import type { LoadedPackage, PackageLoader } from '@main/packages/packages.js'
import type { PackageEnablementStore } from '@main/packages/packageEnablement.js'
import type { ToolContext, ToolRegistry } from '@main/tools/registry.js'
import { callAnthropicToolLoop, callGeminiText, callModelToolLoop, generateObjectWithAi } from '@main/ai/ai.js'
import { PackagePermissionError } from '@main/packages/packageErrors.js'

export interface PackageJobDescriptor {
  id: string
  label: string
  inputSchema?: Record<string, unknown>
  concurrency: 'single' | 'parallel'
  ephemeral: boolean
  run: (ctx: PackageRuntimeContext, input: Record<string, unknown>) => Promise<unknown> | unknown
}

export interface PackageToolDescriptor {
  id: string
  publicName: string
  named: boolean
  packageId: string
  label: string
  description: string
  inputSchema: Record<string, unknown>
  audience: string[]
  execute: (ctx: PackageRuntimeContext, input: Record<string, unknown>) => Promise<unknown> | unknown
}

export interface PackageCapabilities {
  packageId: string
  jobs: PackageJobDescriptor[]
  tools: PackageToolDescriptor[]
  agentContext?: (ctx: PackageRuntimeContext) => Promise<unknown> | unknown
  diagnostics: string[]
}

export interface RuntimeProgress {
  step(name: string): Promise<void> | void
  log(message: string): Promise<void> | void
  progress(value: number, label?: string): Promise<void> | void
  done(summary?: string): Promise<void> | void
}

export interface PackageRuntimeContext {
  package: {
    id: string
    name: string
    version: string
    source: LoadedPackage['source']
  }
  job: {
    id: string
    runId: string
    startedAt: string
  } | null
  inputs: Readonly<Record<string, unknown>>
  data: PackageDataApi
  files: {
    readPackageText(path: string): Promise<string>
    readWorkspaceText(path: string): Promise<string>
  }
  progress: RuntimeProgress
  audit: {
    record(verb: string, data?: Record<string, unknown>): Promise<void>
  }
  abort: {
    signal: AbortSignal | null
    readonly aborted: boolean
    throwIfAborted(): void
  }
  tools: {
    call(name: string, params?: Record<string, unknown>): Promise<unknown>
  }
  http: PackageHttpApi
  secrets: PackageSecretsApi
  ai: {
    generateObject(input: {
      modelId?: string
      system?: string
      prompt: string
      schema: Record<string, unknown>
      maxOutputTokens?: number
      temperature?: number
    }): Promise<unknown>
    callAnthropic(input: {
      model?: string
      system?: string
      messages: Array<{ role: string; content: unknown }>
      tools?: Array<{
        name: string
        description: string
        input_schema: Record<string, unknown>
        execute(input: Record<string, unknown>): Promise<unknown> | unknown
      }>
      maxTokens?: number
      maxSteps?: number
    }): Promise<unknown>
    callGemini(input: {
      model?: string
      system?: string
      messages: Array<{ role: string; content: string }>
      maxTokens?: number
    }): Promise<unknown>
    callModel(input: {
      modelId?: string
      model?: string
      provider?: string
      system?: string
      messages: Array<{ role: string; content: unknown }>
      tools?: Array<{
        name: string
        description: string
        input_schema: Record<string, unknown>
        execute(input: Record<string, unknown>): Promise<unknown> | unknown
      }>
      maxTokens?: number
      maxSteps?: number
      timeoutMs?: number
      controlId?: string
    }): Promise<unknown>
  }
  documents: {
    docx: {
      read(path: string, options?: { max_chars?: number }): Promise<unknown>
      extract(path: string, options?: { max_chars?: number }): Promise<unknown>
      annotate(path: string, operations: unknown[], options?: { output_path?: string }): Promise<unknown>
      comments(path: string): Promise<unknown>
      validate(path: string): Promise<unknown>
      workerStatus(): Promise<unknown>
    }
    pdf: {
      extract(path: string, options?: { max_chars?: number }): Promise<unknown>
    }
  }
}

export interface PackageRuntime {
  loadCapabilities(packageId: string): Promise<PackageCapabilities>
  listCapabilities(): Promise<PackageCapabilities[]>
  listChatTools(): Promise<PackageToolDescriptor[]>
  getJob(packageId: string, jobId: string): Promise<{ pkg: LoadedPackage; job: PackageJobDescriptor }>
  executeTool(publicName: string, input: Record<string, unknown>, ctx?: Partial<ToolContext>): Promise<unknown>
  createContext(options: CreatePackageContextOptions): PackageRuntimeContext
  invalidate(packageId?: string): void
}

interface PackageRuntimeOptions {
  packages: PackageLoader
  enablement: PackageEnablementStore
  tools: ToolRegistry
  trace?: TraceLog
  http?: HttpClient
  secrets?: SecretStore
}

interface CreatePackageContextOptions {
  pkg: LoadedPackage
  caller?: Partial<ToolContext>
  job?: {
    id: string
    runId: string
    startedAt: string
  } | null
  inputs?: Record<string, unknown>
  signal?: AbortSignal | null
  progress?: RuntimeProgress
}

interface RawBackendModule {
  jobs?: Record<string, unknown>
  tools?: Record<string, unknown>
  agentContext?: unknown
}

const noopProgress: RuntimeProgress = {
  step: () => undefined,
  log: () => undefined,
  progress: () => undefined,
  done: () => undefined,
}

export function createPackageRuntime(options: PackageRuntimeOptions): PackageRuntime {
  const cache = new Map<string, Promise<PackageCapabilities>>()
  const toolIndex = new Map<string, { pkg: LoadedPackage; tool: PackageToolDescriptor }>()

  async function loadCapabilities(packageId: string): Promise<PackageCapabilities> {
    const pkg = options.packages.get(packageId)
    if (!pkg) throw new Error(`Package not found: ${packageId}`)
    if (!options.enablement.isEnabled(pkg)) {
      return { packageId, jobs: [], tools: [], diagnostics: [`Package is disabled: ${packageId}`] }
    }
    if (!pkg.manifest.backend) {
      return { packageId, jobs: [], tools: [], diagnostics: [] }
    }
    if (!cache.has(packageId)) {
      cache.set(packageId, importCapabilities(pkg))
    }
    return cache.get(packageId)!
  }

  async function importCapabilities(pkg: LoadedPackage): Promise<PackageCapabilities> {
    const diagnostics: string[] = []
    const backendPath = resolveInsidePackage(pkg.dir, pkg.manifest.backend!)
    if (!backendPath) {
      return { packageId: pkg.manifest.id, jobs: [], tools: [], diagnostics: ['Backend path escapes package directory'] }
    }

    let mod: RawBackendModule
    try {
      mod = await import(`${pathToFileURL(backendPath).href}?mim=${Date.now()}`) as RawBackendModule
    } catch (err) {
      return {
        packageId: pkg.manifest.id,
        jobs: [],
        tools: [],
        diagnostics: [`Failed to import backend: ${(err as Error).message}`],
      }
    }

    const jobs = parseJobs(pkg, mod.jobs, diagnostics)
    const tools = parseTools(pkg, mod.tools, diagnostics)
    const agentContext = parseAgentContext(mod.agentContext, diagnostics)

    return { packageId: pkg.manifest.id, jobs, tools, agentContext, diagnostics }
  }

  async function listCapabilities(): Promise<PackageCapabilities[]> {
    const results: PackageCapabilities[] = []
    toolIndex.clear()
    for (const pkg of options.packages.list()) {
      if (!options.enablement.isEnabled(pkg)) continue
      const capabilities = await loadCapabilities(pkg.manifest.id)
      results.push(capabilities)
      const sourcePkg = options.packages.get(pkg.manifest.id)
      if (sourcePkg) {
        for (const tool of capabilities.tools) toolIndex.set(tool.publicName, { pkg: sourcePkg, tool })
      }
    }
    return results
  }

  async function listChatTools(): Promise<PackageToolDescriptor[]> {
    const capabilities = await listCapabilities()
    return capabilities.flatMap(capability =>
      capability.tools.filter(tool => tool.audience.includes('chat')),
    )
  }

  return {
    loadCapabilities,
    listCapabilities,
    listChatTools,

    async getJob(packageId, jobId) {
      const pkg = options.packages.get(packageId)
      if (!pkg) throw new Error(`Package not found: ${packageId}`)
      if (!options.enablement.isEnabled(pkg)) throw new Error(`Package is disabled: ${packageId}`)
      const capabilities = await loadCapabilities(packageId)
      const job = capabilities.jobs.find(candidate => candidate.id === jobId)
      if (!job) throw new Error(`Package job not found: ${packageId}.${jobId}`)
      return { pkg, job }
    },

    async executeTool(publicName, input, ctx = {}) {
      if (!toolIndex.has(publicName)) await listCapabilities()
      const entry = toolIndex.get(publicName)
      if (!entry) throw new Error(`Package tool not found: ${publicName}`)
      if (ctx.actor === 'package' && ctx.package_id && ctx.package_id !== entry.pkg.manifest.id) {
        throw new Error(`Package ${ctx.package_id} cannot execute tools owned by package ${entry.pkg.manifest.id}`)
      }
      const runtimeCtx = createRuntimeContext(options, {
        pkg: entry.pkg,
        caller: ctx,
        inputs: input,
        signal: null,
      })
      const result = await entry.tool.execute(runtimeCtx, input)
      options.trace?.append({
        kind: 'package.tool.result',
        actor: 'package',
        tool: publicName,
        packageId: entry.pkg.manifest.id,
        packageVersion: entry.pkg.manifest.version,
        sessionId: ctx.sessionId,
        ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
        ...(ctx.spanId ? { parentSpanId: ctx.spanId } : {}),
        summary: summarizePackageResult(result),
        data: { caller: ctx.actor ?? 'unknown' },
      })
      return capPackageResult(result)
    },

    createContext(contextOptions) {
      return createRuntimeContext(options, contextOptions)
    },

    invalidate(packageId) {
      if (packageId) cache.delete(packageId)
      else cache.clear()
      toolIndex.clear()
    },
  }
}

function parseJobs(pkg: LoadedPackage, raw: unknown, diagnostics: string[]): PackageJobDescriptor[] {
  if (raw == null) return []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    diagnostics.push('backend export "jobs" must be an object')
    return []
  }

  const jobs: PackageJobDescriptor[] = []
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidCapabilityId(id)) {
      diagnostics.push(`Invalid job id: ${id}`)
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      diagnostics.push(`Job ${id} must be an object`)
      continue
    }
    const job = value as Record<string, unknown>
    if (typeof job.run !== 'function') {
      diagnostics.push(`Job ${id} must export run(ctx, input)`)
      continue
    }
    jobs.push({
      id,
      label: typeof job.label === 'string' ? job.label : id,
      inputSchema: readSchema(job.inputSchema),
      concurrency: job.concurrency === 'parallel' ? 'parallel' : 'single',
      ephemeral: job.ephemeral === true,
      run: job.run as PackageJobDescriptor['run'],
    })
  }
  return jobs
}

function parseTools(pkg: LoadedPackage, raw: unknown, diagnostics: string[]): PackageToolDescriptor[] {
  if (raw == null) return []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    diagnostics.push('backend export "tools" must be an object')
    return []
  }

  const grants = pkg.manifest.provides?.tools ?? []
  const tools: PackageToolDescriptor[] = []
  const publicNames = new Set<string>()
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidCapabilityId(id)) {
      diagnostics.push(`Invalid tool id: ${id}`)
      continue
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      diagnostics.push(`Tool ${id} must be an object`)
      continue
    }
    const tool = value as Record<string, unknown>
    if (typeof tool.execute !== 'function') {
      diagnostics.push(`Tool ${id} must export execute(ctx, input)`)
      continue
    }
    if (typeof tool.description !== 'string' || tool.description.length === 0) {
      diagnostics.push(`Tool ${id} needs a description`)
      continue
    }

    let named = false
    let resolvedName: string
    const declaredName = typeof tool.name === 'string' ? tool.name : undefined
    if (declaredName) {
      const valid = isValidPublicToolName(declaredName)
      const granted = valid && grants.some(g => matchesToolGrant(g.pattern, declaredName))
      if (valid && granted) {
        resolvedName = declaredName
        named = true
      } else {
        diagnostics.push(`Tool ${id}: name "${declaredName}" is not granted by manifest provides.tools`)
        resolvedName = publicToolName(pkg.manifest.id, id)
      }
    } else {
      resolvedName = publicToolName(pkg.manifest.id, id)
    }

    if (publicNames.has(resolvedName)) {
      diagnostics.push(`Duplicate public tool name: ${resolvedName}`)
      continue
    }
    publicNames.add(resolvedName)
    tools.push({
      id,
      publicName: resolvedName,
      named,
      packageId: pkg.manifest.id,
      label: typeof tool.label === 'string' ? tool.label : id,
      description: tool.description,
      inputSchema: readSchema(tool.inputSchema) ?? { type: 'object', properties: {} },
      audience: Array.isArray(tool.audience) ? tool.audience.filter((item): item is string => typeof item === 'string') : ['chat'],
      execute: tool.execute as PackageToolDescriptor['execute'],
    })
  }
  return tools
}

function parseAgentContext(
  raw: unknown,
  diagnostics: string[],
): PackageCapabilities['agentContext'] {
  if (raw == null) return undefined
  if (typeof raw === 'function') {
    return raw as (ctx: PackageRuntimeContext) => Promise<unknown> | unknown
  }
  diagnostics.push('backend export "agentContext" must be a function')
  return undefined
}

function createRuntimeContext(options: PackageRuntimeOptions, contextOptions: CreatePackageContextOptions): PackageRuntimeContext {
  const workspacePath = options.tools.getWorkspacePath()
  if (!workspacePath) throw new Error('No workspace open')
  const { pkg } = contextOptions
  const inputs = Object.freeze({ ...(contextOptions.inputs ?? {}) })
  const signal = contextOptions.signal ?? null
  // Job runs trace under the run id (the run IS the trace); calls on behalf of
  // another actor (e.g. a chat turn invoking a package tool) inherit that
  // caller's trace so the package work nests inside the originating span.
  const traceId = contextOptions.caller?.traceId ?? contextOptions.job?.runId
  const parentSpanId = contextOptions.caller?.spanId ?? contextOptions.job?.runId
  const callAsPackage = (name: string, params: Record<string, unknown> = {}) =>
    options.tools.call(name, params, {
      actor: 'package',
      package_id: pkg.manifest.id,
      sessionId: contextOptions.caller?.sessionId,
      ...(traceId ? { traceId } : {}),
      ...(parentSpanId ? { spanId: parentSpanId } : {}),
    })

  return {
    package: {
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      source: pkg.source,
    },
    job: contextOptions.job ?? null,
    inputs,
    data: createPackageDataApi(workspacePath, pkg.manifest.id),
    files: {
      async readPackageText(path) {
        const resolved = resolveInsidePackage(pkg.dir, path)
        if (!resolved) throw new Error(`Package file path escapes package directory: ${path}`)
        return readFileSync(resolved, 'utf-8')
      },
      async readWorkspaceText(path) {
        const result = await callAsPackage('fs.read', { path })
        if (!result || typeof result !== 'object' || typeof (result as { content?: unknown }).content !== 'string') {
          throw new Error(`Workspace file read did not return text: ${path}`)
        }
        return (result as { content: string }).content
      },
    },
    progress: contextOptions.progress ?? noopProgress,
    audit: {
      async record(verb, data = {}) {
        options.trace?.append({
          kind: verb,
          actor: 'package',
          packageId: pkg.manifest.id,
          packageVersion: pkg.manifest.version,
          sessionId: contextOptions.caller?.sessionId,
          ...(contextOptions.job ? { runId: contextOptions.job.runId } : {}),
          ...(traceId ? { traceId } : {}),
          ...(parentSpanId ? { parentSpanId } : {}),
          data,
        })
      },
    },
    abort: {
      signal,
      get aborted() {
        return signal?.aborted ?? false
      },
      throwIfAborted() {
        if (signal?.aborted) throw new Error('Package job aborted')
      },
    },
    tools: {
      async call(name, params = {}) {
        return callAsPackage(name, params)
      },
    },
    http: createPackageHttpApi({
      packageId: pkg.manifest.id,
      allowed: pkg.manifest.permissions.http,
      client: options.http ?? fetchHttpClient,
      signal,
      audit: (entry) => {
        options.trace?.append({
          kind: 'package.http.request',
          actor: 'package',
          packageId: pkg.manifest.id,
          packageVersion: pkg.manifest.version,
          sessionId: contextOptions.caller?.sessionId,
          subject: (entry as { host?: string }).host,
          ...(contextOptions.job ? { runId: contextOptions.job.runId } : {}),
          ...(traceId ? { traceId } : {}),
          ...(parentSpanId ? { parentSpanId } : {}),
          data: { ...entry },
        })
      },
    }),
    secrets: options.secrets
      ? createPackageSecretsApi({
          packageId: pkg.manifest.id,
          declared: pkg.manifest.permissions.secrets,
          store: options.secrets,
        })
      : unavailableSecretsApi(),
    ai: {
      async generateObject(input) {
        assertAiPermission(pkg.manifest.id, pkg.manifest.permissions.ai)
        return generateObjectWithAi({ ...input, signal: signal ?? undefined })
      },
      async callAnthropic(input) {
        assertAiPermission(pkg.manifest.id, pkg.manifest.permissions.ai)
        return callAnthropicToolLoop({
          ...input,
          signal,
        })
      },
      async callGemini(input) {
        assertAiPermission(pkg.manifest.id, pkg.manifest.permissions.ai)
        return callGeminiText({
          ...input,
          signal,
        })
      },
      async callModel(input) {
        assertAiPermission(pkg.manifest.id, pkg.manifest.permissions.ai)
        return callModelToolLoop({
          ...input,
          signal,
        })
      },
    },
    documents: {
      docx: {
        async read(path, options = {}) {
          return callAsPackage('documents.docx.read', { path, ...options })
        },
        async extract(path, options = {}) {
          return callAsPackage('documents.docx.extract', { path, ...options })
        },
        async annotate(path, operations, options = {}) {
          return callAsPackage('documents.docx.annotate', { path, operations, ...options })
        },
        async comments(path) {
          return callAsPackage('documents.docx.comments', { path })
        },
        async validate(path) {
          return callAsPackage('documents.docx.validate', { path })
        },
        async workerStatus() {
          return callAsPackage('documents.docx.workerStatus', {})
        },
      },
      pdf: {
        async extract(path, options = {}) {
          return callAsPackage('documents.pdf.extract', { path, ...options })
        },
      },
    },
  }
}

function readSchema(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function publicToolName(packageId: string, toolId: string): string {
  const safeTool = toolId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)
  return `pkg_${hashId(packageId)}__${safeTool}`
}

function hashId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function capPackageResult(value: unknown): unknown {
  const max = 24000
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}\n\n[Truncated at ${max} characters.]` : value
  }
  const json = JSON.stringify(value)
  if (json.length <= max) return value
  return {
    truncated: true,
    content: `${json.slice(0, max)}\n\n[Truncated at ${max} characters.]`,
  }
}

function summarizePackageResult(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { text: value.slice(0, 200) }
  if (value == null || typeof value !== 'object') return { value }
  return { type: Array.isArray(value) ? 'array' : 'object' }
}

function assertAiPermission(packageId: string, allowed: boolean | undefined): void {
  if (allowed !== true) {
    throw new PackagePermissionError(
      'PERMISSION_NOT_DECLARED',
      'ai',
      `Package ${packageId} did not declare AI permission`,
    )
  }
}

function unavailableSecretsApi(): PackageSecretsApi {
  const fail = async () => {
    throw new Error('Secret store is not available in this runtime')
  }
  return { get: fail, set: fail, delete: fail, has: fail }
}
