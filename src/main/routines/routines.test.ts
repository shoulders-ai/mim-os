import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createRoutineFile,
  loadRoutineCatalog,
  pauseRoutine,
  resumeRoutine,
  routineWebhookSecretAccount,
} from './routines.js'

describe('routine definitions', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-routines-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads markdown routines with visible tools and approval grants split', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'nightly-lit-sweep.md'), [
      '---',
      'name: nightly-lit-sweep',
      'description: Sweep new literature.',
      'tools: [web.search, web.read, fs.write]',
      'approval:',
      '  allow: [web.search, web.read]',
      'steps: 42',
      '---',
      '',
      'Search the standing questions.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir, {
      knownTools: new Set(['web.search', 'web.read', 'fs.write']),
    })

    expect(catalog.diagnostics).toEqual([])
    expect(catalog.routines).toEqual([
      expect.objectContaining({
        id: 'nightly-lit-sweep',
        name: 'nightly-lit-sweep',
        description: 'Sweep new literature.',
        tools: ['web.search', 'web.read', 'fs.write'],
        approvalAllow: ['web.search', 'web.read'],
        steps: 42,
        body: 'Search the standing questions.',
        enabled: false,
        paused: false,
        needsEnablement: true,
      }),
    ])
  })

  it('diagnoses approval grants that are not visible tools', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'bad.md'), [
      '---',
      'name: bad',
      'description: Bad routine.',
      'tools: [fs.read]',
      'approval:',
      '  allow: [fs.write]',
      '---',
      '',
      'Do work.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir, {
      knownTools: new Set(['fs.read', 'fs.write']),
    })

    expect(catalog.routines).toEqual([])
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        routineId: 'bad',
        message: 'approval.allow must be a subset of tools: fs.write',
      }),
    ])
  })

  it('allows approval grants without an explicit tools list because the normal chat surface is visible', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'draft.md'), [
      '---',
      'name: draft',
      'description: Draft routine.',
      'approval:',
      '  allow: [fs.write]',
      '---',
      '',
      'Draft the note.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir, {
      knownTools: new Set(['fs.write']),
    })

    expect(catalog.diagnostics).toEqual([])
    expect(catalog.routines[0]).toMatchObject({
      id: 'draft',
      tools: [],
      approvalAllow: ['fs.write'],
    })
  })

  it('reports unknown tools as diagnostics instead of silently ignoring them', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'unknown.md'), [
      '---',
      'name: unknown',
      'description: Unknown routine.',
      'tools: [fs.read, made.up]',
      'approval:',
      '  allow: [made.up]',
      '---',
      '',
      'Do work.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir, {
      knownTools: new Set(['fs.read']),
    })

    expect(catalog.routines).toEqual([])
    expect(catalog.diagnostics.map(d => d.message)).toContain('Unknown tool id: made.up')
  })

  it('resumes and pauses routines through per-machine state keyed by authority hash', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'triage.md'), [
      '---',
      'name: triage',
      'description: Triage issues.',
      'tools: [fs.read]',
      '---',
      '',
      'Read issues.',
    ].join('\n'))

    let catalog = loadRoutineCatalog(dir, { knownTools: new Set(['fs.read']) })
    expect(catalog.routines[0].enabled).toBe(false)
    expect(catalog.routines[0].needsEnablement).toBe(true)

    resumeRoutine(dir, catalog.routines[0])
    catalog = loadRoutineCatalog(dir, { knownTools: new Set(['fs.read']) })
    expect(catalog.routines[0]).toMatchObject({
      enabled: true,
      paused: false,
      needsEnablement: false,
    })

    pauseRoutine(dir, 'triage')
    catalog = loadRoutineCatalog(dir, { knownTools: new Set(['fs.read']) })
    expect(catalog.routines[0]).toMatchObject({
      enabled: false,
      paused: true,
      needsEnablement: false,
    })
  })

  it('creates disabled routine files with validated frontmatter', () => {
    const routine = createRoutineFile(dir, {
      name: 'standup',
      description: 'Draft standup note.',
      body: 'Read the board and draft a note.',
      tools: ['fs.read', 'log.append'],
      approvalAllow: ['fs.read'],
      knownTools: new Set(['fs.read', 'log.append']),
    })

    const path = join(dir, 'routines', 'standup.md')
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toContain('approval:')
    expect(routine.enabled).toBe(false)
    expect(routine.needsEnablement).toBe(true)
  })

  it('loads schedule, interval, file, and webhook trigger definitions', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'morning.md'), [
      '---',
      'name: morning',
      'trigger:',
      '  schedule: "0 8 * * *"',
      '---',
      '',
      'Draft the morning note.',
    ].join('\n'))
    writeFileSync(join(dir, 'routines', 'watch-inbox.md'), [
      '---',
      'name: watch-inbox',
      'trigger:',
      '  files:',
      '    path: inbox/',
      '    events: [add, change]',
      '---',
      '',
      'Process new inbox files.',
    ].join('\n'))
    writeFileSync(join(dir, 'routines', 'hook.md'), [
      '---',
      'name: hook',
      'trigger:',
      '  webhook:',
      '    secret: intake',
      '---',
      '',
      'Process the signed payload.',
    ].join('\n'))
    writeFileSync(join(dir, 'routines', 'pulse.md'), [
      '---',
      'name: pulse',
      'trigger:',
      '  every: 4h',
      '---',
      '',
      'Check the project pulse.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir)

    expect(catalog.diagnostics).toEqual([])
    expect(catalog.routines.map(routine => [routine.id, routine.trigger])).toEqual([
      ['hook', { webhook: { secret: 'intake' } }],
      ['morning', { schedule: '0 8 * * *' }],
      ['pulse', { every: '4h' }],
      ['watch-inbox', { files: { path: 'inbox/', events: ['add', 'change'] } }],
    ])
  })

  it('diagnoses trigger definitions with more than one automatic trigger', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'muddy.md'), [
      '---',
      'name: muddy',
      'trigger:',
      '  schedule: "0 8 * * *"',
      '  files:',
      '    path: inbox/',
      '---',
      '',
      'Do work.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir)

    expect(catalog.routines).toEqual([])
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        routineId: 'muddy',
        message: 'Routine trigger must declare exactly one of: schedule, every, files, webhook, slack',
      }),
    ])
  })

  it('uses a stable keychain account for routine webhook secrets', () => {
    expect(routineWebhookSecretAccount('intake')).toBe('routine:webhook:intake')
  })

  it('loads Slack trigger bindings with channel modes', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'support-bot.md'), [
      '---',
      'name: support-bot',
      'description: Answer support mentions.',
      'trigger:',
      '  slack:',
      '    account: default',
      '    channels:',
      '      - { id: C123, mode: mention }',
      '      - { id: C456, mode: always }',
      'tools: [fs.read]',
      '---',
      '',
      'Answer from the docs.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir, { knownTools: new Set(['fs.read']) })

    expect(catalog.diagnostics).toEqual([])
    expect(catalog.routines[0].trigger).toEqual({
      slack: {
        account: 'default',
        channels: [
          { id: 'C123', mode: 'mention' },
          { id: 'C456', mode: 'always' },
        ],
      },
    })
  })

  it('diagnoses malformed Slack trigger channels', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'bad-slack.md'), [
      '---',
      'name: bad-slack',
      'trigger:',
      '  slack:',
      '    account: default',
      '    channels:',
      '      - { id: C123, mode: loud }',
      '---',
      '',
      'Answer.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir)

    expect(catalog.routines).toEqual([])
    expect(catalog.diagnostics).toEqual([
      expect.objectContaining({
        routineId: 'bad-slack',
        message: 'Slack trigger channel mode must be mention or always: C123',
      }),
    ])
  })

  it('diagnoses duplicate Slack trigger bindings across routines', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    for (const name of ['support-a', 'support-b']) {
      writeFileSync(join(dir, 'routines', `${name}.md`), [
        '---',
        `name: ${name}`,
        'trigger:',
        '  slack:',
        '    account: default',
        '    channels:',
        '      - { id: C123, mode: mention }',
        '---',
        '',
        'Answer.',
      ].join('\n'))
    }

    const catalog = loadRoutineCatalog(dir)

    expect(catalog.routines).toEqual([])
    expect(catalog.diagnostics.map(d => d.message)).toEqual([
      'Duplicate Slack trigger binding for default:C123: support-a, support-b',
      'Duplicate Slack trigger binding for default:C123: support-a, support-b',
    ])
  })
})
