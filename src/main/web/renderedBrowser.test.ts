import { beforeEach, describe, expect, it, vi } from 'vitest'

const onBeforeRequest = vi.fn()
const mockWindow = {
  loadURL: vi.fn(async () => undefined),
  isDestroyed: vi.fn(() => false),
  destroy: vi.fn(),
  webContents: {
    session: {
      webRequest: { onBeforeRequest },
    },
    executeJavaScript: vi.fn(),
    getURL: vi.fn(() => 'https://example.com/final'),
    getTitle: vi.fn(() => 'Rendered Title'),
  },
}
const browserWindowMock = vi.fn(() => mockWindow)

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
}))

const { renderUrlInHiddenWindow } = await import('./renderedBrowser.js')

describe('renderedBrowser Electron boundary', () => {
  beforeEach(() => {
    browserWindowMock.mockClear()
    mockWindow.loadURL.mockClear()
    mockWindow.isDestroyed.mockClear()
    mockWindow.destroy.mockClear()
    mockWindow.webContents.executeJavaScript.mockReset()
    mockWindow.webContents.getURL.mockClear()
    mockWindow.webContents.getTitle.mockClear()
    onBeforeRequest.mockClear()
    mockWindow.webContents.executeJavaScript
      .mockResolvedValueOnce({
        status: 'ready',
        confidence: 'high',
        signals: {
          visible_text_chars: 48,
          timed_out: false,
          dom_stable: true,
          network_idle: true,
        },
      })
      .mockResolvedValueOnce({
        title: 'Captured Title',
        html: '<body><main><h1>Captured</h1><p>Rendered content.</p></main></body>',
        signals: { visible_text_chars: 48 },
      })
  })

  it('uses an isolated ephemeral partition for stateless reads', async () => {
    await renderUrlInHiddenWindow({ url: 'https://example.com/page', timeoutMs: 1000 })

    expect(browserWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      webPreferences: expect.objectContaining({
        partition: expect.stringMatching(/^mim-web-read-/),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      }),
    }))
  })

  it('blocks private-address browser requests and removes the blocker after the read', async () => {
    await renderUrlInHiddenWindow({ url: 'https://example.com/page', timeoutMs: 1000 })

    expect(onBeforeRequest).toHaveBeenCalledWith(
      { urls: ['http://*/*', 'https://*/*'] },
      expect.any(Function),
    )
    const listener = onBeforeRequest.mock.calls[0][1]
    const callback = vi.fn()
    listener({ url: 'http://127.0.0.1/private' }, callback)
    expect(callback).toHaveBeenCalledWith({ cancel: true })

    const allowedCallback = vi.fn()
    listener({ url: 'https://example.com/asset.js' }, allowedCallback)
    expect(allowedCallback).toHaveBeenCalledWith({ cancel: false })

    expect(onBeforeRequest).toHaveBeenLastCalledWith(
      { urls: ['http://*/*', 'https://*/*'] },
      null,
    )
  })
})
