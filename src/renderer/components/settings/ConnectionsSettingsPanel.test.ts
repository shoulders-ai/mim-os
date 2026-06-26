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
}

function makeCall(overrides?: {
  slackStatus?: Record<string, unknown>
  connectors?: Record<string, unknown>
  googlePolicy?: Record<string, unknown>
  googleStatus?: Record<string, unknown>
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
      }
      return researchStatus
    }
    if (tool === 'web.research.removeDomain') {
      researchStatus = {
        ...researchStatus,
        allowedDomains: researchStatus.allowedDomains.filter(d => d !== params?.domain),
      }
      return researchStatus
    }
    if (tool === 'web.research.open') return { opened: true }
    if (tool === 'web.research.clearProfile') return { cleared: true }
    if (tool === 'slack.status') return overrides?.slackStatus ?? { account: 'default', configured: false }
    if (tool === 'slack.connect') return { account: 'default', configured: true, auth: { ok: true, team: 'TestTeam', user: 'bot' } }
    if (tool === 'slack.disconnect') return {}
    if (tool === 'google.status') return overrides?.googleStatus ?? { account: 'default', configured: false, tokenConfigured: false, grantedScopes: [] }
    if (tool === 'google.connect') return {
      account: 'default',
      configured: true,
      tokenConfigured: true,
      auth: { email: 'person@example.com', name: 'Person Example' },
      grantedScopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    }
    if (tool === 'google.disconnect') return {}
    if (tool === 'settings.get') {
      const connectors: Record<string, unknown> = {}
      if (overrides?.connectors) connectors.slack = overrides.connectors
      if (overrides?.googlePolicy) connectors.google = overrides.googlePolicy
      return { value: Object.keys(connectors).length ? connectors : null }
    }
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

  it('lists Research Browser domain grants', async () => {
    mount()
    await flushUi()

    expect(call).toHaveBeenCalledWith('web.research.status', {})
    expect(root.textContent).toContain('Research Browser')
    expect(root.textContent).toContain('dbregio-berlin-brandenburg.de')
    expect(root.textContent).toContain('stackoverflow.com')
    expect(root.textContent).not.toContain('Needs attention')
    expect(root.textContent).not.toContain('security verification')
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

describe('ConnectionsSettingsPanel — Google', () => {
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

  it('shows Connect button when Google is not configured', async () => {
    const call = makeCall()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(call).toHaveBeenCalledWith('google.status', {})
    expect(root.textContent).toContain('Google')
    expect(root.querySelector('[data-testid="google-connect-toggle"]')).toBeTruthy()
    expect(root.textContent).not.toContain('Allow AI to use Google')
  })

  it('shows account metadata, scopes, and policy toggles when connected', async () => {
    const call = makeCall({
      googleStatus: {
        account: 'default',
        configured: true,
        tokenConfigured: true,
        auth: { email: 'person@example.com', name: 'Person Example' },
        grantedScopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/spreadsheets',
        ],
      },
      googlePolicy: {
        aiEnabled: true,
        gmailEnabled: true,
        gmailSendEnabled: false,
        calendarEnabled: true,
        calendarWriteEnabled: true,
        driveEnabled: true,
        sheetsWriteEnabled: true,
      },
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('person@example.com')
    expect(root.textContent).toContain('Gmail read')
    expect(root.textContent).toContain('Sheets write')
    expect(root.textContent).toContain('Allow AI to use Google')
    expect(root.textContent).toContain('Allow Gmail')
    expect(root.textContent).toContain('Allow AI to update Sheets')
  })

  it('connects Google using the raw token form', async () => {
    const call = makeCall()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="google-connect-toggle"]')?.click()
    await flushUi()
    const token = root.querySelector<HTMLInputElement>('[data-testid="google-access-token"]')!
    token.value = 'access-token'
    token.dispatchEvent(new Event('input'))
    const scope = root.querySelector<HTMLInputElement>('[data-testid="google-scope"]')!
    scope.value = 'https://www.googleapis.com/auth/gmail.readonly'
    scope.dispatchEvent(new Event('input'))
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="google-save-token"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('google.connect', {
      access_token: 'access-token',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
    })
    expect(root.textContent).toContain('person@example.com')
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
