import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getSystemPrompt, resolveTemplateVars } from '@main/ai/systemPrompt.js'

describe('getSystemPrompt', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-sysprompt-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the default template prompt with no path and resolves template vars', () => {
    const out = getSystemPrompt()
    expect(out).toContain('Agent Instructions')
    expect(out).toContain('fs_read')
    expect(out).not.toContain('{{TOOL_SET}}')
    expect(out).not.toContain('{{DATE_TODAY}}')
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

  it('appends AGENTS.md and agent-context.md sections with their contents in legacy mode', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'CONTRACT BODY HERE')
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(join(dir, '.mim', 'agent-context.md'), 'CONTEXT BODY HERE')
    const out = getSystemPrompt(dir)
    expect(out).toContain('# WORKSPACE CONTRACT (AGENTS.md)')
    expect(out).toContain('CONTRACT BODY HERE')
    expect(out).toContain('# WORKSPACE CONTEXT (.mim/agent-context.md)')
    expect(out).toContain('CONTEXT BODY HERE')
  })

  it('omits a section when its file is absent in legacy mode', () => {
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
    expect(out).toContain('mim.yaml')
    expect(out).toContain('enabl')
  })

  it('resolves template variables in AGENTS.md', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'Date: {{DATE_TODAY}}\nTools: {{TOOL_SET}}')
    const out = getSystemPrompt(dir)
    expect(out).not.toContain('{{DATE_TODAY}}')
    expect(out).not.toContain('{{TOOL_SET}}')
    expect(out).toContain('fs_read')
    expect(out).toMatch(/\w+day, \d+ \w+ \d{4}/)
  })

  it('falls back to legacy mode when AGENTS.md has no templates', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'Plain workspace contract without templates')
    const out = getSystemPrompt(dir)
    expect(out).toContain('# WORKSPACE CONTRACT (AGENTS.md)')
    expect(out).toContain('# ROLE')
  })

  it('resolves {{AGENT_CONTEXT}} from .mim/agent-context.md', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'Context: {{AGENT_CONTEXT}}\nTools: {{TOOL_SET}}')
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(join(dir, '.mim', 'agent-context.md'), 'Current sprint: fixing bugs')
    const out = getSystemPrompt(dir)
    expect(out).toContain('Current sprint: fixing bugs')
    expect(out).not.toContain('{{AGENT_CONTEXT}}')
  })

  it('leaves unknown template variables as-is', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '{{UNKNOWN_VAR}} and {{TOOL_SET}}')
    const out = getSystemPrompt(dir)
    expect(out).toContain('{{UNKNOWN_VAR}}')
    expect(out).not.toContain('{{TOOL_SET}}')
  })
})

describe('resolveTemplateVars', () => {
  it('is a pure function that replaces known vars and preserves unknown ones', () => {
    const template = 'Hello {{NAME}}, today is {{DATE}}. {{MISSING}} stays.'
    const vars = { NAME: 'World', DATE: '2026-06-21' }
    const result = resolveTemplateVars(template, vars)
    expect(result).toBe('Hello World, today is 2026-06-21. {{MISSING}} stays.')
  })

  it('returns the template unchanged when no vars match', () => {
    const template = 'No {{VARS}} here'
    const result = resolveTemplateVars(template, {})
    expect(result).toBe('No {{VARS}} here')
  })

  it('handles empty template', () => {
    expect(resolveTemplateVars('', { A: 'B' })).toBe('')
  })

  it('replaces multiple occurrences of the same variable', () => {
    const result = resolveTemplateVars('{{X}} and {{X}}', { X: 'Y' })
    expect(result).toBe('Y and Y')
  })
})
