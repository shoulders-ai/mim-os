import { extractPdfTextFromBuffer } from '@main/documents/pdfExtract.js'
import { htmlToMarkdown } from '@main/html/markdown.js'
import { parseAllowedHttpUrl, USER_AGENT } from '@main/web/urlPolicy.js'

export interface ReadUrlParams {
  url: string
  max_chars?: number
  timeout_ms?: number
}

export interface ReadUrlResult {
  url: string
  format?: 'html' | 'pdf'
  title: string
  content: string
  excerpt: string
  byline: string
  siteName: string
  truncated: boolean
  length: number
  pages?: number
  metadata?: Record<string, unknown>
}

export interface FetchInitLike {
  signal?: AbortSignal
  headers?: Record<string, string>
  method?: string
  redirect?: 'follow' | 'manual' | 'error'
}

export interface FetchResponseLike {
  ok: boolean
  status: number
  statusText?: string
  headers: { get(name: string): string | null }
  text(): Promise<string>
  arrayBuffer?: () => Promise<ArrayBuffer>
}

export interface FetchLike {
  (input: string, init?: FetchInitLike): Promise<FetchResponseLike>
}

let _dominoPatched = false

async function parseDom(html: string, url: string): Promise<Document> {
  const mod = await import('@mixmark-io/domino') as unknown as {
    createDocument?: (html: string) => Document
    default?: { createDocument?: (html: string) => Document }
  }
  const createDocument = mod.createDocument ?? mod.default?.createDocument
  if (!createDocument) throw new Error('domino not available')

  // Patch domino's NodeList to be iterable (Readability uses for...of)
  if (!_dominoPatched) {
    const tmpDoc = createDocument('<html><body><p></p></body></html>')
    const protos = new Set<Record<string | symbol, unknown>>()
    for (const method of ['querySelectorAll', 'getElementsByTagName', 'getElementsByClassName'] as const) {
      for (const target of [tmpDoc, tmpDoc.body] as Array<{ [k: string]: (...args: string[]) => unknown }>) {
        try {
          const result = target[method]('*') as Record<string | symbol, unknown>
          protos.add(Object.getPrototypeOf(result))
        } catch { /* method may not exist */ }
      }
    }
    for (const proto of protos) {
      if (!proto[Symbol.iterator]) {
        proto[Symbol.iterator] = function* (this: { length: number; item?: (i: number) => unknown; [i: number]: unknown }) {
          for (let i = 0; i < this.length; i++) yield this[i] ?? this.item?.(i)
        }
      }
    }
    _dominoPatched = true
  }

  const doc = createDocument(html)
  // Polyfill baseURI/documentURI — domino throws NotYetImplemented
  Object.defineProperty(doc, 'baseURI', { get: () => url, configurable: true })
  Object.defineProperty(doc, 'documentURI', { get: () => url, configurable: true })
  return doc
}

async function loadReadability(): Promise<typeof import('@mozilla/readability').Readability> {
  const mod = await import('@mozilla/readability')
  return mod.Readability
}

export async function extractReadableContent(
  html: string,
  url: string,
  maxChars?: number,
): Promise<ReadUrlResult> {
  const doc = await parseDom(html, url)
  const Readability = await loadReadability()

  let title = ''
  let articleHtml = ''
  let excerpt = ''
  let byline = ''
  let siteName = ''

  try {
    const parsed = new Readability(doc, { charThreshold: 50 }).parse()
    if (parsed && parsed.content) {
      title = parsed.title ?? ''
      articleHtml = parsed.content
      excerpt = parsed.excerpt ?? ''
      byline = parsed.byline ?? ''
      siteName = parsed.siteName ?? ''
    } else {
      articleHtml = html
    }
  } catch {
    // Readability can crash on malformed DOM — fall back to raw HTML conversion
    articleHtml = html
    title = doc.title ?? ''
  }

  let content = (await htmlToMarkdown(articleHtml, { extractLinks: true, extractImages: true })).markdown

  const truncated = maxChars != null && content.length > maxChars
  if (truncated) content = content.slice(0, maxChars)

  return { url, format: 'html', title, content, excerpt, byline, siteName, truncated, length: content.length }
}

export async function extractReadablePdfContent(
  pdf: Buffer | Uint8Array | ArrayBuffer,
  url: string,
  maxChars?: number,
): Promise<ReadUrlResult> {
  const extracted = await extractPdfTextFromBuffer(pdf, { maxChars })
  const title = metadataString(extracted.info, ['Title', 'title']) || pdfTitleFromUrl(url)
  const byline = metadataString(extracted.info, ['Author', 'author']) || ''
  const content = extracted.text.trim()
  const excerpt = content.replace(/\s+/g, ' ').slice(0, 300)
  const siteName = new URL(url).hostname
  return {
    url,
    format: 'pdf',
    title,
    content,
    excerpt,
    byline,
    siteName,
    truncated: extracted.truncated,
    length: content.length,
    pages: extracted.pages,
    metadata: extracted.info,
  }
}

export async function readUrl(
  params: ReadUrlParams,
  deps: { fetch?: FetchLike } = {},
): Promise<ReadUrlResult> {
  const { url, max_chars, timeout_ms = 15_000 } = params
  const fetchFn = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)

  parseAllowedHttpUrl(url)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)

  try {
    const { response, finalUrl } = await fetchWithSafeRedirects(fetchFn, url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}: ${url}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    const normalizedType = contentType.toLowerCase()
    if (isPdfResponse(normalizedType, finalUrl)) {
      if (!response.arrayBuffer) throw new Error('PDF response cannot be read because this fetch implementation does not expose arrayBuffer().')
      const buffer = await response.arrayBuffer()
      return extractReadablePdfContent(buffer, finalUrl, max_chars)
    }

    if (!normalizedType.includes('html') && !normalizedType.includes('text/plain')) {
      throw new Error(`Expected HTML or PDF response, got ${contentType}`)
    }

    const html = await response.text()
    return extractReadableContent(html, finalUrl, max_chars)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timeout after ${timeout_ms}ms fetching ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchWithSafeRedirects(
  fetchFn: FetchLike,
  rawUrl: string,
  init: FetchInitLike = {},
  options: { maxRedirects?: number } = {},
): Promise<{ response: FetchResponseLike; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? 5
  let current = parseAllowedHttpUrl(rawUrl).href
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const response = await fetchFn(current, {
      ...init,
      redirect: 'manual',
    })
    if (!isRedirectResponse(response.status)) {
      return { response, finalUrl: current }
    }
    const location = response.headers.get('location')
    if (!location) return { response, finalUrl: current }
    const next = new URL(location, current).href
    current = parseAllowedHttpUrl(next).href
  }
  throw new Error(`Too many redirects fetching ${rawUrl}`)
}

export function isPdfResponse(contentType: string, rawUrl: string): boolean {
  if (contentType.includes('application/pdf') || contentType.includes('application/x-pdf')) return true
  try {
    return new URL(rawUrl).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

function isRedirectResponse(status: number): boolean {
  return status >= 300 && status < 400
}

function metadataString(info: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = info[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function pdfTitleFromUrl(rawUrl: string): string {
  try {
    const path = new URL(rawUrl).pathname
    const last = path.split('/').filter(Boolean).at(-1) ?? 'PDF document'
    return decodeURIComponent(last).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'PDF document'
  } catch {
    return 'PDF document'
  }
}
