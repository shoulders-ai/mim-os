import { BrowserWindow, session } from 'electron'
import type { RenderedPageRenderRequest, RenderedPageSnapshot } from '@main/web/readRenderedUrl.js'
import { renderInWindow } from '@main/web/renderedBrowser.js'
import { parseAllowedHttpUrl } from '@main/web/urlPolicy.js'

export const BROWSER_SESSION_PARTITION = 'persist:mim-browser-session'

export async function renderUrlInBrowserSession(request: RenderedPageRenderRequest): Promise<RenderedPageSnapshot> {
  const win = new BrowserWindow({
    show: false,
    width: 1365,
    height: 900,
    webPreferences: browserSessionWebPreferences(),
  })
  try {
    return await withTimeout(renderInWindow(win, request), request.timeoutMs)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function openBrowserSessionWindow(params: { url?: string } = {}): Promise<{ opened: true, partition: string }> {
  const url = params.url?.trim()
  if (url) parseAllowedHttpUrl(url)
  const win = new BrowserWindow({
    show: true,
    width: 1180,
    height: 820,
    title: 'Mim Website Access',
    webPreferences: browserSessionWebPreferences(),
  })
  await win.loadURL(url || 'about:blank')
  return { opened: true, partition: BROWSER_SESSION_PARTITION }
}

export async function clearBrowserSessionProfile(): Promise<{ cleared: true, partition: string }> {
  const browserSession = session.fromPartition(BROWSER_SESSION_PARTITION)
  await browserSession.clearStorageData()
  await browserSession.clearCache()
  return { cleared: true, partition: BROWSER_SESSION_PARTITION }
}

function browserSessionWebPreferences() {
  return {
    partition: BROWSER_SESSION_PARTITION,
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Website access read timed out after ${Math.round(ms / 1000)}s`)), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
