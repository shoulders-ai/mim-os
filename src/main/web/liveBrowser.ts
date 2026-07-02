import { randomUUID } from 'crypto'
import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import type { ToolContext } from '@main/tools/registry.js'
import { chunkMarkdownByStructure } from '@main/html/markdown.js'
import { isBrowserSessionAllowed, readBrowserSessionSettings } from '@main/web/browserSessionSettings.js'
import { BROWSER_SESSION_PARTITION } from '@main/web/browserSession.js'
import { CAPTURE_MARKANYWHERE_PAGE_SCRIPT, type MarkanywhereActionRef, type MarkanywherePageCapture } from '@main/web/liveBrowserCapture.js'
import { parseAllowedHttpUrl, USER_AGENT } from '@main/web/urlPolicy.js'

export interface LiveBrowserOpenParams {
  url: string
  stateful?: boolean
  timeout_ms?: number
  max_chars?: number
  start_from_char?: number
  visible?: boolean
}

export interface LiveBrowserObserveParams {
  max_chars?: number
  start_from_char?: number
}

export interface LiveBrowserClickParams {
  ref: string
}

export interface LiveBrowserTypeParams {
  ref: string
  text: string
}

export interface LiveBrowserScrollParams {
  direction?: 'down' | 'up' | 'left' | 'right'
  amount?: number
}

export interface LiveBrowserWaitParams {
  ms?: number
}

export interface LiveBrowserExtractParams {
  max_chars?: number
  start_from_char?: number
}

export interface LiveBrowserDriver {
  open(params: LiveBrowserOpenParams, ctx: ToolContext): Promise<LiveBrowserObservation>
  observe(params: LiveBrowserObserveParams, ctx: ToolContext): Promise<LiveBrowserObservation>
  click(params: LiveBrowserClickParams, ctx: ToolContext): Promise<LiveBrowserActionResult>
  type(params: LiveBrowserTypeParams, ctx: ToolContext): Promise<LiveBrowserActionResult>
  scroll(params: LiveBrowserScrollParams, ctx: ToolContext): Promise<LiveBrowserActionResult>
  wait(params: LiveBrowserWaitParams, ctx: ToolContext): Promise<LiveBrowserActionResult>
  extract(params: LiveBrowserExtractParams, ctx: ToolContext): Promise<LiveBrowserExtractResult>
  show(params: Record<string, unknown>, ctx: ToolContext): Promise<{ visible: true }>
  hide(params: Record<string, unknown>, ctx: ToolContext): Promise<{ visible: false }>
  close(params: Record<string, unknown>, ctx: ToolContext): Promise<{ closed: true }>
}

export interface LiveBrowserObservation {
  page: string
  url: string
  title: string
  observation: string
  refs: LiveBrowserPublicRef[]
  ref_count: number
  refs_truncated?: boolean
  signals: MarkanywherePageCapture['signals']
  content_length: number
  truncated?: boolean
  next_start_char?: number
  started_from_char?: number
}

export interface LiveBrowserPublicRef {
  ref: string
  kind: string
  label: string
  href?: string
  disabled?: boolean
}

export interface LiveBrowserActionResult {
  changed: boolean
  observe_next: boolean
  waited_ms?: number
  message?: string
}

export interface LiveBrowserExtractResult {
  content: string
  content_length: number
  truncated?: boolean
  next_start_char?: number
  started_from_char?: number
}

interface LiveBrowserSession {
  win: BrowserWindow
  contents: WebContents
  refs: Map<string, MarkanywhereActionRef>
  capture: MarkanywherePageCapture | null
  removeRequestBlocker: () => void
  chrome: LiveBrowserChrome
}

interface LiveBrowserChrome {
  chromeView: WebContentsView
  pageView: WebContentsView
}

export interface LiveBrowserDriverOptions {
  getWorkspacePath?: () => string | null
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_WAIT_MS = 500
const MAX_WAIT_MS = 10_000
const DEFAULT_OBSERVE_TIMEOUT_MS = 10_000
const DEFAULT_ACTION_TIMEOUT_MS = 10_000
const DEFAULT_MAX_CHARS = 100_000
const MAX_MAX_CHARS = 300_000
const LIVE_BROWSER_CHROME_HEIGHT = 44
const MAX_PUBLIC_REFS = 40
const MAX_REF_LABEL_CHARS = 90
const MAX_REF_HREF_CHARS = 140

export function createElectronLiveBrowserDriver(options: LiveBrowserDriverOptions = {}): LiveBrowserDriver {
  const sessions = new Map<string, LiveBrowserSession>()

  function key(ctx: ToolContext): string {
    return ctx.sessionId || 'default'
  }

  function sessionFor(ctx: ToolContext): LiveBrowserSession {
    const session = sessions.get(key(ctx))
    if (!session || session.win.isDestroyed()) {
      throw new Error('No live browser session is open. Use browser_open first.')
    }
    return session
  }

  async function closeSession(ctx: ToolContext): Promise<{ closed: true }> {
    const session = sessions.get(key(ctx))
    if (session) {
      session.removeRequestBlocker()
      if (!session.win.isDestroyed()) session.win.destroy()
      sessions.delete(key(ctx))
    }
    return { closed: true }
  }

  async function observeSession(
    session: LiveBrowserSession,
    maxChars: number,
    startFromChar: number,
    timeoutMs = DEFAULT_OBSERVE_TIMEOUT_MS,
  ): Promise<LiveBrowserObservation> {
    const capture = await captureCurrentPage(session.contents, timeoutMs)
    session.capture = capture
    session.refs = new Map(capture.refs.map(ref => [ref.ref, ref]))
    return formatObservation(capture, maxChars, startFromChar)
  }

  return {
    async open(params, ctx) {
      const parsed = parseAllowedHttpUrl(params.url)
      await closeSession(ctx)

      const stateful = params.stateful === true
      const workspacePath = options.getWorkspacePath?.() ?? null
      const allowedDomains = stateful ? approvedWebsiteAccessDomains(parsed.href, workspacePath) : undefined
      const visible = params.visible === true
      const partition = stateful ? BROWSER_SESSION_PARTITION : `mim-live-browser-${randomUUID()}`
      const browser = createLiveBrowserWindow(partition, visible)
      const { win, contents, chrome } = browser
      let blockedWebsiteAccessRequest: BlockedWebsiteAccessRequest | null = null
      const removeRequestBlocker = installLiveBrowserRequestBlocker(contents, allowedDomains, (blocked) => {
        if (!blockedWebsiteAccessRequest || blocked.resourceType === 'mainFrame') {
          blockedWebsiteAccessRequest = blocked
        }
      })
      const session: LiveBrowserSession = {
        win,
        contents,
        refs: new Map(),
        capture: null,
        removeRequestBlocker,
        chrome,
      }
      sessions.set(key(ctx), session)
      if (visible) {
        win.show()
        win.focus()
      }
      const timeoutMs = positiveInteger(params.timeout_ms, DEFAULT_TIMEOUT_MS, 120_000)
      const maxChars = positiveInteger(params.max_chars, DEFAULT_MAX_CHARS, MAX_MAX_CHARS)
      const startFromChar = nonNegativeInteger(params.start_from_char)
      const startedAt = Date.now()
      try {
        try {
          await withTimeout(
            contents.loadURL(parsed.href, { userAgent: USER_AGENT }),
            Math.min(navigationTimeoutMs(timeoutMs), remainingTimeoutMs(startedAt, timeoutMs)),
          )
        } catch (err) {
          if (blockedWebsiteAccessRequest && isBlockedByClientError(err)) {
            throw new Error(websiteAccessBlockedMessage(blockedWebsiteAccessRequest))
          }
          if (!isTimeoutError(err)) throw err
        }
        await updateLiveBrowserChromeUrl(session)
        const idleBudgetMs = Math.min(5_000, Math.max(1, remainingTimeoutMs(startedAt, timeoutMs) - 250))
        await withTimeout(waitForPageIdle(contents, idleBudgetMs), remainingTimeoutMs(startedAt, timeoutMs))
        return await observeSession(session, maxChars, startFromChar, remainingTimeoutMs(startedAt, timeoutMs))
      } catch (err) {
        await closeSession(ctx)
        throw err
      }
    },

    async observe(params, ctx) {
      const maxChars = positiveInteger(params.max_chars, DEFAULT_MAX_CHARS, MAX_MAX_CHARS)
      const startFromChar = nonNegativeInteger(params.start_from_char)
      return observeSession(sessionFor(ctx), maxChars, startFromChar)
    },

    async click(params, ctx) {
      const session = sessionFor(ctx)
      const ref = requireRef(session, params.ref)
      const result = await withTimeout(
        runElementAction(session.contents, { action: 'click', ref: ref.ref, uid: ref.uid }),
        DEFAULT_ACTION_TIMEOUT_MS,
      )
      if (!result.ok) throw new Error(result.error)
      return { changed: true, observe_next: true, message: result.message }
    },

    async type(params, ctx) {
      const session = sessionFor(ctx)
      const ref = requireRef(session, params.ref)
      const result = await withTimeout(
        runElementAction(session.contents, {
          action: 'type',
          ref: ref.ref,
          uid: ref.uid,
          text: params.text,
        }),
        DEFAULT_ACTION_TIMEOUT_MS,
      )
      if (!result.ok) throw new Error(result.error)
      return { changed: true, observe_next: true, message: result.message }
    },

    async scroll(params, ctx) {
      const session = sessionFor(ctx)
      const amount = positiveInteger(params.amount, 700, 5_000)
      const direction = params.direction || 'down'
      await withTimeout(
        session.contents.executeJavaScript(scrollScript(direction, amount), true),
        DEFAULT_ACTION_TIMEOUT_MS,
      )
      return { changed: true, observe_next: true }
    },

    async wait(params, ctx) {
      const session = sessionFor(ctx)
      const ms = positiveInteger(params.ms, DEFAULT_WAIT_MS, MAX_WAIT_MS)
      await waitForPageIdle(session.contents, ms)
      return { changed: false, observe_next: true, waited_ms: ms }
    },

    async extract(params, ctx) {
      const session = sessionFor(ctx)
      const capture = session.capture ?? await captureCurrentPage(session.contents)
      const maxChars = positiveInteger(params.max_chars, DEFAULT_MAX_CHARS, MAX_MAX_CHARS)
      const startFromChar = nonNegativeInteger(params.start_from_char)
      const chunk = chunkLiveMarkdown(capture.markdown, maxChars, startFromChar)
      return {
        content: chunk.content,
        content_length: capture.markdown.length,
        ...(chunk.hasMore ? { truncated: true } : {}),
        ...(chunk.nextStartChar != null ? { next_start_char: chunk.nextStartChar } : {}),
        ...(startFromChar > 0 ? { started_from_char: startFromChar } : {}),
      }
    },

    async show(_params, ctx) {
      const session = sessionFor(ctx)
      await updateLiveBrowserChromeUrl(session)
      session.win.show()
      session.win.focus()
      return { visible: true }
    },

    async hide(_params, ctx) {
      const session = sessionFor(ctx)
      session.win.hide()
      return { visible: false }
    },

    async close(_params, ctx) {
      return closeSession(ctx)
    },
  }
}

function pageWebPreferences(partition: string) {
  return {
    sandbox: true,
    nodeIntegration: false,
    contextIsolation: true,
    partition,
  }
}

function createLiveBrowserWindow(partition: string, visible: boolean): { win: BrowserWindow, contents: WebContents, chrome: LiveBrowserChrome } {
  const win = new BrowserWindow({
    show: visible,
    width: 1365,
    height: 900,
    title: 'Mim Live Browser',
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  const chromeView = new WebContentsView({
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  const pageView = new WebContentsView({
    webPreferences: pageWebPreferences(partition),
  })
  win.contentView.addChildView(chromeView)
  win.contentView.addChildView(pageView)
  const chrome = { chromeView, pageView }
  const layout = () => layoutLiveBrowserChrome(win, chrome)
  win.on('resize', layout)
  layout()
  installLiveBrowserChromeHandlers(chromeView, pageView.webContents)
  void chromeView.webContents.loadURL(liveBrowserChromeDataUrl())
  return { win, contents: pageView.webContents, chrome }
}

function layoutLiveBrowserChrome(win: BrowserWindow, chrome: LiveBrowserChrome): void {
  const bounds = win.getContentBounds()
  chrome.chromeView.setBounds({
    x: 0,
    y: 0,
    width: Math.max(0, bounds.width),
    height: LIVE_BROWSER_CHROME_HEIGHT,
  })
  chrome.pageView.setBounds({
    x: 0,
    y: LIVE_BROWSER_CHROME_HEIGHT,
    width: Math.max(0, bounds.width),
    height: Math.max(0, bounds.height - LIVE_BROWSER_CHROME_HEIGHT),
  })
}

function installLiveBrowserChromeHandlers(chromeView: WebContentsView, pageContents: WebContents): void {
  const update = () => updateChromeUrl(chromeView, pageContents.getURL())
  chromeView.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('mim-live-browser:')) return
    event.preventDefault()
    const parsed = new URL(url)
    if (parsed.hostname === 'navigate') {
      const raw = parsed.searchParams.get('url')?.trim()
      if (!raw) return
      const target = raw.includes('://') ? raw : `https://${raw}`
      void pageContents.loadURL(target, { userAgent: USER_AGENT }).catch(() => undefined)
      return
    }
    if (parsed.hostname === 'reload') {
      pageContents.reload()
    }
  })
  pageContents.on('did-navigate', update)
  pageContents.on('did-navigate-in-page', update)
  pageContents.on('did-finish-load', update)
}

function liveBrowserChromeDataUrl(): string {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 44px; display: flex; align-items: center; gap: 8px; padding: 6px 8px; font: 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; background: #f6f7f9; border-bottom: 1px solid #d8dde6; }
  button { height: 30px; min-width: 32px; border: 1px solid #c9d0da; border-radius: 6px; background: #ffffff; color: #1d2733; }
  button:hover { background: #eef2f7; }
  form { flex: 1; margin: 0; }
  input { width: 100%; height: 30px; border: 1px solid #c9d0da; border-radius: 6px; padding: 0 10px; background: #ffffff; color: #111827; font: inherit; }
</style>
</head>
<body>
  <button id="reload" type="button" title="Reload">Reload</button>
  <form id="form"><input id="url" spellcheck="false" autocomplete="off" aria-label="URL"></form>
  <script>
    const input = document.getElementById('url');
    document.getElementById('form').addEventListener('submit', event => {
      event.preventDefault();
      location.href = 'mim-live-browser://navigate?url=' + encodeURIComponent(input.value);
    });
    document.getElementById('reload').addEventListener('click', () => {
      location.href = 'mim-live-browser://reload';
    });
    window.__setMimLiveBrowserUrl = value => { input.value = value || ''; };
  </script>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

async function updateLiveBrowserChromeUrl(session: LiveBrowserSession): Promise<void> {
  await updateChromeUrl(session.chrome.chromeView, session.contents.getURL())
}

async function updateChromeUrl(chromeView: WebContentsView, url: string): Promise<void> {
  try {
    await chromeView.webContents.executeJavaScript(`window.__setMimLiveBrowserUrl?.(${JSON.stringify(url)})`, true)
  } catch {
    // The chrome view may not be ready yet; navigation events will retry.
  }
}

function approvedWebsiteAccessDomains(url: string, workspacePath: string | null): string[] {
  const settings = readBrowserSessionSettings(workspacePath)
  const match = isBrowserSessionAllowed(url, settings.allowedDomains)
  if (!settings.enabled || !match.allowed) {
    throw new Error(`Website access is not approved for ${match.host}. Approve this website from chat or add it in Settings > Connections.`)
  }
  return settings.allowedDomains
}

async function captureCurrentPage(contents: WebContents, timeoutMs = DEFAULT_OBSERVE_TIMEOUT_MS): Promise<MarkanywherePageCapture> {
  const capture = await withTimeout(
    contents.executeJavaScript(CAPTURE_MARKANYWHERE_PAGE_SCRIPT, true) as Promise<MarkanywherePageCapture>,
    timeoutMs,
  )
  if (!capture.markdown.trim() && capture.refs.length === 0) {
    throw new Error(`No readable content captured from ${capture.url || contents.getURL() || 'current page'}.`)
  }
  return capture
}

function formatObservation(capture: MarkanywherePageCapture, maxChars: number, startFromChar: number): LiveBrowserObservation {
  const metadataLines = [
    `Page: ${capture.title || '(untitled)'}`,
    `URL: ${capture.url}`,
    `Capture: ${capture.signals.visible_text_chars} visible chars, ${capture.refs.length} refs`,
  ]
  const metadataPrefix = [
    ...metadataLines,
    '',
  ].join('\n')
  const includeMetadata = maxChars >= metadataPrefix.length + 180
  const chunkLineReserve = includeMetadata ? 140 : 0
  const prefix = includeMetadata ? metadataPrefix : ''
  const markdownBudget = Math.max(1, maxChars - prefix.length - chunkLineReserve)
  const chunk = chunkLiveMarkdown(capture.markdown, markdownBudget, startFromChar)
  const publicRefs = compactPublicRefs(capture.refs, refsMentionedInMarkdown(chunk.content), MAX_PUBLIC_REFS)
  const markdown = chunk.content
  const chunkLine = includeMetadata && (chunk.hasMore || startFromChar > 0)
    ? [`[chunk: showing chars ${chunk.startChar}-${chunk.endChar} of ${capture.markdown.length}; call browser_act with action="observe" and start_from_char=${chunk.nextStartChar ?? chunk.startChar} to continue.]`, '']
    : []
  let observation = includeMetadata
    ? [
        ...metadataLines,
        '',
        ...chunkLine,
        markdown || 'No readable content captured',
      ].join('\n')
    : markdown || 'No readable content captured'
  if (observation.length > maxChars) {
    const marker = '\n[truncated]'
    observation = maxChars <= marker.length
      ? observation.slice(0, maxChars)
      : `${observation.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`
  }
  return {
    page: capture.title || '',
    title: capture.title || '',
    url: capture.url,
    observation,
    refs: publicRefs,
    ref_count: capture.refs.length,
    ...(publicRefs.length < capture.refs.length ? { refs_truncated: true } : {}),
    signals: capture.signals,
    content_length: capture.markdown.length,
    ...(chunk.hasMore ? { truncated: true } : {}),
    ...(chunk.nextStartChar != null ? { next_start_char: chunk.nextStartChar } : {}),
    ...(startFromChar > 0 ? { started_from_char: startFromChar } : {}),
  }
}

function refsMentionedInMarkdown(markdown: string): Set<string> {
  const refs = new Set<string>()
  for (const match of markdown.matchAll(/\bref:(\d+):/g)) refs.add(match[1])
  for (const match of markdown.matchAll(/\bref="(\d+)"/g)) refs.add(match[1])
  return refs
}

function compactPublicRefs(
  refs: MarkanywhereActionRef[],
  mentionedRefs: Set<string>,
  limit: number,
): LiveBrowserPublicRef[] {
  if (mentionedRefs.size === 0) return []
  return refs
    .filter(ref => mentionedRefs.has(ref.ref))
    .slice(0, limit)
    .map(ref => ({
      ref: ref.ref,
      kind: ref.role || ref.tag || 'control',
      label: truncateOneLine(ref.label || ref.value || '(unlabeled)', MAX_REF_LABEL_CHARS),
      ...(ref.href ? { href: truncateOneLine(ref.href, MAX_REF_HREF_CHARS) } : {}),
      ...(ref.disabled ? { disabled: true } : {}),
    }))
}

function truncateOneLine(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxChars) return compact
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function chunkLiveMarkdown(markdown: string, maxChars: number, startFromChar: number): {
  content: string
  hasMore: boolean
  startChar: number
  endChar: number
  nextStartChar?: number
} {
  const chunks = chunkMarkdownByStructure(markdown, {
    maxChunkChars: maxChars,
    startFromChar,
  })
  if (!chunks.length) {
    throw new Error(`start_from_char (${startFromChar}) exceeds content length ${markdown.length} characters.`)
  }
  const chunk = chunks[0]
  const structuredContent = chunk.overlapPrefix ? `${chunk.overlapPrefix}\n${chunk.content}` : chunk.content
  if (structuredContent.length > maxChars || chunk.charOffsetStart < startFromChar) {
    const endChar = Math.min(markdown.length, startFromChar + maxChars)
    return {
      content: markdown.slice(startFromChar, endChar),
      hasMore: endChar < markdown.length,
      startChar: startFromChar,
      endChar,
      ...(endChar < markdown.length ? { nextStartChar: endChar } : {}),
    }
  }
  return {
    content: structuredContent,
    hasMore: chunk.hasMore,
    startChar: chunk.charOffsetStart,
    endChar: chunk.charOffsetEnd,
    ...(chunk.hasMore ? { nextStartChar: chunk.charOffsetEnd } : {}),
  }
}

function requireRef(session: LiveBrowserSession, ref: string): MarkanywhereActionRef {
  const found = session.refs.get(ref)
  if (!found) {
    throw new Error(`Stale ref: no actionable element with ref '${ref}' in the current capture. Run browser_act with action="observe" again.`)
  }
  return found
}

async function runElementAction(
  contents: WebContents,
  input: { action: 'click' | 'type', ref: string, uid: string, text?: string },
): Promise<{ ok: true, message?: string } | { ok: false, error: string }> {
  return contents.executeJavaScript(`(${performElementAction.toString()})(${JSON.stringify(input)})`, true) as Promise<
    { ok: true, message?: string } | { ok: false, error: string }
  >
}

function performElementAction(input: { action: 'click' | 'type', ref: string, uid: string, text?: string }): { ok: true, message?: string } | { ok: false, error: string } {
  const ELEMENT_UID = '__mimMarkanywhereElementUid'

  function isDisabled(el: Element): boolean {
    return (el as HTMLButtonElement).disabled === true
      || el.hasAttribute('disabled')
      || el.getAttribute('aria-disabled')?.toLowerCase() === 'true'
  }

  function dispatch(el: Element, type: string): void {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))
  }

  const element = Array.from(document.querySelectorAll('*')).find(el =>
    (el as Element & Record<string, string>)[ELEMENT_UID] === input.uid
  ) as HTMLElement | undefined
  if (!element) {
    return {
      ok: false,
      error: `Stale ref: no actionable element with ref '${input.ref}' in the current capture. Run browser_act with action="observe" again.`,
    }
  }
  if (isDisabled(element)) {
    return { ok: false, error: `Action target disabled: ref '${input.ref}' cannot be used.` }
  }

  if (input.action === 'click') {
    element.focus?.()
    element.click()
    return { ok: true, message: `Clicked ref ${input.ref}.` }
  }

  element.focus?.()
  const text = input.text ?? ''
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.value = text
    dispatch(element, 'input')
    dispatch(element, 'change')
    return { ok: true, message: `Typed into ref ${input.ref}.` }
  }
  if (element.isContentEditable) {
    element.textContent = text
    dispatch(element, 'input')
    return { ok: true, message: `Typed into ref ${input.ref}.` }
  }
  return { ok: false, error: `Action target is not text-editable: ref '${input.ref}'.` }
}

async function waitForPageIdle(contents: WebContents, ms: number): Promise<boolean> {
  const timeoutMs = Math.max(1, Math.floor(ms)) + Math.min(500, Math.max(50, Math.floor(ms / 10)))
  return await withTimeout(
    contents.executeJavaScript(waitForDomIdleScript(ms), true) as Promise<boolean>,
    timeoutMs,
  )
}

function waitForDomIdleScript(ms: number): string {
  const timeout = Math.max(1, Math.floor(ms))
  const quiet = Math.max(100, Math.min(500, timeout))
  return `
    new Promise((resolve) => {
      const maxWait = ${timeout};
      const quiet = ${quiet};
      const started = Date.now();
      let timer = null;
      let settled = false;
      const finish = (idle) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
        resolve(Boolean(idle));
      };
      const bump = () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => finish(document.readyState === 'complete' || Date.now() - started >= maxWait), quiet);
      };
      const observer = new MutationObserver(bump);
      observer.observe(document.documentElement || document, {
        subtree: true, childList: true, attributes: true, characterData: true
      });
      bump();
      setTimeout(() => finish(false), maxWait);
    })
  `
}

function scrollScript(direction: string, amount: number): string {
  const signed = direction === 'up' || direction === 'left' ? -amount : amount
  const x = direction === 'left' || direction === 'right' ? signed : 0
  const y = direction === 'up' || direction === 'down' ? signed : 0
  return `window.scrollBy({ left: ${x}, top: ${y}, behavior: 'auto' }); true`
}

function installLiveBrowserRequestBlocker(
  contents: WebContents,
  allowedDomains?: string[],
  onWebsiteAccessBlocked?: (blocked: BlockedWebsiteAccessRequest) => void,
): () => void {
  const filter = { urls: ['http://*/*', 'https://*/*'] }
  contents.session.webRequest.onBeforeRequest(filter, (details, callback) => {
    try {
      const parsed = parseAllowedHttpUrl(details.url)
      if (allowedDomains?.length && !isBrowserSessionAllowed(parsed.href, allowedDomains).allowed) {
        onWebsiteAccessBlocked?.({
          url: parsed.href,
          host: parsed.hostname,
          resourceType: typeof details.resourceType === 'string' ? details.resourceType : undefined,
        })
        callback({ cancel: true })
        return
      }
      callback({ cancel: false })
    } catch {
      callback({ cancel: true })
    }
  })
  return () => {
    contents.session.webRequest.onBeforeRequest(filter, null)
  }
}

interface BlockedWebsiteAccessRequest {
  url: string
  host: string
  resourceType?: string
}

function websiteAccessBlockedMessage(blocked: BlockedWebsiteAccessRequest): string {
  return `Website access is not approved for ${blocked.host}. Approve this website from chat or add it in Settings > Connections.`
}

function navigationTimeoutMs(totalTimeoutMs: number): number {
  return Math.max(1, totalTimeoutMs - Math.min(5_000, Math.floor(totalTimeoutMs / 2)))
}

function remainingTimeoutMs(startedAt: number, totalTimeoutMs: number): number {
  return Math.max(1, totalTimeoutMs - (Date.now() - startedAt))
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Live browser timed out after ${Math.round(ms / 1000)}s`)), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.max(1, Math.floor(value)), max)
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function isBlockedByClientError(err: unknown): boolean {
  const message = (err as Error).message || String(err)
  return /ERR_BLOCKED_BY_CLIENT/i.test(message)
}

function isTimeoutError(err: unknown): boolean {
  const message = (err as Error).message || String(err)
  return /timed?\s*out|timeout/i.test(message)
}
