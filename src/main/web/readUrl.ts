export interface ReadUrlParams {
  url: string
  max_chars?: number
  timeout_ms?: number
}

export interface ReadUrlResult {
  url: string
  title: string
  content: string
  excerpt: string
  byline: string
  siteName: string
  truncated: boolean
  length: number
}

interface FetchLike {
  (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }): Promise<{
    ok: boolean
    status: number
    statusText?: string
    headers: { get(name: string): string | null }
    text(): Promise<string>
  }>
}

const BLOCKED_HOSTS = new Set(['localhost', '0.0.0.0', '[::1]'])

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function isPrivateIpv4(a: number, b: number, c: number, d: number): boolean {
  if (a === 127) return true
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 169 && b === 254 && c === 169 && d === 254) return true
  if (a === 0 && b === 0 && c === 0 && d === 0) return true
  return false
}

function parseIpv4MappedHex(host: string): [number, number, number, number] | null {
  const match = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (!match) return null
  const hi = parseInt(match[1], 16)
  const lo = parseInt(match[2], 16)
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]
}

function isBlockedUrl(url: URL): boolean {
  if (BLOCKED_HOSTS.has(url.hostname)) return true
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '')
  if (host === '::1') return true
  const mapped = parseIpv4MappedHex(host)
  if (mapped && isPrivateIpv4(...mapped)) return true
  const parts = host.split('.')
  if (parts.length === 4) {
    const nums = parts.map(p => parseInt(p, 10))
    if (nums.every(n => !isNaN(n)) && isPrivateIpv4(nums[0], nums[1], nums[2], nums[3])) return true
  }
  return false
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

async function htmlToMarkdown(html: string): Promise<string> {
  const mod = await import('turndown') as unknown as {
    default?: new (opts?: Record<string, unknown>) => {
      turndown(html: string): string
      use(plugin: unknown): void
    }
  }
  const Ctor = mod.default
  if (!Ctor) throw new Error('turndown not available')
  const instance = new Ctor({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  try {
    const gfm = await import('turndown-plugin-gfm') as unknown as {
      default?: { gfm?: unknown } | ((...args: unknown[]) => void)
      gfm?: unknown
    }
    const gfmDefault = gfm.default
    const plugin = (typeof gfmDefault === 'function' ? gfmDefault : gfmDefault?.gfm) ?? gfm.gfm
    if (plugin) instance.use(plugin)
  } catch { /* gfm plugin optional */ }
  return instance.turndown(html)
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

  let content = await htmlToMarkdown(articleHtml)

  const truncated = maxChars != null && content.length > maxChars
  if (truncated) content = content.slice(0, maxChars)

  return { url, title, content, excerpt, byline, siteName, truncated, length: content.length }
}

export async function readUrl(
  params: ReadUrlParams,
  deps: { fetch?: FetchLike } = {},
): Promise<ReadUrlResult> {
  const { url, max_chars, timeout_ms = 15_000 } = params
  const fetchFn = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid URL: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http/https URLs are supported, got ${parsed.protocol}`)
  }
  if (isBlockedUrl(parsed)) {
    throw new Error(`Blocked URL: ${url} (private/loopback addresses are not allowed)`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)

  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}: ${url}`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('html') && !contentType.includes('text/plain')) {
      throw new Error(`Expected HTML response, got ${contentType}`)
    }

    const html = await response.text()
    return extractReadableContent(html, url, max_chars)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timeout after ${timeout_ms}ms fetching ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
