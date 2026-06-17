// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import SkillsSettingsPanel from './SkillsSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function click(target: Element | null) {
  expect(target).toBeTruthy()
  target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

async function input(selector: string, value: string) {
  const el = document.body.querySelector<HTMLInputElement>(selector)
  expect(el).toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input', { bubbles: true }))
  await flushUi()
}

describe('SkillsSettingsPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>
  let revealInFinder: ReturnType<typeof vi.fn>
  let openNativeFile: ReturnType<typeof vi.fn>
  let openFolderDialog: ReturnType<typeof vi.fn>
  let skills: Array<Record<string, unknown>>
  let sources: Array<Record<string, unknown>>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    app = null
    skills = [
      {
        id: 'issue-work',
        name: 'issue-work',
        description: 'Use when working with Mim issues.',
        tools: ['issues.list'],
        unlocks: ['issues.update'],
        source: 'personal',
        dir: '/home/.mim/skills/issue-work',
        path: '/home/.mim/skills/issue-work/SKILL.md',
        enabled: true,
        shadows: [{ id: 'issue-work', name: 'issue-work', source: 'builtin' }],
      },
      {
        id: 'team-review',
        name: 'team-review',
        description: 'Use when reviewing team work.',
        tools: [],
        unlocks: ['review.start'],
        source: 'source',
        sourceId: 'team',
        sourceName: 'Team skills',
        dir: '/team/skills/team-review',
        path: '/team/skills/team-review/SKILL.md',
        enabled: true,
        shadows: [],
      },
      {
        id: 'builtin-note',
        name: 'builtin-note',
        description: 'Use built-in defaults.',
        tools: [],
        unlocks: [],
        source: 'builtin',
        dir: '/app/skills/builtin-note',
        path: '/app/skills/builtin-note/SKILL.md',
        enabled: true,
        shadows: [],
      },
    ]
    sources = [
      {
        id: 'team',
        name: 'Team skills',
        kind: 'path',
        location: '/team/skills',
        trusted: true,
        status: 'ok',
        skillCount: 1,
        unlocks: ['review.start'],
      },
    ]
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'skill.list') return { skills: skills.map(skill => ({ ...skill })), diagnostics: [] }
      if (tool === 'skillSource.list') return { sources: sources.map(source => ({ ...source })) }
      if (tool === 'skill.setDisabled') {
        const skill = skills.find(item => item.name === params?.name)
        if (skill) skill.enabled = params?.disabled !== true
        return { ok: true }
      }
      if (tool === 'skill.create') {
        const name = params?.name as string
        const dir = `/home/.mim/skills/${name}`
        skills.push({
          id: name,
          name,
          description: params?.description ?? 'Use when...',
          tools: [],
          unlocks: [],
          source: 'personal',
          dir,
          path: `${dir}/SKILL.md`,
          enabled: true,
          shadows: [],
        })
        return { skill: { dir, path: `${dir}/SKILL.md` } }
      }
      if (tool === 'skill.delete') {
        skills = skills.filter(skill => skill.name !== params?.name)
        return { deleted: params?.name }
      }
      if (tool === 'skill.inspectImport') {
        return {
          skill: {
            id: 'imported-skill',
            name: 'imported-skill',
            description: 'Use imported.',
            tools: [],
            unlocks: ['issues.create'],
            source: 'personal',
            dir: params?.folder,
            path: `${params?.folder}/SKILL.md`,
            enabled: true,
          },
          unlocks: ['issues.create'],
          collision: false,
        }
      }
      if (tool === 'skill.import') {
        const dir = '/home/.mim/skills/imported-skill'
        skills.push({
          id: 'imported-skill',
          name: 'imported-skill',
          description: 'Use imported.',
          tools: [],
          unlocks: ['issues.create'],
          source: 'personal',
          dir,
          path: `${dir}/SKILL.md`,
          enabled: true,
          shadows: [],
        })
        return { skill: { dir } }
      }
      if (tool === 'skillSource.inspect') {
        return {
          id: params?.id ?? 'research',
          name: params?.name ?? 'Research skills',
          kind: params?.git ? 'git' : 'path',
          location: params?.git ?? params?.path,
          skillCount: 1,
          unlocks: ['research.search'],
          diagnostics: [],
        }
      }
      if (tool === 'skillSource.add') {
        sources.push({
          id: params?.id ?? 'research',
          name: params?.name ?? 'Research skills',
          kind: params?.git ? 'git' : 'path',
          location: params?.git ?? params?.path,
          trusted: true,
          status: 'ok',
          skillCount: 1,
          unlocks: ['research.search'],
        })
        skills.push({
          id: 'research-plan',
          name: 'research-plan',
          description: 'Use research.',
          tools: [],
          unlocks: ['research.search'],
          source: 'source',
          sourceId: params?.id ?? 'research',
          sourceName: params?.name ?? 'Research skills',
          dir: `${params?.path ?? '/mirror/research'}/research-plan`,
          path: `${params?.path ?? '/mirror/research'}/research-plan/SKILL.md`,
          enabled: true,
          shadows: [],
        })
        return { source: sources.at(-1) }
      }
      if (tool === 'skillSource.refresh') return { refreshed: params?.id }
      if (tool === 'skillSource.remove') {
        sources = sources.filter(source => source.id !== params?.id)
        skills = skills.filter(skill => skill.sourceId !== params?.id)
        return { removed: params?.id }
      }
      return {}
    })
    revealInFinder = vi.fn(async () => undefined)
    openNativeFile = vi.fn(async () => ({ opened: true }))
    openFolderDialog = vi.fn(async () => '/picked/folder')
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call,
        getWorkspace: vi.fn(async () => '/workspace'),
        revealInFinder,
        openNativeFile,
        openFolderDialog,
        on: vi.fn(),
        off: vi.fn(),
      },
    })
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function mount() {
    app = createApp(SkillsSettingsPanel)
    app.mount(root)
  }

  it('lists authored skills with source, shadow, tool, unlock, and source metadata', async () => {
    mount()
    await flushUi()

    expect(call).toHaveBeenCalledWith('skill.list', { detailed: true })
    expect(call).toHaveBeenCalledWith('skillSource.list', {})
    expect(root.textContent).toContain('Personal')
    expect(root.textContent).toContain('issue-work')
    expect(root.textContent).toContain('Shadows Built-in')
    expect(root.textContent).toContain('Mentions issues.list')
    expect(root.textContent).toContain('Uses issues.update')
    expect(root.textContent).toContain('Team skills')
    expect(root.textContent).toContain('team-review')
    expect(root.textContent).toContain('Built-in')
    expect(root.textContent).not.toContain('App')
  })

  it('opens the Add menu with intake actions in the intended order', async () => {
    mount()
    await flushUi()

    click(root.querySelector('[data-testid="skill-add-menu"]'))
    await flushUi()

    const labels = [...document.body.querySelectorAll('.mim-menu-item')].map(item => item.textContent?.trim())
    expect(labels).toEqual([
      'Add a source...',
      'Import skill from folder...',
      'New Personal skill...',
    ])
  })

  it('toggles a skill by writing global skills.disabled', async () => {
    mount()
    await flushUi()

    click(root.querySelector('[aria-label="issue-work enabled"]'))
    await flushUi()

    expect(call).toHaveBeenCalledWith('skill.setDisabled', { name: 'issue-work', disabled: true })
  })

  it('reveals every row but edits and deletes only Personal rows', async () => {
    mount()
    await flushUi()

    click(root.querySelector('[data-testid="skill-reveal-issue-work"]'))
    click(root.querySelector('[data-testid="skill-edit-issue-work"]'))
    click(root.querySelector('[data-testid="skill-delete-issue-work"]'))
    click(root.querySelector('[data-testid="skill-delete-issue-work"]'))
    await flushUi()

    expect(revealInFinder).toHaveBeenCalledWith('/home/.mim/skills/issue-work')
    expect(openNativeFile).toHaveBeenCalledWith('/home/.mim/skills/issue-work/SKILL.md')
    expect(call).toHaveBeenCalledWith('skill.delete', { name: 'issue-work' })
    expect(root.querySelector('[data-testid="skill-edit-team-review"]')).toBeNull()
    expect(root.querySelector('[data-testid="skill-delete-team-review"]')).toBeNull()
    expect(root.querySelector('[data-testid="skill-reveal-team-review"]')).not.toBeNull()
  })

  it('creates a Personal skill and reveals its folder without opening the editor', async () => {
    mount()
    await flushUi()

    click(root.querySelector('[data-testid="skill-add-menu"]'))
    await flushUi()
    click(document.body.querySelector('[data-testid="skill-new-open"]'))
    await flushUi()
    await input('[data-testid="skill-new-name"]', 'research-plan')
    click(document.body.querySelector('[data-testid="skill-create"]'))
    await flushUi()

    expect(call).toHaveBeenCalledWith('skill.create', { name: 'research-plan' })
    expect(revealInFinder).toHaveBeenCalledWith('/home/.mim/skills/research-plan')
    expect(call).not.toHaveBeenCalledWith('editor.open', expect.anything())
    expect(root.textContent).toContain('research-plan')
  })

  it('inspects then imports a skill before revealing the Personal copy', async () => {
    mount()
    await flushUi()

    click(root.querySelector('[data-testid="skill-add-menu"]'))
    await flushUi()
    click(document.body.querySelector('[data-testid="skill-import-open"]'))
    await flushUi()
    await input('[data-testid="skill-import-folder"]', '/incoming/skill')
    click(document.body.querySelector('[data-testid="skill-import-inspect"]'))
    await flushUi()

    expect(call).toHaveBeenCalledWith('skill.inspectImport', { folder: '/incoming/skill' })
    expect(document.body.textContent).toContain('imported-skill')
    expect(document.body.textContent).toContain('Uses issues.create')

    click(document.body.querySelector('[data-testid="skill-import-confirm"]'))
    await flushUi()

    expect(call).toHaveBeenCalledWith('skill.import', { folder: '/incoming/skill', confirmed: true })
    expect(revealInFinder).toHaveBeenCalledWith('/home/.mim/skills/imported-skill')
  })

  it('manages source headers and confirms source add after inspection', async () => {
    mount()
    await flushUi()

    click(root.querySelector('[data-testid="skill-source-refresh-team"]'))
    click(root.querySelector('[data-testid="skill-source-remove-team"]'))
    click(root.querySelector('[data-testid="skill-source-remove-team"]'))
    await flushUi()

    expect(call).toHaveBeenCalledWith('skillSource.refresh', { id: 'team' })
    expect(call).toHaveBeenCalledWith('skillSource.remove', { id: 'team' })

    click(root.querySelector('[data-testid="skill-add-menu"]'))
    await flushUi()
    click(document.body.querySelector('[data-testid="skill-add-source"]'))
    await flushUi()
    await input('[data-testid="skill-source-location"]', '/research/skills')
    await input('[data-testid="skill-source-id"]', 'research')
    await input('[data-testid="skill-source-name"]', 'Research skills')
    click(document.body.querySelector('[data-testid="skill-source-inspect"]'))
    await flushUi()

    expect(call).toHaveBeenCalledWith('skillSource.inspect', {
      path: '/research/skills',
      id: 'research',
      name: 'Research skills',
    })
    expect(document.body.textContent).toContain('1 skills')
    expect(document.body.textContent).toContain('Uses research.search')

    click(document.body.querySelector('[data-testid="skill-source-confirm"]'))
    await flushUi()

    expect(call).toHaveBeenCalledWith('skillSource.add', {
      path: '/research/skills',
      id: 'research',
      name: 'Research skills',
      confirmed: true,
    })
    expect(root.textContent).toContain('Research skills')
  })
})
