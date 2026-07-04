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

  it('does not show scope hint when Google scope is granted', async () => {
    const scopeCall = vi.fn(async (tool: string) => {
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
        grantedScopes: ['https://www.googleapis.com/auth/gmail.send'],
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

    expect(root.textContent).not.toContain('Reconnect required')
    const toggle = root.querySelector<HTMLButtonElement>('[aria-label="Enable Send Gmail"]')
    expect(toggle?.disabled).toBe(false)
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

  it('renders interpreter rows beneath the code domain group', async () => {
    const interpreterCall = vi.fn(async (tool: string) => {
      if (tool === 'toolPolicy.get') return policy([
        {
          id: 'code.run',
          domain: 'code',
          label: 'Run code interpreters',
          description: 'Execute detected interpreters',
          toolIds: ['code.run'],
          enabled: true,
        },
      ])
      if (tool === 'toolchain.status') return {
        entries: [
          { id: 'r', name: 'R', bin: 'R', installed: true, binPath: '/usr/bin/R', version: '4.4.1' },
          { id: 'rscript', name: 'Rscript', bin: 'Rscript', installed: true, binPath: '/usr/bin/Rscript', version: '4.4.1' },
          { id: 'quarto', name: 'Quarto', bin: 'quarto', installed: false },
          { id: 'pandoc', name: 'pandoc', bin: 'pandoc', installed: true, binPath: '/usr/bin/pandoc', version: '3.1' },
          { id: 'python3', name: 'Python', bin: 'python3', installed: true, binPath: '/usr/bin/python3', version: '3.12.0' },
        ],
      }
      if (tool === 'settings.get') return {
        settings: { codeInterpreters: ['rscript', 'r', 'quarto'] },
      }
      if (tool === 'slack.status') return { configured: false }
      if (tool === 'google.status') return { configured: false }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call: interpreterCall, on: vi.fn(), off: vi.fn() },
    })
    app = createApp(ToolsSettingsPanel)
    app.mount(root)
    await flushUi()

    // Interpreter section header
    expect(root.textContent).toContain('Interpreters')
    // Installed interpreters show version
    expect(root.textContent).toContain('R')
    expect(root.textContent).toContain('4.4.1')
    // Not-installed shows "not found"
    expect(root.textContent).toContain('Quarto')
    expect(root.textContent).toContain('not found')
    // pandoc excluded
    expect(root.querySelector('[aria-label*="pandoc"]')).toBeNull()
    // Python shown but not enabled (not in allowlist)
    const pythonToggle = root.querySelector<HTMLButtonElement>('[aria-label="Enable Python interpreter"]')
    expect(pythonToggle).toBeTruthy()
    expect(pythonToggle!.disabled).toBe(false)
    // Quarto toggle is disabled (not installed) — it's in the allowlist so label says "Disable"
    const quartoToggle = root.querySelector<HTMLButtonElement>('[aria-label="Disable Quarto interpreter"]')
    expect(quartoToggle?.disabled).toBe(true)
  })

  it('persists interpreter toggle via settings.set', async () => {
    const interpreterCall = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'toolPolicy.get') return policy([
        {
          id: 'code.run',
          domain: 'code',
          label: 'Run code interpreters',
          toolIds: ['code.run'],
          enabled: true,
        },
      ])
      if (tool === 'toolchain.status') return {
        entries: [
          { id: 'r', name: 'R', bin: 'R', installed: true, binPath: '/usr/bin/R', version: '4.4.1' },
          { id: 'rscript', name: 'Rscript', bin: 'Rscript', installed: true, binPath: '/usr/bin/Rscript', version: '4.4.1' },
          { id: 'quarto', name: 'Quarto', bin: 'quarto', installed: false },
          { id: 'pandoc', name: 'pandoc', bin: 'pandoc', installed: true, binPath: '/usr/bin/pandoc', version: '3.1' },
          { id: 'python3', name: 'Python', bin: 'python3', installed: true, binPath: '/usr/bin/python3', version: '3.12.0' },
        ],
      }
      if (tool === 'settings.get') return {
        settings: { codeInterpreters: ['rscript', 'r', 'quarto'] },
      }
      if (tool === 'settings.set') {
        // Should remove 'rscript' from allowlist
        expect(params).toEqual({ key: 'codeInterpreters', value: ['r', 'quarto'] })
        return {}
      }
      if (tool === 'slack.status') return { configured: false }
      if (tool === 'google.status') return { configured: false }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call: interpreterCall, on: vi.fn(), off: vi.fn() },
    })
    app = createApp(ToolsSettingsPanel)
    app.mount(root)
    await flushUi()

    // Toggle off Rscript (currently enabled)
    const rscriptToggle = root.querySelector<HTMLButtonElement>('[aria-label="Disable Rscript interpreter"]')
    expect(rscriptToggle).toBeTruthy()
    rscriptToggle!.click()
    await flushUi()

    expect(interpreterCall).toHaveBeenCalledWith('settings.set', { key: 'codeInterpreters', value: ['r', 'quarto'] })
  })
})
