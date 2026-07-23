import { describe, expect, it, vi } from 'vitest'
import { createBackgroundSync } from './backgroundSync.js'

describe('background sync lifecycle', () => {
  it('syncs on open, coalesces saves, retries offline failures, and flushes before close', async () => {
    vi.useFakeTimers()
    const syncProject = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValue({ state: 'synced' })
    const syncTeam = vi.fn().mockResolvedValue({ state: 'synced' })
    const lifecycle = createBackgroundSync({
      syncProject,
      syncTeam,
      debounceMs: 20,
      retryMs: 100,
    })

    await lifecycle.open()
    expect(syncProject).toHaveBeenCalledTimes(1)
    expect(syncTeam).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(syncProject).toHaveBeenCalledTimes(2)

    lifecycle.changed('notes/a.md')
    lifecycle.changed('notes/b.md')
    await vi.advanceTimersByTimeAsync(20)
    expect(syncProject).toHaveBeenCalledTimes(3)
    expect(syncTeam).toHaveBeenCalledTimes(1)

    lifecycle.changed('.mim/team/files/brief.md')
    await lifecycle.beforeClose()
    expect(syncProject).toHaveBeenCalledTimes(4)
    expect(syncTeam).toHaveBeenCalledTimes(2)
    lifecycle.stop()
    vi.useRealTimers()
  })
})
