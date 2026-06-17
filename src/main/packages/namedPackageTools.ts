import { matchesToolGrant, applyToolRiskFloor } from '@main/packages/packageManifest.js'
import type { ToolPolicy } from '@main/security/gate.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import type { PackageRuntime } from '@main/packages/packageRuntime.js'
import type { PackageLoader } from '@main/packages/packages.js'

export interface NamedPackageToolSync {
  /** Re-resolve capabilities and reconcile ToolRegistry registrations. */
  sync(): Promise<void>
  /** Per-tool gate policy for names this registrar owns; wired into gate.getDynamicToolPolicy by the kernel. */
  getPolicy(name: string): ToolPolicy | undefined
  /** Collision and grant problems from the last sync. */
  diagnostics(): string[]
}

export function createNamedPackageToolSync(options: {
  runtime: PackageRuntime
  tools: ToolRegistry
  packages: PackageLoader
}): NamedPackageToolSync {
  const owned = new Set<string>()
  const policyMap = new Map<string, ToolPolicy>()
  let lastDiagnostics: string[] = []

  return {
    async sync() {
      const caps = await options.runtime.listCapabilities()
      const nextOwned = new Set<string>()
      const nextPolicies = new Map<string, ToolPolicy>()
      const diags: string[] = []

      for (const cap of caps) {
        const pkg = options.packages.get(cap.packageId)
        if (!pkg) continue
        const grants = pkg.manifest.provides?.tools ?? []

        for (const tool of cap.tools) {
          if (!tool.named) continue

          const existing = options.tools.get(tool.publicName)
          if (existing && !owned.has(tool.publicName)) {
            // Core tools are unoverridable — security property: a package cannot
            // replace a core tool by claiming its name.
            diags.push(`Named tool "${tool.publicName}" from ${cap.packageId} collides with existing registration`)
            continue
          }

          if (nextOwned.has(tool.publicName)) {
            // First-enabled-package-wins between packages.
            diags.push(`Named tool "${tool.publicName}" from ${cap.packageId} collides with an earlier package`)
            continue
          }

          options.tools.register({
            name: tool.publicName,
            description: tool.description,
            inputSchema: tool.inputSchema,
            execute: async (params, ctx) => options.runtime.executeTool(tool.publicName, params, ctx),
          })
          nextOwned.add(tool.publicName)

          // Build policy from the first matching grant in manifest order.
          // Re-applying the risk floor here closes the wildcard-grant loophole:
          // a wildcard `issues.*` declared low cannot make `issues.delete` low.
          const grant = grants.find(g => matchesToolGrant(g.pattern, tool.publicName))
          if (grant) {
            nextPolicies.set(tool.publicName, {
              category: grant.category,
              risk: applyToolRiskFloor(tool.publicName, grant.risk),
              label: `${pkg.manifest.name}: ${tool.label}`,
              ownerPackageId: pkg.manifest.id,
            })
          }
        }
      }

      // Stale reconciliation: unregister names we owned that are no longer present.
      // NEVER unregister a name the registrar does not own.
      for (const name of owned) {
        if (!nextOwned.has(name)) {
          options.tools.unregister(name)
        }
      }

      owned.clear()
      for (const name of nextOwned) owned.add(name)
      policyMap.clear()
      for (const [k, v] of nextPolicies) policyMap.set(k, v)
      lastDiagnostics = diags
    },

    getPolicy(name) {
      return policyMap.get(name)
    },

    diagnostics() {
      return lastDiagnostics
    },
  }
}
