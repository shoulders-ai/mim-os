/**
 * Cached renderer-side service for querying toolchain detection status.
 * Fetches once via `window.kernel.call('toolchain.status', {})` and caches
 * the promise. Use `resetToolchainCache()` to force a re-fetch (tests, workspace switch).
 */

export interface ToolchainEntry {
  id: string
  name: string
  bin: string
  installed: boolean
  binPath?: string
  version?: string
}

export interface ToolchainStatusResult {
  entries: ToolchainEntry[]
  hasQuarto: boolean
  hasRscript: boolean
  /** True when at least one render engine (quarto or rscript) is available. */
  canRender: boolean
}

let cached: Promise<ToolchainStatusResult> | null = null

/**
 * Get the toolchain status, calling the kernel tool once and caching the result.
 */
export function getToolchainStatus(): Promise<ToolchainStatusResult> {
  if (!cached) {
    cached = fetchToolchainStatus()
  }
  return cached
}

/**
 * Clear the cached promise so the next call to `getToolchainStatus()` re-fetches.
 */
export function resetToolchainCache(): void {
  cached = null
}

async function fetchToolchainStatus(): Promise<ToolchainStatusResult> {
  try {
    const response = await window.kernel.call('toolchain.status', {}) as { entries?: ToolchainEntry[] }
    const entries: ToolchainEntry[] = Array.isArray(response?.entries) ? response.entries : []
    const hasQuarto = entries.some(e => e.id === 'quarto' && e.installed)
    const hasRscript = entries.some(e => e.id === 'rscript' && e.installed)
    return { entries, hasQuarto, hasRscript, canRender: hasQuarto || hasRscript }
  } catch {
    return { entries: [], hasQuarto: false, hasRscript: false, canRender: false }
  }
}
