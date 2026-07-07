import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parse as parseYaml } from 'yaml'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerPackageTools } from '@main/tools/packages.js'
import { listSkillTemplates, renderSkillTemplate } from '@main/templates/skillTemplates.js'
import { listAppTemplates, renderAppTemplate } from '@main/templates/appTemplates.js'

function frontmatterOf(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  expect(match).toBeTruthy()
  const parsed = parseYaml(match![1])
  expect(parsed).toBeTruthy()
  expect(typeof parsed).toBe('object')
  expect(Array.isArray(parsed)).toBe(false)
  return parsed as Record<string, unknown>
}

function stubPackageLoader() {
  return {
    list: () => [],
    get: () => undefined,
    diagnostics: () => [],
    onChange: () => {},
    rescan: async () => {},
  }
}

describe('starter templates', () => {
  let root: string | null = null

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  it('renders skill templates with override-safe frontmatter', () => {
    const listed = listSkillTemplates()
    expect(listed.templates.map(template => template.id)).toEqual(['review-checklist', 'house-style', 'r-modelling'])

    const rendered = renderSkillTemplate('review-checklist', {
      name: 'clinical-review',
      description: 'Use when reviewing CRO documents against the clinical checklist.',
    })
    const meta = frontmatterOf(rendered.content)

    expect(meta.name).toBe('clinical-review')
    expect(meta.description).toBe('Use when reviewing CRO documents against the clinical checklist.')
    expect(meta.tools).toEqual(['fs_read', 'fs_write'])
    expect(meta.unlocks).toEqual([])
  })

  it('renders the r-modelling skill template with correct frontmatter and body', () => {
    const rendered = renderSkillTemplate('r-modelling')
    const meta = frontmatterOf(rendered.content)

    expect(meta.name).toBe('r-modelling')
    expect(meta.description).toBe('Use when running R analyses, fitting models, or rendering R Markdown/Quarto reports.')
    expect(meta.tools).toEqual(['bash', 'editor_open', 'fs_read', 'fs_write'])
    expect(meta.unlocks).toEqual([])
    expect(rendered.content).toContain('# R Modelling')
    expect(rendered.content.length).toBeGreaterThan(200)
    expect(rendered.files).toBeUndefined()
  })

  it('renders house style with bundled relative reference files', () => {
    const rendered = renderSkillTemplate('house-style', {
      name: 'team-style',
      description: 'Use when applying the team house style.',
    })

    expect(rendered.files).toEqual({
      'references/glossary.md': expect.stringContaining('preferred terms'),
    })
    expect(rendered.content).toContain('references/glossary.md')
  })

  it('rewrites every coupled Word Count identifier from the app id override', () => {
    const params = renderAppTemplate('word-count', {
      id: 'trial-counter',
      name: 'Trial Counter',
    })
    const backend = String(params.backend)
    const readme = String(params.readme)
    const skill = (params.skills as Array<{ name: string; content: string }>)[0]
    const skillMeta = frontmatterOf(skill.content)

    expect(params.id).toBe('trial-counter')
    expect(params.name).toBe('Trial Counter')
    expect(params.provides).toEqual({
      tools: [{ name: 'trial_counter.analyze', category: 'read', risk: 'low' }],
    })
    expect(backend).toContain("name: 'trial_counter.analyze'")
    expect(skill.name).toBe('trial-counter')
    expect(skillMeta.name).toBe('trial-counter')
    expect(skillMeta.unlocks).toEqual(['trial_counter.analyze'])
    expect(readme).toContain('trial_counter.analyze')
    expect(readme).not.toContain('word_count.analyze')
  })

  it('uses current package job event names in the Summarize UI template', () => {
    const params = renderAppTemplate('summarize')
    const js = String(params.js)

    expect(js).toContain("jobEvent.type === 'job.done'")
    expect(js).not.toContain('job.completed')
  })

  it('renders the Agent template with agents export, skill, and id coupling', () => {
    const params = renderAppTemplate('agent', {
      id: 'stats-referee',
      name: 'Stats Referee',
    })
    const backend = String(params.backend)
    const readme = String(params.readme)
    const skill = (params.skills as Array<{ name: string; content: string }>)[0]
    const skillMeta = frontmatterOf(skill.content)

    expect(params.id).toBe('stats-referee')
    expect(params.name).toBe('Stats Referee')
    expect(params.icon).toBe('S')

    // Backend exports agents, not tools or jobs
    expect(backend).toContain('export const agents')
    expect(backend).toContain("name: 'Stats Referee'")
    expect(backend).toContain('statsReferee:')
    expect(backend).toContain("skills: ['stats-referee']")
    expect(backend).toContain('ctx.data.kv.get')
    expect(backend).toContain('{{WORKSPACE_TREE}}')
    expect(backend).not.toContain('export const tools')
    expect(backend).not.toContain('export const jobs')

    // No views, no provides — headless agent-only app
    expect(params.html).toBeUndefined()
    expect(params.js).toBeUndefined()
    expect(params.provides).toBeUndefined()

    // Skill is coupled to the app id
    expect(skill.name).toBe('stats-referee')
    expect(skillMeta.name).toBe('stats-referee')

    // README mentions the iterate loop
    expect(readme).toContain('package.validate')
    expect(readme).toContain('package.reload')
  })

  it('creates and validates every rendered app template', async () => {
    root = mkdtempSync(join(tmpdir(), 'mim-template-test-'))
    const tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(root)
    registerPackageTools(tools, stubPackageLoader() as never)

    for (const template of listAppTemplates().templates) {
      const id = `${template.defaultId}-demo`
      const params = renderAppTemplate(template.id, { id, name: `${template.defaultName} Demo` })
      await tools.call('package.create', params as Record<string, unknown>, { actor: 'user' })
      const validation = await tools.call('package.validate', { id }, { actor: 'user' }) as {
        valid: boolean
        errors: unknown[]
        warnings: unknown[]
      }

      expect(validation.valid, `${template.id} should validate`).toBe(true)
      expect(validation.errors).toEqual([])
      expect(validation.warnings).toEqual([])
      const packageJson = JSON.parse(readFileSync(join(root, 'packages', id, 'package.json'), 'utf-8'))
      expect(packageJson.mim.id).toBe(id)
      expect(packageJson.mim.name).toBe(`${template.defaultName} Demo`)
    }
  })
})
