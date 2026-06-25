import { parseAllowedHttpUrl, type UrlPolicyOptions } from '@main/web/urlPolicy.js'
import { chunkMarkdownByStructure } from '@main/html/markdown.js'
import {
  classifyRenderedRead,
  readResearchUrl,
  type ReadResearchUrlResult,
  type ResearchPageRenderer,
  type ResearchReadStatus,
} from './readResearchUrl.js'
import {
  readRenderedUrl,
  type ReadRenderedUrlParams,
  type ReadRenderedUrlResult,
  type RenderedPageRenderer,
  type RenderedReadStats,
} from './readRenderedUrl.js'
import {
  isResearchBrowserAllowed,
  readResearchBrowserSettings,
  recordResearchBrowserSourceRead,
} from './researchSettings.js'
import {
  getWebReadCacheEntry,
  putWebReadCacheEntry,
  type WebReadCacheEntry,
} from './webReadCache.js'

export type AutoPageRenderer = RenderedPageRenderer

export type AutoReadStatus =
  | ResearchReadStatus
  | 'source_not_configured'
  | 'research_profile_unavailable'
  | 'render_failed'
  | 'research_failed'

export type AutoReadSource = 'rendered' | 'research-profile' | 'cache'

export interface AutoReadAttempt {
  source: AutoReadSource
  status: AutoReadStatus
  attention_required: boolean
  reason?: string
  final_url?: string
  error?: string
}

export interface ReadAutoUrlParams extends ReadRenderedUrlParams {
  prefer_research?: boolean
}

export interface ReadAutoUrlDeps extends UrlPolicyOptions {
  workspacePath?: string | null
  renderRendered?: RenderedPageRenderer
  renderResearch?: ResearchPageRenderer
  now?: () => Date
}

export interface ReadAutoUrlResult extends ReadRenderedUrlResult {
  source: AutoReadSource
  status: AutoReadStatus
  attention_required: boolean
  reason?: string
  source_domain?: string
  setup_url?: string
  allowed_domain?: string
  blocked_status?: ResearchReadStatus
  attempts: AutoReadAttempt[]
  cache?: AutoReadCacheInfo
}

export interface AutoReadCacheInfo {
  hit: boolean
  cached_at: string
  reason?: string
}

interface ResearchGrant {
  host: string
  allowed: boolean
  matchedDomain?: string
}

const DEFAULT_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000
const DEFAULT_MAX_CHARS = 100_000
const HARD_MAX_CHARS = 300_000

export async function readAutoUrl(
  params: ReadAutoUrlParams,
  deps: ReadAutoUrlDeps = {},
): Promise<ReadAutoUrlResult> {
  const parsed = parseAllowedHttpUrl(params.url, deps)
  const settings = readResearchBrowserSettings(deps.workspacePath)
  const match = isResearchBrowserAllowed(parsed.href, settings.allowedDomains)
  const grant: ResearchGrant = {
    host: match.host,
    allowed: settings.enabled && match.allowed && Boolean(match.matchedDomain),
    ...(match.matchedDomain ? { matchedDomain: match.matchedDomain } : {}),
  }
  const attempts: AutoReadAttempt[] = []

  if (params.prefer_research === true && grant.allowed && deps.renderResearch) {
    const researchFirst = await tryResearch(params, deps, attempts)
    if (researchFirst) return finishAutoRead(params, deps, grant, researchFirst)
  }

  let renderedResult: ReadRenderedUrlResult | null = null
  let renderedStatus: ResearchReadStatus | 'render_failed' = 'render_failed'
  let renderedReason: string | undefined

  if (deps.renderRendered) {
    try {
      renderedResult = await readRenderedUrl(params, {
        ...deps,
        render: deps.renderRendered,
      })
      const classification = classifyRenderedRead({
        title: renderedResult.title,
        content: renderedResult.content,
      })
      renderedStatus = classification.status
      renderedReason = classification.reason
      attempts.push({
        source: 'rendered',
        status: classification.status,
        attention_required: classification.attention_required,
        ...(classification.reason ? { reason: classification.reason } : {}),
        final_url: renderedResult.final_url,
      })

      if (!classification.attention_required) {
        return finishAutoRead(params, deps, grant, {
          ...renderedResult,
          source: 'rendered',
          status: classification.status,
          attention_required: false,
          ...(classification.reason ? { reason: classification.reason } : {}),
          attempts,
        })
      }
    } catch (err) {
      renderedReason = (err as Error).message
      attempts.push({
        source: 'rendered',
        status: 'render_failed',
        attention_required: true,
        reason: renderedReason,
        error: renderedReason,
      })
    }
  }

  if (grant.allowed && deps.renderResearch) {
    const researchFallback = await tryResearch(params, deps, attempts, renderedResult)
    if (researchFallback) return finishAutoRead(params, deps, grant, researchFallback)
  }

  if (renderedResult) {
    if (grant.allowed && !deps.renderResearch) {
      return finishAutoRead(params, deps, grant, decorateAttentionResult(renderedResult, attempts, {
        source: 'rendered',
        status: 'research_profile_unavailable',
        blocked_status: renderedStatus === 'render_failed' ? undefined : renderedStatus,
        reason: 'The source is configured for the Research Browser, but the persistent profile is only available in the Electron desktop runtime.',
      }))
    }

    return finishAutoRead(params, deps, grant, decorateAttentionResult(renderedResult, attempts, {
      source: 'rendered',
      status: 'source_not_configured',
      blocked_status: renderedStatus === 'render_failed' ? undefined : renderedStatus,
      reason: `The stateless render reached ${renderedStatus}. Add ${grant.host} to Research Browser sources so the agent can use the persistent browser profile.`,
    }))
  }

  if (grant.allowed && !deps.renderResearch) {
    return finishAutoRead(params, deps, grant, emptyAttentionResult(params.url, attempts, {
      source: 'rendered',
      status: 'research_profile_unavailable',
      reason: 'The source is configured for the Research Browser, but the persistent profile is only available in the Electron desktop runtime.',
    }))
  }

  return finishAutoRead(params, deps, grant, emptyAttentionResult(params.url, attempts, {
    source: 'rendered',
    status: 'render_failed',
    reason: renderedReason
      ? `The page could not be rendered: ${renderedReason}`
      : 'web.readAuto is only available when a rendered or research browser backend is registered.',
  }))
}

async function tryResearch(
  params: ReadAutoUrlParams,
  deps: ReadAutoUrlDeps,
  attempts: AutoReadAttempt[],
  renderedResult?: ReadRenderedUrlResult | null,
): Promise<ReadAutoUrlResult | null> {
  try {
    const result = await readResearchUrl(params, {
      ...deps,
      render: deps.renderResearch,
      recordSourceState: false,
    })
    attempts.push({
      source: 'research-profile',
      status: result.status,
      attention_required: result.attention_required,
      ...(result.reason ? { reason: result.reason } : {}),
      final_url: result.final_url,
    })
    return {
      ...result,
      attempts,
    }
  } catch (err) {
    const reason = (err as Error).message
    attempts.push({
      source: 'research-profile',
      status: 'research_failed',
      attention_required: true,
      reason,
      error: reason,
    })
    if (!renderedResult) return null
    return decorateAttentionResult(renderedResult, attempts, {
      source: 'rendered',
      status: 'research_failed',
      reason: `The Research Browser fallback failed: ${reason}`,
    })
  }
}

function decorateAttentionResult(
  result: ReadRenderedUrlResult,
  attempts: AutoReadAttempt[],
  options: {
    source: AutoReadSource
    status: AutoReadStatus
    reason: string
    blocked_status?: ResearchReadStatus
  },
): ReadAutoUrlResult {
  return {
    ...result,
    source: options.source,
    status: options.status,
    attention_required: true,
    reason: options.reason,
    ...(options.blocked_status ? { blocked_status: options.blocked_status } : {}),
    attempts,
  }
}

function emptyAttentionResult(
  url: string,
  attempts: AutoReadAttempt[],
  options: {
    source: AutoReadSource
    status: AutoReadStatus
    reason: string
  },
): ReadAutoUrlResult {
  return {
    url,
    final_url: url,
    title: '',
    content: '',
    truncated: false,
    length: 0,
    stats: emptyStats(),
    source: options.source,
    status: options.status,
    attention_required: true,
    reason: options.reason,
    attempts,
  }
}

function finishAutoRead(
  params: ReadAutoUrlParams,
  deps: ReadAutoUrlDeps,
  grant: ResearchGrant,
  result: ReadAutoUrlResult,
): ReadAutoUrlResult {
  const now = deps.now?.() ?? new Date()
  const sourceDomain = result.allowed_domain ?? grant.matchedDomain ?? grant.host
  const enriched: ReadAutoUrlResult = {
    ...result,
    source_domain: sourceDomain,
    ...(result.status === 'source_not_configured' ? { setup_url: sourceSetupUrl(sourceDomain) } : {}),
  }
  const cached = deps.workspacePath && enriched.attention_required
    ? cachedFallbackResult(params, deps.workspacePath, now, enriched, sourceDomain)
    : null
  const finalResult = cached ?? enriched

  if (deps.workspacePath && (grant.allowed || enriched.attention_required)) {
    recordResearchBrowserSourceRead(deps.workspacePath, {
      domain: sourceDomain,
      url: params.url,
      status: enriched.status,
      attentionRequired: enriched.attention_required,
      source: enriched.source,
      ...(enriched.reason ? { reason: enriched.reason } : {}),
      at: now.toISOString(),
    })
  }
  if (deps.workspacePath && shouldStoreCacheResult(params, enriched)) {
    putWebReadCacheEntry(deps.workspacePath, {
      url: params.url,
      finalUrl: enriched.final_url,
      title: enriched.title,
      content: enriched.content,
      length: enriched.length,
      sourceDomain,
      createdAt: now.toISOString(),
    })
  }
  return finalResult
}

function sourceSetupUrl(domain: string): string {
  return `https://${domain.replace(/^\*\./, '')}`
}

function cachedFallbackResult(
  params: ReadAutoUrlParams,
  workspacePath: string,
  now: Date,
  liveResult: ReadAutoUrlResult,
  sourceDomain: string,
): ReadAutoUrlResult | null {
  if (!cacheEligibleParams(params)) return null
  const entry = getWebReadCacheEntry(workspacePath, params.url, {
    now,
    maxAgeMs: DEFAULT_CACHE_MAX_AGE_MS,
  })
  if (!entry) return null
  const liveStatus = liveResult.blocked_status ?? liveResult.status
  const reason = `Used cached content after live read returned ${liveStatus}.`
  return cachedAutoReadResult(params, liveResult, entry, sourceDomain, reason)
}

function cachedAutoReadResult(
  params: ReadAutoUrlParams,
  liveResult: ReadAutoUrlResult,
  entry: WebReadCacheEntry,
  sourceDomain: string,
  reason: string,
): ReadAutoUrlResult | null {
  const maxChars = positiveInteger(params.max_chars, DEFAULT_MAX_CHARS, HARD_MAX_CHARS)
  const startFromChar = nonNegativeInteger(params.start_from_char)
  const chunks = chunkMarkdownByStructure(entry.content, {
    maxChunkChars: maxChars,
    startFromChar,
  })
  if (!chunks.length) return null
  const chunk = chunks[0]
  const content = chunk.overlapPrefix ? `${chunk.overlapPrefix}\n${chunk.content}` : chunk.content
  const nextStartChar = chunk.hasMore ? chunk.charOffsetEnd : undefined
  const attempts: AutoReadAttempt[] = [
    ...liveResult.attempts,
    {
      source: 'cache',
      status: 'ok',
      attention_required: false,
      reason,
      final_url: entry.finalUrl,
    },
  ]

  return {
    url: params.url,
    final_url: entry.finalUrl,
    title: entry.title,
    content,
    truncated: chunk.hasMore,
    length: entry.length,
    ...(nextStartChar != null ? { next_start_char: nextStartChar } : {}),
    stats: cachedStats(entry.content.length, startFromChar, chunk),
    source: 'cache',
    status: 'ok',
    attention_required: false,
    source_domain: entry.sourceDomain ?? sourceDomain,
    ...(liveResult.allowed_domain ? { allowed_domain: liveResult.allowed_domain } : {}),
    ...(liveResult.blocked_status ? { blocked_status: liveResult.blocked_status } : {}),
    attempts,
    cache: {
      hit: true,
      cached_at: entry.createdAt,
      reason,
    },
  }
}

function shouldStoreCacheResult(params: ReadAutoUrlParams, result: ReadAutoUrlResult): boolean {
  return cacheEligibleParams(params)
    && !result.attention_required
    && result.status === 'ok'
    && result.source !== 'cache'
    && !result.truncated
    && nonNegativeInteger(params.start_from_char) === 0
    && result.content.length > 0
}

function cacheEligibleParams(params: ReadAutoUrlParams): boolean {
  return params.extract_links !== true && params.extract_images !== true
}

function cachedStats(
  markdownChars: number,
  startFromChar: number,
  chunk: ReturnType<typeof chunkMarkdownByStructure>[number],
): RenderedReadStats {
  return {
    rendered_html_chars: 0,
    markdown: {
      method: 'html_to_markdown',
      originalHtmlChars: 0,
      normalizedHtmlChars: 0,
      initialMarkdownChars: markdownChars,
      filteredCharsRemoved: 0,
      finalMarkdownChars: markdownChars,
    },
    capture: {
      status: 'complete',
      confidence: 'high',
      signals: {
        visible_text_chars: markdownChars,
        timed_out: false,
      },
    },
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
}

function positiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), max)
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function emptyStats(): RenderedReadStats {
  return {
    rendered_html_chars: 0,
    markdown: {
      method: 'html_to_markdown',
      originalHtmlChars: 0,
      normalizedHtmlChars: 0,
      initialMarkdownChars: 0,
      filteredCharsRemoved: 0,
      finalMarkdownChars: 0,
    },
    capture: {
      status: 'partial',
      confidence: 'low',
      reason: 'No browser snapshot was available.',
      signals: {
        visible_text_chars: 0,
        timed_out: false,
      },
    },
  }
}
