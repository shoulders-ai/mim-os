import { BrowserWindow, session } from 'electron'
import type { RenderedPageRenderRequest, RenderedPageSnapshot } from '@main/web/readRenderedUrl.js'
import { renderInWindow } from '@main/web/renderedBrowser.js'
import { parseAllowedHttpUrl } from '@main/web/urlPolicy.js'

export const RESEARCH_BROWSER_PARTITION = 'persist:mim-research'

export async function renderUrlInResearchSession(request: RenderedPageRenderRequest): Promise<RenderedPageSnapshot> {
  const win = new BrowserWindow({
    show: false,
    width: 1365,
    height: 900,
    webPreferences: researchWebPreferences(),
  })
  try {
    return await withTimeout(renderInWindow(win, request), request.timeoutMs)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function openResearchBrowserWindow(params: { url?: string } = {}): Promise<{ opened: true, partition: string }> {
  const url = params.url?.trim()
  if (url) parseAllowedHttpUrl(url)
  const win = new BrowserWindow({
    show: true,
    width: 1180,
    height: 820,
    title: 'Mim Research Browser',
    webPreferences: researchWebPreferences(),
  })
  await win.loadURL(url || 'about:blank')
  return { opened: true, partition: RESEARCH_BROWSER_PARTITION }
}

export async function clearResearchBrowserProfile(): Promise<{ cleared: true, partition: string }> {
  const researchSession = session.fromPartition(RESEARCH_BROWSER_PARTITION)
  await researchSession.clearStorageData()
  await researchSession.clearCache()
  return { cleared: true, partition: RESEARCH_BROWSER_PARTITION }
}

function researchWebPreferences() {
  return {
    partition: RESEARCH_BROWSER_PARTITION,
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
        timer = setTimeout(() => reject(new Error(`Research browser read timed out after ${Math.round(ms / 1000)}s`)), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
