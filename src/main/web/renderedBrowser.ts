import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import type {
  RenderedCaptureInfo,
  RenderedCaptureSignals,
  RenderedPageRenderRequest,
  RenderedPageSnapshot,
} from '@main/web/readRenderedUrl.js'
import { CAPTURE_RENDERED_HTML_SCRIPT } from '@main/web/renderedCapture.js'
import { parseAllowedHttpUrl, USER_AGENT } from '@main/web/urlPolicy.js'

const POLL_MS = 250
const STABLE_MS = 900
const LOW_CONFIDENCE_WAIT_MS = 6_000

export async function renderUrlInHiddenWindow(request: RenderedPageRenderRequest): Promise<RenderedPageSnapshot> {
  const win = new BrowserWindow({
    show: false,
    width: 1365,
    height: 900,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      partition: `mim-web-read-${randomUUID()}`,
    },
  })
  try {
    return await renderInWindow(win, request)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export async function renderInWindow(
  win: BrowserWindow,
  request: RenderedPageRenderRequest,
): Promise<RenderedPageSnapshot> {
  const startedAt = Date.now()
  const removeRequestBlocker = installUrlPolicyRequestBlocker(win)
  let loadTimedOut = false
  try {
    try {
      await withTimeout(win.loadURL(request.url, { userAgent: USER_AGENT }), request.timeoutMs)
    } catch (err) {
      if (!isTimeoutError(err)) throw err
      loadTimedOut = true
    }
    const remainingMs = Math.max(0, request.timeoutMs - (Date.now() - startedAt))
    const readiness = loadTimedOut
      ? timeoutReadiness('Navigation did not finish before the capture budget ended.')
      : await waitForReadiness(win, remainingMs)
    const capture = await captureCurrentDocument(win)
    const elapsedMs = Date.now() - startedAt
    const captureInfo = buildCaptureInfo(readiness, capture.signals, elapsedMs)

    return {
      requestedUrl: request.url,
      finalUrl: win.webContents.getURL() || request.url,
      title: capture.title ?? win.webContents.getTitle() ?? '',
      html: capture.html ?? '<body></body>',
      capture: captureInfo,
    }
  } finally {
    removeRequestBlocker()
  }
}

async function waitForReadiness(win: BrowserWindow, budgetMs: number): Promise<ReadinessResult> {
  if (budgetMs <= 0) return timeoutReadiness('Capture budget ended before readiness could be checked.')
  try {
    return await win.webContents.executeJavaScript(readinessScript(budgetMs), true) as ReadinessResult
  } catch (err) {
    return {
      status: 'timeout',
      confidence: 'low',
      reason: `Readiness check failed: ${(err as Error).message || String(err)}`,
      signals: {
        timed_out: true,
        dom_stable: false,
        network_idle: false,
      },
    }
  }
}

async function captureCurrentDocument(win: BrowserWindow): Promise<{
  title: string
  html: string
  signals: RenderedCaptureSignals
}> {
  try {
    const capture = await win.webContents.executeJavaScript(CAPTURE_RENDERED_HTML_SCRIPT, true) as {
      title?: string
      html?: string
      signals?: RenderedCaptureSignals
    }
    return {
      title: capture.title ?? win.webContents.getTitle() ?? '',
      html: capture.html ?? '<body></body>',
      signals: capture.signals ?? {},
    }
  } catch (err) {
    return {
      title: win.webContents.getTitle() ?? '',
      html: '<body></body>',
      signals: {
        timed_out: true,
        dom_stable: false,
        network_idle: false,
        visible_text_chars: 0,
      },
    }
  }
}

function readinessScript(budgetMs: number): string {
  return `
    new Promise((resolve) => {
      const deadline = Date.now() + ${Math.max(0, Math.floor(budgetMs))}
      const stableForMs = ${STABLE_MS}
      const lowConfidenceWaitMs = Math.min(${LOW_CONFIDENCE_WAIT_MS}, ${Math.max(0, Math.floor(budgetMs))})
      const pollMs = ${POLL_MS}
      const startedAt = Date.now()
      let lastSignature = ''
      let stableSince = Date.now()

      const isHidden = (el) => {
        if (!el || el === document.documentElement || el === document.body) return false
        if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true
        try {
          const style = window.getComputedStyle(el)
          const contentVisibility = style.contentVisibility
          return style.display === 'none' || style.visibility === 'hidden' || contentVisibility === 'hidden'
        } catch (_) {
          return false
        }
      }

      const visibleText = (node) => {
        if (!node) return ''
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || ''
        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return ''
        if (node.nodeType === Node.ELEMENT_NODE && isHidden(node)) return ''
        return Array.from(node.childNodes || []).map(visibleText).join(' ')
      }

      const countVisible = (selector) => {
        try {
          return Array.from(document.querySelectorAll(selector)).filter(el => !isHidden(el)).length
        } catch (_) {
          return 0
        }
      }

      const collect = () => {
        const root = document.body || document.documentElement
        const text = root ? visibleText(root).replace(/\\s+/g, ' ').trim() : ''
        const signals = {
          elapsed_ms: Date.now() - startedAt,
          timed_out: false,
          dom_stable: false,
          network_idle: document.readyState === 'complete',
          visible_text_chars: text.length,
          link_count: countVisible('a[href]'),
          button_count: countVisible('button, [role="button"]'),
          form_control_count: countVisible('input, select, textarea'),
          table_row_count: countVisible('tr'),
          heading_count: countVisible('h1, h2, h3, h4, h5, h6, [role="heading"]'),
          image_count: countVisible('img, picture, svg'),
        }
        const signature = [
          signals.visible_text_chars,
          signals.link_count,
          signals.button_count,
          signals.form_control_count,
          signals.table_row_count,
          signals.heading_count,
          signals.image_count,
          document.location.href,
        ].join(':')
        const meaningful = signals.visible_text_chars >= 32
          || signals.table_row_count >= 2
          || signals.link_count >= 3
          || signals.button_count + signals.form_control_count >= 3
          || (signals.heading_count >= 1 && signals.visible_text_chars >= 24)
        return { signals, signature, meaningful }
      }

      const finish = (status, confidence, reason, sample) => {
        const signals = sample ? sample.signals : collect().signals
        resolve({
          status,
          confidence,
          reason,
          signals: {
            ...signals,
            timed_out: status === 'timeout',
            dom_stable: Date.now() - stableSince >= stableForMs,
            network_idle: document.readyState === 'complete',
          },
        })
      }

      const tick = () => {
        const sample = collect()
        if (sample.signature !== lastSignature) {
          lastSignature = sample.signature
          stableSince = Date.now()
        }
        const stable = Date.now() - stableSince >= stableForMs
        const elapsed = Date.now() - startedAt
        if (sample.meaningful && stable) {
          finish('ready', sample.signals.visible_text_chars >= 80 ? 'high' : 'medium', undefined, sample)
          return
        }
        if (!sample.meaningful && stable && elapsed >= lowConfidenceWaitMs) {
          finish('ready', 'low', 'The page stayed stable but exposed very little readable content.', sample)
          return
        }
        if (Date.now() >= deadline) {
          finish('timeout', sample.meaningful ? 'medium' : 'low', 'Capture budget ended before readiness was certain.', sample)
          return
        }
        setTimeout(tick, pollMs)
      }

      Promise.all([
        document.fonts ? document.fonts.ready.catch(() => undefined) : Promise.resolve(),
        ...Array.from(document.images || [], img => img.decode ? img.decode().catch(() => undefined) : Promise.resolve()),
      ]).finally(() => {
        requestAnimationFrame(() => requestAnimationFrame(tick))
      })
    })
  `
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Rendered read timed out after ${Math.round(ms / 1000)}s`)), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

interface ReadinessResult {
  status: 'ready' | 'timeout'
  confidence: 'high' | 'medium' | 'low'
  reason?: string
  signals?: RenderedCaptureSignals
}

function timeoutReadiness(reason: string): ReadinessResult {
  return {
    status: 'timeout',
    confidence: 'low',
    reason,
    signals: {
      timed_out: true,
      dom_stable: false,
      network_idle: false,
    },
  }
}

function installUrlPolicyRequestBlocker(win: BrowserWindow): () => void {
  const filter = { urls: ['http://*/*', 'https://*/*'] }
  win.webContents.session.webRequest.onBeforeRequest(filter, (details, callback) => {
    try {
      parseAllowedHttpUrl(details.url)
      callback({ cancel: false })
    } catch {
      callback({ cancel: true })
    }
  })
  return () => {
    win.webContents.session.webRequest.onBeforeRequest(filter, null)
  }
}

function buildCaptureInfo(
  readiness: ReadinessResult,
  captureSignals: RenderedCaptureSignals,
  elapsedMs: number,
): RenderedCaptureInfo {
  const status = readiness.status === 'timeout' ? 'partial' : 'complete'
  return {
    status,
    confidence: readiness.confidence,
    ...(readiness.reason ? { reason: readiness.reason } : {}),
    signals: {
      ...captureSignals,
      ...readiness.signals,
      elapsed_ms: elapsedMs,
      timed_out: status === 'partial' || readiness.signals?.timed_out === true,
    },
  }
}

function isTimeoutError(err: unknown): boolean {
  const message = (err as Error).message || String(err)
  return /timed?\s*out|timeout/i.test(message)
}
