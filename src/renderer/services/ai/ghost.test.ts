import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
const getPortMock = vi.fn()
const getAiTokenMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  getPortMock.mockReset().mockResolvedValue(17654)
  getAiTokenMock.mockReset().mockResolvedValue('test-shell-token')
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', {
    kernel: { getPort: getPortMock, getAiToken: getAiTokenMock },
  })
  // Reset the lazy config cache in aiApi so each test gets fresh mocks.
  vi.resetModules()
})

describe('requestGhostSuggestions', () => {
  async function loadGhost() {
    return import('./ghost.js')
  }

  it('requests ghost suggestions from the central local AI endpoint with shell token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [' next phrase ', ' next phrase ', '\nsecond option'] }),
    })

    const { requestGhostSuggestions } = await loadGhost()
    const result = await requestGhostSuggestions({
      before: 'The intervention',
      after: 'was evaluated.',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:17654/api/ai/ghost',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          before: 'The intervention',
          after: 'was evaluated.',
        }),
      }),
    )
    // Verify the shell token header is set
    const callHeaders = fetchMock.mock.calls[0][1].headers
    expect(callHeaders.get('x-mim-shell-token')).toBe('test-shell-token')
    expect(callHeaders.get('Content-Type')).toBe('application/json')
    expect(result).toEqual([' next phrase ', '\nsecond option'])
  })

  it('stays silent (empty result) when the central endpoint fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    const { requestGhostSuggestions } = await loadGhost()
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

    const { requestGhostSuggestions } = await loadGhost()
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

    const { requestGhostSuggestions } = await loadGhost()
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

    const { requestGhostSuggestions } = await loadGhost()
    await expect(requestGhostSuggestions({
      before: 'The intervention',
      after: '',
    })).resolves.toEqual({ error: 'API key missing. Open Settings to add your key.' })
  })
})
