// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AiSettingsPanel from './AiSettingsPanel.vue'
import { useSettingsStore } from '../../stores/settings.js'

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

const DEFAULT_STATUSES = [
  { provider: 'anthropic', configured: true },
  { provider: 'openai', configured: true },
]

function stubKernel(config: Record<string, unknown>, statuses: unknown[] = DEFAULT_STATUSES) {
  const call = vi.fn(async (tool: string) => {
    if (tool === 'ai.registry') return REGISTRY
    if (tool === 'ai.keyStatus') return { statuses }
    if (tool === 'config.get') return config
    if (tool === 'settings.get') return { settings: {} }
    return {}
  })
  Object.defineProperty(window, 'kernel', {
    configurable: true,
    value: { call, on: vi.fn(), off: vi.fn(), getWorkspace: vi.fn(async () => '') },
  })
  return call
}

describe('AiSettingsPanel config.yaml cascade', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('shows the config.yaml chat default when set and no workspace override', async () => {
    stubKernel({
      user: {},
      defaults: { models: { chat: 'gpt-5.4', ghost: 'claude-haiku-4-5' } },
    })
    const store = useSettingsStore()
    // config layer set, workspace override empty
    store.configChatModel = 'gpt-5.4'
    store.lastChatModel = ''

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const chatTrigger = document.body.querySelector('[data-testid="settings-model-trigger-chat"]') as HTMLButtonElement | null
    expect(chatTrigger).toBeTruthy()
    // The effective chat default is the config.yaml value, not the registry default (sonnet).
    expect(chatTrigger.textContent).toContain('GPT-5.4')
    expect(chatTrigger.textContent).not.toContain('Claude Sonnet 4.6')
  })

  it('falls back to the registry default when both override and config default are empty', async () => {
    stubKernel({ user: {}, defaults: { models: {} } })
    const store = useSettingsStore()
    store.configChatModel = ''
    store.lastChatModel = ''

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const chatTrigger = document.body.querySelector('[data-testid="settings-model-trigger-chat"]') as HTMLButtonElement | null
    expect(chatTrigger).toBeTruthy()
    // registry chat default[0] is claude-sonnet-4-6
    expect(chatTrigger.textContent).toContain('Claude Sonnet 4.6')
  })

  it('workspace override wins over the config.yaml default', async () => {
    stubKernel({ user: {}, defaults: { models: { chat: 'gpt-5.4' } } })
    const store = useSettingsStore()
    store.configChatModel = 'gpt-5.4'
    store.lastChatModel = 'claude-sonnet-4-6'

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const chatTrigger = document.body.querySelector('[data-testid="settings-model-trigger-chat"]') as HTMLButtonElement | null
    expect(chatTrigger).toBeTruthy()
    expect(chatTrigger.textContent).toContain('Claude Sonnet 4.6')
  })

  it('shows a configured model even when it is outside the feature defaults order', async () => {
    // config.yaml points chat at a model that exists in the registry but is
    // NOT in defaults.chat — the trigger must not render blank.
    stubKernel({ user: {}, defaults: { models: { chat: 'claude-haiku-4-5' } } })
    const store = useSettingsStore()
    store.configChatModel = 'claude-haiku-4-5'
    store.lastChatModel = ''

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const chatTrigger = document.body.querySelector('[data-testid="settings-model-trigger-chat"]') as HTMLButtonElement | null
    expect(chatTrigger).toBeTruthy()
    expect(chatTrigger.textContent).toContain('Claude Haiku 4.5')
  })

  it('hides the key input behind Replace for file-configured providers', async () => {
    stubKernel({ user: {}, defaults: { models: {} } }, [
      { provider: 'anthropic', configured: true, source: 'file' },
      { provider: 'openai', configured: true, source: 'env' },
      { provider: 'google', configured: false },
    ])

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    // file-configured: no input until Replace is clicked
    const anthropicInput = () => document.body.querySelector('[aria-label="Anthropic API key"]')
    expect(anthropicInput()).toBeNull()
    const replaceBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Replace')
    expect(replaceBtn).toBeTruthy()
    replaceBtn!.click()
    await flushUi()
    expect(anthropicInput()).toBeTruthy()

    // env-configured: display-only (env wins over keys.env, no Replace/Remove)
    expect(document.body.querySelector('[aria-label="OpenAI API key"]')).toBeNull()

    // unconfigured: input always visible
    expect(document.body.querySelector('[aria-label="Google API key"]')).toBeTruthy()
  })
})
