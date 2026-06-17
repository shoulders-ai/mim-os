import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchHttpClient, readJsonResponse, readTextResponse, type HttpResponse } from '@main/integrations/http.js'

function fakeResponse(overrides: Partial<HttpResponse> & { textBody?: string } = {}): HttpResponse {
  const { textBody = '', ...rest } = overrides
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(textBody),
    text: async () => textBody,
    ...rest,
  }
}

describe('fetchHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes url, method, headers, body and signal through to fetch', async () => {
    const fetchMock = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await fetchHttpClient.request({
      url: 'https://api.example.com/v1/things',
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: '{"a":1}',
      signal: controller.signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/things', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: '{"a":1}',
      signal: controller.signal,
    })
  })

  it('defaults method, headers, body and signal to undefined (a plain GET)', async () => {
    const fetchMock = vi.fn(async () => fakeResponse())
    vi.stubGlobal('fetch', fetchMock)

    await fetchHttpClient.request({ url: 'https://api.example.com/' })

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/', {
      method: undefined,
      headers: undefined,
      body: undefined,
      signal: undefined,
    })
  })

  it('returns the fetch response as-is, including non-2xx status', async () => {
    const res = fakeResponse({ ok: false, status: 429, textBody: 'rate limited' })
    vi.stubGlobal('fetch', vi.fn(async () => res))

    const out = await fetchHttpClient.request({ url: 'https://api.example.com/' })

    expect(out.ok).toBe(false)
    expect(out.status).toBe(429)
    expect(await out.text()).toBe('rate limited')
  })

  it('propagates fetch rejections (network errors)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))

    await expect(fetchHttpClient.request({ url: 'https://down.example.com/' })).rejects.toThrow('fetch failed')
  })
})

describe('readJsonResponse', () => {
  it('parses a JSON body', async () => {
    const res = fakeResponse({ textBody: '{"ok":true,"items":[1,2]}' })
    expect(await readJsonResponse('Slack', res)).toEqual({ ok: true, items: [1, 2] })
  })

  it('returns null for an empty body', async () => {
    const res = fakeResponse({ textBody: '' })
    expect(await readJsonResponse('Slack', res)).toBeNull()
  })

  it('parses the body even for non-2xx responses (status handling is the caller\'s job)', async () => {
    const res = fakeResponse({ ok: false, status: 500, textBody: '{"error":"server_error"}' })
    expect(await readJsonResponse('Google', res)).toEqual({ error: 'server_error' })
  })

  it('throws a labeled error for a non-JSON body', async () => {
    const res = fakeResponse({ textBody: '<html>gateway timeout</html>' })
    await expect(readJsonResponse('Slack', res)).rejects.toThrow(
      'Slack returned non-JSON response: <html>gateway timeout</html>',
    )
  })

  it('truncates the body excerpt in the error to 200 characters', async () => {
    const res = fakeResponse({ textBody: '<' + 'x'.repeat(500) })
    const err = await readJsonResponse('Slack', res).catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(Error)
    const excerpt = (err as Error).message.replace('Slack returned non-JSON response: ', '')
    expect(excerpt).toHaveLength(200)
  })
})

describe('readTextResponse', () => {
  it('returns the raw body text', async () => {
    const res = fakeResponse({ textBody: 'plain text body' })
    expect(await readTextResponse(res)).toBe('plain text body')
  })
})
