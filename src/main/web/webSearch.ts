import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface WebSearchParams {
  query: string
  max_results?: number
  timeout_ms?: number
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchResult {
  query: string
  results: SearchResult[]
}

interface FetchLike {
  (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string>; method?: string; body?: string }): Promise<{
    ok: boolean
    status: number
    statusText?: string
    text(): Promise<string>
    json(): Promise<unknown>
  }>
}

function userHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || ''
}

export function resolveExaKey(): { key: string | null; source: string } {
  const envVar = 'EXA_API_KEY'

  // Same precedence as resolveKey in ai.ts: the app-managed ~/.mim/keys.env
  // wins over the launch environment so in-app key changes always take effect.
  const dotenvPath = join(userHomeDir(), '.mim', 'keys.env')
  if (existsSync(dotenvPath)) {
    const content = readFileSync(dotenvPath, 'utf-8')
    for (const line of content.split(/\r\n|\n|\r/)) {
      const [k, ...rest] = line.split('=')
      if (k?.trim() === envVar && rest.length) {
        const value = rest.join('=').trim().replace(/^["']|["']$/g, '')
        if (value) return { key: value, source: 'file' }
      }
    }
  }

  if (process.env[envVar]) return { key: process.env[envVar]!, source: 'env' }

  return { key: null, source: 'missing' }
}

interface ExaResponse {
  results?: Array<{
    title?: string
    url?: string
    highlights?: string[]
    publishedDate?: string
  }>
  error?: string
}

export async function webSearch(
  params: WebSearchParams,
  deps: { fetch?: FetchLike; apiKey?: string } = {},
): Promise<WebSearchResult> {
  const { query, max_results = 10, timeout_ms = 15_000 } = params
  const fetchFn = deps.fetch ?? (globalThis.fetch as unknown as FetchLike)

  const trimmed = query.trim()
  if (!trimmed) throw new Error('Search query cannot be empty')

  const apiKey = 'apiKey' in deps ? deps.apiKey : resolveExaKey().key
  if (!apiKey) {
    throw new Error(
      'Web search requires an Exa API key. ' +
      'Add one in Settings → Connections, or set EXA_API_KEY in your environment. ' +
      'Get a free key at https://dashboard.exa.ai/api-keys',
    )
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout_ms)

  try {
    const response = await fetchFn('https://api.exa.ai/search', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: trimmed,
        type: 'auto',
        numResults: Math.min(max_results, 20),
        contents: { highlights: true },
      }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      if (response.status === 401) {
        throw new Error('Exa API key is invalid. Check your key in Settings → Connections.')
      }
      if (response.status === 429) {
        throw new Error('Exa rate limit exceeded. Try again in a moment.')
      }
      throw new Error(`Exa search failed: HTTP ${response.status} ${body}`.trim())
    }

    const data = await response.json() as ExaResponse

    if (data.error) throw new Error(`Exa search error: ${data.error}`)

    const results: SearchResult[] = (data.results ?? []).map(r => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.highlights?.join(' ') ?? '',
    })).filter(r => r.title && r.url)

    return { query: trimmed, results }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timeout after ${timeout_ms}ms searching for "${trimmed}"`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
