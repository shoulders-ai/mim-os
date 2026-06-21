import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  renderAgentContext,
  gatherAgentContext,
  writeAgentContext,
  setAgentContextContributionsProvider,
  setAgentContextLocalPackagesProvider,
  type AgentContextData,
  type AgentContextApp,
  type AgentContextAppSection,
} from '@main/ai/agentContext.js'

// A fixed "now" so overdue/dueSoon classification is deterministic. 2026-06-01.
const NOW_MS = Date.parse('2026-06-01T12:00:00.000Z')

function baseData(overrides: Partial<AgentContextData> = {}): AgentContextData {
  return {
    workspace: { name: 'Demo', path: '/tmp/demo', initialized: true },
    generatedAt: '2026-06-01T12:00:00.000Z',
    apps: [],
    recentChanges: [],
    ...overrides,
  }
}

describe('renderAgentContext', () => {
  it('is deterministic for identical input', () => {
    const data = baseData()
    expect(renderAgentContext(data)).toBe(renderAgentContext(baseData()))
  })

  it('does not depend on list ordering', () => {
    const a = baseData({
      apps: [{ id: 'z-app', enabled: true }, { id: 'a-app', enabled: true }],
      appSections: [
        { appId: 'z-app', title: 'Z Status', body: 'Ready.' },
        { appId: 'a-app', title: 'A Status', body: 'Running.' },
      ],
    })
    const b = baseData({
      apps: [{ id: 'a-app', enabled: true }, { id: 'z-app', enabled: true }],
      appSections: [
        { appId: 'a-app', title: 'A Status', body: 'Running.' },
        { appId: 'z-app', title: 'Z Status', body: 'Ready.' },
      ],
    })
    expect(renderAgentContext(a)).toBe(renderAgentContext(b))
  })

  it('begins with a volatile note and includes workspace name and date', () => {
    const out = renderAgentContext(baseData({ generatedAt: '2026-06-01T12:00:00.000Z' }))
    const firstLine = out.split('\n')[0].toLowerCase()
    expect(firstLine).toContain('generated')
    expect(out).toContain('Demo')
    expect(out).toContain('2026-06-01')
  })

  it('includes an Apps enabled line', () => {
    const out = renderAgentContext(baseData())
    expect(out).toContain('Apps enabled')
  })

  it('does not render core Issues section from app enablement alone', () => {
    const out = renderAgentContext(baseData({ apps: [] }))
    expect(out).not.toContain('## Issues')
  })

  it('does not render core Knowledge section from app enablement alone', () => {
    const out = renderAgentContext(baseData({ apps: [] }))
    expect(out).not.toContain('## Knowledge')
  })

  it('renders app-owned board context through app sections', () => {
    const out = renderAgentContext(
      baseData({
        apps: [{ id: 'board', enabled: true }],
        appSections: [{ appId: 'board', title: 'Board', body: 'In progress: Working on it\nWaiting on Bob' }],
      }),
    )
    expect(out).toContain('## Board')
    expect(out).toContain('Working on it')
    expect(out).toContain('Waiting on Bob')
  })

  it('renders app-owned knowledge context through app sections', () => {
    const out = renderAgentContext(
      baseData({
        apps: [{ id: 'knowledge', enabled: true }],
        appSections: [{ appId: 'knowledge', title: 'Knowledge', body: '5 notes\n- A note' }],
      }),
    )
    expect(out).toContain('## Knowledge')
    expect(out).toContain('A note')
    expect(out).toContain('5')
  })

  it('renders local app development health', () => {
    const out = renderAgentContext(
      baseData({
        localPackages: [
          {
            id: 'my-pr-monitor',
            name: 'My PR Monitor',
            enabled: true,
            loaded: true,
            tools: 2,
            jobs: 1,
            skills: 1,
            diagnostics: [],
          },
          {
            id: 'my-reader',
            enabled: false,
            loaded: false,
            tools: 0,
            jobs: 0,
            skills: 0,
            diagnostics: ['manifest error: Backend file does not exist: ./backend/index.mjs'],
          },
        ],
      }),
    )

    expect(out).toContain('## Local apps (development)')
    expect(out).toContain('- my-pr-monitor: 2 tools, 1 job, 1 skill - enabled, loaded')
    expect(out).toContain('- my-reader: manifest error: Backend file does not exist')
  })

  it('omits local app development health when there are no workspace apps', () => {
    const out = renderAgentContext(baseData({ localPackages: [] }))
    expect(out).not.toContain('## Local apps')
  })

  it('renders recent changes when populated', () => {
    const out = renderAgentContext(baseData({ recentChanges: ['Fix the bug', 'Add a feature'] }))
    expect(out).toContain('Fix the bug')
    expect(out).toContain('Add a feature')
  })

  it('renders observability health when populated', () => {
    const out = renderAgentContext(baseData({
      traceHealth: [
        'Top failing tools: fs.read 2/3 errors',
        'Denial hotspots: gmail.send 2 denied',
      ],
    }))
    expect(out).toContain('## Observability health')
    expect(out).toContain('Top failing tools: fs.read 2/3 errors')
    expect(out).toContain('Denial hotspots: gmail.send 2 denied')
  })

  it('omits observability health when there are no signals', () => {
    const out = renderAgentContext(baseData({ traceHealth: [] }))
    expect(out).not.toContain('## Observability health')
  })

  it('shows a one-liner when there are no recent changes', () => {
    const out = renderAgentContext(baseData({ recentChanges: [] }))
    expect(out.toLowerCase()).toContain('no recent commits')
  })

  it('omits the Shared resources section when there are none', () => {
    const out = renderAgentContext(baseData())
    expect(out).not.toContain('## Shared resources')
  })

  it('omits the Shared resources section when the list is empty', () => {
    const out = renderAgentContext(baseData({ resources: [] }))
    expect(out).not.toContain('## Shared resources')
  })

  it('renders shared resources with name, mount path, write policy and status', () => {
    const out = renderAgentContext(
      baseData({
        resources: [
          { id: 'designs', name: 'Designs', mountPath: '.mim/resources/designs', write: 'readonly', status: 'ok' },
          { id: 'team-docs', name: 'Team docs', mountPath: '.mim/resources/team-docs', write: 'direct', status: 'ok' },
        ],
      }),
    )
    expect(out).toContain('## Shared resources')
    expect(out).toContain('Designs')
    expect(out).toContain('.mim/resources/designs')
    expect(out).toContain('readonly')
    expect(out).toContain('Team docs')
    expect(out).toContain('.mim/resources/team-docs')
    expect(out).toContain('direct')
  })

  it('renders shared resources order-independently', () => {
    const a = baseData({
      resources: [
        { id: 'a', name: 'A', mountPath: '.mim/resources/a', write: 'readonly', status: 'ok' },
        { id: 'b', name: 'B', mountPath: '.mim/resources/b', write: 'readonly', status: 'ok' },
      ],
    })
    const b = baseData({
      resources: [
        { id: 'b', name: 'B', mountPath: '.mim/resources/b', write: 'readonly', status: 'ok' },
        { id: 'a', name: 'A', mountPath: '.mim/resources/a', write: 'readonly', status: 'ok' },
      ],
    })
    expect(renderAgentContext(a)).toBe(renderAgentContext(b))
  })

  it('surfaces a non-ok resource status so the agent knows it is unavailable', () => {
    const out = renderAgentContext(
      baseData({
        resources: [
          { id: 'mirror', name: 'Mirror', mountPath: '.mim/resources/mirror', write: 'readonly', status: 'not-synced' },
        ],
      }),
    )
    expect(out).toContain('not-synced')
  })

  it('uses no em dashes or emojis', () => {
    const out = renderAgentContext(
      baseData({
        apps: [{ id: 'board', enabled: true }, { id: 'knowledge', enabled: true }],
        appSections: [{ appId: 'board', title: 'Board', body: 'Backlog: 1' }],
        recentChanges: ['Y'],
      }),
    )
    expect(out).not.toContain('—')
    // no emoji (rough check for surrogate pairs / pictographs)
    expect(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(out)).toBe(false)
  })
})

describe('gatherAgentContext', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-agentctx-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('uses mim.yaml name and reports initialized', () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: My Project\n')
    writeFileSync(join(dir, 'AGENTS.md'), '# a')
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md')
    const data = gatherAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(data.workspace.name).toBe('My Project')
    expect(data.workspace.initialized).toBe(true)
    expect(data.generatedAt).toBe('2026-06-01T12:00:00.000Z')
  })

  it('falls back to basename when mim.yaml is absent', () => {
    const data = gatherAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(data.workspace.name).toBe(dir.split('/').pop())
    expect(data.workspace.initialized).toBe(false)
  })

  it('records board and knowledge enablement without scraping app-owned data folders', () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: X\napps:\n  board: true\n  knowledge: false\n')
    const data = gatherAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(data.apps.find(a => a.id === 'board')?.enabled).toBe(true)
    expect(data.apps.find(a => a.id === 'knowledge')?.enabled).toBe(false)
    expect('issues' in data).toBe(false)
    expect('knowledge' in data).toBe(false)
  })

  it('passes through recentChanges from the injected reader', () => {
    const data = gatherAgentContext(dir, {
      now: () => NOW_MS,
      readRecentChanges: () => ['c1', 'c2'],
    })
    expect(data.recentChanges).toEqual(['c1', 'c2'])
  })

  it('passes through shared resources from the injected reader', () => {
    const data = gatherAgentContext(dir, {
      now: () => NOW_MS,
      readRecentChanges: () => [],
      readResources: () => [
        { id: 'designs', name: 'Designs', mountPath: '.mim/resources/designs', write: 'readonly', status: 'ok' },
      ],
    })
    expect(data.resources?.map(r => r.id)).toEqual(['designs'])
  })

  it('passes through trace health from the injected reader', () => {
    const data = gatherAgentContext(dir, {
      now: () => NOW_MS,
      readRecentChanges: () => [],
      readTraceHealth: () => ['Top failing tools: fs.read 2/3 errors'],
    })
    expect(data.traceHealth).toEqual(['Top failing tools: fs.read 2/3 errors'])
  })

  it('leaves resources undefined when no resource reader is injected', () => {
    const data = gatherAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(data.resources).toBeUndefined()
  })

  it('never throws on a missing git repo (default reader)', () => {
    expect(() => gatherAgentContext(dir, { now: () => NOW_MS })).not.toThrow()
  })

  // --- Generalized apps digest (spec §7) ---

  it('populates apps from injected resolveApps', () => {
    const data = gatherAgentContext(dir, {
      now: () => NOW_MS,
      readRecentChanges: () => [],
      resolveApps: () => [
        { id: 'board', enabled: true },
        { id: 'hello', enabled: true },
        { id: 'knowledge', enabled: false },
      ],
    })
    expect(data.apps).toEqual([
      { id: 'board', enabled: true },
      { id: 'hello', enabled: true },
      { id: 'knowledge', enabled: false },
    ])
  })

  it('lists enabled packages by id in the digest', () => {
    const data = gatherAgentContext(dir, {
      now: () => NOW_MS,
      readRecentChanges: () => [],
      resolveApps: () => [
        { id: 'board', enabled: true },
        { id: 'github-monitor', enabled: true },
        { id: 'knowledge', enabled: false },
      ],
    })
    const enabled = data.apps.filter(a => a.enabled).map(a => a.id)
    expect(enabled).toContain('board')
    expect(enabled).toContain('github-monitor')
    expect(enabled).not.toContain('knowledge')
  })

  it('marks disabled packages as enabled: false', () => {
    const data = gatherAgentContext(dir, {
      now: () => NOW_MS,
      readRecentChanges: () => [],
      resolveApps: () => [
        { id: 'board', enabled: false },
        { id: 'knowledge', enabled: false },
      ],
    })
    expect(data.apps.every(a => !a.enabled)).toBe(true)
  })

  it('uses resolveApps only for the generalized apps digest', () => {
    const data = gatherAgentContext(dir, {
      now: () => NOW_MS,
      readRecentChanges: () => [],
      resolveApps: () => [
        { id: 'board', enabled: true },
        { id: 'knowledge', enabled: true },
      ],
    })
    expect(data.apps).toEqual([
      { id: 'board', enabled: true },
      { id: 'knowledge', enabled: true },
    ])
    expect('issues' in data).toBe(false)
    expect('knowledge' in data).toBe(false)
  })

  it('falls back to committed mim.yaml apps when resolveApps is not injected', () => {
    writeFileSync(join(dir, 'mim.yaml'), 'name: X\napps:\n  board: true\n  knowledge: false\n')
    const data = gatherAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(data.apps.find(a => a.id === 'board')?.enabled).toBe(true)
    expect(data.apps.find(a => a.id === 'knowledge')?.enabled).toBe(false)
  })
})

describe('writeAgentContext local app provider', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-agentctx-local-'))
  })

  afterEach(() => {
    setAgentContextLocalPackagesProvider(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it('includes local app status from the async provider', async () => {
    setAgentContextLocalPackagesProvider(async () => [
      {
        id: 'dev-app',
        name: 'Dev App',
        enabled: true,
        loaded: true,
        tools: 1,
        jobs: 0,
        skills: 1,
        diagnostics: [],
      },
    ])

    const result = await writeAgentContext(dir, {
      now: () => NOW_MS,
      readRecentChanges: () => [],
      readTraceHealth: () => [],
    })

    expect(result.content).toContain('## Local apps (development)')
    expect(result.content).toContain('dev-app: 1 tool')
  })
})

describe('renderAgentContext — generalized apps digest', () => {
  it('lists enabled app ids in the Apps enabled line', () => {
    const data = baseData({
      apps: [
        { id: 'board', enabled: true },
        { id: 'hello', enabled: true },
        { id: 'knowledge', enabled: false },
      ],
    })
    const out = renderAgentContext(data)
    expect(out).toContain('Apps enabled: board, hello')
    expect(out).not.toMatch(/Apps enabled:.*knowledge/)
  })

  it('shows none when no packages are enabled', () => {
    const data = baseData({
      apps: [{ id: 'board', enabled: false }],
    })
    const out = renderAgentContext(data)
    expect(out).toContain('Apps enabled: none')
  })

  it('sorts app ids alphabetically in the enabled line', () => {
    const data = baseData({
      apps: [
        { id: 'knowledge', enabled: true },
        { id: 'board', enabled: true },
        { id: 'hello', enabled: true },
      ],
    })
    const out = renderAgentContext(data)
    expect(out).toContain('Apps enabled: board, hello, knowledge')
  })

  it('does not synthesize a Board section from the apps array alone', () => {
    const out = renderAgentContext(
      baseData({
        apps: [{ id: 'board', enabled: false }],
      }),
    )
    expect(out).not.toContain('## Board')
  })

  it('does not synthesize a Knowledge section from the apps array alone', () => {
    const out = renderAgentContext(
      baseData({
        apps: [{ id: 'knowledge', enabled: false }],
      }),
    )
    expect(out).not.toContain('## Knowledge')
  })
})

describe('writeAgentContext', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-agentctx-write-'))
  })

  afterEach(() => {
    setAgentContextContributionsProvider(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes .mim/agent-context.md and returns path + content', async () => {
    const result = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(result.path).toBe(join(dir, '.mim', 'agent-context.md'))
    expect(result.content.toLowerCase()).toContain('generated')
  })

  it('throws when no workspace path is given', async () => {
    await expect(writeAgentContext('', { now: () => NOW_MS })).rejects.toThrow('No workspace open')
  })
})

describe('renderAgentContext — app sections', () => {
  it('renders app sections as ## headings sorted by appId', () => {
    const data = baseData({
      appSections: [
        { appId: 'z-app', title: 'Z App Status', body: 'All good.' },
        { appId: 'a-app', title: 'A App Status', body: 'Running.' },
      ],
    })
    const out = renderAgentContext(data)
    expect(out).toContain('## A App Status')
    expect(out).toContain('Running.')
    expect(out).toContain('## Z App Status')
    expect(out).toContain('All good.')
    // a-app before z-app
    expect(out.indexOf('## A App Status')).toBeLessThan(out.indexOf('## Z App Status'))
  })

  it('places app sections after the app digest and before shared resources', () => {
    const data = baseData({
      apps: [{ id: 'knowledge', enabled: true }],
      appSections: [{ appId: 'test', title: 'Test Section', body: 'Body here.' }],
      resources: [
        { id: 'r1', name: 'R1', mountPath: '.mim/resources/r1', write: 'readonly', status: 'ok' },
      ],
    })
    const out = renderAgentContext(data)
    const appsPos = out.indexOf('Apps enabled:')
    const sectionPos = out.indexOf('## Test Section')
    const resourcesPos = out.indexOf('## Shared resources')
    expect(appsPos).toBeLessThan(sectionPos)
    expect(sectionPos).toBeLessThan(resourcesPos)
  })

  it('omits app sections when the array is empty', () => {
    const data = baseData({ appSections: [] })
    const out = renderAgentContext(data)
    // no double blank lines from empty section rendering
    expect(out).not.toContain('\n\n\n')
  })

  it('omits app sections when the field is undefined', () => {
    const data = baseData()
    const out = renderAgentContext(data)
    expect(out).not.toContain('## undefined')
  })
})

describe('writeAgentContext — contributions provider', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-agentctx-contrib-'))
  })

  afterEach(() => {
    setAgentContextContributionsProvider(null)
    rmSync(dir, { recursive: true, force: true })
  })

  it('includes provider sections in the written file', async () => {
    setAgentContextContributionsProvider(async () => [
      { appId: 'monitor', title: 'Monitor', body: 'All clear.' },
    ])
    const result = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(result.content).toContain('## Monitor')
    expect(result.content).toContain('All clear.')
  })

  it('caps title to first line and 80 chars', async () => {
    const longTitle = 'A'.repeat(100)
    setAgentContextContributionsProvider(async () => [
      { appId: 'x', title: `${longTitle}\nSecond line`, body: 'ok' },
    ])
    const result = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(result.content).toContain('## ' + 'A'.repeat(80))
    expect(result.content).not.toContain('A'.repeat(81))
    expect(result.content).not.toContain('Second line')
  })

  it('caps body at 1500 chars with truncation marker', async () => {
    const longBody = 'B'.repeat(2000)
    setAgentContextContributionsProvider(async () => [
      { appId: 'x', title: 'T', body: longBody },
    ])
    const result = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(result.content).toContain('B'.repeat(1500) + '…')
    expect(result.content).not.toContain('B'.repeat(1501))
  })

  it('drops sections with empty body', async () => {
    setAgentContextContributionsProvider(async () => [
      { appId: 'a', title: 'Empty', body: '' },
      { appId: 'b', title: 'Whitespace', body: '   ' },
      { appId: 'c', title: 'Real', body: 'Content.' },
    ])
    const result = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(result.content).not.toContain('## Empty')
    expect(result.content).not.toContain('## Whitespace')
    expect(result.content).toContain('## Real')
  })

  it('limits to at most 8 sections', async () => {
    const sections = Array.from({ length: 12 }, (_, i) => ({
      appId: `app-${String(i).padStart(2, '0')}`,
      title: `Section ${i}`,
      body: `Body ${i}`,
    }))
    setAgentContextContributionsProvider(async () => sections)
    const result = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    const matches = result.content.match(/^## Section \d+$/gm)
    expect(matches).toHaveLength(8)
  })

  it('writes file without sections when provider rejects', async () => {
    setAgentContextContributionsProvider(async () => {
      throw new Error('provider failed')
    })
    const result = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(result.content.toLowerCase()).toContain('generated')
    // File was written despite provider failure
    const onDisk = readFileSync(result.path, 'utf-8')
    expect(onDisk).toBe(result.content)
  })

  it('writes file without sections when provider times out', async () => {
    vi.useFakeTimers()
    try {
      // Provider that never resolves
      setAgentContextContributionsProvider(() => new Promise(() => {}))
      const promise = writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
      // Advance past the 3s timeout
      await vi.advanceTimersByTimeAsync(3500)
      const result = await promise
      expect(result.content.toLowerCase()).toContain('generated')
      const onDisk = readFileSync(result.path, 'utf-8')
      expect(onDisk).toBe(result.content)
    } finally {
      vi.useRealTimers()
    }
  })

  it('null provider resets — no sections after clearing', async () => {
    setAgentContextContributionsProvider(async () => [
      { appId: 'x', title: 'X', body: 'present' },
    ])
    const r1 = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(r1.content).toContain('## X')

    setAgentContextContributionsProvider(null)
    const r2 = await writeAgentContext(dir, { now: () => NOW_MS, readRecentChanges: () => [] })
    expect(r2.content).not.toContain('## X')
  })
})
