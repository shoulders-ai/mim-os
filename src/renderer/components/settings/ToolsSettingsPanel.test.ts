// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import ToolsSettingsPanel from './ToolsSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function policy(rows = [
  {
    id: 'git.push',
    domain: 'git',
    label: 'Push changes',
    description: 'Push the current branch',
    toolIds: ['git.push'],
    enabled: true,
  },
  {
    id: 'slack.public',
    domain: 'slack',
    label: 'Read and search public channels',
    toolIds: ['slack.search', 'slack.history'],
    enabled: false,
  },
  {
    id: 'google.gmail.read',
    domain: 'google',
    label: 'Read Gmail',
    toolIds: ['gmail.search', 'gmail.read'],
    enabled: false,
  },
]) {
  return { policy: { rows, enabled: [], disabled: [] } }
}

describe('ToolsSettingsPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    app = null
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'toolPolicy.get') return policy()
      if (tool === 'toolPolicy.set') {
        expect(params).toEqual({ rowId: 'git.push', enabled: false })
        return policy([{
          id: 'git.push',
          domain: 'git',
          label: 'Push changes',
          description: 'Push the current branch',
          toolIds: ['git.push'],
          enabled: false,
        }])
      }
      if (tool === 'slack.status') return { configured: false }
      if (tool === 'google.status') return { configured: true, auth: { email: 'person@example.com' } }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('renders policy rows with connection state and tool ids', async () => {
    app = createApp(ToolsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(call).toHaveBeenCalledWith('toolPolicy.get')
    expect(root.textContent).toContain('Git')
    expect(root.textContent).toContain('Push changes')
    expect(root.textContent).toContain('git.push')
    expect(root.textContent).toContain('Slack · Not connected')
    expect(root.textContent).toContain('Google · person@example.com')
  })

  it('persists row toggles through toolPolicy.set', async () => {
    app = createApp(ToolsSettingsPanel)
    app.mount(root)
    await flushUi()

    const toggle = root.querySelector<HTMLButtonElement>('[aria-label="Disable Push changes"]')
    expect(toggle).toBeTruthy()
    toggle!.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('toolPolicy.set', { rowId: 'git.push', enabled: false })
    expect(root.querySelector('[aria-label="Enable Push changes"]')).toBeTruthy()
  })

  it('shows scope hint and disables toggle when Google scope is missing', async () => {
    const scopeCall = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'toolPolicy.get') return policy([
        {
          id: 'google.gmail.send',
          domain: 'google',
          label: 'Send Gmail',
          toolIds: ['gmail.send'],
          enabled: false,
        },
      ])
      if (tool === 'slack.status') return { configured: false }
      if (tool === 'google.status') return {
        configured: true,
        auth: { email: 'test@example.com' },
        grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call: scopeCall, on: vi.fn(), off: vi.fn() },
    })
    app = createApp(ToolsSettingsPanel)
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Reconnect required')
    const toggle = root.querySelector<HTMLButtonElement>('[aria-label="Enable Send Gmail"]')
    expect(toggle?.disabled).toBe(true)
  })

  it('filters rows by label and tool id', async () => {
    app = createApp(ToolsSettingsPanel)
    app.mount(root)
    await flushUi()

    const input = root.querySelector<HTMLInputElement>('input[aria-label="Search tools"]')!
    input.value = 'slack.search'
    input.dispatchEvent(new Event('input'))
    await flushUi()

    expect(root.textContent).toContain('Read and search public channels')
    expect(root.textContent).not.toContain('Push changes')
  })
})
