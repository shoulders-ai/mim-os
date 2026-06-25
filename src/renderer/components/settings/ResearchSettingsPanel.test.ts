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

const STATUS = {
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

describe('ConnectionsSettingsPanel — Research Browser', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>
  let status: typeof STATUS

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    status = structuredClone(STATUS)
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'web.research.status') return status
      if (tool === 'web.research.allowDomain') {
        status = {
          ...status,
          enabled: true,
          allowedDomains: [...status.allowedDomains, params?.domain as string],
          sources: [
            ...status.sources,
            {
              domain: params?.domain as string,
              allowed: true,
              status: 'ready',
              attentionRequired: false,
              consecutiveFailures: 0,
            },
          ],
        }
        return status
      }
      if (tool === 'web.research.removeDomain') {
        status = {
          ...status,
          allowedDomains: status.allowedDomains.filter(domain => domain !== params?.domain),
          sources: status.sources.filter(source => source.domain !== params?.domain),
        }
        return status
      }
      if (tool === 'web.research.open') return { opened: true }
      if (tool === 'web.research.clearProfile') return { cleared: true }
      if (tool === 'slack.status') return { account: 'default', configured: false }
      if (tool === 'settings.get') return { value: null }
      if (tool === 'ai.keyStatus') return { statuses: [] }
      return {}
    })
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

  function mountPanel() {
    app = createApp(ConnectionsSettingsPanel)
    app.mount(root)
  }

  it('lists Research Browser source health', async () => {
    mountPanel()
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
    mountPanel()
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
    status = {
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
        },
      ],
    }
    mountPanel()
    await flushUi()

    expect(root.textContent).toContain('Needs setup')
    root.querySelector<HTMLButtonElement>('[data-testid="research-allow-maps.google.com"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('web.research.allowDomain', { domain: 'maps.google.com' })
    expect(root.textContent).toContain('Ready')
  })

  it('opens a source setup window and removes a domain', async () => {
    mountPanel()
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
    mountPanel()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="research-refresh"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('web.research.status', {})

    root.querySelector<HTMLButtonElement>('[data-testid="research-clear-profile"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('web.research.clearProfile', {})
  })
})
