import { readUrl, fetchWithSafeRedirects, isPdfResponse, type FetchLike } from './readUrl.js'
import {
  readRenderedUrl,
  type ReadRenderedUrlParams,
  type ReadRenderedUrlResult,
  type RenderedPageRenderer,
} from './readRenderedUrl.js'
import { readBrowserSessionUrl, type BrowserSessionPageRenderer } from './readBrowserSessionUrl.js'
import { BlockedUrlError, parseAllowedHttpUrl, USER_AGENT, type UrlPolicyOptions } from './urlPolicy.js'

export interface ReadWebUrlParams extends ReadRenderedUrlParams {
  stateful?: boolean
}

export interface ReadWebUrlDeps extends UrlPolicyOptions {
  workspacePath?: string | null
  fetch?: FetchLike
  renderRendered?: RenderedPageRenderer
  renderBrowserSession?: BrowserSessionPageRenderer
  now?: () => number
}

export type WebPageRenderer = RenderedPageRenderer

export interface ReadWebUrlResult {
  url: string
  final_url: string
  title: string
  content: string
  content_length: number
  source: 'pdf' | 'rendered' | 'rendered-stateful'
  elapsed_ms: number
  truncated?: boolean
  next_start_char?: number
}

const HEAD_TIMEOUT_MS = 8_000

export async function readWebUrl(
  params: ReadWebUrlParams,
  deps: ReadWebUrlDeps = {},
): Promise<ReadWebUrlResult> {
  const start = deps.now?.() ?? Date.now()
  const parsed = parseAllowedHttpUrl(params.url, deps)

  if (await shouldUsePdfReader(parsed, params, deps)) {
    const result = await readUrl({
      url: params.url,
      max_chars: params.max_chars,
      timeout_ms: params.timeout_ms,
    }, { fetch: deps.fetch })
    return cleanResult({
      url: params.url,
      final_url: result.url,
      title: result.title,
      content: result.content,
      content_length: result.length,
      source: 'pdf',
      elapsed_ms: elapsedMs(start, deps),
      truncated: result.truncated,
    })
  }

  const rendered = params.stateful === true
    ? await readBrowserSessionUrl(params, {
        ...deps,
        workspacePath: deps.workspacePath,
        render: deps.renderBrowserSession,
      })
    : await readRenderedUrl(params, {
        ...deps,
        render: deps.renderRendered,
      })

  return renderedResult(params.url, rendered, params.stateful === true ? 'rendered-stateful' : 'rendered', start, deps)
}

async function shouldUsePdfReader(
  parsed: URL,
  params: ReadWebUrlParams,
  deps: ReadWebUrlDeps,
): Promise<boolean> {
  if (parsed.pathname.toLowerCase().endsWith('.pdf')) return true
  const fetchFn = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(params.timeout_ms ?? HEAD_TIMEOUT_MS, HEAD_TIMEOUT_MS))
  try {
    const { response, finalUrl } = await fetchWithSafeRedirects(fetchFn, parsed.href, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!response.ok) return false
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    return isPdfResponse(contentType, finalUrl)
  } catch (err) {
    if (err instanceof BlockedUrlError) throw err
    return false
  } finally {
    clearTimeout(timer)
  }
}

function renderedResult(
  requestedUrl: string,
  result: ReadRenderedUrlResult,
  source: ReadWebUrlResult['source'],
  start: number,
  deps: ReadWebUrlDeps,
): ReadWebUrlResult {
  return cleanResult({
    url: requestedUrl,
    final_url: result.final_url,
    title: result.title,
    content: result.content,
    content_length: result.length,
    source,
    elapsed_ms: elapsedMs(start, deps),
    truncated: result.truncated,
    next_start_char: result.next_start_char,
  })
}

function cleanResult(result: ReadWebUrlResult): ReadWebUrlResult {
  return {
    url: result.url,
    final_url: result.final_url,
    title: result.title,
    content: result.content,
    content_length: result.content_length,
    source: result.source,
    elapsed_ms: result.elapsed_ms,
    ...(result.truncated ? { truncated: true } : {}),
    ...(result.next_start_char != null ? { next_start_char: result.next_start_char } : {}),
  }
}

function elapsedMs(start: number, deps: ReadWebUrlDeps): number {
  return Math.max(0, Math.round((deps.now?.() ?? Date.now()) - start))
}
