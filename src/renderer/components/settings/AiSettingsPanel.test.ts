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

describe('AiSettingsPanel Personal model defaults', () => {
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

  it('shows the Personal chat default when set', async () => {
    stubKernel({
      user: {},
      defaults: { models: { chat: 'gpt-5.4', ghost: 'claude-haiku-4-5' } },
    })
    const store = useSettingsStore()
    store.lastChatModel = 'gpt-5.4'

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const chatTrigger = document.body.querySelector('[data-testid="settings-model-trigger-chat"]') as HTMLButtonElement | null
    expect(chatTrigger).toBeTruthy()
    // The Personal default wins over the registry default (sonnet).
    expect(chatTrigger.textContent).toContain('GPT-5.4')
    expect(chatTrigger.textContent).not.toContain('Claude Sonnet 4.6')
  })

  it('falls back to the registry default when the Personal default is empty', async () => {
    stubKernel({ user: {}, defaults: { models: {} } })
    const store = useSettingsStore()
    store.lastChatModel = ''

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const chatTrigger = document.body.querySelector('[data-testid="settings-model-trigger-chat"]') as HTMLButtonElement | null
    expect(chatTrigger).toBeTruthy()
    // registry chat default[0] is claude-sonnet-4-6
    expect(chatTrigger.textContent).toContain('Claude Sonnet 4.6')
  })

  it('uses a Personal preference instead of the registry default', async () => {
    stubKernel({ user: {}, defaults: { models: { chat: 'gpt-5.4' } } })
    const store = useSettingsStore()
    store.lastChatModel = 'claude-sonnet-4-6'

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const chatTrigger = document.body.querySelector('[data-testid="settings-model-trigger-chat"]') as HTMLButtonElement | null
    expect(chatTrigger).toBeTruthy()
    expect(chatTrigger.textContent).toContain('Claude Sonnet 4.6')
  })

  it('shows a configured model even when it is outside the feature defaults order', async () => {
    // The preference points at a model that exists in the registry but is not
    // in defaults.chat — the trigger must not render blank.
    stubKernel({ user: {}, defaults: { models: { chat: 'claude-haiku-4-5' } } })
    const store = useSettingsStore()
    store.lastChatModel = 'claude-haiku-4-5'

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
    const replaceBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="key-replace-anthropic"]')
    expect(replaceBtn).toBeTruthy()
    replaceBtn!.click()
    await flushUi()
    expect(anthropicInput()).toBeTruthy()

    // unconfigured: input always visible
    expect(document.body.querySelector('[aria-label="Google API key"]')).toBeTruthy()
  })

  it('shows the masked key tail for a configured provider', async () => {
    stubKernel({ user: {}, defaults: { models: {} } }, [
      { provider: 'anthropic', configured: true, source: 'file', masked: 'sk-ant…X4Q2' },
      { provider: 'openai', configured: false, source: 'missing', masked: null },
    ])

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(document.body.querySelector('[data-testid="key-masked-anthropic"]')?.textContent).toBe('sk-ant…X4Q2')
    expect(document.body.querySelector('[data-testid="key-masked-openai"]')).toBeNull()
  })

  it('removes a file-stored key via Remove', async () => {
    const call = stubKernel({ user: {}, defaults: { models: {} } }, [
      { provider: 'anthropic', configured: true, source: 'file' },
    ])

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const removeBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="key-remove-anthropic"]')
    expect(removeBtn).toBeTruthy()
    removeBtn!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('ai.clearKey', { provider: 'anthropic' })
  })

  it('lets the user replace an env-sourced key', async () => {
    const call = stubKernel({ user: {}, defaults: { models: {} } }, [
      { provider: 'openai', configured: true, source: 'env', masked: 'sk-…9KfD' },
    ])

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    // Env keys live in the shell: the app cannot unset them, only replace
    // them with a saved key (which the resolver prefers). No Remove button,
    // no instruction text — the label's tooltip names the variable.
    const envLabel = [...document.body.querySelectorAll('span')].find(s => s.textContent === 'From environment')
    expect(envLabel).toBeTruthy()
    expect(envLabel!.getAttribute('title')).toContain('OPENAI_API_KEY')
    expect(document.body.querySelector('[data-testid="key-remove-openai"]')).toBeNull()
    const input = () => document.body.querySelector<HTMLInputElement>('[aria-label="OpenAI API key"]')
    expect(input()).toBeNull()

    const replaceBtn = document.body.querySelector<HTMLButtonElement>('[data-testid="key-replace-openai"]')
    expect(replaceBtn).toBeTruthy()
    replaceBtn!.click()
    await flushUi()

    input()!.value = 'sk-replacement'
    input()!.dispatchEvent(new Event('input'))
    await flushUi()
    document.body.querySelector<HTMLButtonElement>('[data-testid="key-save-openai"]')!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('ai.setKey', { provider: 'openai', key: 'sk-replacement' })
  })

  it('Cancel collapses the input for a configured provider', async () => {
    stubKernel({ user: {}, defaults: { models: {} } }, [
      { provider: 'anthropic', configured: true, source: 'file' },
    ])

    app = createApp(AiSettingsPanel)
    app.mount(root)
    await flushUi()

    const input = () => document.body.querySelector('[aria-label="Anthropic API key"]')
    document.body.querySelector<HTMLButtonElement>('[data-testid="key-replace-anthropic"]')!.click()
    await flushUi()
    expect(input()).toBeTruthy()

    document.body.querySelector<HTMLButtonElement>('[data-testid="key-cancel-anthropic"]')!.click()
    await flushUi()
    expect(input()).toBeNull()
    expect(document.body.querySelector('[data-testid="key-replace-anthropic"]')).toBeTruthy()
  })
})
