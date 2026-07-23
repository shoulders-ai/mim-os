export interface BackgroundSyncOptions {
  syncProject(): Promise<unknown>
  syncTeam(): Promise<unknown>
  debounceMs?: number
  retryMs?: number
  onError?: (scope: 'project' | 'team', error: unknown) => void
}

export function createBackgroundSync(options: BackgroundSyncOptions) {
  const debounceMs = options.debounceMs ?? 2_000
  const retryMs = options.retryMs ?? 60_000
  const pending = new Set<'project' | 'team'>()
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let stopped = false

  async function open(): Promise<void> {
    pending.add('project')
    pending.add('team')
    await flush()
  }

  function changed(path: string): void {
    pending.add(path.startsWith('.mim/team/') ? 'team' : 'project')
    if (debounceTimer || stopped) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void flush()
    }, debounceMs)
    debounceTimer.unref?.()
  }

  async function flush(): Promise<void> {
    if (stopped) return
    if (running) {
      await running
      if (pending.size) await flush()
      return
    }
    const scopes = [...pending]
    pending.clear()
    running = (async () => {
      for (const scope of scopes) {
        try {
          await (scope === 'project' ? options.syncProject() : options.syncTeam())
        } catch (error) {
          pending.add(scope)
          options.onError?.(scope, error)
        }
      }
    })()
    await running
    running = null
    if (pending.size) scheduleRetry()
  }

  function scheduleRetry(): void {
    if (retryTimer || stopped) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void flush()
    }, retryMs)
    retryTimer.unref?.()
  }

  async function beforeClose(): Promise<void> {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    pending.add('project')
    pending.add('team')
    await flush()
  }

  function stop(): void {
    stopped = true
    if (debounceTimer) clearTimeout(debounceTimer)
    if (retryTimer) clearTimeout(retryTimer)
    debounceTimer = null
    retryTimer = null
    pending.clear()
  }

  return { open, changed, flush, beforeClose, stop }
}
