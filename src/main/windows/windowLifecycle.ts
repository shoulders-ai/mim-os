export type MainWindowCloseAction = 'hide' | 'close'

export interface RestorableMainWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * macOS keeps the application alive when the main window's close button is
 * used. An explicit app quit must still be allowed to close the window.
 */
export function mainWindowCloseAction(
  platform: NodeJS.Platform,
  isQuitting: boolean,
): MainWindowCloseAction {
  return platform === 'darwin' && !isQuitting ? 'hide' : 'close'
}

/** macOS applications remain available from the Dock without open windows. */
export function shouldQuitWhenAllWindowsClose(platform: NodeJS.Platform): boolean {
  return platform !== 'darwin'
}

/**
 * Whether a URL from `setWindowOpenHandler` should be opened externally.
 * Filters out `about:blank` (xterm's `window.open()` with no args) and empty values.
 */
export function shouldOpenExternal(url: string | undefined | null): boolean {
  return typeof url === 'string' && url.length > 0 && url !== 'about:blank'
}

/**
 * Whether a renderer-requested `openExternal` URL is safe to open.
 * Only http/https URLs are allowed.
 */
export function isAllowedExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && /^https?:\/\//i.test(url)
}

/** Bring the preserved main window back when macOS activates Mim from the Dock. */
export function restoreMainWindow(window: RestorableMainWindow | null): boolean {
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}
