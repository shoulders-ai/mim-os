import type { ToolRegistry } from '@main/tools/registry.js'
import { detectToolchain, resetToolchainDetection, type ToolchainDetectDeps } from '@main/toolchain/toolchain.js'

export function registerToolchainTools(tools: ToolRegistry, deps?: ToolchainDetectDeps): void {
  tools.register({
    name: 'toolchain.status',
    description: 'Report detected interpreters (R, Rscript, Quarto, pandoc, python3) with versions and paths',
    execute: async () => {
      const entries = await detectToolchain(deps)
      return { entries }
    },
  })
}

export { resetToolchainDetection }
