import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createSkillLoader } from '@main/skills.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerSkillTools } from '@main/tools/skills.js'
import { loadUserConfig, reset as resetUserConfig } from '@main/userConfig.js'

const ctx = { actor: 'user' as const }

describe('skill tools', () => {
  let root: string
  let builtinDir: string
  let home: string
  let workspaceDir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mim-skill-tools-'))
    home = join(root, 'home')
    builtinDir = join(root, 'builtin-skills')
    workspaceDir = join(root, 'workspace')
    process.env.HOME = home
    resetUserConfig()
    mkdirSync(workspaceDir, { recursive: true })
    const issueSkillDir = join(builtinDir, 'issue-work')
    mkdirSync(issueSkillDir, { recursive: true })
    writeFileSync(join(issueSkillDir, 'SKILL.md'), [
      '---',
      'name: issue-work',
      'description: Use when working with Mim issues.',
      'tools: [issues.list, issues.update]',
      'unlocks: [issues.list, issues.update]',
      '---',
      '',
      '# Issue Work',
      '',
      'Keep issue plans current.',
    ].join('\n'), 'utf-8')

    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(workspaceDir)
    registerSkillTools(tools, {
      homeDir: home,
      builtinDir,
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    resetUserConfig()
  })

  it('declares inputSchema on each skill tool', () => {
    for (const name of [
      'skill.list',
      'skill.get',
      'skill.setDisabled',
      'skill.create',
      'skill.templateList',
      'skill.templateContent',
      'skill.inspectImport',
      'skill.import',
      'skill.delete',
      'skillSource.list',
      'skillSource.inspect',
      'skillSource.add',
      'skillSource.remove',
      'skillSource.refresh',
    ]) {
      const def = tools.get(name)
      expect(def, name).toBeDefined()
      expect(def!.inputSchema, name).toBeDefined()
      expect((def as Record<string, unknown>).parameters, name).toBeUndefined()
    }
  })

  it('lists skill metadata without loading body text', async () => {
    const result = await tools.call('skill.list', {}, ctx) as { skills: Array<Record<string, unknown>> }

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]).toMatchObject({
      name: 'issue-work',
      description: 'Use when working with Mim issues.',
      tools: ['issues.list', 'issues.update'],
      source: 'builtin',
    })
    expect(result.skills[0]).not.toHaveProperty('body')
  })

  it('returns the activated skill body and declared tools', async () => {
    const result = await tools.call('skill.get', { name: 'issue-work' }, ctx) as { skill: Record<string, unknown> }

    expect(result.skill).toMatchObject({
      name: 'issue-work',
      body: expect.stringContaining('Keep issue plans current.'),
      tools: ['issues.list', 'issues.update'],
    })
  })

  it('skill.list exposes unlocks array', async () => {
    const result = await tools.call('skill.list', {}, ctx) as { skills: Array<Record<string, unknown>> }

    expect(result.skills[0]).toMatchObject({
      name: 'issue-work',
      unlocks: ['issues.list', 'issues.update'],
    })
  })

  it('disables skills through mim.yaml and omits them from the active list', async () => {
    await tools.call('skill.setDisabled', { name: 'issue-work', disabled: true }, ctx)

    const active = await tools.call('skill.list', {}, ctx) as { skills: Array<Record<string, unknown>> }
    const detailed = await tools.call('skill.list', { detailed: true }, ctx) as { skills: Array<Record<string, unknown>> }

    expect(active.skills).toEqual([])
    expect(detailed.skills[0]).toMatchObject({ name: 'issue-work', enabled: false })
    expect(loadUserConfig(home).skills.disabled).toEqual(['issue-work'])
  })

  it('creates a personal skill template', async () => {
    const result = await tools.call('skill.create', { name: 'new-skill' }, ctx) as { skill: Record<string, unknown> }

    expect(result.skill).toMatchObject({
      name: 'new-skill',
      source: 'personal',
      dir: join(home, '.mim', 'skills', 'new-skill'),
      path: join(home, '.mim', 'skills', 'new-skill', 'SKILL.md'),
    })
    expect(readFileSync(join(home, '.mim', 'skills', 'new-skill', 'SKILL.md'), 'utf-8')).toContain('## When to use')
    await expect(tools.call('skill.get', { name: 'new-skill' }, ctx)).resolves.toMatchObject({
      skill: {
        name: 'new-skill',
        source: 'personal',
        body: expect.stringContaining('## When to use'),
      },
    })
  })

  it('creates a personal skill from supplied content and extra files', async () => {
    const content = [
      '---',
      'name: review-checklist',
      'description: Use when reviewing a checklist.',
      'tools: [fs_read, fs_write]',
      'unlocks: []',
      '---',
      '',
      '# Review Checklist',
      '',
      'Follow the checklist.',
    ].join('\n')

    const result = await tools.call('skill.create', {
      name: 'review-checklist',
      description: 'Use when reviewing a checklist.',
      content,
      files: {
        'references/checklist.md': '# Checklist\n',
      },
    }, ctx) as { skill: Record<string, unknown> }

    expect(result.skill).toMatchObject({
      name: 'review-checklist',
      source: 'personal',
      dir: join(home, '.mim', 'skills', 'review-checklist'),
      path: join(home, '.mim', 'skills', 'review-checklist', 'SKILL.md'),
    })
    expect(readFileSync(join(home, '.mim', 'skills', 'review-checklist', 'SKILL.md'), 'utf-8')).toBe(content)
    expect(readFileSync(join(home, '.mim', 'skills', 'review-checklist', 'references', 'checklist.md'), 'utf-8')).toBe('# Checklist\n')
    await expect(tools.call('skill.get', { name: 'review-checklist' }, ctx)).resolves.toMatchObject({
      skill: {
        name: 'review-checklist',
        description: 'Use when reviewing a checklist.',
        body: expect.stringContaining('Follow the checklist.'),
      },
    })
  })

  it('rejects supplied skill content whose frontmatter name does not match the requested name', async () => {
    await expect(tools.call('skill.create', {
      name: 'expected-name',
      content: [
        '---',
        'name: wrong-name',
        'description: Use when wrong.',
        '---',
        '',
        '# Wrong',
      ].join('\n'),
    }, ctx)).rejects.toThrow('name must match')
  })

  it('rejects unsafe extra file paths for supplied skill content', async () => {
    const content = [
      '---',
      'name: safe-files',
      'description: Use when testing safe files.',
      '---',
      '',
      '# Safe files',
    ].join('\n')

    await expect(tools.call('skill.create', {
      name: 'safe-files',
      content,
      files: { '../escape.md': 'no' },
    }, ctx)).rejects.toThrow(/outside|traversal|relative/i)

    await expect(tools.call('skill.create', {
      name: 'safe-files',
      content,
      files: { '/tmp/escape.md': 'no' },
    }, ctx)).rejects.toThrow(/absolute|relative/i)

    await expect(tools.call('skill.create', {
      name: 'safe-files',
      content,
      files: { 'SKILL.md': 'no' },
    }, ctx)).rejects.toThrow(/SKILL\.md/)

    await expect(tools.call('skill.create', {
      name: 'safe-files',
      content,
      files: { 'references/a.md': 7 },
    }, ctx)).rejects.toThrow(/string/)

    expect(existsSync(join(home, '.mim', 'skills', 'safe-files'))).toBe(false)
  })

  it('returns skill template content with name and description overrides applied', async () => {
    const list = await tools.call('skill.templateList', {}, ctx) as {
      templates: Array<{ id: string; defaultName: string; defaultDescription: string }>
    }
    expect(list.templates.map(template => template.id)).toEqual(['review-checklist', 'house-style', 'r-modelling'])

    const rendered = await tools.call('skill.templateContent', {
      templateId: 'review-checklist',
      name: 'review-checklist-custom',
      description: 'Use when custom review is needed.',
    }, ctx) as { name: string; description: string; content: string }

    expect(rendered).toMatchObject({
      name: 'review-checklist-custom',
      description: 'Use when custom review is needed.',
    })
    expect(rendered.content).toContain('name: review-checklist-custom')
    expect(rendered.content).toContain('description: Use when custom review is needed.')
  })

  it('inspects then imports a skill folder into Personal only after confirmation', async () => {
    const sourceDir = join(root, 'incoming-skill')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'SKILL.md'), [
      '---',
      'name: imported-skill',
      'description: Use when importing.',
      'unlocks: [issues.create]',
      '---',
      '',
      '# Imported',
    ].join('\n'))

    await expect(tools.call('skill.import', { folder: sourceDir }, ctx)).rejects.toThrow('confirmation')

    await expect(tools.call('skill.inspectImport', { folder: sourceDir }, ctx)).resolves.toMatchObject({
      skill: {
        name: 'imported-skill',
        unlocks: ['issues.create'],
      },
      unlocks: ['issues.create'],
    })

    const imported = await tools.call('skill.import', { folder: sourceDir, confirmed: true }, ctx) as { skill: Record<string, unknown> }
    expect(imported.skill).toMatchObject({
      name: 'imported-skill',
      source: 'personal',
      dir: join(home, '.mim', 'skills', 'imported-skill'),
    })
    expect(existsSync(join(home, '.mim', 'skills', 'imported-skill', 'SKILL.md'))).toBe(true)
  })

  it('rejects symlinked import folders', async () => {
    const sourceDir = join(root, 'symlink-skill')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(join(sourceDir, 'SKILL.md'), [
      '---',
      'name: symlink-skill',
      'description: Bad import.',
      '---',
      '',
    ].join('\n'))
    writeFileSync(join(root, 'secret.txt'), 'secret')
    symlinkSync(join(root, 'secret.txt'), join(sourceDir, 'secret-link.txt'))

    await expect(tools.call('skill.inspectImport', { folder: sourceDir }, ctx)).rejects.toThrow('Symlink')
  })

  it('excludes app skills from detailed settings listing but allows qualified activation', async () => {
    const pkgDir = join(root, 'package-skills')
    mkdirSync(join(pkgDir, 'review-work'), { recursive: true })
    writeFileSync(join(pkgDir, 'review-work', 'SKILL.md'), [
      '---',
      'name: review-work',
      'description: Use when reviewing.',
      '---',
      '',
      '# Review',
    ].join('\n'))

    const registry = createToolRegistry(createTraceLog())
    registry.setWorkspacePath(workspaceDir)
    registerSkillTools(registry, {
      homeDir: home,
      loader: createSkillLoader({
        builtinDir,
        personalDir: join(home, '.mim', 'skills'),
        getPackageSkillRoots: () => [{ packageId: 'review-app', packageName: 'Review App', dir: pkgDir }],
        getWorkspacePath: () => workspaceDir,
      }),
    })

    const active = await registry.call('skill.list', {}, ctx) as { skills: Array<Record<string, unknown>> }
    const detailed = await registry.call('skill.list', { detailed: true }, ctx) as { skills: Array<Record<string, unknown>> }
    expect(active.skills.map(skill => skill.id)).toContain('package:review-app/review-work')
    expect(detailed.skills.map(skill => skill.id)).not.toContain('package:review-app/review-work')
    await expect(registry.call('skill.get', { name: 'review-work' }, ctx)).resolves.toMatchObject({
      skill: {
        source: 'package',
        packageId: 'review-app',
      },
    })
    await expect(registry.call('skill.get', { name: 'package:review-app/review-work' }, ctx)).resolves.toMatchObject({
      skill: {
        source: 'package',
        packageId: 'review-app',
      },
    })
  })

  it('inspects, adds, lists, refreshes, and removes a local skill source', async () => {
    const sourceRoot = join(root, 'team-source')
    mkdirSync(join(sourceRoot, 'team-review'), { recursive: true })
    writeFileSync(join(sourceRoot, 'team-review', 'SKILL.md'), [
      '---',
      'name: team-review',
      'description: Use team review.',
      'unlocks: [issues.update]',
      '---',
      '',
      '# Team Review',
    ].join('\n'))

    await expect(tools.call('skillSource.add', {
      id: 'team',
      path: sourceRoot,
      name: 'Team skills',
    }, ctx)).rejects.toThrow('confirmation')

    await expect(tools.call('skillSource.inspect', {
      id: 'team',
      path: sourceRoot,
      name: 'Team skills',
    }, ctx)).resolves.toMatchObject({
      id: 'team',
      skillCount: 1,
      unlocks: ['issues.update'],
    })

    await tools.call('skillSource.add', {
      id: 'team',
      path: sourceRoot,
      name: 'Team skills',
      confirmed: true,
    }, ctx)

    await expect(tools.call('skillSource.list', {}, ctx)).resolves.toMatchObject({
      sources: [
        {
          id: 'team',
          name: 'Team skills',
          kind: 'path',
          location: sourceRoot,
          trusted: true,
          skillCount: 1,
        },
      ],
    })
    await expect(tools.call('skill.get', { name: 'team-review' }, ctx)).resolves.toMatchObject({
      skill: {
        source: 'source',
        sourceId: 'team',
      },
    })
    await expect(tools.call('skillSource.refresh', { id: 'team' }, ctx)).resolves.toMatchObject({ refreshed: 'team' })

    await tools.call('skillSource.remove', { id: 'team' }, ctx)
    await expect(tools.call('skillSource.list', {}, ctx)).resolves.toMatchObject({ sources: [] })
  })
})
