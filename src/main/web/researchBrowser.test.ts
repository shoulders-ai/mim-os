import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWindow = {
  loadURL: vi.fn(async () => undefined),
  isDestroyed: vi.fn(() => false),
  destroy: vi.fn(),
}
const browserWindowMock = vi.fn(() => mockWindow)
const mockSession = {
  clearStorageData: vi.fn(async () => undefined),
  clearCache: vi.fn(async () => undefined),
}
const fromPartition = vi.fn(() => mockSession)
const renderInWindow = vi.fn(async (_win, request) => ({
  requestedUrl: request.url,
  finalUrl: `${request.url}#done`,
  title: 'Rendered',
  html: '<body>Rendered</body>',
}))

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  session: { fromPartition },
}))

vi.mock('@main/web/renderedBrowser.js', () => ({
  renderInWindow,
}))

const {
  RESEARCH_BROWSER_PARTITION,
  clearResearchBrowserProfile,
  openResearchBrowserWindow,
  renderUrlInResearchSession,
} = await import('./researchBrowser.js')

describe('researchBrowser Electron boundary', () => {
  beforeEach(() => {
    browserWindowMock.mockClear()
    mockWindow.loadURL.mockClear()
    mockWindow.isDestroyed.mockClear()
    mockWindow.destroy.mockClear()
    mockSession.clearStorageData.mockClear()
    mockSession.clearCache.mockClear()
    fromPartition.mockClear()
    renderInWindow.mockClear()
  })

  it('opens a visible setup window with the persistent research partition', async () => {
    const result = await openResearchBrowserWindow({ url: 'https://example.com/login' })

    expect(result).toEqual({ opened: true, partition: 'persist:mim-research' })
    expect(browserWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      show: true,
      webPreferences: expect.objectContaining({
        partition: RESEARCH_BROWSER_PARTITION,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      }),
    }))
    expect(mockWindow.loadURL).toHaveBeenCalledWith('https://example.com/login')
  })

  it('renders hidden reads with the same persistent research partition', async () => {
    const result = await renderUrlInResearchSession({ url: 'https://example.com/private', timeoutMs: 1000 })

    expect(result.finalUrl).toBe('https://example.com/private#done')
    expect(browserWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      webPreferences: expect.objectContaining({
        partition: RESEARCH_BROWSER_PARTITION,
      }),
    }))
    expect(renderInWindow).toHaveBeenCalledWith(mockWindow, { url: 'https://example.com/private', timeoutMs: 1000 })
    expect(mockWindow.destroy).toHaveBeenCalled()
  })

  it('clears storage and cache for the persistent research partition', async () => {
    const result = await clearResearchBrowserProfile()

    expect(result).toEqual({ cleared: true, partition: 'persist:mim-research' })
    expect(fromPartition).toHaveBeenCalledWith(RESEARCH_BROWSER_PARTITION)
    expect(mockSession.clearStorageData).toHaveBeenCalled()
    expect(mockSession.clearCache).toHaveBeenCalled()
  })
})
