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
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn(), getWorkspace: vi.fn(async () => '') },
    })
    // Model assertions target the AI section explicitly; the dialog's bare
    // default is Appearance (covered by its own test below).
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

  it('opens Appearance by default and never resizes between sections', async () => {
    app = createApp(SettingsDialog)
    app.mount(root)
    await flushUi()

    expect(document.body.querySelector('[aria-label="Appearance settings"]')).toBeTruthy()

    const panel = document.body.querySelector<HTMLElement>('.mim-dialog-panel')
    expect(panel).toBeTruthy()
    const sizeClasses = () => panel!.className.split(/\s+/)
      .filter(c => c.startsWith('w-[') || c.startsWith('h-['))
      .sort()
    const sizeBefore = sizeClasses()
    expect(sizeBefore.length).toBe(2)
    const resourcesBtn = document.body.querySelector<HTMLButtonElement>('.sd-nav [data-section="resources"]')
    expect(resourcesBtn).toBeTruthy()
    resourcesBtn!.click()
    await flushUi()
    expect(document.body.querySelector('[aria-label="Resources settings"]')).toBeTruthy()
    expect(sizeClasses()).toEqual(sizeBefore)
  })

  it('renders the Apps panel inline when the apps section is active', async () => {
    app = createApp(SettingsDialog, { initialSection: 'apps' })
    app.mount(root)
    await flushUi()
    await flushUi()

    expect(document.body.querySelector('[data-testid="settings-dialog-layout"]')).toBeTruthy()
    expect(document.body.textContent).toContain('My Sidebar')
  })

  it('renders the Agents panel inline when the agents section is active', async () => {
    app = createApp(SettingsDialog, { initialSection: 'agents' })
    app.mount(root)
    await flushUi()
    await flushUi()

    expect(document.body.querySelector('[data-testid="settings-dialog-layout"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Coding agents')
    expect(document.body.querySelector('[data-section="agents"]')).toBeTruthy()
  })
})
