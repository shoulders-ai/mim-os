// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ConnectionsSettingsPanel from './ConnectionsSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

const RESEARCH_STATUS = {
  enabled: true,
  allowedDomains: ['dbregio-berlin-brandenburg.de', 'stackoverflow.com'],
  profile_available: true,
  sources: [
    {
      domain: 'dbregio-berlin-brandenburg.de',
      allowed: true,
      status: 'ready',
      attentionRequired: false,
      lastStatus: 'ok',
      lastSource: 'research-profile',
      lastUrl: 'https://dbregio-berlin-brandenburg.de/fahrplan',
      lastReadAt: '2026-06-25T08:15:00.000Z',
      lastSuccessAt: '2026-06-25T08:15:00.000Z',
      consecutiveFailures: 0,
    },
    {
      domain: 'stackoverflow.com',
      allowed: true,
      status: 'needs_attention',
      attentionRequired: true,
      lastStatus: 'security_verification',
      lastSource: 'rendered',
      lastUrl: 'https://stackoverflow.com/questions/1',
      lastReadAt: '2026-06-25T08:20:00.000Z',
      lastFailureAt: '2026-06-25T08:20:00.000Z',
      consecutiveFailures: 2,
      reason: 'The page is showing a security verification interstitial.',
    },
  ],
}

function makeCall(overrides?: {
  slackStatus?: Record<string, unknown>
  connectors?: Record<string, unknown>
  keyStatuses?: Array<Record<string, unknown>>
  researchStatus?: typeof RESEARCH_STATUS
}) {
  let researchStatus = structuredClone(overrides?.researchStatus ?? RESEARCH_STATUS)
  return vi.fn(async (tool: string, params?: Record<string, unknown>) => {
    if (tool === 'web.research.status') return researchStatus
    if (tool === 'web.research.allowDomain') {
      researchStatus = {
        ...researchStatus,
        enabled: true,
        allowedDomains: [...researchStatus.allowedDomains, params?.domain as string],
        sources: [
          ...researchStatus.sources,
          {
            domain: params?.domain as string,
            allowed: true,
            status: 'ready',
            attentionRequired: false,
            consecutiveFailures: 0,
          },
        ],
      }
      return researchStatus
    }
    if (tool === 'web.research.removeDomain') {
      researchStatus = {
        ...researchStatus,
        allowedDomains: researchStatus.allowedDomains.filter(d => d !== params?.domain),
        sources: researchStatus.sources.filter(s => s.domain !== params?.domain),
      }
      return researchStatus
    }
    if (tool === 'web.research.open') return { opened: true }
    if (tool === 'web.research.clearProfile') return { cleared: true }
    if (tool === 'slack.status') return overrides?.slackStatus ?? { account: 'default', configured: false }
    if (tool === 'slack.connect') return { account: 'default', configured: true, auth: { ok: true, team: 'TestTeam', user: 'bot' } }
    if (tool === 'slack.disconnect') return {}
    if (tool === 'settings.get') return { value: overrides?.connectors ? { slack: overrides.connectors } : null }
    if (tool === 'settings.set') return {}
    if (tool === 'ai.keyStatus') return { statuses: overrides?.keyStatuses ?? [] }
    if (tool === 'ai.setKey') return {}
    if (tool === 'ai.clearKey') return {}
    return {}
  })
}

describe('ConnectionsSettingsPanel — Research Browser', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    call = makeCall()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })
    app = null
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  function mount() {
    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
  }

  it('lists Research Browser source health', async () => {
    mount()
    await flushUi()

    expect(call).toHaveBeenCalledWith('web.research.status', {})
    expect(root.textContent).toContain('Research Browser')
    expect(root.textContent).toContain('dbregio-berlin-brandenburg.de')
    expect(root.textContent).toContain('Ready')
    expect(root.textContent).toContain('stackoverflow.com')
    expect(root.textContent).toContain('Needs attention')
    expect(root.textContent).toContain('security verification')
  })

  it('adds a domain grant from the input', async () => {
    mount()
    await flushUi()

    const input = root.querySelector<HTMLInputElement>('[data-testid="research-domain-input"]')!
    input.value = 'maps.google.com'
    input.dispatchEvent(new Event('input'))
    await flushUi()
    root.querySelector<HTMLButtonElement>('[data-testid="research-add-domain"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('web.research.allowDomain', { domain: 'maps.google.com' })
    expect(root.textContent).toContain('maps.google.com')
  })

  it('allows a queued source without retyping the domain', async () => {
    call = makeCall({
      researchStatus: {
        enabled: false,
        allowedDomains: [],
        profile_available: true,
        sources: [
          {
            domain: 'maps.google.com',
            allowed: false,
            status: 'not_configured',
            attentionRequired: true,
            lastStatus: 'source_not_configured',
            lastUrl: 'https://maps.google.com/search/coffee',
            consecutiveFailures: 1,
            reason: 'Add maps.google.com to Research Browser sources.',
          } as typeof RESEARCH_STATUS['sources'][number],
        ],
      },
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    mount()
    await flushUi()

    expect(root.textContent).toContain('Needs setup')
    root.querySelector<HTMLButtonElement>('[data-testid="research-allow-maps.google.com"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('web.research.allowDomain', { domain: 'maps.google.com' })
    expect(root.textContent).toContain('Ready')
  })

  it('opens a source setup window and removes a domain', async () => {
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="research-open-stackoverflow.com"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('web.research.open', { url: 'https://stackoverflow.com' })

    root.querySelector<HTMLButtonElement>('[data-testid="research-remove-stackoverflow.com"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('web.research.removeDomain', { domain: 'stackoverflow.com' })
    expect(root.textContent).not.toContain('stackoverflow.com')
  })

  it('refreshes status and clears the persistent profile', async () => {
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="research-refresh"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('web.research.status', {})

    root.querySelector<HTMLButtonElement>('[data-testid="research-clear-profile"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('web.research.clearProfile', {})
  })
})

describe('ConnectionsSettingsPanel — Slack', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    app = null
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('shows Connect button when Slack is not configured', async () => {
    const call = makeCall()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(call).toHaveBeenCalledWith('slack.status', {})
    expect(root.textContent).toContain('Slack')
    expect(root.querySelector('button')?.textContent).toBeDefined()
    const buttons = [...root.querySelectorAll('button')]
    expect(buttons.some(b => b.textContent?.trim() === 'Connect')).toBe(true)
  })

  it('shows team name and policy toggles when connected', async () => {
    const call = makeCall({
      slackStatus: {
        account: 'default',
        configured: true,
        auth: { ok: true, team: 'Acme Corp', user: 'mim-bot' },
      },
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Acme Corp')
    expect(root.textContent).toContain('mim-bot')
    expect(root.textContent).toContain('Allow AI to use Slack')
    expect(root.textContent).toContain('Allow private channels')
    expect(root.textContent).toContain('Allow direct messages')
    expect(root.textContent).toContain('Allow AI to send messages')
  })

  it('hides policy toggles when disconnected', async () => {
    const call = makeCall()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(root.textContent).not.toContain('Allow AI to use Slack')
  })

  it('calls slack.disconnect and hides policy toggles', async () => {
    const call = makeCall({
      slackStatus: {
        account: 'default',
        configured: true,
        auth: { ok: true, team: 'Acme Corp', user: 'mim-bot' },
      },
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    const disconnect = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Disconnect')!
    disconnect.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('slack.disconnect', {})
    expect(root.textContent).not.toContain('Allow AI to use Slack')
  })
})

describe('ConnectionsSettingsPanel — Search keys', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    app = null
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('shows Exa Search key row with hint when unconfigured', async () => {
    const call = makeCall()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Exa Search')
    expect(root.textContent).toContain('EXA_API_KEY')
    expect(root.textContent).toContain('Free key at dashboard.exa.ai')
  })

  it('shows configured status when Exa key is set', async () => {
    const call = makeCall({
      keyStatuses: [{ provider: 'exa', configured: true, source: 'file' }],
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Exa Search')
    expect(root.textContent).not.toContain('Free key at dashboard.exa.ai')
    const buttons = [...root.querySelectorAll('button')]
    expect(buttons.some(b => b.textContent?.trim() === 'Replace')).toBe(true)
    expect(buttons.some(b => b.textContent?.trim() === 'Remove')).toBe(true)
  })

  it('shows env source badge when key is from environment', async () => {
    const call = makeCall({
      keyStatuses: [{ provider: 'exa', configured: true, source: 'env' }],
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('From environment')
  })
})
