import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getSystemPrompt } from '@main/ai/systemPrompt.js'

describe('getSystemPrompt', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-sysprompt-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the bare preamble with no path and no contract/context headers', () => {
    const out = getSystemPrompt()
    expect(out).toContain('# ROLE')
    expect(out).toContain('# WORKSPACE')
    expect(out).not.toContain('# WORKSPACE CONTRACT')
    expect(out).not.toContain('# WORKSPACE CONTEXT')
  })

  it('no longer describes the false docs/ layout', () => {
    const out = getSystemPrompt()
    expect(out).not.toContain('docs/ — documents')
    expect(out).toContain('AGENTS.md')
    expect(out).toContain('.mim/')
  })

  it('tells the model that the final response must stand on its own', () => {
    const out = getSystemPrompt()
    expect(out).toContain('progress may be collapsed')
    expect(out).toContain('Make the final response stand on its own')
  })

  it('appends AGENTS.md and agent-context.md sections with their contents', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'CONTRACT BODY HERE')
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(join(dir, '.mim', 'agent-context.md'), 'CONTEXT BODY HERE')
    const out = getSystemPrompt(dir)
    expect(out).toContain('# WORKSPACE CONTRACT (AGENTS.md)')
    expect(out).toContain('CONTRACT BODY HERE')
    expect(out).toContain('# WORKSPACE CONTEXT (.mim/agent-context.md)')
    expect(out).toContain('CONTEXT BODY HERE')
  })

  it('omits a section when its file is absent', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'ONLY CONTRACT')
    const out = getSystemPrompt(dir)
    expect(out).toContain('# WORKSPACE CONTRACT (AGENTS.md)')
    expect(out).not.toContain('# WORKSPACE CONTEXT')
  })

  it('never throws when files are missing', () => {
    expect(() => getSystemPrompt(dir)).not.toThrow()
    expect(() => getSystemPrompt('/nonexistent/path/xyz')).not.toThrow()
  })

  it('advertises the registry/install tools wired in both kernels', () => {
    const out = getSystemPrompt()
    expect(out).toContain('registry_list')
    expect(out).toContain('package_install')
    expect(out).toContain('package_update')
    expect(out).toContain('package_uninstall')
  })

  it('describes the enablement model briefly', () => {
    const out = getSystemPrompt()
    // Should mention per-workspace enablement via mim.yaml.
    expect(out).toContain('mim.yaml')
    expect(out).toContain('enabl')
  })
})
