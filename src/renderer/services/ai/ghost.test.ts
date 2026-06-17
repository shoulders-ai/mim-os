import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestGhostSuggestions } from './ghost.js'

const fetchMock = vi.fn()
const getPortMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  getPortMock.mockReset().mockResolvedValue(17654)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', {
    kernel: { getPort: getPortMock },
  })
})

describe('requestGhostSuggestions', () => {
  it('requests ghost suggestions from the central local AI endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [' next phrase ', ' next phrase ', '\nsecond option'] }),
    })

    const result = await requestGhostSuggestions({
      before: 'The intervention',
      after: 'was evaluated.',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:17654/api/ai/ghost',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          before: 'The intervention',
          after: 'was evaluated.',
        }),
      }),
    )
    expect(result).toEqual([' next phrase ', '\nsecond option'])
  })

  it('stays silent (empty result) when the central endpoint fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    await expect(requestGhostSuggestions({
      before: 'The intervention',
      after: '',
    })).resolves.toEqual([])
  })

  it('stays silent (empty result) when the endpoint returns no suggestions', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [] }),
    })

    await expect(requestGhostSuggestions({
      before: 'The intervention',
      after: '',
    })).resolves.toEqual([])
  })

  it('passes the selected ghost model when provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [' selected model suggestion'] }),
    })

    await requestGhostSuggestions({
      before: 'The intervention',
      after: '',
      modelId: 'gemini-3.1-flash-lite',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:17654/api/ai/ghost',
      expect.objectContaining({
        body: JSON.stringify({
          before: 'The intervention',
          after: '',
          modelId: 'gemini-3.1-flash-lite',
        }),
      }),
    )
  })

  it('returns an auth error object for missing keys', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'No API key configured for anthropic' }),
    })

    await expect(requestGhostSuggestions({
      before: 'The intervention',
      after: '',
    })).resolves.toEqual({ error: 'API key missing. Open Settings to add your key.' })
  })
})
