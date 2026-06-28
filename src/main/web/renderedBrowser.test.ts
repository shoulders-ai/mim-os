import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const { renderInWindow, renderUrlInHiddenWindow } = await import('./renderedBrowser.js')

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

  afterEach(() => {
    vi.useRealTimers()
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

  it('blocks website access requests outside the granted domains', async () => {
    await renderInWindow(mockWindow as any, {
      url: 'https://example.com/page',
      timeoutMs: 1000,
      allowedDomains: ['example.com'],
    })

    const listener = onBeforeRequest.mock.calls[0][1]

    const allowedCallback = vi.fn()
    listener({ url: 'https://example.com/asset.js' }, allowedCallback)
    expect(allowedCallback).toHaveBeenCalledWith({ cancel: false })

    const ungrantedCallback = vi.fn()
    listener({ url: 'https://cdn.example.net/app.js' }, ungrantedCallback)
    expect(ungrantedCallback).toHaveBeenCalledWith({ cancel: true })

    const privateCallback = vi.fn()
    listener({ url: 'http://127.0.0.1/private' }, privateCallback)
    expect(privateCallback).toHaveBeenCalledWith({ cancel: true })
  })

  it('reports the unapproved website access host when a main-frame request is blocked', async () => {
    mockWindow.loadURL.mockReset()
    mockWindow.loadURL.mockImplementationOnce(async () => {
      const listener = onBeforeRequest.mock.calls[0][1]
      listener({
        url: 'https://en.wikipedia.org/wiki/Main_Page',
        resourceType: 'mainFrame',
      }, vi.fn())
      throw new Error('ERR_BLOCKED_BY_CLIENT')
    })

    await expect(renderInWindow(mockWindow as any, {
      url: 'https://wikipedia.org/wiki/Main_Page',
      timeoutMs: 1000,
      allowedDomains: ['wikipedia.org'],
    })).rejects.toThrow('Website access is not approved for en.wikipedia.org')

    expect(onBeforeRequest).toHaveBeenLastCalledWith(
      { urls: ['http://*/*', 'https://*/*'] },
      null,
    )
  })

  it('captures the current DOM when navigation consumes its budget without finishing', async () => {
    vi.useFakeTimers()
    mockWindow.loadURL.mockReset()
    mockWindow.loadURL.mockReturnValueOnce(new Promise(() => undefined))

    const pending = renderInWindow(mockWindow as any, {
      url: 'https://www.bbc.com/news',
      timeoutMs: 1000,
    })

    await vi.advanceTimersByTimeAsync(500)
    const result = await pending

    expect(result.html).toContain('Rendered content.')
    expect(result.capture).toMatchObject({
      status: 'complete',
      confidence: 'high',
    })
  })

  it('times out a stuck readiness script and tears down the hidden window', async () => {
    vi.useFakeTimers()
    mockWindow.webContents.executeJavaScript.mockReset()
    mockWindow.webContents.executeJavaScript.mockReturnValueOnce(new Promise(() => undefined))

    const pending = renderUrlInHiddenWindow({ url: 'https://example.com/page', timeoutMs: 1000 })
    const assertion = expect(pending).rejects.toThrow('Rendered read timed out')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)

    await assertion
    expect(mockWindow.destroy).toHaveBeenCalled()
    expect(onBeforeRequest).toHaveBeenLastCalledWith(
      { urls: ['http://*/*', 'https://*/*'] },
      null,
    )
  })
})
