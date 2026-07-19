import { describe, expect, it, vi } from 'vitest'
import {
  isAllowedExternalUrl,
  mainWindowCloseAction,
  restoreMainWindow,
  shouldOpenExternal,
  shouldQuitWhenAllWindowsClose,
} from './windowLifecycle.js'

describe('main window lifecycle', () => {
  it('hides on an ordinary macOS close', () => {
    expect(mainWindowCloseAction('darwin', false)).toBe('hide')
  })

  it('closes on macOS when the app is explicitly quitting', () => {
    expect(mainWindowCloseAction('darwin', true)).toBe('close')
  })

  it.each(['win32', 'linux'] as const)('closes normally on %s', (platform) => {
    expect(mainWindowCloseAction(platform, false)).toBe('close')
  })

  it('keeps the app alive after all windows close on macOS', () => {
    expect(shouldQuitWhenAllWindowsClose('darwin')).toBe(false)
  })

  it.each(['win32', 'linux'] as const)('quits after all windows close on %s', (platform) => {
    expect(shouldQuitWhenAllWindowsClose(platform)).toBe(true)
  })

  it('shows and focuses the existing main window on activation', () => {
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }

    expect(restoreMainWindow(window)).toBe(true)
    expect(window.restore).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('restores a minimized main window before showing it', () => {
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }

    expect(restoreMainWindow(window)).toBe(true)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  describe('shouldOpenExternal', () => {
    it('allows normal URLs', () => {
      expect(shouldOpenExternal('https://example.com')).toBe(true)
      expect(shouldOpenExternal('http://localhost:3000')).toBe(true)
      expect(shouldOpenExternal('file:///tmp/foo')).toBe(true)
    })

    it('rejects about:blank from xterm window.open()', () => {
      expect(shouldOpenExternal('about:blank')).toBe(false)
    })

    it('rejects empty and missing values', () => {
      expect(shouldOpenExternal('')).toBe(false)
      expect(shouldOpenExternal(null)).toBe(false)
      expect(shouldOpenExternal(undefined)).toBe(false)
    })
  })

  describe('isAllowedExternalUrl', () => {
    it('allows http and https URLs', () => {
      expect(isAllowedExternalUrl('https://example.com')).toBe(true)
      expect(isAllowedExternalUrl('http://example.com')).toBe(true)
      expect(isAllowedExternalUrl('HTTP://EXAMPLE.COM')).toBe(true)
    })

    it('rejects non-http schemes', () => {
      expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
      expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
      expect(isAllowedExternalUrl('about:blank')).toBe(false)
    })

    it('rejects non-string values', () => {
      expect(isAllowedExternalUrl(null)).toBe(false)
      expect(isAllowedExternalUrl(undefined)).toBe(false)
      expect(isAllowedExternalUrl(42)).toBe(false)
      expect(isAllowedExternalUrl('')).toBe(false)
    })
  })

  it('does not restore a missing or destroyed window', () => {
    expect(restoreMainWindow(null)).toBe(false)

    const destroyedWindow = {
      isDestroyed: vi.fn(() => true),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    }
    expect(restoreMainWindow(destroyedWindow)).toBe(false)
    expect(destroyedWindow.show).not.toHaveBeenCalled()
    expect(destroyedWindow.focus).not.toHaveBeenCalled()
  })
})
