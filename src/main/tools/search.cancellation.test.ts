import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerSearchTools } from '@main/tools/search.js'
import { searchFiles } from '@main/search/fileSearch.js'

// Mock file search to capture the AbortSignal each call receives, so we can
// assert the abort-previous contract without timing-dependent fixtures.
vi.mock('@main/search/fileSearch.js', () => ({
  searchFiles: vi.fn(async () => []),
}))

const mockedSearchFiles = vi.mocked(searchFiles)

describe('search.files cancellation', () => {
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    vi.clearAllMocks()
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath('/tmp/ws')
    registerSearchTools(tools)
  })

  function signalOfCall(index: number): AbortSignal {
    const options = mockedSearchFiles.mock.calls[index][2] as { signal?: AbortSignal }
    expect(options.signal).toBeInstanceOf(AbortSignal)
    return options.signal!
  }

  it('passes an AbortSignal to searchFiles', async () => {
    await tools.call('search.files', { query: 'alpha' }, ctx)
    expect(mockedSearchFiles).toHaveBeenCalledTimes(1)
    expect(signalOfCall(0).aborted).toBe(false)
  })

  it('a new search.files call aborts the in-flight one', async () => {
    let releaseFirst!: () => void
    mockedSearchFiles.mockImplementationOnce(
      () => new Promise(resolve => { releaseFirst = () => resolve([]) }),
    )

    const first = tools.call('search.files', { query: 'alpha' }, ctx)
    // Let the first call reach searchFiles before firing the second
    await Promise.resolve()
    const second = tools.call('search.files', { query: 'alpha beta' }, ctx)

    await second
    expect(signalOfCall(0).aborted).toBe(true)
    expect(signalOfCall(1).aborted).toBe(false)

    releaseFirst()
    await first
  })

  it('a completed search does not abort the next one', async () => {
    await tools.call('search.files', { query: 'alpha' }, ctx)
    await tools.call('search.files', { query: 'beta' }, ctx)
    expect(signalOfCall(1).aborted).toBe(false)
  })
})
