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

  it('emits one debounced workspace-relative change event', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'mim-watch-test-'))
    dirs.push(dir)
    const emit = vi.fn()
    const handles: Array<{
      on: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    }> = []
    const watch = vi.fn((_path: string, _options: Record<string, unknown>) => {
      const handle = {
        on: vi.fn(() => handle),
        close: vi.fn(async () => undefined),
      }
      handles.push(handle)
      return handle
    })

    const watcher = createWorkspaceFileWatcher({
      emit,
      watch,
      debounceMs: 25,
    })

    await watcher.setWorkspace(dir)
    const onAll = handles[0].on.mock.calls.find(([event]) => event === 'all')?.[1]
    expect(onAll).toBeTypeOf('function')

    onAll('change', join(dir, 'docs', 'a.md'))
    onAll('add', join(dir, 'docs', 'b.md'))
    vi.advanceTimersByTime(24)
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(emit).toHaveBeenCalledWith('workspace:files-changed', {
      paths: ['docs/a.md', 'docs/b.md'],
      changes: [
        { path: 'docs/a.md', kind: 'change' },
        { path: 'docs/b.md', kind: 'add' },
      ],
    })
  })

  it('ignores runtime and dependency directories and closes old workspace watchers', async () => {
    const first = mkdtempSync(join(tmpdir(), 'mim-watch-first-'))
    const second = mkdtempSync(join(tmpdir(), 'mim-watch-second-'))
    dirs.push(first, second)
    const emit = vi.fn()
    const handles: Array<{
      on: ReturnType<typeof vi.fn>
      close: ReturnType<typeof vi.fn>
    }> = []
    const watch = vi.fn((_path: string, _options: Record<string, unknown>) => {
      const handle = {
        on: vi.fn(() => handle),
        close: vi.fn(async () => undefined),
      }
      handles.push(handle)
      return handle
    })

    const watcher = createWorkspaceFileWatcher({ emit, watch })

    await watcher.setWorkspace(first)
    const ignored = watch.mock.calls[0][1].ignored as (path: string) => boolean
    expect(ignored(join(first, '.mim', 'traces', '2026-06-12.jsonl'))).toBe(true)
    expect(ignored(join(first, 'node_modules', 'pkg', 'index.js'))).toBe(true)
    expect(ignored(join(first, 'docs', 'note.md'))).toBe(false)

    await watcher.setWorkspace(second)
    expect(handles[0].close).toHaveBeenCalled()
    expect(watch).toHaveBeenLastCalledWith(second, expect.any(Object))
  })
})
