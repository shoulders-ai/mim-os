// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import StorageSettingsPanel from './StorageSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll('button')]
    .find(item => item.textContent?.trim() === label) as HTMLButtonElement | undefined
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

describe('StorageSettingsPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>
  let confirmAction: ReturnType<typeof vi.fn>
  let syncStatus: Record<string, unknown>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    setActivePinia(createPinia())
    syncStatus = {
      mode: 'manual',
      state: 'manual',
      gitAvailable: true,
      git: false,
      remote: null,
      dirty: false,
      ahead: false,
      behind: false,
      conflicts: [],
      retryable: false,
      message: 'Manual',
    }
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'history.stats') {
        return { bytes: 12 * 1024 * 1024, blobBytes: 11 * 1024 * 1024, fileCount: 8, versionCount: 42, prunedVersionCount: 12 }
      }
      if (tool === 'trace.storage') {
        return { digestBytes: 2 * 1024 * 1024, payloadBytes: 8 * 1024 * 1024, payloadCount: 17, totalBytes: 10 * 1024 * 1024 }
      }
      if (tool === 'sync.status') {
        return syncStatus
      }
      if (tool === 'history.prune' || tool === 'trace.prune' || tool === 'settings.set') return { ok: true, ...params }
      if (tool === 'telemetry.setEnabled') return { enabled: params?.enabled !== false, locked: false }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })
    confirmAction = vi.fn(() => true)
    Object.defineProperty(window, 'confirm', { configurable: true, value: confirmAction })
    app = createApp(StorageSettingsPanel)
    app.use(createPinia())
    app.mount(root)
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('shows two plain-language toggles and hides technical controls by default', async () => {
    await flushUi()

    expect(call).toHaveBeenCalledWith('history.stats')
    expect(call).toHaveBeenCalledWith('trace.storage')
    expect(root.textContent).toContain('File recovery')
    expect(root.textContent).toContain('Local audit trail')
    expect(root.textContent).toContain('Advanced')
    expect(root.textContent).not.toContain('History budget')
    expect(root.textContent).not.toContain('Audit retention')
    expect(root.textContent).not.toContain('Content retention')
    expect(root.textContent).not.toContain('Content budget')

    button(root, 'Show').click()
    await flushUi()
    expect(root.textContent).toContain('12.0 MB · 42 versions')
    expect(root.textContent).toContain('2.0 MB audit · 8.0 MB content')
    expect(root.textContent).toContain('History budget')
    expect(root.textContent).toContain('Audit retention')
    expect(root.textContent).toContain('Content retention')
    expect(root.textContent).toContain('Content budget')
  })

  it('applies explicit history and trace cleanup actions', async () => {
    await flushUi()
    button(root, 'Show').click()
    await flushUi()

    button(root, 'Optimize history').click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('history.prune')

    button(root, 'Clean now').click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('trace.prune')
  })

  it('persists the content-capture choice', async () => {
    await flushUi()
    button(root, 'Show').click()
    await flushUi()

    const toggle = root.querySelector('[aria-label="Keep trace content"]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('settings.set', {
      key: 'traceCaptureContent',
      value: false,
    })
  })

  it('confirms and disables local audit storage immediately', async () => {
    await flushUi()

    const toggle = root.querySelector('[aria-label="Keep local audit trail"]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click()
    await flushUi()

    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('delete the existing local audit trail'))
    expect(call).toHaveBeenCalledWith('settings.set', { key: 'traceRetentionDays', value: 0 })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    button(root, 'Show').click()
    await flushUi()
    expect((root.querySelector('[aria-label="Audit retention"]') as HTMLButtonElement).disabled).toBe(true)
    expect((root.querySelector('[aria-label="Keep trace content"]') as HTMLButtonElement).disabled).toBe(true)

    toggle.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('settings.set', { key: 'traceRetentionDays', value: 90 })
    expect(confirmAction).toHaveBeenCalledTimes(1)
  })

  it('confirms and disables future file recovery without deleting existing versions', async () => {
    await flushUi()

    const toggle = root.querySelector('[aria-label="Keep file recovery"]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click()
    await flushUi()

    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining('stop saving new file recovery points'))
    expect(call).toHaveBeenCalledWith('settings.set', { key: 'historyEnabled', value: false })
    expect(call).not.toHaveBeenCalledWith('history.clear')

    toggle.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('settings.set', { key: 'historyEnabled', value: true })
    expect(confirmAction).toHaveBeenCalledTimes(1)
  })

  it('leaves both local records enabled when disable confirmations are cancelled', async () => {
    await flushUi()
    confirmAction.mockReturnValue(false)

    const historyToggle = root.querySelector('[aria-label="Keep file recovery"]') as HTMLButtonElement
    const auditToggle = root.querySelector('[aria-label="Keep local audit trail"]') as HTMLButtonElement
    historyToggle.click()
    auditToggle.click()
    await flushUi()

    expect(historyToggle.getAttribute('aria-checked')).toBe('true')
    expect(auditToggle.getAttribute('aria-checked')).toBe('true')
    expect(call).not.toHaveBeenCalledWith('settings.set', expect.anything())
  })

  it('shows guided Git setup and explains automatic managed sync', async () => {
    syncStatus = {
      mode: 'managed',
      state: 'not-configured',
      gitAvailable: false,
      git: false,
      remote: 'https://github.com/acme/project.git',
      dirty: false,
      ahead: false,
      behind: false,
      conflicts: [],
      retryable: false,
      gitInstallAction: 'Run xcode-select --install, then try again.',
      lfsRequired: false,
      lfsAvailable: null,
      lfsInstallAction: null,
      message: 'Git is required.',
    }
    await (app?.unmount())
    root.innerHTML = ''
    app = createApp(StorageSettingsPanel)
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Mim syncs on open, after changes, and before quit')
    expect(root.textContent).toContain('Run xcode-select --install')
    expect(button(root, 'Sync now').disabled).toBe(true)
  })
})
