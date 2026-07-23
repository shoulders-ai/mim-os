// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import SettingsDialog from './SettingsDialog.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

const REGISTRY = {
  defaults: {
    chat: ['claude-sonnet-4-6', 'gpt-5.4'],
    inline: ['claude-sonnet-4-6', 'gpt-5.4'],
    ghost: ['claude-haiku-4-5', 'gpt-5.4-nano'],
  },
  models: [
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', provider: 'anthropic', providerLabel: 'Anthropic' },
    { id: 'gpt-5.4', displayName: 'GPT-5.4', provider: 'openai', providerLabel: 'OpenAI' },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', provider: 'anthropic', providerLabel: 'Anthropic' },
    { id: 'gpt-5.4-nano', displayName: 'GPT-5.4 Nano', provider: 'openai', providerLabel: 'OpenAI' },
  ],
}

describe('SettingsDialog model defaults', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    call = vi.fn(async (tool: string) => {
      if (tool === 'ai.registry') return REGISTRY
      if (tool === 'ai.keyStatus') {
        return { statuses: [{ provider: 'anthropic', configured: true }, { provider: 'openai', configured: true }] }
      }
      if (tool === 'app.status') {
        return {
          apps: [
            { id: 'board', enabled: false, layer: 'default', installed: true, installedVersions: ['0.1.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
            { id: 'knowledge', enabled: false, layer: 'default', installed: true, installedVersions: ['0.1.0'], source: 'global', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
            { id: 'runtime-demo', enabled: true, layer: 'default', installed: true, installedVersions: ['0.1.0'], source: 'workspace', shadowed: false, needsTrust: false, needsInstall: false, folderPresent: false },
          ],
        }
      }
      if (tool === 'package.list') {
        return {
          packages: [{
            id: 'runtime-demo',
            name: 'Runtime',
            icon: 'R',
            description: 'Package runtime demo',
            views: [{ id: 'main', label: 'Runtime', src: './ui/index.html', role: 'work' }],
            enabled: true,
            source: 'workspace',
          }],
          diagnostics: [],
        }
      }
      if (tool === 'package.capabilities.list') return { packages: [] }
      if (tool === 'agent.list') return { agents: [] }
      if (tool === 'web.browser.status') return {
        enabled: true,
        allowedDomains: ['dbregio-berlin-brandenburg.de'],
        profile_available: true,
      }
      if (tool === 'slack.status') return { account: 'default', configured: false }
      if (tool === 'google.status') return { account: 'default', configured: false, grantedScopes: [] }
      if (tool === 'toolPolicy.get') {
        return {
          policy: {
            rows: [{
              id: 'git.push',
              domain: 'git',
              label: 'Push changes',
              toolIds: ['git.push'],
              enabled: true,
            }],
            enabled: [],
            disabled: [],
          },
        }
      }
      if (tool === 'settings.get') return { value: null }
      if (tool === 'skill.list') return { skills: [], diagnostics: [] }
      if (tool === 'skill.templateList') return { templates: [] }
      if (tool === 'history.stats') return { bytes: 0, blobBytes: 0, fileCount: 0, versionCount: 0 }
      if (tool === 'sync.status') return { mode: 'manual', state: 'manual', git: false, remote: null, dirty: false, ahead: false, behind: false, conflicts: [], message: 'Manual' }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn(), getWorkspace: vi.fn(async () => '') },
    })
    // Model assertions target the AI section explicitly; the dialog's bare
    // default is General (covered by its own test below).
    app = createApp(SettingsDialog, { initialSection: 'ai' })
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('never offers an abstract "Auto" model option', async () => {
    app.mount(root)
    await flushUi()
    // open every model dropdown
    const triggerIds = ['chat', 'inline', 'ghost'] as const
    for (const feature of triggerIds) {
      const trigger = document.body.querySelector(`[data-testid="settings-model-trigger-${feature}"]`) as HTMLButtonElement | null
      expect(trigger).toBeTruthy()
      trigger.click()
      await flushUi()
    }
    const names = [...document.body.querySelectorAll<HTMLElement>('[data-testid^="settings-model-option-"]')]
      .map(node => node.textContent?.trim())
    expect(names.length).toBeGreaterThan(0)
    expect(names).not.toContain('Auto')
    expect(names).not.toContain('Best configured')
  })

  it('shows the resolved default model name on an unset feature and badges it', async () => {
    app.mount(root)
    await flushUi()
    // unset ghost should display its registry default (haiku), not a placeholder
    const ghostTrigger = document.body.querySelector('[data-testid="settings-model-trigger-ghost"]') as HTMLButtonElement | null
    expect(ghostTrigger).toBeTruthy()
    expect(ghostTrigger.textContent).toContain('Claude Haiku 4.5')

    ghostTrigger.click()
    await flushUi()
    const haiku = document.body.querySelector('[data-testid="settings-model-option-ghost-claude-haiku-4-5"]') as HTMLElement | null
    expect(haiku).toBeTruthy()
    expect(haiku.textContent).toContain('Default')
    // the unset default is rendered as the active selection
    expect(haiku?.getAttribute('aria-selected')).toBe('true')
    // the non-default option carries no Default badge
    const nano = document.body.querySelector('[data-testid="settings-model-option-ghost-gpt-5.4-nano"]') as HTMLElement | null
    expect(nano).toBeTruthy()
    expect(nano.textContent).not.toContain('Default')
  })

  it('keeps the navigation and content side by side inside the shared dialog panel', async () => {
    app.mount(root)
    await flushUi()

    const layout = document.body.querySelector<HTMLElement>('[data-testid="settings-dialog-layout"]')
    const nav = document.body.querySelector<HTMLElement>('.sd-nav')
    const main = document.body.querySelector<HTMLElement>('.sd-main')

    expect(layout).toBeTruthy()
    expect(layout?.className).toContain('flex-row')
    expect(nav?.parentElement).toBe(layout)
    expect(main?.parentElement).toBe(layout)
  })

  it('opens General by default and never resizes between sections', async () => {
    app = createApp(SettingsDialog)
    app.mount(root)
    await flushUi()

    expect(document.body.querySelector('[aria-label="General settings"]')).toBeTruthy()

    const panel = document.body.querySelector<HTMLElement>('.mim-dialog-panel')
    expect(panel).toBeTruthy()
    const sizeClasses = () => panel!.className.split(/\s+/)
      .filter(c => c.startsWith('w-[') || c.startsWith('h-['))
      .sort()
    const sizeBefore = sizeClasses()
    expect(sizeBefore.length).toBe(2)
    const projectBtn = document.body.querySelector<HTMLButtonElement>('.sd-nav [data-section="project"]')
    expect(projectBtn).toBeTruthy()
    projectBtn!.click()
    await flushUi()
    expect(document.body.querySelector('[aria-label="Project settings"]')).toBeTruthy()
    expect(sizeClasses()).toEqual(sizeBefore)
  })

  it('renders the Apps panel inline when the apps section is active', async () => {
    app = createApp(SettingsDialog, { initialSection: 'apps' })
    app.mount(root)
    await flushUi()
    await flushUi()

    expect(document.body.querySelector('[data-testid="settings-dialog-layout"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Apps')
  })

  it('renders the Skills panel inline when the skills section is active', async () => {
    app = createApp(SettingsDialog, { initialSection: 'skills' })
    app.mount(root)
    await flushUi()
    await flushUi()

    expect(document.body.querySelector('[data-testid="settings-dialog-layout"]')).toBeTruthy()
    expect(document.body.querySelector('[aria-label="Skills settings"]')).toBeTruthy()
    expect(document.body.querySelector('[data-section="skills"]')).toBeTruthy()
  })

  it('renders CLI tools inside the Apps panel', async () => {
    app = createApp(SettingsDialog, { initialSection: 'apps' })
    app.mount(root)
    await flushUi()
    await flushUi()

    expect(document.body.textContent).toContain('Coding agents')
  })

  it('renders the Connections panel inline when the connections section is active', async () => {
    app = createApp(SettingsDialog, { initialSection: 'connections' })
    app.mount(root)
    await flushUi()

    expect(document.body.querySelector('[aria-label="Connections settings"]')).toBeTruthy()
    expect(document.body.textContent).toContain('dbregio-berlin-brandenburg.de')
    expect(document.body.querySelector('[data-section="connections"]')).toBeTruthy()
  })

  it('renders the Tools panel inline when the tools section is active', async () => {
    app = createApp(SettingsDialog, { initialSection: 'tools' })
    app.mount(root)
    await flushUi()

    expect(document.body.querySelector('[aria-label="Tools settings"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Push changes')
    expect(document.body.querySelector('[data-section="tools"]')).toBeTruthy()
  })
})
