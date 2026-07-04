import { describe, expect, it } from 'vitest'
import { buildInterpreterRows, type InterpreterRowVM, type ToolchainEntry } from './codeInterpreterRows'

function entry(overrides: Partial<ToolchainEntry> = {}): ToolchainEntry {
  return {
    id: 'rscript',
    name: 'Rscript',
    bin: 'Rscript',
    installed: true,
    binPath: '/usr/local/bin/Rscript',
    version: 'R scripting front-end version 4.4.1',
    ...overrides,
  }
}

describe('buildInterpreterRows', () => {
  it('produces a row for each interpreter entry (excludes pandoc)', () => {
    const entries: ToolchainEntry[] = [
      entry({ id: 'r', name: 'R', bin: 'R', version: '4.4.1' }),
      entry({ id: 'rscript', name: 'Rscript', bin: 'Rscript', version: '4.4.1' }),
      entry({ id: 'quarto', name: 'Quarto', bin: 'quarto', version: '1.5.57' }),
      entry({ id: 'pandoc', name: 'pandoc', bin: 'pandoc', version: '3.1.11' }),
      entry({ id: 'python3', name: 'Python', bin: 'python3', version: '3.12.0' }),
    ]
    const rows = buildInterpreterRows(entries, ['rscript', 'r', 'quarto'])
    // pandoc excluded — only 4 rows
    expect(rows).toHaveLength(4)
    expect(rows.map(r => r.id)).toEqual(['r', 'rscript', 'quarto', 'python3'])
  })

  it('marks installed entries with version label', () => {
    const entries: ToolchainEntry[] = [
      entry({ id: 'rscript', version: '4.4.1' }),
    ]
    const [row] = buildInterpreterRows(entries, ['rscript'])
    expect(row.installed).toBe(true)
    expect(row.versionLabel).toBe('4.4.1')
  })

  it('marks not-installed entries with "not found" label', () => {
    const entries: ToolchainEntry[] = [
      entry({ id: 'quarto', name: 'Quarto', installed: false, binPath: undefined, version: undefined }),
    ]
    const [row] = buildInterpreterRows(entries, ['rscript', 'r', 'quarto'])
    expect(row.installed).toBe(false)
    expect(row.versionLabel).toBe('not found')
  })

  it('sets enabled=true when id is in the allowlist', () => {
    const entries: ToolchainEntry[] = [
      entry({ id: 'rscript' }),
      entry({ id: 'python3', name: 'Python', bin: 'python3', version: '3.12.0' }),
    ]
    const rows = buildInterpreterRows(entries, ['rscript'])
    const rscript = rows.find(r => r.id === 'rscript')!
    const python = rows.find(r => r.id === 'python3')!
    expect(rscript.enabled).toBe(true)
    expect(python.enabled).toBe(false)
  })

  it('returns enabled=false for not-installed entries even if in allowlist', () => {
    const entries: ToolchainEntry[] = [
      entry({ id: 'quarto', name: 'Quarto', installed: false, binPath: undefined, version: undefined }),
    ]
    // quarto is in allowlist but not installed — toggle should be disabled (canToggle false)
    const [row] = buildInterpreterRows(entries, ['quarto'])
    expect(row.enabled).toBe(true) // allowlist membership reflected
    expect(row.canToggle).toBe(false) // but toggle is disabled
  })

  it('uses entry name as label', () => {
    const entries: ToolchainEntry[] = [
      entry({ id: 'r', name: 'R' }),
    ]
    const [row] = buildInterpreterRows(entries, ['r'])
    expect(row.label).toBe('R')
  })

  it('returns empty array when no entries provided', () => {
    expect(buildInterpreterRows([], ['rscript'])).toEqual([])
  })

  it('handles missing allowlist gracefully (empty array)', () => {
    const entries: ToolchainEntry[] = [entry({ id: 'rscript' })]
    const rows = buildInterpreterRows(entries, [])
    expect(rows[0].enabled).toBe(false)
  })

  it('preserves catalog order: r, rscript, quarto, python3', () => {
    const entries: ToolchainEntry[] = [
      entry({ id: 'python3', name: 'Python', bin: 'python3' }),
      entry({ id: 'quarto', name: 'Quarto', bin: 'quarto' }),
      entry({ id: 'r', name: 'R', bin: 'R' }),
      entry({ id: 'rscript', name: 'Rscript', bin: 'Rscript' }),
      entry({ id: 'pandoc', name: 'pandoc', bin: 'pandoc' }),
    ]
    const rows = buildInterpreterRows(entries, [])
    expect(rows.map(r => r.id)).toEqual(['r', 'rscript', 'quarto', 'python3'])
  })
})
