import { chunkMarkdownByStructure, htmlToMarkdown, type HtmlToMarkdownStats } from '@main/html/markdown.js'
import { parseAllowedHttpUrl, type UrlPolicyOptions } from '@main/web/urlPolicy.js'

export interface ReadRenderedUrlParams {
  url: string
  max_chars?: number
  start_from_char?: number
  extract_links?: boolean
  extract_images?: boolean
  timeout_ms?: number
}

export interface RenderedPageSnapshot {
  requestedUrl: string
  finalUrl: string
  title: string
  html: string
  capture?: RenderedCaptureInfo
}

export interface RenderedPageRenderRequest {
  url: string
  timeoutMs: number
}

export type RenderedCaptureStatus = 'complete' | 'partial'
export type RenderedCaptureConfidence = 'high' | 'medium' | 'low'

export interface RenderedCaptureSignals {
  elapsed_ms?: number
  timed_out?: boolean
  dom_stable?: boolean
  network_idle?: boolean
  visible_text_chars?: number
  link_count?: number
  button_count?: number
  form_control_count?: number
  table_row_count?: number
  heading_count?: number
  image_count?: number
}

export interface RenderedCaptureInfo {
  status: RenderedCaptureStatus
  confidence: RenderedCaptureConfidence
  reason?: string
  signals?: RenderedCaptureSignals
}

export interface RenderedReadStats {
  rendered_html_chars: number
  markdown: HtmlToMarkdownStats
  capture: RenderedCaptureInfo
  render_attempts?: number
  started_from_char?: number
  truncated_at_char?: number
  next_start_char?: number
  chunk_index?: number
  total_chunks?: number
}

export interface ReadRenderedUrlResult {
  url: string
  final_url: string
  title: string
  content: string
  truncated: boolean
  length: number
  next_start_char?: number
  capture: RenderedCaptureInfo
  stats: RenderedReadStats
}

export interface ReadRenderedUrlDeps extends UrlPolicyOptions {
  render?: RenderedPageRenderer
}

export type RenderedPageRenderer = (request: RenderedPageRenderRequest) => Promise<RenderedPageSnapshot>

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_CHARS = 100_000
const HARD_MAX_CHARS = 300_000

export async function readRenderedUrl(
  params: ReadRenderedUrlParams,
  deps: ReadRenderedUrlDeps = {},
): Promise<ReadRenderedUrlResult> {
  parseAllowedHttpUrl(params.url, deps)
  const render = deps.render
  if (!render) throw new Error('web.readRendered is only available in the Electron desktop runtime')

  const timeoutMs = positiveInteger(params.timeout_ms, DEFAULT_TIMEOUT_MS, 120_000)
  const maxChars = positiveInteger(params.max_chars, DEFAULT_MAX_CHARS, HARD_MAX_CHARS)
  const startFromChar = nonNegativeInteger(params.start_from_char)

  const rendered = await renderWithRecovery(render, params.url, timeoutMs)
  const snapshot = rendered.snapshot

  const converted = await htmlToMarkdown(snapshot.html, {
    extractLinks: params.extract_links === true,
    extractImages: params.extract_images === true,
  })
  const fullMarkdown = converted.markdown
  const capture = normalizeCapture(snapshot.capture, fullMarkdown)
  const chunks = chunkMarkdownByStructure(fullMarkdown, {
    maxChunkChars: maxChars,
    startFromChar,
  })
  if (!chunks.length) {
    throw new Error(`start_from_char (${startFromChar}) exceeds content length ${fullMarkdown.length} characters.`)
  }

  const chunk = chunks[0]
  const content = chunk.overlapPrefix ? `${chunk.overlapPrefix}\n${chunk.content}` : chunk.content
  const nextStartChar = chunk.hasMore ? chunk.charOffsetEnd : undefined
  const stats: RenderedReadStats = {
    rendered_html_chars: snapshot.html.length,
    markdown: converted.stats,
    capture,
    ...(rendered.attempts > 1 ? { render_attempts: rendered.attempts } : {}),
    ...(startFromChar > 0 ? { started_from_char: startFromChar } : {}),
    ...(chunk.hasMore
      ? {
          truncated_at_char: chunk.charOffsetEnd,
          next_start_char: chunk.charOffsetEnd,
          chunk_index: chunk.chunkIndex,
          total_chunks: chunk.totalChunks,
        }
      : {}),
  }

  return {
    url: params.url,
    final_url: snapshot.finalUrl || params.url,
    title: snapshot.title,
    content,
    truncated: chunk.hasMore,
    length: fullMarkdown.length,
    ...(nextStartChar != null ? { next_start_char: nextStartChar } : {}),
    capture,
    stats,
  }
}

async function renderWithRecovery(
  render: RenderedPageRenderer,
  url: string,
  timeoutMs: number,
): Promise<{ snapshot: RenderedPageSnapshot, attempts: number }> {
  const maxAttempts = 2
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return {
        snapshot: await render({ url, timeoutMs }),
        attempts: attempt,
      }
    } catch (err) {
      const message = (err as Error).message || String(err)
      if (attempt < maxAttempts && isTransientRenderFailure(message)) continue
      if (isTimeoutRenderFailure(message)) {
        return {
          snapshot: timeoutSnapshot(url, message, timeoutMs),
          attempts: attempt,
        }
      }
      throw new Error(`Rendered read failed for ${url}: ${message}`)
    }
  }
  throw new Error(`Rendered read failed for ${url}: renderer did not return a snapshot`)
}

function isTransientRenderFailure(message: string): boolean {
  return /execution context.*destroy|context.*destroy|navigation|frame.*detached|detached frame|net::err_aborted/i.test(message)
}

function isTimeoutRenderFailure(message: string): boolean {
  return /timed?\s*out|timeout/i.test(message)
}

function timeoutSnapshot(url: string, reason: string, timeoutMs: number): RenderedPageSnapshot {
  return {
    requestedUrl: url,
    finalUrl: url,
    title: '',
    html: '<body></body>',
    capture: {
      status: 'partial',
      confidence: 'low',
      reason,
      signals: {
        elapsed_ms: timeoutMs,
        timed_out: true,
        dom_stable: false,
        network_idle: false,
        visible_text_chars: 0,
        link_count: 0,
        button_count: 0,
        form_control_count: 0,
        table_row_count: 0,
        heading_count: 0,
        image_count: 0,
      },
    },
  }
}

function normalizeCapture(value: RenderedCaptureInfo | undefined, markdown: string): RenderedCaptureInfo {
  const fallbackSignals = inferredSignals(markdown)
  if (!value) {
    return {
      status: 'complete',
      confidence: fallbackSignals.visible_text_chars && fallbackSignals.visible_text_chars < 20 ? 'low' : 'high',
      signals: fallbackSignals,
    }
  }
  return {
    status: value.status === 'partial' ? 'partial' : 'complete',
    confidence: normalizeConfidence(value.confidence),
    ...(value.reason ? { reason: value.reason } : {}),
    signals: {
      ...fallbackSignals,
      ...normalizeSignals(value.signals),
    },
  }
}

function normalizeConfidence(value: unknown): RenderedCaptureConfidence {
  if (value === 'low' || value === 'medium' || value === 'high') return value
  return 'medium'
}

function normalizeSignals(value: unknown): RenderedCaptureSignals {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  return {
    ...normalizedNumberSignal(record.elapsed_ms, 'elapsed_ms'),
    ...normalizedBooleanSignal(record.timed_out, 'timed_out'),
    ...normalizedBooleanSignal(record.dom_stable, 'dom_stable'),
    ...normalizedBooleanSignal(record.network_idle, 'network_idle'),
    ...normalizedNumberSignal(record.visible_text_chars, 'visible_text_chars'),
    ...normalizedNumberSignal(record.link_count, 'link_count'),
    ...normalizedNumberSignal(record.button_count, 'button_count'),
    ...normalizedNumberSignal(record.form_control_count, 'form_control_count'),
    ...normalizedNumberSignal(record.table_row_count, 'table_row_count'),
    ...normalizedNumberSignal(record.heading_count, 'heading_count'),
    ...normalizedNumberSignal(record.image_count, 'image_count'),
  }
}

function inferredSignals(markdown: string): RenderedCaptureSignals {
  const text = markdown
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]+\)/g, ' ')
    .replace(/[`*_#[\]|>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    visible_text_chars: text.length,
    heading_count: (markdown.match(/^#{1,6}\s+\S/gm) ?? []).length,
    table_row_count: (markdown.match(/^\s*\|.*\|\s*$/gm) ?? []).length,
    link_count: (markdown.match(/\[[^\]]+]\([^)]+\)/g) ?? []).length,
    image_count: (markdown.match(/!\[[^\]]*]\([^)]+\)/g) ?? []).length,
  }
}

function normalizedNumberSignal<K extends keyof RenderedCaptureSignals>(
  value: unknown,
  key: K,
): Partial<RenderedCaptureSignals> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return {}
  return { [key]: Math.max(0, Math.floor(value)) } as Partial<RenderedCaptureSignals>
}

function normalizedBooleanSignal<K extends keyof RenderedCaptureSignals>(
  value: unknown,
  key: K,
): Partial<RenderedCaptureSignals> {
  if (typeof value !== 'boolean') return {}
  return { [key]: value } as Partial<RenderedCaptureSignals>
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}
