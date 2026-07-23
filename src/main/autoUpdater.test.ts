import { describe, it, expect, vi, beforeEach } from 'vitest'

const on = vi.fn()
const checkForUpdates = vi.fn().mockResolvedValue(null)
const downloadUpdate = vi.fn().mockResolvedValue(null)
const quitAndInstall = vi.fn()
const setFeedURL = vi.fn()

const mockAutoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: false,
  on,
  setFeedURL,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
}

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mockAutoUpdater },
  autoUpdater: mockAutoUpdater,
}))

vi.mock('electron', () => ({
  app: { isPackaged: true },
}))

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { initAutoUpdater, shouldInitializeAutoUpdater } = await import('./autoUpdater.js') as typeof import('./autoUpdater.js')

function registeredHandler(event: string): ((...args: unknown[]) => void) | undefined {
  const call = mockAutoUpdater.on.mock.calls.find(([e]: string[]) => e === event)
  return call?.[1] as ((...args: unknown[]) => void) | undefined
}

describe('autoUpdater', () => {
  let send: ReturnType<typeof vi.fn>
  let broadcast: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockAutoUpdater.autoDownload = true
    mockAutoUpdater.autoInstallOnAppQuit = false
    send = vi.fn()
    broadcast = vi.fn()
  })

  it('configures autoDownload=false and autoInstallOnAppQuit=true', () => {
    initAutoUpdater({ send, broadcast })
    expect(mockAutoUpdater.autoDownload).toBe(false)
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('uses the packaged app-update.yml feed instead of overriding it', () => {
    initAutoUpdater({ send, broadcast })
    expect(mockAutoUpdater.setFeedURL).not.toHaveBeenCalled()
  })

  it('registers event handlers', () => {
    initAutoUpdater({ send, broadcast })
    const events = mockAutoUpdater.on.mock.calls.map(([e]: string[]) => e)
    expect(events).toContain('update-available')
    expect(events).toContain('download-progress')
    expect(events).toContain('update-downloaded')
    expect(events).toContain('error')
  })

  it('broadcasts update-available to renderer and server', () => {
    initAutoUpdater({ send, broadcast })
    const handler = registeredHandler('update-available')!
    handler({ version: '1.2.0', releaseNotes: 'fixes' })
    expect(send).toHaveBeenCalledWith('app:update-available', { version: '1.2.0', releaseNotes: 'fixes' })
    expect(broadcast).toHaveBeenCalledWith('app:update-available', { version: '1.2.0', releaseNotes: 'fixes' })
  })

  it('broadcasts download-progress', () => {
    initAutoUpdater({ send, broadcast })
    const handler = registeredHandler('download-progress')!
    handler({ percent: 42 })
    expect(send).toHaveBeenCalledWith('app:update-progress', { percent: 42 })
  })

  it('broadcasts update-downloaded', () => {
    const updater = initAutoUpdater({ send, broadcast })
    const handler = registeredHandler('update-downloaded')!
    handler({ version: '1.2.0' })
    expect(send).toHaveBeenCalledWith('app:update-downloaded', { version: '1.2.0' })
    expect(broadcast).toHaveBeenCalledWith('app:update-downloaded', { version: '1.2.0' })
    expect(updater.status()).toEqual({ state: 'ready', version: '1.2.0' })
  })

  it('forwards updater errors to renderer and server without throwing', () => {
    initAutoUpdater({ send, broadcast })
    const handler = registeredHandler('error')!
    expect(() => handler(new Error('network down'))).not.toThrow()
    expect(send).toHaveBeenCalledWith('app:update-error', { message: 'network down' })
    expect(broadcast).toHaveBeenCalledWith('app:update-error', { message: 'network down' })
  })

  it('returns checkForUpdates and downloadUpdate and quitAndInstall', () => {
    const result = initAutoUpdater({ send, broadcast })
    expect(typeof result.checkForUpdates).toBe('function')
    expect(typeof result.downloadUpdate).toBe('function')
    expect(typeof result.quitAndInstall).toBe('function')
  })

  it('initializes only for packaged updater-capable builds', () => {
    expect(shouldInitializeAutoUpdater({
      isPackaged: false,
      platform: 'darwin',
      appImage: undefined,
    })).toBe(false)
    expect(shouldInitializeAutoUpdater({
      isPackaged: true,
      platform: 'darwin',
      appImage: undefined,
    })).toBe(true)
    expect(shouldInitializeAutoUpdater({
      isPackaged: true,
      platform: 'win32',
      appImage: undefined,
    })).toBe(true)
    expect(shouldInitializeAutoUpdater({
      isPackaged: true,
      platform: 'linux',
      appImage: undefined,
    })).toBe(false)
    expect(shouldInitializeAutoUpdater({
      isPackaged: true,
      platform: 'linux',
      appImage: '/Applications/Mim.AppImage',
    })).toBe(true)
  })
})
