import { describe, expect, it, vi } from 'vitest'
import { webSearch } from './webSearch.js'

const EXA_RESPONSE = {
  results: [
    {
      title: 'Example Article',
      url: 'https://example.com/article',
      highlights: ['This is the key excerpt from the article.'],
      publishedDate: '2025-01-15',
    },
    {
      title: 'Other Page',
      url: 'https://other.com/page',
      highlights: ['Another relevant snippet.', 'Second highlight.'],
    },
    {
      title: 'Third Result',
      url: 'https://third.com',
      highlights: [],
    },
  ],
}

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

describe('webSearch', () => {
  it('returns parsed Exa results with highlights as snippets', async () => {
    const fetch = mockFetchOk(EXA_RESPONSE)
    const result = await webSearch({ query: 'test query' }, { fetch, apiKey: 'test-key' })

    expect(result.query).toBe('test query')
    expect(result.results).toHaveLength(3)
    expect(result.results[0]).toEqual({
      title: 'Example Article',
      url: 'https://example.com/article',
      snippet: 'This is the key excerpt from the article.',
    })
    expect(result.results[1].snippet).toBe('Another relevant snippet. Second highlight.')
    expect(result.results[2].snippet).toBe('')
  })

  it('sends correct request to Exa API', async () => {
    const fetch = mockFetchOk(EXA_RESPONSE)
    await webSearch({ query: 'test', max_results: 5 }, { fetch, apiKey: 'my-key' })

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.exa.ai/search')
    expect(init.method).toBe('POST')
    expect(init.headers['x-api-key']).toBe('my-key')
    const body = JSON.parse(init.body)
    expect(body.query).toBe('test')
    expect(body.numResults).toBe(5)
    expect(body.type).toBe('auto')
    expect(body.contents.highlights).toBe(true)
  })

  it('respects max_results', async () => {
    const fetch = mockFetchOk(EXA_RESPONSE)
    const result = await webSearch({ query: 'test', max_results: 1 }, { fetch, apiKey: 'k' })
    expect(fetch.mock.calls[0][1].body).toContain('"numResults":1')
  })

  it('throws clear error when no API key', async () => {
    const fetch = vi.fn()
    await expect(webSearch({ query: 'test' }, { fetch, apiKey: '' }))
      .rejects.toThrow(/Exa API key/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws clear error on invalid key (401)', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })
    await expect(webSearch({ query: 'test' }, { fetch, apiKey: 'bad' }))
      .rejects.toThrow(/invalid/)
  })

  it('throws clear error on rate limit (429)', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    })
    await expect(webSearch({ query: 'test' }, { fetch, apiKey: 'k' }))
      .rejects.toThrow(/rate limit/i)
  })

  it('rejects empty queries', async () => {
    await expect(webSearch({ query: '' }, { apiKey: 'k' })).rejects.toThrow()
    await expect(webSearch({ query: '   ' }, { apiKey: 'k' })).rejects.toThrow()
  })

  it('produces a clear timeout error', async () => {
    const fetch = vi.fn().mockImplementation(() => {
      const err = new DOMException('The operation was aborted', 'AbortError')
      return Promise.reject(err)
    })
    await expect(webSearch({ query: 'test', timeout_ms: 100 }, { fetch, apiKey: 'k' }))
      .rejects.toThrow(/Timeout.*100ms/)
  })

  it('handles Exa error field in response', async () => {
    const fetch = mockFetchOk({ error: 'Invalid query format' })
    await expect(webSearch({ query: 'test' }, { fetch, apiKey: 'k' }))
      .rejects.toThrow(/Invalid query format/)
  })
})
