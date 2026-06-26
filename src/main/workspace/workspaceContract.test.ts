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
  readAppEnabled,
  readCommittedApp,
  setAppEnabled,
  removeApp,
  DEFAULT_AGENTS_MD,
} from '@main/workspace/workspaceContract.js'

const EXPECTED_AGENTS_MD = DEFAULT_AGENTS_MD

describe('workspaceContract — mim.yaml parse/serialize', () => {
  it('round-trips { name }', () => {
    const config = { name: 'my-project' }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('round-trips { name, google, slack }', () => {
    const config = { name: 'my-project', google: 'acme.com', slack: 'T123' }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('round-trips a boolean apps map keyed by app id', () => {
    const config = { name: 'my-project', apps: { board: true, knowledge: false } }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('round-trips a partial apps map', () => {
    const config = { name: 'my-project', apps: { board: true } }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('round-trips object app entries with source, version, and enabled', () => {
    const config = {
      name: 'my-project',
      apps: {
        'github-monitor': { source: 'https://github.com/shoulders-ai/mim-github-monitor', version: '1.2.0' },
        'docx-review': { enabled: false },
      },
    }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('round-trips object app entries with a monorepo path', () => {
    const config = {
      name: 'my-project',
      apps: {
        slides: {
          source: 'https://github.com/shoulders-ai/mim-apps',
          path: 'packages/slides',
          version: '0.1.0',
        },
      },
    }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('treats a missing apps key as no apps', () => {
    const config = parseMimYaml('name: solo\n')
    expect(config).toEqual({ name: 'solo' })
    expect(config.apps).toBeUndefined()
  })

  it('drops app entries whose value is neither boolean nor object', () => {
    const config = parseMimYaml('name: solo\napps:\n  board: yes-ish\n  knowledge: 1\n  hello: true\n')
    expect(config.apps).toEqual({ hello: true })
  })

  it('drops app keys that are not valid app ids', () => {
    const config = parseMimYaml('name: solo\napps:\n  "Bad Name!": true\n  UPPER: true\n  "-leading": true\n  board: true\n')
    expect(config.apps).toEqual({ board: true })
  })

  it('drops unknown keys inside an object app entry', () => {
    const config = parseMimYaml('name: solo\napps:\n  github-monitor:\n    source: https://x.example/r.git\n    pinned: yes\n')
    expect(config.apps).toEqual({ 'github-monitor': { source: 'https://x.example/r.git' } })
  })

  it('omits undefined optional fields from serialized output', () => {
    const text = serializeMimYaml({ name: 'solo' })
    expect(text).toContain('name: solo')
    expect(text).not.toContain('google')
    expect(text).not.toContain('slack')
    expect(text).not.toContain('apps')
  })

  it('omits an empty apps map from serialized output', () => {
    const text = serializeMimYaml({ name: 'solo', apps: {} })
    expect(text).not.toContain('apps')
  })

  it('does not write a version field', () => {
    expect(serializeMimYaml({ name: 'x' })).not.toContain('version')
  })

  it('defaultMimYaml serializes { name }', () => {
    expect(parseMimYaml(defaultMimYaml('demo'))).toEqual({ name: 'demo' })
  })
})

describe('workspaceContract — skills key', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-skill-contract-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips disabled skill names', () => {
    const config = { name: 'my-project', skills: { disabled: ['issue-work', 'review-docx'] } }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('drops invalid disabled skill names', () => {
    const config = parseMimYaml('name: x\nskills:\n  disabled:\n    - issue-work\n    - Bad Name\n    - issues.list\n')
    expect(config.skills).toEqual({ disabled: ['issue-work'] })
  })

})

describe('workspaceContract — collections key', () => {
  it('round-trips a git collection', () => {
    const config = {
      name: 'my-project',
      collections: { 'journal-guidance': { name: 'Journal guidance', git: 'https://github.com/acme/guidance.git' } },
    }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('round-trips an expectation entry (no git) with a write policy', () => {
    const config = {
      name: 'my-project',
      collections: { templates: { name: 'Company templates', write: 'direct' as const } },
    }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('round-trips multiple collections', () => {
    const config = {
      name: 'x',
      collections: {
        templates: { write: 'readonly' as const },
        guidance: { git: 'git@github.com:acme/guidance.git' },
      },
    }
    expect(parseMimYaml(serializeMimYaml(config))).toEqual(config)
  })

  it('treats a missing collections key as no collections', () => {
    expect(parseMimYaml('name: solo\n').collections).toBeUndefined()
  })

  it('drops invalid write policies on parse', () => {
    const config = parseMimYaml('name: x\ncollections:\n  templates:\n    write: yolo\n')
    expect(config.collections).toEqual({ templates: {} })
  })

  it('drops collection ids that are not kebab-case slugs', () => {
    const config = parseMimYaml('name: x\ncollections:\n  "Bad Name!":\n    git: https://x.example/r.git\n  good-id:\n    git: https://x.example/r2.git\n')
    expect(Object.keys(config.collections ?? {})).toEqual(['good-id'])
  })

  it('drops non-object collection entries on parse', () => {
    const config = parseMimYaml('name: x\ncollections:\n  templates: true\n  guidance:\n    git: https://x.example/r.git\n')
    expect(Object.keys(config.collections ?? {})).toEqual(['guidance'])
  })

  it('drops unknown keys inside a collection entry on parse', () => {
    const config = parseMimYaml('name: x\ncollections:\n  templates:\n    name: T\n    path: /tmp/leaked-local-path\n')
    expect(config.collections).toEqual({ templates: { name: 'T' } })
  })

  it('omits an empty collections map from serialized output', () => {
    expect(serializeMimYaml({ name: 'solo', collections: {} })).not.toContain('collections')
  })

  it('existing files without collections are unaffected by a parse → serialize round-trip', () => {
    const text = serializeMimYaml(parseMimYaml('name: solo\napps:\n  board: true\n'))
    expect(text).not.toContain('collections')
    expect(parseMimYaml(text)).toEqual({ name: 'solo', apps: { board: true } })
  })
})

describe('workspaceContract — registries key', () => {
  it('round-trips a git registry entry', () => {
    const config = {
      name: 'my-project',
      registries: { acme: { name: 'Acme internal apps', git: 'https://github.com/acme/mim-registry.git' } },
    }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('round-trips a path registry entry', () => {
    const config = {
      name: 'my-project',
      registries: { 'in-repo': { path: 'tools/registry' } },
    }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('name is optional', () => {
    const config = parseMimYaml('name: x\nregistries:\n  acme:\n    git: https://github.com/acme/mim-registry.git\n')
    expect(config.registries).toEqual({ acme: { git: 'https://github.com/acme/mim-registry.git' } })
  })

  it('drops entries with both git and path', () => {
    const config = parseMimYaml('name: x\nregistries:\n  bad:\n    git: https://github.com/acme/reg.git\n    path: tools/reg\n')
    expect(config.registries).toBeUndefined()
  })

  it('round-trips a url registry entry', () => {
    const config = {
      name: 'my-project',
      registries: { company: { url: 'https://internal.company.com/mim-apps/index.json' } },
    }
    const text = serializeMimYaml(config)
    expect(parseMimYaml(text)).toEqual(config)
  })

  it('drops url entries with http:// (requires https)', () => {
    const config = parseMimYaml('name: x\nregistries:\n  bad:\n    url: http://example.com/index.json\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops url entries with credentials', () => {
    const config = parseMimYaml('name: x\nregistries:\n  bad:\n    url: https://user:pass@example.com/index.json\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops entries with both url and git', () => {
    const config = parseMimYaml('name: x\nregistries:\n  bad:\n    url: https://example.com/index.json\n    git: https://github.com/acme/reg.git\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops entries with neither git nor path nor url', () => {
    const config = parseMimYaml('name: x\nregistries:\n  bad:\n    name: Orphan\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops entries with invalid slug ids', () => {
    const config = parseMimYaml('name: x\nregistries:\n  "Bad Name!":\n    git: https://github.com/acme/reg.git\n  good:\n    git: https://github.com/acme/reg.git\n')
    expect(Object.keys(config.registries ?? {})).toEqual(['good'])
  })

  it('drops reserved id "default"', () => {
    const config = parseMimYaml('name: x\nregistries:\n  default:\n    git: https://github.com/acme/reg.git\n  ok:\n    git: https://github.com/acme/reg2.git\n')
    expect(Object.keys(config.registries ?? {})).toEqual(['ok'])
  })

  it('drops reserved id "user"', () => {
    const config = parseMimYaml('name: x\nregistries:\n  user:\n    git: https://github.com/acme/reg.git\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops http:// git URLs', () => {
    const config = parseMimYaml('name: x\nregistries:\n  acme:\n    git: http://github.com/acme/reg.git\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops git URLs with credentials (user:pass@)', () => {
    const config = parseMimYaml('name: x\nregistries:\n  acme:\n    git: https://user:pass@github.com/acme/reg.git\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops git URLs with a token (token@)', () => {
    const config = parseMimYaml('name: x\nregistries:\n  acme:\n    git: https://token@github.com/acme/reg.git\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops absolute paths', () => {
    const config = parseMimYaml('name: x\nregistries:\n  local:\n    path: /tmp/registry\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops paths with ../ traversal', () => {
    const config = parseMimYaml('name: x\nregistries:\n  local:\n    path: ../escape/registry\n')
    expect(config.registries).toBeUndefined()
  })

  it('drops paths with backslashes', () => {
    const config = parseMimYaml('name: x\nregistries:\n  local:\n    path: tools\\registry\n')
    expect(config.registries).toBeUndefined()
  })

  it('round-trip stability: parse → serialize → parse is identical', () => {
    const yaml = 'name: x\nregistries:\n  acme:\n    name: Acme\n    git: https://github.com/acme/reg.git\n  local:\n    path: tools/registry\n'
    const first = parseMimYaml(yaml)
    const second = parseMimYaml(serializeMimYaml(first))
    expect(second).toEqual(first)
  })

  it('treats a missing registries key as no registries', () => {
    expect(parseMimYaml('name: solo\n').registries).toBeUndefined()
  })

  it('omits an empty registries map from serialized output', () => {
    expect(serializeMimYaml({ name: 'solo', registries: {} })).not.toContain('registries')
  })

  it('existing files without registries are unaffected by a parse → serialize round-trip', () => {
    const text = serializeMimYaml(parseMimYaml('name: solo\napps:\n  board: true\n'))
    expect(text).not.toContain('registries')
    expect(parseMimYaml(text)).toEqual({ name: 'solo', apps: { board: true } })
  })

  it('drops non-object registry entries on parse', () => {
    const config = parseMimYaml('name: x\nregistries:\n  bad: true\n  good:\n    git: https://github.com/acme/reg.git\n')
    expect(Object.keys(config.registries ?? {})).toEqual(['good'])
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

describe('workspaceContract — committed app enablement (readAppEnabled / readCommittedApp / setAppEnabled)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-apps-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function write(body: string): void {
    writeFileSync(join(dir, 'mim.yaml'), body)
  }

  it('readAppEnabled is false for a missing file, missing map, or absent entry', () => {
    expect(readAppEnabled(dir, 'board')).toBe(false)
    write('name: x\n')
    expect(readAppEnabled(dir, 'board')).toBe(false)
    write('name: x\napps:\n  knowledge: true\n')
    expect(readAppEnabled(dir, 'board')).toBe(false)
  })

  it('readAppEnabled reads boolean entries by app id', () => {
    write('name: x\napps:\n  board: true\n  knowledge: false\n')
    expect(readAppEnabled(dir, 'board')).toBe(true)
    expect(readAppEnabled(dir, 'knowledge')).toBe(false)
  })

  it('readAppEnabled treats an object entry as enabled unless enabled is false', () => {
    write('name: x\napps:\n  github-monitor:\n    source: https://x.example/r.git\n  docx-review:\n    enabled: false\n')
    expect(readAppEnabled(dir, 'github-monitor')).toBe(true)
    expect(readAppEnabled(dir, 'docx-review')).toBe(false)
  })

  it('readCommittedApp returns null when absent and a normalized entry when present', () => {
    expect(readCommittedApp(dir, 'board')).toBeNull()
    write('name: x\napps:\n  board: true\n  github-monitor:\n    source: https://x.example/r.git\n    version: 1.2.0\n    enabled: false\n')
    expect(readCommittedApp(dir, 'board')).toEqual({ enabled: true })
    expect(readCommittedApp(dir, 'github-monitor')).toEqual({
      enabled: false,
      source: 'https://x.example/r.git',
      version: '1.2.0',
    })
  })

  it('setAppEnabled writes a boolean entry for a new app id', () => {
    write('name: x\n')
    setAppEnabled(dir, 'board', true)
    expect(parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8')).apps).toEqual({ board: true })
  })

  it('setAppEnabled preserves source and version when toggling an object entry', () => {
    write('name: x\napps:\n  github-monitor:\n    source: https://x.example/r.git\n    version: 1.2.0\n')
    setAppEnabled(dir, 'github-monitor', false)
    expect(parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8')).apps).toEqual({
      'github-monitor': { source: 'https://x.example/r.git', version: '1.2.0', enabled: false },
    })
    setAppEnabled(dir, 'github-monitor', true)
    expect(readCommittedApp(dir, 'github-monitor')).toEqual({
      enabled: true,
      source: 'https://x.example/r.git',
      version: '1.2.0',
    })
  })

  it('setAppEnabled preserves other entries and the name', () => {
    write('name: ws\napps:\n  board: true\n')
    setAppEnabled(dir, 'knowledge', true)
    setAppEnabled(dir, 'board', false)
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.name).toBe('ws')
    expect(config.apps).toEqual({ board: false, knowledge: true })
  })

  it('setAppEnabled rejects invalid app ids', () => {
    expect(() => setAppEnabled(dir, 'Bad Id', true)).toThrow('Invalid app id')
  })
})

describe('workspaceContract — removeApp', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-removeapp-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function write(body: string): void {
    writeFileSync(join(dir, 'mim.yaml'), body)
  }

  it('removes a boolean-form entry and serializes cleanly', () => {
    write('name: ws\napps:\n  board: true\n  knowledge: true\n')
    removeApp(dir, 'board')
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps).toEqual({ knowledge: true })
  })

  it('removes an object-form entry and serializes cleanly', () => {
    write('name: ws\napps:\n  github-monitor:\n    source: https://x.example/r.git\n    version: 1.2.0\n  board: true\n')
    removeApp(dir, 'github-monitor')
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps).toEqual({ board: true })
  })

  it('is a no-op when the id is absent from the apps map', () => {
    write('name: ws\napps:\n  board: true\n')
    removeApp(dir, 'ghost')
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.apps).toEqual({ board: true })
  })

  it('is a no-op when the file does not exist', () => {
    expect(() => removeApp(dir, 'board')).not.toThrow()
  })

  it('preserves other keys (name, other apps, collections)', () => {
    write('name: ws\napps:\n  board: true\n  knowledge: false\ncollections:\n  guidance:\n    git: https://x.example/g.git\n')
    removeApp(dir, 'board')
    const config = parseMimYaml(readFileSync(join(dir, 'mim.yaml'), 'utf-8'))
    expect(config.name).toBe('ws')
    expect(config.apps).toEqual({ knowledge: false })
    expect(config.collections).toEqual({ guidance: { git: 'https://x.example/g.git' } })
  })

  it('round-trips: removing the only app drops the apps key entirely', () => {
    write('name: ws\napps:\n  board: true\n')
    removeApp(dir, 'board')
    const text = readFileSync(join(dir, 'mim.yaml'), 'utf-8')
    expect(text).not.toContain('apps')
    expect(parseMimYaml(text)).toEqual({ name: 'ws' })
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

describe('workspaceContract — default AGENTS.md', () => {
  it('includes project log context and one concise logging instruction', () => {
    expect(DEFAULT_AGENTS_MD).toContain('{{PROJECT_LOG}}')
    expect(DEFAULT_AGENTS_MD).toContain('Use `log_append` only for durable activity notes')
    expect(DEFAULT_AGENTS_MD).toContain('do not log routine progress or implementation chatter')
  })
})
