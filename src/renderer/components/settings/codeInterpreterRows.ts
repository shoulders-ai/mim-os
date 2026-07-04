/**
 * Pure view-model builder for the code-interpreter rows in the Tools settings panel.
 * Merges toolchain detection entries with the user's codeInterpreters allowlist setting
 * to produce toggle-ready row data.
 */

export interface ToolchainEntry {
  id: string
  name: string
  bin: string
  installed: boolean
  binPath?: string
  version?: string
}

export interface InterpreterRowVM {
  id: string
  label: string
  versionLabel: string
  installed: boolean
  enabled: boolean
  /** Whether the toggle is interactive (false when not installed). */
  canToggle: boolean
}

/**
 * Canonical display order for interpreter entries.
 * pandoc is excluded — it has no interpreter role in the allowlist.
 */
const INTERPRETER_ORDER: string[] = ['r', 'rscript', 'quarto', 'python3']

/**
 * Build interpreter row view-models from toolchain detection output and the current
 * codeInterpreters setting value.
 */
export function buildInterpreterRows(
  entries: ToolchainEntry[],
  allowlist: string[],
): InterpreterRowVM[] {
  const allowSet = new Set(allowlist)
  const entryMap = new Map(entries.map(e => [e.id, e]))

  return INTERPRETER_ORDER
    .filter(id => entryMap.has(id))
    .map(id => {
      const e = entryMap.get(id)!
      const installed = e.installed
      return {
        id: e.id,
        label: e.name,
        versionLabel: installed ? (e.version ?? 'installed') : 'not found',
        installed,
        enabled: allowSet.has(e.id),
        canToggle: installed,
      }
    })
}
