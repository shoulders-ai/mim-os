import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createWorkspaceFileWatcher } from '@main/workspace/workspaceFileWatcher.js'

describe('workspace file watcher', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
    vi.useRealTimers()
  })

  function watchHarness() {
    const handles: Array<{
      path: string
      on: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    }> = []
    const watch = vi.fn((path: string, _options: Record<string, unknown>) => {
      const handle = {
        path,
        on: vi.fn(() => handle),
        close: vi.fn(async () => undefined),
      }
      handles.push(handle)
      return handle
    })
    return { watch, handles }
  }

  it('watches only explicitly registered workspace files', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'mim-watch-test-'))
    dirs.push(dir)
    const emit = vi.fn()
    const { watch, handles } = watchHarness()
    const watcher = createWorkspaceFileWatcher({
      emit,
      watch,
      debounceMs: 25,
    })

    await watcher.setWorkspace(dir)
    expect(watch).not.toHaveBeenCalled()

    expect(watcher.watchFile('docs/a.md')).toBe(true)
    expect(watch).toHaveBeenCalledTimes(1)
    expect(watch).toHaveBeenCalledWith(join(dir, 'docs/a.md'), { ignoreInitial: true })

    const onAll = handles[0].on.mock.calls.find(([event]) => event === 'all')?.[1]
    expect(onAll).toBeTypeOf('function')

    onAll('change', join(dir, 'docs', 'a.md'))
    onAll('change', join(dir, 'docs', 'unwatched.md'))
    vi.advanceTimersByTime(25)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('workspace:files-changed', {
      paths: ['docs/a.md'],
      changes: [{ path: 'docs/a.md', kind: 'change' }],
    })
  })

  it('reference-counts duplicate watches and closes when the last registration is removed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mim-watch-ref-'))
    dirs.push(dir)
    const emit = vi.fn()
    const { watch, handles } = watchHarness()
    const watcher = createWorkspaceFileWatcher({ emit, watch })

    await watcher.setWorkspace(dir)
    expect(watcher.watchFile('docs/a.md')).toBe(true)
    expect(watcher.watchFile('docs/a.md')).toBe(true)
    expect(watch).toHaveBeenCalledTimes(1)

    await watcher.unwatchFile('docs/a.md')
    expect(handles[0].close).not.toHaveBeenCalled()
    await watcher.unwatchFile('docs/a.md')
    expect(handles[0].close).toHaveBeenCalledTimes(1)
  })

  it('rejects ignored or escaping paths and closes file watchers on workspace switch', async () => {
    const first = mkdtempSync(join(tmpdir(), 'mim-watch-first-'))
    const second = mkdtempSync(join(tmpdir(), 'mim-watch-second-'))
    dirs.push(first, second)
    const emit = vi.fn()
    const { watch, handles } = watchHarness()
    const watcher = createWorkspaceFileWatcher({ emit, watch })

    await watcher.setWorkspace(first)
    expect(watcher.watchFile('node_modules/pkg/index.js')).toBe(false)
    expect(watcher.watchFile('../outside.md')).toBe(false)
    expect(watcher.watchFile('docs/a.md')).toBe(true)
    expect(watch).toHaveBeenCalledTimes(1)

    await watcher.setWorkspace(second)
    expect(handles[0].close).toHaveBeenCalled()
    expect(watch).toHaveBeenCalledTimes(1)

    expect(watcher.watchFile('docs/b.md')).toBe(true)
    expect(watch).toHaveBeenLastCalledWith(join(second, 'docs/b.md'), expect.any(Object))
  })
})
