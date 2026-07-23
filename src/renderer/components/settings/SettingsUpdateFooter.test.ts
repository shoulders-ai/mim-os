// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import SettingsUpdateFooter from './SettingsUpdateFooter.vue'

describe('SettingsUpdateFooter', () => {
  it('checks for updates and changes to Restart when a download is ready', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const call = vi.fn(async () => ({ version: '0.1.2' }))
    const checkForUpdates = vi.fn(async () => {})
    const quitAndInstall = vi.fn(async () => {})
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call,
        checkForUpdates,
        quitAndInstall,
        on: vi.fn((channel: string, cb: (...args: unknown[]) => void) => listeners.set(channel, cb)),
        off: vi.fn(),
      },
    })
    const root = document.createElement('div')
    const app = createApp(SettingsUpdateFooter)
    app.mount(root)
    await Promise.resolve()
    await nextTick()

    expect(root.textContent).toContain('Mim 0.1.2')
    root.querySelector<HTMLButtonElement>('[data-testid="settings-check-updates"]')?.click()
    expect(checkForUpdates).toHaveBeenCalledOnce()

    listeners.get('app:update-downloaded')?.({ version: '0.2.0' })
    await nextTick()
    expect(root.textContent).toContain('Mim 0.2.0 ready')
    root.querySelector<HTMLButtonElement>('[data-testid="settings-restart-update"]')?.click()
    expect(quitAndInstall).toHaveBeenCalledOnce()
    app.unmount()
  })
})
