import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { AgentContextAppSection, AgentContextLocalPackage } from '@main/ai/agentContext.js'
import type { PackageEnablementStore } from '@main/packages/packageEnablement.js'
import type { PackageRuntime } from '@main/packages/packageRuntime.js'
import type { PackageLoader } from '@main/packages/packages.js'

export function createAgentContextContributionsProvider(options: {
  runtime: PackageRuntime
  packages: PackageLoader
}): (workspacePath: string) => Promise<AgentContextAppSection[]> {
  return async (_workspacePath) => {
    const caps = await options.runtime.listCapabilities()
    const sections: AgentContextAppSection[] = []

    for (const cap of caps) {
      if (!cap.agentContext) continue
      const pkg = options.packages.get(cap.packageId)
      if (!pkg) continue

      try {
        const ctx = options.runtime.createContext({ pkg })
        const raw = await cap.agentContext(ctx)

        if (typeof raw === 'string') {
          sections.push({ appId: cap.packageId, title: pkg.manifest.name, body: raw })
        } else if (raw && typeof raw === 'object') {
          const obj = raw as Record<string, unknown>
          const title = typeof obj.title === 'string' ? obj.title : pkg.manifest.name
          const body = typeof obj.body === 'string' ? obj.body : null
          if (body) sections.push({ appId: cap.packageId, title, body })
        }
      } catch {
        // Per-app best-effort: skip on error.
      }
    }

    return sections
  }
}

export function createLocalPackageStatusProvider(options: {
  runtime: PackageRuntime
  packages: PackageLoader
  enablement: PackageEnablementStore
}): (workspacePath: string) => Promise<AgentContextLocalPackage[]> {
  return async (workspacePath) => {
    const localRoot = join(workspacePath, 'packages')
    if (!existsSync(localRoot)) return []

    const ids = readdirSync(localRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    const diagnostics = options.packages.diagnostics()
    const results: AgentContextLocalPackage[] = []

    for (const id of ids) {
      const pkg = options.packages.get(id)
      if (!pkg || pkg.source !== 'project') {
        results.push({
          id,
          enabled: false,
          loaded: false,
          tools: 0,
          jobs: 0,
          skills: countPackageSkills(join(localRoot, id)),
          diagnostics: diagnostics
            .filter(d => d.packageId === id || d.path.includes(join('packages', id)))
            .map(d => d.message),
        })
        continue
      }

      const enabled = options.enablement.isEnabled(pkg)
      let tools = 0
      let jobs = 0
      let loaded = !pkg.manifest.backend
      const runtimeDiagnostics: string[] = []

      if (enabled) {
        try {
          const caps = await options.runtime.loadCapabilities(id)
          tools = caps.tools.length
          jobs = caps.jobs.length
          runtimeDiagnostics.push(...caps.diagnostics)
          loaded = !caps.diagnostics.some(d => d.includes('Failed to import backend'))
        } catch (err) {
          runtimeDiagnostics.push((err as Error).message)
          loaded = false
        }
      }

      results.push({
        id,
        name: pkg.manifest.name,
        enabled,
        loaded,
        tools,
        jobs,
        skills: countPackageSkills(pkg.dir),
        diagnostics: [
          ...diagnostics
            .filter(d => d.packageId === id)
            .map(d => d.message),
          ...runtimeDiagnostics,
        ],
      })
    }

    return results
  }
}

function countPackageSkills(packageDir: string): number {
  const skillsDir = join(packageDir, 'skills')
  if (!existsSync(skillsDir)) return 0
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(skillsDir, entry.name, 'SKILL.md')))
    .length
}
