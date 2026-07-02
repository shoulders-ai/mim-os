import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const onBeforeRequest = vi.fn()
const mockPageWebContents = {
  session: {
    webRequest: { onBeforeRequest },
  },
  executeJavaScript: vi.fn(),
  loadURL: vi.fn(async () => undefined),
  getURL: vi.fn(() => 'https://example.com/final'),
  on: vi.fn(),
  reload: vi.fn(),
}
const mockChromeWebContents = {
  executeJavaScript: vi.fn(async () => undefined),
  loadURL: vi.fn(async () => undefined),
  on: vi.fn(),
}
const mockChromeView = {
  webContents: mockChromeWebContents,
  setBounds: vi.fn(),
}
const mockPageView = {
  webContents: mockPageWebContents,
  setBounds: vi.fn(),
}
let mockWebContentsViewQueue = [mockChromeView, mockPageView]
const mockWindow = {
  isDestroyed: vi.fn(() => false),
  destroy: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  focus: vi.fn(),
  on: vi.fn(),
  getContentBounds: vi.fn(() => ({ width: 1365, height: 900 })),
  contentView: {
    addChildView: vi.fn(),
  },
  webContents: mockPageWebContents,
}
const browserWindowMock = vi.fn(() => mockWindow)
const webContentsViewMock = vi.fn(() => mockWebContentsViewQueue.shift() ?? mockPageView)

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  WebContentsView: webContentsViewMock,
}))

const { createElectronLiveBrowserDriver } = await import('./liveBrowser.js')

function pageCapture(markdown = '# Loaded\n\nReady') {
  return {
    title: 'Loaded',
    url: 'https://example.com/final',
    markdown,
    refs: [],
    signals: { visible_text_chars: markdown.length, actionable_count: 0 },
  }
}

function pageCaptureWithRefs(markdown: string, count: number) {
  return {
    ...pageCapture(markdown),
    refs: Array.from({ length: count }, (_value, index) => ({
      ref: String(index + 1),
      uid: `internal-${index + 1}`,
      tag: 'a',
      role: 'link',
      label: `Very long navigation link label ${index + 1} with extra text that should be trimmed`,
      href: `https://example.com/${index + 1}?tracking=${'x'.repeat(80)}`,
    })),
  }
}

describe('live browser Electron boundary', () => {
  beforeEach(() => {
    browserWindowMock.mockClear()
    webContentsViewMock.mockClear()
    mockWebContentsViewQueue = [mockChromeView, mockPageView]
    mockWindow.isDestroyed.mockClear()
    mockWindow.destroy.mockClear()
    mockWindow.show.mockClear()
    mockWindow.hide.mockClear()
    mockWindow.focus.mockClear()
    mockWindow.on.mockClear()
    mockWindow.getContentBounds.mockClear()
    mockWindow.contentView.addChildView.mockClear()
    mockPageWebContents.loadURL.mockReset()
    mockPageWebContents.loadURL.mockResolvedValue(undefined)
    mockPageWebContents.getURL.mockClear()
    mockPageWebContents.on.mockClear()
    mockPageWebContents.reload.mockClear()
    mockPageWebContents.executeJavaScript.mockReset()
    mockPageWebContents.executeJavaScript
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(pageCapture())
    mockChromeWebContents.executeJavaScript.mockReset()
    mockChromeWebContents.executeJavaScript.mockResolvedValue(undefined)
    mockChromeWebContents.loadURL.mockReset()
    mockChromeWebContents.loadURL.mockResolvedValue(undefined)
    mockChromeWebContents.on.mockClear()
    mockChromeView.setBounds.mockClear()
    mockPageView.setBounds.mockClear()
    onBeforeRequest.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('captures the current DOM when navigation consumes its budget without finishing', async () => {
    vi.useFakeTimers()
    mockPageWebContents.loadURL.mockReturnValueOnce(new Promise(() => undefined))
    const driver = createElectronLiveBrowserDriver()

    const pending = driver.open(
      { url: 'https://www.reddit.com/', timeout_ms: 1000 },
      { actor: 'ai', sessionId: 'reddit' },
    )

    await vi.advanceTimersByTimeAsync(500)
    const result = await pending

    expect(result.observation).toContain('Ready')
    expect('markdown' in result).toBe(false)
    expect(mockWindow.destroy).not.toHaveBeenCalled()
  })

  it('can open the AI-controlled browser as a visible window', async () => {
    const driver = createElectronLiveBrowserDriver()

    await driver.open(
      { url: 'https://example.com/login', visible: true },
      { actor: 'ai', sessionId: 'visible' },
    )

    expect(browserWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      show: true,
    }))
    expect(mockWindow.show).toHaveBeenCalled()
    expect(mockWindow.focus).toHaveBeenCalled()
  })

  it('can show and hide an existing live browser session', async () => {
    const driver = createElectronLiveBrowserDriver()
    const ctx = { actor: 'ai' as const, sessionId: 'show-hide' }

    await driver.open({ url: 'https://example.com/login' }, ctx)
    const shown = await driver.show({}, ctx)
    const hidden = await driver.hide({}, ctx)

    expect(shown).toEqual({ visible: true })
    expect(hidden).toEqual({ visible: false })
    expect(mockWindow.show).toHaveBeenCalled()
    expect(mockWindow.focus).toHaveBeenCalled()
    expect(mockWindow.hide).toHaveBeenCalled()
  })

  it('applies a default max_chars cap to live browser observations', async () => {
    const longMarkdown = 'A'.repeat(100_005)
    mockPageWebContents.executeJavaScript
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(pageCapture(longMarkdown))
    const driver = createElectronLiveBrowserDriver()

    const result = await driver.open(
      { url: 'https://example.com/long' },
      { actor: 'ai', sessionId: 'long' },
    )

    expect(result.observation.length).toBeLessThanOrEqual(100_000)
    expect('markdown' in result).toBe(false)
    expect(result.content_length).toBe(100_005)
    expect(result.truncated).toBe(true)
  })

  it('returns compact public refs without internal element ids', async () => {
    const markdown = Array.from({ length: 120 }, (_value, index) =>
      `[Item ${index + 1}](ref:${index + 1}:https://example.com/${index + 1})`,
    ).join('\n')
    mockPageWebContents.executeJavaScript
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(pageCaptureWithRefs(markdown, 120))
    const driver = createElectronLiveBrowserDriver()

    const result = await driver.open(
      { url: 'https://example.com/many-links', max_chars: 1200 },
      { actor: 'ai', sessionId: 'refs' },
    )

    expect(result.observation.length).toBeLessThanOrEqual(1200)
    expect(result.ref_count).toBe(120)
    expect(result.refs.length).toBeLessThanOrEqual(40)
    expect(result.refs_truncated).toBe(true)
    expect(result.refs[0]).toEqual(expect.objectContaining({
      ref: '1',
      kind: 'link',
      label: expect.any(String),
      href: expect.stringContaining('https://example.com/1'),
    }))
    expect(JSON.stringify(result.refs)).not.toContain('internal-')
    expect(JSON.stringify(result.refs)).not.toContain('uid')
  })

  it('allows callers to lower max_chars for open and observe', async () => {
    mockPageWebContents.executeJavaScript
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(pageCapture('Open content that should be truncated.'))
      .mockResolvedValueOnce(pageCapture('Observe content that should be truncated.'))
    const driver = createElectronLiveBrowserDriver()

    const opened = await driver.open(
      { url: 'https://example.com/long', max_chars: 12 },
      { actor: 'ai', sessionId: 'cap' },
    )
    const observed = await driver.observe(
      { max_chars: 14 },
      { actor: 'ai', sessionId: 'cap' },
    )

    expect(opened.observation).toContain('Open content')
    expect(opened.observation).not.toContain('that should be truncated')
    expect(opened.truncated).toBe(true)
    expect(observed.observation).toContain('Observe conten')
    expect(observed.observation).not.toContain('t that should be truncated')
    expect(observed.truncated).toBe(true)
  })

  it('continues live browser observations from start_from_char offsets', async () => {
    mockPageWebContents.executeJavaScript
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(pageCapture('Alpha\n\nBeta\n\nGamma'))
      .mockResolvedValueOnce(pageCapture('Alpha\n\nBeta\n\nGamma'))
    const driver = createElectronLiveBrowserDriver()

    const first = await driver.open(
      { url: 'https://example.com/long', max_chars: 9 },
      { actor: 'ai', sessionId: 'offset' },
    )
    const second = await driver.observe(
      { max_chars: 9, start_from_char: first.next_start_char },
      { actor: 'ai', sessionId: 'offset' },
    )

    expect(first.truncated).toBe(true)
    expect(first.next_start_char).toBeGreaterThan(0)
    expect(second.observation).toContain('Beta')
    expect(second.started_from_char).toBe(first.next_start_char)
  })

  it('times out and tears down the hidden browser when page idle never resolves', async () => {
    vi.useFakeTimers()
    mockPageWebContents.executeJavaScript.mockReset()
    mockPageWebContents.executeJavaScript.mockReturnValueOnce(new Promise(() => undefined))
    const driver = createElectronLiveBrowserDriver()

    const pending = driver.open(
      { url: 'https://www.reddit.com/', timeout_ms: 1000 },
      { actor: 'ai', sessionId: 'reddit' },
    ).then(
      () => 'resolved',
      (err) => `rejected:${(err as Error).message}`,
    )

    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1000)

    await expect(Promise.race([pending, Promise.resolve('pending')]))
      .resolves.toMatch(/^rejected:Live browser timed out/)
    expect(mockWindow.destroy).toHaveBeenCalled()
    expect(onBeforeRequest).toHaveBeenLastCalledWith(
      { urls: ['http://*/*', 'https://*/*'] },
      null,
    )
  })
})
