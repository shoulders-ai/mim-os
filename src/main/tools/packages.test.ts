import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerPackageTools } from '@main/tools/packages.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Minimal stub for PackageLoader
function stubPackageLoader() {
  const pkgs: Array<{
    manifest: {
      id: string
      name: string
      icon?: string
      description?: string
      views?: Array<{ id: string; label: string; src: string; role: 'work' | 'artifact' | 'either' }>
      backend?: string
      permissions?: Record<string, unknown>
    }
    dir: string
    source: string
    hasReadme: boolean
  }> = []
  const loader = {
    list: () => pkgs,
    get: (id: string) => pkgs.find(p => p.manifest.id === id),
    diagnostics: () => [],
    onChange: () => {},
    rescan: vi.fn(async () => {}),
    _add(manifest: { id: string; name: string; backend?: string; permissions?: Record<string, unknown> }, dir: string) {
      pkgs.push({ manifest, dir, source: 'workspace', hasReadme: existsSync(join(dir, 'README.md')) })
    },
    _addWithSource(manifest: { id: string; name: string; backend?: string; permissions?: Record<string, unknown> }, dir: string, source: string) {
      pkgs.push({ manifest, dir, source, hasReadme: existsSync(join(dir, 'README.md')) })
    }
  }
  return loader
}

describe('App tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  let loader: ReturnType<typeof stubPackageLoader>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-pkg-test-'))
    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    tools.setWorkspacePath(dir)
    loader = stubPackageLoader()
    registerPackageTools(tools, loader as any)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('package.create creates app manifest and html', async () => {
    const result = await tools.call('package.create', {
      id: 'test-pkg',
      name: 'Test Package',
      description: 'A test',
      icon: 'T',
      html: '<h1>Hello</h1>'
    }, ctx) as { created: string; path: string }

    expect(result.created).toBe('test-pkg')
    const manifest = JSON.parse(readFileSync(join(dir, 'packages/test-pkg/package.json'), 'utf-8'))
    expect(manifest.name).toBe('@mim/test-pkg')
    expect(manifest.mim.id).toBe('test-pkg')
    expect(manifest.mim.name).toBe('Test Package')
    expect(manifest.mim.views).toEqual([{ id: 'main', label: 'Test Package', src: './ui/index.html', role: 'work' }])
    expect(readFileSync(join(dir, 'packages/test-pkg/ui/index.html'), 'utf-8')).toBe('<h1>Hello</h1>')
  })

  it('package.create writes optional js file', async () => {
    await tools.call('package.create', {
      id: 'with-js',
      name: 'With JS',
      html: '<div></div>',
      js: 'console.log("hello")'
    }, ctx)

    expect(readFileSync(join(dir, 'packages/with-js/ui/app.js'), 'utf-8')).toBe('console.log("hello")')
  })

  it('package.create can scaffold a complete headless app', async () => {
    await tools.call('package.create', {
      id: 'pr-monitor',
      name: 'PR Monitor',
      description: 'Watch pull requests from chat.',
      backend: [
        'export const tools = {',
        '  list: {',
        "    name: 'github_prs.list',",
        "    description: 'List pull requests needing attention.',",
        "    inputSchema: { type: 'object', properties: {} },",
        '    async execute() { return { prs: [] } }',
        '  }',
        '}',
      ].join('\n'),
      permissions: {
        http: ['api.github.com'],
        secrets: ['github_token'],
      },
      provides: {
        tools: [{ name: 'github_prs.list', category: 'read', risk: 'low' }],
      },
      dataFolder: 'github-prs',
      skills: [{
        name: 'github-prs',
        content: [
          '---',
          'name: github-prs',
          'description: Use when checking pull requests that need review.',
          'unlocks: [github_prs.list]',
          '---',
          '',
          '# GitHub PRs',
          '',
          'Use github_prs.list first.',
        ].join('\n'),
      }],
      readme: '# PR Monitor\n\nAsk what pull requests need review.',
    }, ctx)

    const pkgDir = join(dir, 'packages/pr-monitor')
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'))
    expect(manifest.mim.views).toEqual([])
    expect(manifest.mim.backend).toBe('./backend/index.mjs')
    expect(manifest.mim.permissions).toEqual({
      http: ['api.github.com'],
      secrets: ['github_token'],
    })
    expect(manifest.mim.provides).toEqual({
      tools: [{ name: 'github_prs.list', category: 'read', risk: 'low' }],
    })
    expect(manifest.mim.dataFolder).toBe('github-prs')
    expect(readFileSync(join(pkgDir, 'backend/index.mjs'), 'utf-8')).toContain('github_prs.list')
    expect(readFileSync(join(pkgDir, 'skills/github-prs/SKILL.md'), 'utf-8')).toContain('github_prs.list')
    expect(readFileSync(join(pkgDir, 'README.md'), 'utf-8')).toContain('pull requests')
  })

  it('app template tools render package.create params with rewritten named-tool identifiers', async () => {
    const list = await tools.call('app.templateList', {}, ctx) as {
      templates: Array<{ id: string; defaultId: string; defaultName: string }>
    }
    expect(list.templates.map(template => template.id)).toEqual(['word-count', 'summarize', 'agent'])

    const params = await tools.call('app.templateContent', {
      templateId: 'word-count',
      id: 'trial-counter',
      name: 'Trial Counter',
    }, ctx) as Record<string, unknown>

    expect(params).toMatchObject({
      id: 'trial-counter',
      name: 'Trial Counter',
      provides: {
        tools: [{ name: 'trial_counter.analyze', category: 'read', risk: 'low' }],
      },
    })
    expect(String(params.backend)).toContain("name: 'trial_counter.analyze'")
    expect(String(params.readme)).toContain('trial_counter.analyze')
    const skill = (params.skills as Array<{ name: string; content: string }>)[0]
    expect(skill.name).toBe('trial-counter')
    expect(skill.content).toContain('unlocks:')
    expect(skill.content).toContain('trial_counter.analyze')
  })

  it('package.validate reports a complete app as valid', async () => {
    await tools.call('package.create', {
      id: 'valid-tools',
      name: 'Valid Tools',
      backend: [
        'export const tools = {',
        '  ping: {',
        "    name: 'valid_tools.ping',",
        "    description: 'Ping the package.',",
        '    async execute() { return { ok: true } }',
        '  }',
        '}',
        "export const agentContext = () => 'Ready.'",
      ].join('\n'),
      provides: { tools: [{ name: 'valid_tools.ping', category: 'read', risk: 'low' }] },
      skill: [
        '---',
        'name: valid-tools',
        'description: Use when testing package validation.',
        'unlocks: [valid_tools.ping]',
        '---',
        '',
        '# Valid Tools',
      ].join('\n'),
    }, ctx)

    const result = await tools.call('package.validate', { id: 'valid-tools' }, ctx) as {
      valid: boolean
      errors: unknown[]
      warnings: unknown[]
      summary: { tools: number; jobs: number; skills: number; namedTools: number }
    }

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.summary).toEqual({ tools: 1, jobs: 0, skills: 1, namedTools: 1, agents: 0 })
  })

  it('package.validate catches backend and skill diagnostics without requiring the app loader', async () => {
    const pkgDir = join(dir, 'packages/broken')
    mkdirSync(join(pkgDir, 'backend'), { recursive: true })
    mkdirSync(join(pkgDir, 'skills/bad-skill'), { recursive: true })
    writeFileSync(join(pkgDir, 'backend/index.mjs'), [
      'export const tools = {',
      '  list: {',
      "    name: 'broken.list',",
      "    description: 'List data.',",
      '    async execute() { return [] }',
      '  }',
      '}',
    ].join('\n'))
    writeFileSync(join(pkgDir, 'skills/bad-skill/SKILL.md'), [
      '---',
      'name: wrong-name',
      'description: Bad skill.',
      '---',
      '',
      '# Bad',
    ].join('\n'))
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@mim/broken',
      version: '0.1.0',
      type: 'module',
      mim: {
        manifestVersion: 1,
        id: 'broken',
        name: 'Broken',
        views: [],
        backend: './backend/index.mjs',
        permissions: {},
        provides: { tools: [{ name: 'broken.missing', category: 'read', risk: 'low' }] },
      },
    }, null, 2))

    const result = await tools.call('package.validate', { id: 'broken' }, ctx) as {
      valid: boolean
      errors: Array<{ message: string }>
      warnings: Array<{ message: string }>
    }

    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('broken.list') && e.message.includes('not granted'))).toBe(true)
    expect(result.errors.some(e => e.message.includes('Skill name must match folder name'))).toBe(true)
    expect(result.warnings.some(w => w.message.includes('broken.missing'))).toBe(true)
  })

  it('package.reload rescans, invalidates runtime state, syncs named tools, and emits app changes', async () => {
    const invalidate = vi.fn()
    const syncNamedTools = vi.fn(async () => {})
    const emit = vi.fn()
    const reloadTools = createToolRegistry(createTraceLog())
    reloadTools.setWorkspacePath(dir)
    registerPackageTools(reloadTools, loader as any, undefined, {
      invalidate,
      syncNamedTools,
      emit,
    })

    await expect(reloadTools.call('package.reload', { id: 'test-pkg' }, ctx))
      .resolves.toMatchObject({ reloaded: 'test-pkg' })

    expect(loader.rescan).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith('test-pkg')
    expect(syncNamedTools).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith('packages:changed', expect.anything())
  })

  it('package.create rejects duplicate id', async () => {
    await tools.call('package.create', { id: 'dupe', name: 'Dupe', html: '<p>1</p>' }, ctx)
    await expect(
      tools.call('package.create', { id: 'dupe', name: 'Dupe 2', html: '<p>2</p>' }, ctx)
    ).rejects.toThrow('already exists')
  })

  it('package.create rejects invalid id', async () => {
    await expect(
      tools.call('package.create', { id: '../escape', name: 'Bad', html: '<p></p>' }, ctx)
    ).rejects.toThrow('Invalid app id')

    await expect(
      tools.call('package.create', { id: 'UPPER', name: 'Bad', html: '<p></p>' }, ctx)
    ).rejects.toThrow('Invalid app id')
  })

  it('package.edit writes file within app', async () => {
    // Set up a package directory
    const pkgDir = join(dir, 'packages', 'editable')
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{"id":"editable","name":"Editable"}')
    writeFileSync(join(pkgDir, 'ui/index.html'), '<p>old</p>')

    const result = await tools.call('package.edit', {
      id: 'editable',
      file: 'ui/index.html',
      content: '<p>new</p>'
    }, ctx) as { edited: string }

    expect(result.edited).toBe('ui/index.html')
    expect(readFileSync(join(pkgDir, 'ui/index.html'), 'utf-8')).toBe('<p>new</p>')
  })

  it('package.edit blocks path traversal', async () => {
    const pkgDir = join(dir, 'packages', 'safe')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{"id":"safe","name":"Safe"}')

    await expect(
      tools.call('package.edit', {
        id: 'safe',
        file: '../../etc/passwd',
        content: 'hacked'
      }, ctx)
    ).rejects.toThrow('traversal')
  })

  it('package.delete removes the app directory', async () => {
    const pkgDir = join(dir, 'packages', 'to-delete')
    mkdirSync(join(pkgDir, 'ui'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{"id":"to-delete","name":"Delete Me"}')
    writeFileSync(join(pkgDir, 'ui/index.html'), '<p>bye</p>')

    await tools.call('package.delete', { id: 'to-delete' }, ctx)
    expect(existsSync(pkgDir)).toBe(false)
  })

  it('package.delete throws for nonexistent app', async () => {
    await expect(
      tools.call('package.delete', { id: 'ghost' }, ctx)
    ).rejects.toThrow('not found')
  })

  it('package.list returns loaded apps', async () => {
    const aDir = join(dir, 'packages', 'a')
    mkdirSync(aDir, { recursive: true })
    writeFileSync(join(aDir, 'README.md'), '# A')
    loader._add({ id: 'a', name: 'A', backend: './backend/index.mjs', permissions: { workspace: { read: true } } }, aDir)
    loader._add({ id: 'b', name: 'B' }, '/fake/b')

    const result = await tools.call('package.list', {}, ctx) as {
      packages: Array<{ id: string; backend?: string; permissions?: Record<string, unknown>; hasReadme?: boolean }>
    }
    expect(result.packages).toHaveLength(2)
    expect(result.packages.map(p => p.id)).toEqual(['a', 'b'])
    expect(result.packages[0]).toMatchObject({
      backend: './backend/index.mjs',
      permissions: { workspace: { read: true } },
      hasReadme: true,
    })
    expect(result.packages[1].hasReadme).toBe(false)
  })

  it('package.readme returns README.md content for a loaded app', async () => {
    const pkgDir = join(dir, 'packages', 'docs-app')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'README.md'), '# Docs App\n\nUse it well.')
    loader._add({ id: 'docs-app', name: 'Docs App' }, pkgDir)

    const result = await tools.call('package.readme', { id: 'docs-app' }, ctx) as {
      id: string
      name: string
      content: string
    }

    expect(result).toEqual({
      id: 'docs-app',
      name: 'Docs App',
      content: '# Docs App\n\nUse it well.',
    })
  })

  it('package.readme throws for an app without README.md', async () => {
    const pkgDir = join(dir, 'packages', 'no-docs')
    mkdirSync(pkgDir, { recursive: true })
    loader._add({ id: 'no-docs', name: 'No Docs' }, pkgDir)

    await expect(
      tools.call('package.readme', { id: 'no-docs' }, ctx)
    ).rejects.toThrow('App README not found: no-docs')
  })

  it('package.readme rejects a symlink README.md for an app', async () => {
    const pkgDir = join(dir, 'packages', 'linked-docs')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(dir, 'external-readme.md'), '# Outside')
    symlinkSync(join(dir, 'external-readme.md'), join(pkgDir, 'README.md'))
    loader._add({ id: 'linked-docs', name: 'Linked Docs' }, pkgDir)

    await expect(
      tools.call('package.readme', { id: 'linked-docs' }, ctx)
    ).rejects.toThrow('App README is not a regular file: linked-docs')
  })

  it('throws when no workspace is open', async () => {
    const noWs = createToolRegistry(createTraceLog())
    registerPackageTools(noWs, loader as any)
    await expect(
      noWs.call('package.create', { id: 'x', name: 'X', html: '<p></p>' }, ctx)
    ).rejects.toThrow('No workspace')
  })

  it('package.create refuses when id resolves to a global app', async () => {
    loader._addWithSource({ id: 'github-monitor', name: 'GitHub Monitor' }, '/fake/github-monitor', 'global')
    await expect(
      tools.call('package.create', { id: 'github-monitor', name: 'GM Local', html: '<p></p>' }, ctx)
    ).rejects.toThrow(/global/)
  })

  it('package.create with override: true allows shadowing global', async () => {
    loader._addWithSource({ id: 'github-monitor', name: 'GM' }, '/fake/gm', 'global')
    const result = await tools.call('package.create', {
      id: 'github-monitor', name: 'GM Local', html: '<p>Override</p>', override: true,
    }, ctx) as { created: string }
    expect(result.created).toBe('github-monitor')
  })

  it('package.create still rejects when workspace dir already exists even with override', async () => {
    const pkgDir = join(dir, 'packages', 'existing')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{}')
    await expect(
      tools.call('package.create', {
        id: 'existing', name: 'Existing', html: '<p></p>', override: true,
      }, ctx)
    ).rejects.toThrow('already exists')
  })
})
