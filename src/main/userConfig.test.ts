import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  loadUserConfig,
  resolveModelDefault,
  reset,
  registryUrl,
  DEFAULT_REGISTRY_URL,
  setUserSkillDisabled,
  writeSkillSource,
  removeSkillSource,
} from '@main/userConfig.js'

function writeConfig(home: string, text: string): void {
  mkdirSync(join(home, '.mim'), { recursive: true })
  writeFileSync(join(home, '.mim', 'config.yaml'), text)
}

describe('userConfig — loadUserConfig', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-home-'))
    reset()
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    reset()
  })

  it('parses a full config.yaml into the typed UserConfig', () => {
    writeConfig(home, [
      'user:',
      '  name: Paul',
      '  email: user@example.com',
      '  timezone: Europe/Berlin',
      'defaults:',
      '  google: acme.com',
      '  slack: T123',
      '  models:',
      '    chat: claude-sonnet-4-6',
      '    ghost: claude-haiku-4-5-20251001',
      '',
    ].join('\n'))

    const config = loadUserConfig(home)
    expect(config.user.name).toBe('Paul')
    expect(config.user.email).toBe('user@example.com')
    expect(config.user.timezone).toBe('Europe/Berlin')
    expect(config.defaults.google).toBe('acme.com')
    expect(config.defaults.slack).toBe('T123')
    expect(config.defaults.models.chat).toBe('claude-sonnet-4-6')
    expect(config.defaults.models.ghost).toBe('claude-haiku-4-5-20251001')
  })

  it('missing file → safe empty defaults, no throw', () => {
    const config = loadUserConfig(home)
    expect(config.user).toEqual({})
    expect(config.defaults.models).toEqual({})
  })

  it('malformed YAML → safe empty defaults, no throw', () => {
    writeConfig(home, 'user: [unclosed\n  : : :')
    let config!: ReturnType<typeof loadUserConfig>
    expect(() => { config = loadUserConfig(home) }).not.toThrow()
    expect(config.defaults.models).toEqual({})
  })

  it('partial config (only user, no defaults) tolerated', () => {
    writeConfig(home, 'user:\n  name: Solo\n')
    const config = loadUserConfig(home)
    expect(config.user.name).toBe('Solo')
    expect(config.defaults.models).toEqual({})
  })

  it('never surfaces an api-key-like field present in config.yaml', () => {
    writeConfig(home, [
      'user:',
      '  name: Paul',
      'ANTHROPIC_API_KEY: sk-should-not-leak',
      'defaults:',
      '  apiKey: sk-also-leaks',
      '  models:',
      '    chat: claude-sonnet-4-6',
      '',
    ].join('\n'))

    const config = loadUserConfig(home)
    const serialized = JSON.stringify(config)
    expect(serialized).not.toContain('sk-should-not-leak')
    expect(serialized).not.toContain('sk-also-leaks')
    expect((config.defaults as Record<string, unknown>).apiKey).toBeUndefined()
  })

  it('parses connector policy from config.yaml', () => {
    writeConfig(home, [
      'connectors:',
      '  slack:',
      '    aiEnabled: true',
      '    sendEnabled: false',
      '    privateChannels: false',
      '    directMessages: true',
      '  google:',
      '    aiEnabled: true',
      '    gmailEnabled: true',
      '    gmailSendEnabled: false',
      '    calendarEnabled: true',
      '    calendarWriteEnabled: false',
      '    driveEnabled: true',
      '    sheetsWriteEnabled: false',
    ].join('\n'))
    const config = loadUserConfig(home)
    expect(config.connectors.slack).toEqual({
      aiEnabled: true,
      sendEnabled: false,
      privateChannels: false,
      directMessages: true,
    })
    expect(config.connectors.google).toEqual({
      aiEnabled: true,
      gmailEnabled: true,
      gmailSendEnabled: false,
      calendarEnabled: true,
      calendarWriteEnabled: false,
      driveEnabled: true,
      sheetsWriteEnabled: false,
    })
  })

  it('returns empty connectors when none configured', () => {
    writeConfig(home, 'user:\n  name: Paul\n')
    const config = loadUserConfig(home)
    expect(config.connectors).toEqual({})
  })
})

describe('userConfig — resolveModelDefault', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-home-'))
    reset()
    process.env.HOME = home
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    reset()
  })

  it('workspace override wins over config.yaml', () => {
    writeConfig(home, 'defaults:\n  models:\n    chat: claude-sonnet-4-6\n')
    reset()
    expect(resolveModelDefault('chat', { override: 'gpt-5.4' })).toBe('gpt-5.4')
  })

  it('config.yaml wins when no override', () => {
    writeConfig(home, 'defaults:\n  models:\n    chat: claude-sonnet-4-6\n    ghost: claude-haiku-4-5-20251001\n')
    reset()
    expect(resolveModelDefault('chat', {})).toBe('claude-sonnet-4-6')
    expect(resolveModelDefault('ghost', {})).toBe('claude-haiku-4-5-20251001')
  })

  it('undefined when neither override nor config set', () => {
    expect(resolveModelDefault('chat', {})).toBeUndefined()
  })

  it('reset() clears the in-process cache between cases', () => {
    writeConfig(home, 'defaults:\n  models:\n    chat: claude-sonnet-4-6\n')
    reset()
    expect(resolveModelDefault('chat', {})).toBe('claude-sonnet-4-6')

    writeConfig(home, 'defaults:\n  models:\n    chat: gpt-5.4\n')
    reset()
    expect(resolveModelDefault('chat', {})).toBe('gpt-5.4')
  })
})

describe('userConfig — registry.url', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-home-'))
    reset()
    process.env.HOME = home
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    reset()
  })

  it('returns DEFAULT_REGISTRY_URL when no config file exists', () => {
    expect(registryUrl()).toBe(DEFAULT_REGISTRY_URL)
  })

  it('returns DEFAULT_REGISTRY_URL when config has no registry section', () => {
    writeConfig(home, 'user:\n  name: Paul\n')
    reset()
    expect(registryUrl()).toBe(DEFAULT_REGISTRY_URL)
  })

  it('returns the override when registry.url is set in config.yaml', () => {
    writeConfig(home, [
      'registry:',
      '  url: https://git.corp.example.com/mim-registry.git',
      '',
    ].join('\n'))
    reset()
    expect(registryUrl()).toBe('https://git.corp.example.com/mim-registry.git')
  })

  it('ignores non-string registry.url values', () => {
    writeConfig(home, 'registry:\n  url: 42\n')
    reset()
    expect(registryUrl()).toBe(DEFAULT_REGISTRY_URL)
  })

  it('loadUserConfig exposes the registry.url field', () => {
    writeConfig(home, 'registry:\n  url: https://private.example.com/reg.git\n')
    reset()
    const config = loadUserConfig(home)
    expect(config.registry.url).toBe('https://private.example.com/reg.git')
  })

  it('DEFAULT_REGISTRY_URL is an HTTPS URL', () => {
    expect(DEFAULT_REGISTRY_URL).toMatch(/^https:\/\//)
  })
})

describe('userConfig — skill config', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-home-'))
    reset()
    process.env.HOME = home
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    reset()
  })

  it('parses skill sources and globally disabled authored skills', () => {
    writeConfig(home, [
      'skillSources:',
      '  acme-research:',
      '    name: Acme Research',
      '    git: https://github.com/acme/mim-skills.git',
      '    trusted: true',
      '  local-team:',
      '    path: /Users/test/team-skills',
      'skills:',
      '  disabled:',
      '    - issue-work',
      '    - docx-review',
      '',
    ].join('\n'))

    const config = loadUserConfig(home)

    expect(config.skillSources).toEqual({
      'acme-research': {
        name: 'Acme Research',
        git: 'https://github.com/acme/mim-skills.git',
        trusted: true,
      },
      'local-team': {
        path: '/Users/test/team-skills',
      },
    })
    expect(config.skills.disabled).toEqual(['docx-review', 'issue-work'])
  })

  it('writes global disabled skills without clobbering unrelated config', () => {
    writeConfig(home, [
      'user:',
      '  name: Paul',
      'defaults:',
      '  models:',
      '    chat: claude-sonnet-4-6',
      '',
    ].join('\n'))

    setUserSkillDisabled('issue-work', true, home)
    setUserSkillDisabled('docx-review', true, home)
    setUserSkillDisabled('issue-work', false, home)

    const config = loadUserConfig(home)
    expect(config.user.name).toBe('Paul')
    expect(config.defaults.models.chat).toBe('claude-sonnet-4-6')
    expect(config.skills.disabled).toEqual(['docx-review'])
    expect(readFileSync(join(home, '.mim', 'config.yaml'), 'utf-8')).toContain('user:')
  })

  it('writes and removes skill sources while preserving registry config', () => {
    writeConfig(home, [
      'registry:',
      '  url: https://private.example.com/reg.git',
      '',
    ].join('\n'))

    writeSkillSource('acme-research', {
      name: 'Acme Research',
      git: 'https://github.com/acme/mim-skills.git',
      trusted: true,
    }, home)
    writeSkillSource('local-team', {
      path: '/Users/test/team-skills',
      trusted: true,
    }, home)
    removeSkillSource('acme-research', home)

    const config = loadUserConfig(home)
    expect(config.registry.url).toBe('https://private.example.com/reg.git')
    expect(config.skillSources).toEqual({
      'local-team': {
        path: '/Users/test/team-skills',
        trusted: true,
      },
    })
  })
})
