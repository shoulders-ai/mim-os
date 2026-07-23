import electronUpdater from 'electron-updater'

export interface AutoUpdaterDeps {
  send: (channel: string, data: unknown) => void
  broadcast: (channel: string, data: unknown) => void
}

export interface AutoUpdaterInitOptions {
  isPackaged: boolean
  platform: NodeJS.Platform
  appImage?: string
}

export function shouldInitializeAutoUpdater(options: AutoUpdaterInitOptions): boolean {
  if (!options.isPackaged) return false
  if (options.platform !== 'linux') return true
  return typeof options.appImage === 'string' && options.appImage.length > 0
}

export function initAutoUpdater(deps: AutoUpdaterDeps) {
  const { autoUpdater } = electronUpdater
  let status: { state: 'idle' | 'available' | 'ready' | 'error'; version?: string; message?: string } = {
    state: 'idle',
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    const payload = { version: info.version, releaseNotes: info.releaseNotes }
    status = { state: 'available', version: info.version }
    deps.send('app:update-available', payload)
    deps.broadcast('app:update-available', payload)
  })

  autoUpdater.on('update-not-available', (info) => {
    const payload = { version: info.version }
    status = { state: 'idle' }
    deps.send('app:update-not-available', payload)
    deps.broadcast('app:update-not-available', payload)
  })

  autoUpdater.on('download-progress', (progress) => {
    deps.send('app:update-progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    const payload = { version: info.version }
    status = { state: 'ready', version: info.version }
    deps.send('app:update-downloaded', payload)
    deps.broadcast('app:update-downloaded', payload)
  })

  autoUpdater.on('error', (error) => {
    const payload = { message: errorMessage(error) }
    status = { state: 'error', message: payload.message }
    deps.send('app:update-error', payload)
    deps.broadcast('app:update-error', payload)
  })

  return {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    status: () => ({ ...status }),
    quitAndInstall: () => {
      autoUpdater.quitAndInstall()
    },
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.length > 0) return error
  return 'Unknown update error'
}
