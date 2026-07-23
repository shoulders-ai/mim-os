import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  parseMimYaml,
  serializeMimYaml,
  defaultMimYaml,
  classifyWorkspace,
  scaffoldWorkspace,
  DEFAULT_PROJECT_AGENTS_MD,
  MIM_INSTRUCTIONS_TEMPLATE,
} from '@main/workspace/workspaceContract.js'

const EXPECTED_AGENTS_MD = DEFAULT_PROJECT_AGENTS_MD

describe('workspaceContract — mim.yaml parse/serialize', () => {
  it('round-trips { name }', () => {
    const config = { name: 'my-project' }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('omits undefined optional fields from serialized output', () => {
    const text = serializeMimYaml({ name: 'solo' })
    expect(text).toContain('name: solo')
    expect(text).not.toContain('google')
    expect(text).not.toContain('slack')
    expect(text).not.toContain('apps')
    expect(text).not.toContain('skills')
    expect(text).not.toContain('registries')
  })

  it('drops retired project-owned keys instead of preserving compatibility shims', () => {
    const config = parseMimYaml([
      'name: solo',
      'google: acme.com',
      'slack: T123',
      'apps:',
      '  board: true',
      'skills:',
      '  disabled:',
      '    - issue-work',
      'registries:',
      '  acme:',
      '    git: https://github.com/acme/registry.git',
      'collections:',
      '  templates:',
      '    git: https://example.com/templates.git',
      '',
    ].join('\n'))

    expect(config).toEqual({ name: 'solo' })
    const text = serializeMimYaml(config)
    expect(text).not.toContain('google')
    expect(text).not.toContain('slack')
    expect(text).not.toContain('apps')
    expect(text).not.toContain('skills')
    expect(text).not.toContain('registries')
    expect(text).not.toContain('collections')
  })

  it('does not write a version field', () => {
    expect(serializeMimYaml({ name: 'x' })).not.toContain('version')
  })

  it('defaultMimYaml serializes { name }', () => {
    expect(parseMimYaml(defaultMimYaml('demo'))).toEqual({ name: 'demo' })
  })
})

describe('workspaceContract — sync key', () => {
  it('round-trips managed sync mode and remote', () => {
    const config = {
      name: 'solo',
      sync: { mode: 'managed' as const, remote: 'https://github.com/acme/work.git' },
    }
    expect(parseMimYaml(serializeMimYaml(config))).toEqual(config)
  })

  it('drops invalid sync modes but keeps a useful remote', () => {
    const config = parseMimYaml('name: x\nsync:\n  mode: yolo\n  remote: https://github.com/acme/work.git\n')
    expect(config.sync).toEqual({ remote: 'https://github.com/acme/work.git' })
  })

  it('omits an empty sync config from serialized output', () => {
    expect(serializeMimYaml({ name: 'solo', sync: {} })).not.toContain('sync')
  })
})

describe('workspaceContract — classifyWorkspace', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-contract-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('empty dir → not initialized, all three missing', () => {
    const result = classifyWorkspace(dir)
    expect(result.initialized).toBe(false)
    expect(result.missing.sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'mim.yaml'])
  })

  it('partial dir (only mim.yaml) → not initialized, AGENTS.md + CLAUDE.md missing', () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: x\n')
    const result = classifyWorkspace(dir)
    expect(result.initialized).toBe(false)
    expect(result.missing.sort()).toEqual(['AGENTS.md', 'CLAUDE.md'])
  })

  it('all three present → initialized, nothing missing', () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: x\n')
    writeFileSync(join(dir, 'AGENTS.md'), 'x')
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n')
    const result = classifyWorkspace(dir)
    expect(result.initialized).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('.mim/ presence is irrelevant to init status', () => {
    mkdirSync(join(dir, '.mim'), { recursive: true })
    writeFileSync(join(dir, '.mim', 'workspace.json'), '{}')
    const result = classifyWorkspace(dir)
    expect(result.initialized).toBe(false)
  })
})

describe('workspaceContract — scaffoldWorkspace', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-scaffold-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes exactly mim.yaml, AGENTS.md, CLAUDE.md with expected contents', () => {
    scaffoldWorkspace(dir, { name: 'my-ws' })
    expect(parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))).toEqual({ name: 'my-ws' })
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe(EXPECTED_AGENTS_MD)
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf-8')).toBe('@AGENTS.md\n')
  })

  it('creates .mim/ directory', () => {
    scaffoldWorkspace(dir, { name: 'my-ws' })
    expect(existsSync(join(dir, '.mim'))).toBe(true)
  })

  it('adds .mim/ to a missing .gitignore', () => {
    scaffoldWorkspace(dir, { name: 'my-ws' })
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(gitignore.split('\n')).toContain('.mim/')
  })

  it('never writes .mim/settings.json (Step 3 seam)', () => {
    scaffoldWorkspace(dir, { name: 'my-ws' })
    expect(existsSync(join(dir, '.mim', 'settings.json'))).toBe(false)
  })

  it('is idempotent: re-run does not duplicate .gitignore lines', () => {
    scaffoldWorkspace(dir, { name: 'my-ws' })
    scaffoldWorkspace(dir, { name: 'my-ws' })
    const lines = readFileSync(join(dir, '.gitignore'), 'utf-8').split('\n').filter(l => l === '.mim/')
    expect(lines).toHaveLength(1)
  })

  it('is idempotent: re-run does not overwrite an edited AGENTS.md', () => {
    scaffoldWorkspace(dir, { name: 'my-ws' })
    writeFileSync(join(dir, 'AGENTS.md'), '# Edited by user\n')
    scaffoldWorkspace(dir, { name: 'my-ws' })
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).toBe('# Edited by user\n')
  })

  it('merges into an existing .gitignore without clobbering its contents', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n')
    scaffoldWorkspace(dir, { name: 'my-ws' })
    const gitignore = readFileSync(join(dir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('node_modules/')
    expect(gitignore).toContain('dist/')
    expect(gitignore.split('\n')).toContain('.mim/')
  })
})

describe('workspaceContract — instruction defaults', () => {
  it('keeps dynamic runtime context in Mim and scaffolds a Project-only document', () => {
    expect(MIM_INSTRUCTIONS_TEMPLATE).toContain('{{PROJECT_LOG}}')
    expect(MIM_INSTRUCTIONS_TEMPLATE).toContain('Use `log_append` only for durable activity notes')
    expect(MIM_INSTRUCTIONS_TEMPLATE).toContain('do not log routine progress or implementation chatter')
    expect(DEFAULT_PROJECT_AGENTS_MD).toContain('Project Instructions')
    expect(DEFAULT_PROJECT_AGENTS_MD).not.toContain('{{TOOL_SET}}')
  })
})
