import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createRoutineFile,
  disableRoutine,
  duplicateRoutineFile,
  enableRoutine,
  loadRoutineCatalog,
  readRoutineState,
  removeRoutineState,
  routineWebhookSecretAccount,
  updateRoutineFile,
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
        activation: 'manual',
        revision: expect.any(String),
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

  it('enables and disables automatic routines through versioned per-machine authority state', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'triage.md'), [
      '---',
      'name: triage',
      'description: Triage issues.',
      'trigger:',
      '  every: 4h',
      'tools: [fs.read]',
      '---',
      '',
      'Read issues.',
    ].join('\n'))

    let catalog = loadRoutineCatalog(dir, { knownTools: new Set(['fs.read']) })
    expect(catalog.routines[0].activation).toBe('review-required')

    enableRoutine(dir, catalog.routines[0])
    catalog = loadRoutineCatalog(dir, { knownTools: new Set(['fs.read']) })
    expect(catalog.routines[0].activation).toBe('active')

    disableRoutine(dir, catalog.routines[0])
    catalog = loadRoutineCatalog(dir, { knownTools: new Set(['fs.read']) })
    expect(catalog.routines[0].activation).toBe('disabled')
    expect(readRoutineState(dir).version).toBe(2)
  })

  it('changes machine-local activation without rewriting the shared routine definition', () => {
    const routine = createRoutineFile(dir, {
      name: 'team-pulse',
      trigger: { every: '4h' },
      body: 'Check the team pulse.',
    })
    const definitionPath = join(dir, 'routines', 'team-pulse.md')
    const definition = readFileSync(definitionPath, 'utf-8')

    enableRoutine(dir, routine)
    disableRoutine(dir, routine)

    expect(readFileSync(definitionPath, 'utf-8')).toBe(definition)
    expect(readRoutineState(dir).routines?.['team-pulse']).toMatchObject({
      enabled: false,
      authorityHash: routine.authorityHash,
    })
  })

  it('resolves Team and Project routines together with Project overrides', () => {
    const teamRoutinesDir = join(dir, 'connected-team', 'routines')
    mkdirSync(teamRoutinesDir, { recursive: true })
    mkdirSync(join(dir, 'routines'), { recursive: true })
    writeFileSync(join(teamRoutinesDir, 'shared.md'), [
      '---',
      'name: shared',
      'description: Team version.',
      '---',
      '',
      'Run the Team version.',
    ].join('\n'))
    writeFileSync(join(teamRoutinesDir, 'team-only.md'), [
      '---',
      'name: team-only',
      'description: Team only.',
      '---',
      '',
      'Run everywhere.',
    ].join('\n'))
    writeFileSync(join(dir, 'routines', 'shared.md'), [
      '---',
      'name: shared',
      'description: Project version.',
      '---',
      '',
      'Run for this Project.',
    ].join('\n'))

    const catalog = loadRoutineCatalog(dir, { teamRoutinesDir })

    expect(catalog.diagnostics).toEqual([])
    expect(catalog.routines).toEqual([
      expect.objectContaining({
        id: 'shared',
        origin: 'project',
        path: 'routines/shared.md',
        description: 'Project version.',
      }),
      expect.objectContaining({
        id: 'team-only',
        origin: 'team',
        path: '.mim/team/routines/team-only.md',
      }),
    ])
  })

  it('keeps Team routine activation and owner independent for two client checkouts', () => {
    const teamRoot = join(dir, 'connected-team')
    const teamRoutinesDir = join(teamRoot, 'routines')
    const clientA = join(dir, 'client-a')
    const clientB = join(dir, 'client-b')
    mkdirSync(teamRoutinesDir, { recursive: true })
    mkdirSync(clientA, { recursive: true })
    mkdirSync(clientB, { recursive: true })
    const definitionPath = join(teamRoutinesDir, 'overnight.md')
    writeFileSync(definitionPath, [
      '---',
      'name: overnight',
      'trigger:',
      '  every: 4h',
      '---',
      '',
      'Run overnight work.',
    ].join('\n'))
    const definition = readFileSync(definitionPath, 'utf-8')

    const routineA = loadRoutineCatalog(clientA, { teamRoutinesDir }).routines[0]
    enableRoutine(clientA, routineA, { owner: 'always-on-a' })

    expect(loadRoutineCatalog(clientA, { teamRoutinesDir }).routines[0]).toMatchObject({
      origin: 'team',
      activation: 'active',
      owner: 'always-on-a',
    })
    const routineB = loadRoutineCatalog(clientB, { teamRoutinesDir }).routines[0]
    expect(routineB).toMatchObject({
      origin: 'team',
      activation: 'review-required',
    })
    expect(routineB).not.toHaveProperty('owner')
    expect(readRoutineState(clientA).routines?.['team:overnight']).toMatchObject({
      enabled: true,
      owner: 'always-on-a',
    })
    expect(existsSync(join(clientB, '.mim', 'routines', 'state.json'))).toBe(false)
    expect(readFileSync(definitionPath, 'utf-8')).toBe(definition)
  })

  it('ignores legacy state and requires automatic routines to be reviewed again', () => {
    mkdirSync(join(dir, 'routines'), { recursive: true })
    mkdirSync(join(dir, '.mim', 'routines'), { recursive: true })
    writeFileSync(join(dir, 'routines', 'pulse.md'), [
      '---',
      'name: pulse',
      'trigger:',
      '  every: 4h',
      '---',
      '',
      'Check the project pulse.',
    ].join('\n'))
    writeFileSync(join(dir, '.mim', 'routines', 'state.json'), JSON.stringify({
      routines: { pulse: { enabled: true, authorityHash: 'legacy' } },
    }))

    expect(loadRoutineCatalog(dir).routines[0].activation).toBe('review-required')
  })

  it('creates routine files with validated frontmatter', () => {
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
    expect(routine.activation).toBe('manual')
    expect(routine.revision).toMatch(/^[a-f0-9]{64}$/)
  })

  it('updates definitions with stale-write protection and invalidates only authority changes', () => {
    let routine = createRoutineFile(dir, {
      name: 'standup',
      description: 'Draft standup note.',
      trigger: { every: '4h' },
      body: 'Read the board.',
      tools: ['fs.read'],
      knownTools: new Set(['fs.read']),
    })
    enableRoutine(dir, routine)
    routine = loadRoutineCatalog(dir, { knownTools: new Set(['fs.read']) }).routines[0]

    const promptUpdate = updateRoutineFile(dir, {
      name: routine.id,
      expectedRevision: routine.revision,
      description: 'Draft the daily standup note.',
      trigger: routine.trigger,
      body: 'Read the board and summarize it.',
      tools: routine.tools,
      approvalAllow: routine.approvalAllow,
      knownTools: new Set(['fs.read']),
    })
    expect(promptUpdate.activation).toBe('active')
    expect(promptUpdate.body).toBe('Read the board and summarize it.')

    expect(() => updateRoutineFile(dir, {
      name: routine.id,
      expectedRevision: routine.revision,
      body: 'Overwrite a newer edit.',
    })).toThrow('Routine changed since it was opened')

    const authorityUpdate = updateRoutineFile(dir, {
      name: promptUpdate.id,
      expectedRevision: promptUpdate.revision,
      description: promptUpdate.description,
      trigger: { every: '8h' },
      body: promptUpdate.body,
      tools: promptUpdate.tools,
      approvalAllow: promptUpdate.approvalAllow,
      knownTools: new Set(['fs.read']),
    })
    expect(authorityUpdate.activation).toBe('review-required')

    const revertedAuthority = updateRoutineFile(dir, {
      name: authorityUpdate.id,
      expectedRevision: authorityUpdate.revision,
      description: authorityUpdate.description,
      trigger: { every: '4h' },
      body: authorityUpdate.body,
      tools: authorityUpdate.tools,
      approvalAllow: authorityUpdate.approvalAllow,
      knownTools: new Set(['fs.read']),
    })
    expect(revertedAuthority.activation).toBe('disabled')
  })

  it('duplicates routine definitions as new review-required automatic routines', () => {
    const source = createRoutineFile(dir, {
      name: 'standup',
      description: 'Draft standup note.',
      trigger: { schedule: '0 9 * * *' },
      model: 'model-a',
      body: 'Read the board.',
      tools: ['fs.read'],
      approvalAllow: ['fs.read'],
      knownTools: new Set(['fs.read']),
    })
    enableRoutine(dir, source)

    const duplicate = duplicateRoutineFile(dir, source, 'standup-copy', new Set(['fs.read']))

    expect(duplicate).toMatchObject({
      id: 'standup-copy',
      description: 'Draft standup note.',
      trigger: { schedule: '0 9 * * *' },
      model: 'model-a',
      tools: ['fs.read'],
      approvalAllow: ['fs.read'],
      body: 'Read the board.',
      activation: 'review-required',
    })
  })

  it('removes only a routine local-state entry', () => {
    const routine = createRoutineFile(dir, {
      name: 'pulse',
      trigger: { every: '4h' },
      body: 'Check the project pulse.',
    })
    enableRoutine(dir, routine)

    removeRoutineState(dir, routine.id)

    expect(readRoutineState(dir).routines?.pulse).toBeUndefined()
    expect(existsSync(join(dir, 'routines', 'pulse.md'))).toBe(true)
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
