import { readFileSync } from 'fs'
import type { PackageRuntime } from '@main/packages/packageRuntime.js'
import type { PackageLoader } from '@main/packages/packages.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import { resolveInsidePackage } from '@main/packages/packageManifest.js'
import { createPackageDataApi } from '@main/packages/packageData.js'
import { loadRegistry } from '@main/ai/ai.js'
import type { AgentProfile } from '@main/ai/aiRuntime.js'
import { buildPromptTemplateVars, formatSkillCatalogSection, resolveTemplateVars } from '@main/ai/systemPrompt.js'
import { newSpanId } from '@main/trace/trace.js'

const INSTRUCTIONS_TIMEOUT_MS = 3000

export interface AgentInstructionsContext {
  package: { id: string; name: string; version: string; source: string }
  data: {
    kv: { get(key: string): unknown; keys(): string[] }
    collection(name: string): { get(id: string): unknown; list(): unknown[] }
  }
  files: { readPackageText(path: string): Promise<string> }
  abort: { signal: AbortSignal; readonly aborted: boolean; throwIfAborted(): void }
}

export interface MountedAgentSummary {
  id: string
  packageId: string
  key: string
  name: string
  icon?: string
  model?: string
  scoped: boolean
  toolCount?: number
  skills: string[]
  diagnostics: string[]
}

export function createAgentMounts(options: {
  runtime: PackageRuntime
  packages: PackageLoader
  tools: ToolRegistry
}): {
  list(): Promise<MountedAgentSummary[]>
  resolveProfile(agentId: string): Promise<AgentProfile>
} {
  const { runtime, packages, tools } = options

  async function list(): Promise<MountedAgentSummary[]> {
    const allCapabilities = await runtime.listCapabilities()
    const summaries: MountedAgentSummary[] = []

    for (const caps of allCapabilities) {
      for (const agent of caps.agents) {
        const id = `package:${caps.packageId}/${agent.key}`
        const diagnostics: string[] = []

        // (a) Validate tools
        if (agent.tools) {
          // Gather the app's own tool publicNames for checking
          const ownToolNames = new Set(caps.tools.map(t => t.publicName))
          for (const toolId of agent.tools) {
            const registryTool = tools.get(toolId)
            const isOwnTool = ownToolNames.has(toolId)
            if (!registryTool && !isOwnTool) {
              diagnostics.push(`Unknown tool id in agent ${agent.key}: ${toolId}`)
            }
          }
        }

        // (b) Validate skills — each declared skill must exist among the app's bundled skills
        if (agent.skills) {
          // Package skills are enumerated as files in the package's skills/ dir.
          // We check by looking for the qualified skill id via the skill.get call pattern.
          const pkg = packages.get(caps.packageId)
          for (const skillName of agent.skills) {
            const qualifiedId = `package:${caps.packageId}/${skillName}`
            try {
              const result = await tools.call('skill.get', { name: qualifiedId }, { actor: 'system' }) as { skill?: unknown }
              if (!result?.skill) {
                diagnostics.push(`Unknown skill in agent ${agent.key}: ${skillName}`)
              }
            } catch {
              diagnostics.push(`Unknown skill in agent ${agent.key}: ${skillName}`)
            }
          }
        }

        // (c) Validate model
        if (agent.model) {
          const registry = loadRegistry()
          const knownModel = (registry.models || []).find(
            (m: { id: string; model: string }) => m.id === agent.model || m.model === agent.model,
          )
          if (!knownModel) {
            diagnostics.push(`Unknown model in agent ${agent.key}: ${agent.model}`)
          }
        }

        summaries.push({
          id,
          packageId: caps.packageId,
          key: agent.key,
          name: agent.name,
          ...(agent.icon ? { icon: agent.icon } : {}),
          ...(agent.model ? { model: agent.model } : {}),
          scoped: agent.tools !== undefined,
          ...(agent.tools !== undefined ? { toolCount: agent.tools.length } : {}),
          skills: agent.skills ?? [],
          diagnostics,
        })
      }
    }

    return summaries
  }

  async function resolveProfile(agentId: string): Promise<AgentProfile> {
    const parsed = parseAgentId(agentId)
    if (!parsed) throw new Error(`Unknown or unavailable agent: ${agentId}`)
    const { packageId, key } = parsed

    const pkg = packages.get(packageId)
    if (!pkg) throw new Error(`Unknown or unavailable agent: ${agentId}`)

    const caps = await runtime.loadCapabilities(packageId)
    // A disabled package returns empty capabilities with a diagnostic
    if (caps.agents.length === 0 && caps.diagnostics.some(d => d.includes('disabled'))) {
      throw new Error(`Unknown or unavailable agent: ${agentId}`)
    }

    const descriptor = caps.agents.find(a => a.key === key)
    if (!descriptor) throw new Error(`Unknown or unavailable agent: ${agentId}`)

    return {
      id: agentId,
      toolSurface: 'chat',
      modelFeature: 'chat',
      defaultModelId: descriptor.model,
      useCatalogs: true,
      persistSession: true,
      stepCap: 100,
      sendReasoning: true,
      toolAllowlist: descriptor.tools,
      preActivatedSkills: (descriptor.skills ?? []).map(s => `package:${packageId}/${s}`),

      async buildInstructions({ workspacePath, skillCatalog, selectedSkillsSection, trace }) {
        const workspacePath_ = workspacePath ?? tools.getWorkspacePath() ?? undefined
        const ctx = buildConstrainedContext(tools, packages, packageId, pkg.dir)
        const spanId = newSpanId()
        const startedAt = Date.now()

        let result: unknown
        try {
          result = await withTimeout(
            descriptor.instructions(ctx),
            INSTRUCTIONS_TIMEOUT_MS,
          )
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          // Trace the failure
          tools.trace.append({
            kind: 'agent.instructions',
            actor: 'ai',
            spanId,
            ...(trace ? { traceId: trace.traceId, parentSpanId: trace.spanId } : {}),
            packageId,
            durationMs: Date.now() - startedAt,
            status: 'error',
            data: { agentId },
          })
          throw new Error(`Agent "${descriptor.name}" (${agentId}) instructions failed: ${reason}`)
        }

        if (typeof result !== 'string') {
          tools.trace.append({
            kind: 'agent.instructions',
            actor: 'ai',
            spanId,
            ...(trace ? { traceId: trace.traceId, parentSpanId: trace.spanId } : {}),
            packageId,
            durationMs: Date.now() - startedAt,
            status: 'error',
            data: { agentId },
          })
          throw new Error(`Agent "${descriptor.name}" (${agentId}) instructions failed: instructions must return a string`)
        }

        // Trace success
        tools.trace.append({
          kind: 'agent.instructions',
          actor: 'ai',
          spanId,
          ...(trace ? { traceId: trace.traceId, parentSpanId: trace.spanId } : {}),
          packageId,
          durationMs: Date.now() - startedAt,
          status: 'ok',
          data: { agentId },
        })

        // Resolve template vars
        const catalogString = formatSkillCatalogSection(skillCatalog) ?? ''
        const vars = buildPromptTemplateVars(workspacePath_, { skillCatalog: catalogString })
        const resolved = resolveTemplateVars(result, vars)

        // Final join
        return [resolved, selectedSkillsSection].filter(Boolean).join('\n\n\n')
      },
    }
  }

  return { list, resolveProfile }
}

function parseAgentId(agentId: string): { packageId: string; key: string } | null {
  const match = /^package:([^/]+)\/(.+)$/.exec(agentId)
  if (!match) return null
  return { packageId: match[1], key: match[2] }
}

function buildConstrainedContext(
  tools: ToolRegistry,
  packages: PackageLoader,
  packageId: string,
  packageDir: string,
): AgentInstructionsContext {
  const workspacePath = tools.getWorkspacePath()
  if (!workspacePath) throw new Error('No workspace open')

  const pkg = packages.get(packageId)
  if (!pkg) throw new Error(`Package not found: ${packageId}`)

  // Read-only wrappers over createPackageDataApi — no set/put/delete
  const dataApi = createPackageDataApi(workspacePath, packageId)

  const controller = new AbortController()
  // Tie to timeout
  const timer = setTimeout(() => controller.abort(), INSTRUCTIONS_TIMEOUT_MS)
  timer.unref?.()

  return {
    package: {
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      source: pkg.source,
    },
    data: {
      kv: {
        get: (key: string) => dataApi.kv.get(key),
        keys: () => dataApi.kv.keys(),
      },
      collection: (name: string) => {
        const col = dataApi.collection(name)
        return {
          get: (id: string) => col.get(id),
          list: () => col.list(),
        }
      },
    },
    files: {
      async readPackageText(path: string): Promise<string> {
        const resolved = resolveInsidePackage(packageDir, path)
        if (!resolved) throw new Error(`Package file path escapes package directory: ${path}`)
        return readFileSync(resolved, 'utf-8')
      },
    },
    abort: {
      signal: controller.signal,
      get aborted() { return controller.signal.aborted },
      throwIfAborted() {
        if (controller.signal.aborted) throw new Error('Aborted')
      },
    },
  }
}

async function withTimeout<T>(work: Promise<T> | T, timeoutMs: number): Promise<T> {
  if (!(work instanceof Promise)) return work
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
