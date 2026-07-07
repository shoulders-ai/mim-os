import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerWindow,
  unregisterWindow,
  updateWindowDirtyState,
  totalDirtyCount,
  unionDirtyPaths,
  getWindowDirtyState,
  resetRegistry,
  cascadePosition,
  popoutCloseGuardMessage,
  addReadyResolver,
  resolveReady,
  removeReadyResolver,
  resolveMenuTarget,
  normalizeSetEditedPayload,
} from './popoutWindows.js'

describe('popoutWindows registry', () => {
  beforeEach(() => {
    resetRegistry()
  })

  // ── Registration ──

  it('registers a window with default dirty state', () => {
    registerWindow(1, 'main')
    expect(getWindowDirtyState(1)).toEqual({ count: 0, paths: new Set() })
  })

  it('registers a popout window', () => {
    registerWindow(2, 'popout')
    expect(getWindowDirtyState(2)).toEqual({ count: 0, paths: new Set() })
  })

  it('unregisters a window', () => {
    registerWindow(1, 'main')
    unregisterWindow(1)
    expect(getWindowDirtyState(1)).toBeNull()
  })

  it('unregistering an unknown id is a no-op', () => {
    expect(() => unregisterWindow(999)).not.toThrow()
  })

  // ── Dirty state ──

  it('updates dirty state for a registered window', () => {
    registerWindow(1, 'main')
    updateWindowDirtyState(1, 3, ['a.md', 'b.md', 'c.md'])
    expect(getWindowDirtyState(1)).toEqual({
      count: 3,
      paths: new Set(['a.md', 'b.md', 'c.md']),
    })
  })

  it('ignores dirty state update for unknown window', () => {
    // Should not throw, just silently no-op
    updateWindowDirtyState(999, 2, ['x.md'])
    expect(getWindowDirtyState(999)).toBeNull()
  })

  it('clamps negative counts to zero', () => {
    registerWindow(1, 'main')
    updateWindowDirtyState(1, -5, [])
    expect(getWindowDirtyState(1)!.count).toBe(0)
  })

  // ── Aggregation ──

  it('totalDirtyCount sums across all windows', () => {
    registerWindow(1, 'main')
    registerWindow(2, 'popout')
    updateWindowDirtyState(1, 2, ['a.md', 'b.md'])
    updateWindowDirtyState(2, 3, ['c.md', 'd.md', 'e.md'])
    expect(totalDirtyCount()).toBe(5)
  })

  it('totalDirtyCount returns 0 when no windows are registered', () => {
    expect(totalDirtyCount()).toBe(0)
  })

  it('unionDirtyPaths merges paths from all windows', () => {
    registerWindow(1, 'main')
    registerWindow(2, 'popout')
    updateWindowDirtyState(1, 2, ['shared.md', 'a.md'])
    updateWindowDirtyState(2, 1, ['shared.md', 'b.md'])
    expect(unionDirtyPaths()).toEqual(new Set(['shared.md', 'a.md', 'b.md']))
  })

  it('unionDirtyPaths returns empty set when no windows registered', () => {
    expect(unionDirtyPaths()).toEqual(new Set())
  })

  // ── Lifecycle: drop on destroy ──

  it('unregistering removes dirty contributions from aggregates', () => {
    registerWindow(1, 'main')
    registerWindow(2, 'popout')
    updateWindowDirtyState(1, 2, ['a.md'])
    updateWindowDirtyState(2, 3, ['b.md'])
    expect(totalDirtyCount()).toBe(5)

    unregisterWindow(2)

    expect(totalDirtyCount()).toBe(2)
    expect(unionDirtyPaths()).toEqual(new Set(['a.md']))
  })

  // ── Reset ──

  it('resetRegistry clears everything', () => {
    registerWindow(1, 'main')
    registerWindow(2, 'popout')
    updateWindowDirtyState(1, 1, ['x.md'])
    resetRegistry()

    expect(totalDirtyCount()).toBe(0)
    expect(unionDirtyPaths()).toEqual(new Set())
    expect(getWindowDirtyState(1)).toBeNull()
  })
})

// ── cascadePosition ──

describe('cascadePosition', () => {
  it('cascades from last existing bounds', () => {
    const bounds = [{ x: 100, y: 200 }, { x: 128, y: 228 }]
    expect(cascadePosition(bounds, { x: 0, y: 0 })).toEqual({ x: 156, y: 256 })
  })

  it('cascades from fallback when no existing bounds', () => {
    expect(cascadePosition([], { x: 50, y: 80 })).toEqual({ x: 78, y: 108 })
  })

  it('uses custom offset', () => {
    const bounds = [{ x: 100, y: 200 }]
    expect(cascadePosition(bounds, { x: 0, y: 0 }, 40)).toEqual({ x: 140, y: 240 })
  })
})

// ── popoutCloseGuardMessage ──

describe('popoutCloseGuardMessage', () => {
  it('returns shouldPrompt: false when dirtyCount is 0', () => {
    const result = popoutCloseGuardMessage(0)
    expect(result).toEqual({ shouldPrompt: false, message: '' })
  })

  it('returns shouldPrompt: false when dirtyCount is negative', () => {
    const result = popoutCloseGuardMessage(-3)
    expect(result).toEqual({ shouldPrompt: false, message: '' })
  })

  it('returns correct message for 1 dirty tab', () => {
    const result = popoutCloseGuardMessage(1)
    expect(result).toEqual({
      shouldPrompt: true,
      message: 'You have 1 unsaved tab. Close this window anyway?',
    })
  })

  it('returns correct message for multiple dirty tabs', () => {
    const result = popoutCloseGuardMessage(4)
    expect(result).toEqual({
      shouldPrompt: true,
      message: 'You have 4 unsaved tabs. Close this window anyway?',
    })
  })
})

// ── Ready resolvers ──

describe('ready resolvers', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('addReadyResolver + resolveReady succeeds', () => {
    const fn = vi.fn()
    addReadyResolver(10, fn)
    const found = resolveReady(10)
    expect(found).toBe(true)
    expect(fn).toHaveBeenCalledWith(true)
  })

  it('resolveReady returns false for unknown id', () => {
    expect(resolveReady(999)).toBe(false)
  })

  it('timeout resolves with false', () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      addReadyResolver(10, fn, 5000)

      vi.advanceTimersByTime(5000)

      expect(fn).toHaveBeenCalledWith(false)
      // After timeout, resolveReady should return false (entry already removed)
      expect(resolveReady(10)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('removeReadyResolver cleans up without calling resolve', () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      addReadyResolver(10, fn, 5000)

      removeReadyResolver(10)

      // Timer should be cleared, advancing time should not call resolve
      vi.advanceTimersByTime(10_000)
      expect(fn).not.toHaveBeenCalled()
      expect(resolveReady(10)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('addReadyResolver replaces existing resolver', () => {
    vi.useFakeTimers()
    try {
      const first = vi.fn()
      const second = vi.fn()
      addReadyResolver(10, first, 5000)
      addReadyResolver(10, second, 5000)

      // First resolver's timer should have been cleared
      vi.advanceTimersByTime(5000)
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resetRegistry also clears ready resolvers', () => {
    vi.useFakeTimers()
    try {
      const fn = vi.fn()
      addReadyResolver(10, fn, 5000)

      resetRegistry()

      vi.advanceTimersByTime(10_000)
      expect(fn).not.toHaveBeenCalled()
      expect(resolveReady(10)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ── resolveMenuTarget ──

describe('resolveMenuTarget', () => {
  const editorCommands = [
    'menu:new-document',
    'menu:open-file',
    'menu:save-file',
    'menu:save-file-as',
    'menu:export-document',
    'menu:close-tab',
    'menu:open-recent',
  ]

  const appCommands = [
    'menu:settings',
    'menu:shortcuts',
    'menu:welcome',
    'menu:clear-recent',
  ]

  it.each(editorCommands)('%s routes to focused window when focused is a popout', (cmd) => {
    expect(resolveMenuTarget(cmd, true)).toBe('focused')
  })

  it.each(editorCommands)('%s routes to main when focused is main', (cmd) => {
    expect(resolveMenuTarget(cmd, false)).toBe('main')
  })

  it.each(appCommands)('%s always routes to main even when focused is a popout', (cmd) => {
    expect(resolveMenuTarget(cmd, true)).toBe('main')
  })

  it.each(appCommands)('%s routes to main when focused is main', (cmd) => {
    expect(resolveMenuTarget(cmd, false)).toBe('main')
  })

  it('returns main for unknown commands', () => {
    expect(resolveMenuTarget('menu:unknown', true)).toBe('main')
    expect(resolveMenuTarget('menu:unknown', false)).toBe('main')
  })
})

// ── normalizeSetEditedPayload ──

describe('normalizeSetEditedPayload', () => {
  it('normalizes a valid payload', () => {
    expect(normalizeSetEditedPayload({
      title: 'test.md - Mim',
      dirty: true,
      path: 'docs/test.md',
    })).toEqual({
      title: 'test.md - Mim',
      dirty: true,
      path: 'docs/test.md',
    })
  })

  it('defaults missing fields: title to "", dirty to false, path to ""', () => {
    expect(normalizeSetEditedPayload({})).toEqual({
      title: '',
      dirty: false,
      path: '',
    })
  })

  it('returns null for null input', () => {
    expect(normalizeSetEditedPayload(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(normalizeSetEditedPayload(undefined)).toBeNull()
  })

  it('returns null for non-object input (string)', () => {
    expect(normalizeSetEditedPayload('hello')).toBeNull()
  })

  it('returns null for non-object input (number)', () => {
    expect(normalizeSetEditedPayload(42)).toBeNull()
  })

  it('returns null for array input', () => {
    expect(normalizeSetEditedPayload([1, 2])).toBeNull()
  })

  it('ignores extra fields', () => {
    const result = normalizeSetEditedPayload({
      title: 'x',
      dirty: false,
      path: 'y',
      extra: 'ignored',
      another: 99,
    })
    expect(result).toEqual({ title: 'x', dirty: false, path: 'y' })
  })

  it('coerces dirty with Boolean()', () => {
    expect(normalizeSetEditedPayload({ dirty: 0 })!.dirty).toBe(false)
    expect(normalizeSetEditedPayload({ dirty: 1 })!.dirty).toBe(true)
    expect(normalizeSetEditedPayload({ dirty: '' })!.dirty).toBe(false)
    expect(normalizeSetEditedPayload({ dirty: 'yes' })!.dirty).toBe(true)
    expect(normalizeSetEditedPayload({ dirty: null })!.dirty).toBe(false)
    expect(normalizeSetEditedPayload({ dirty: undefined })!.dirty).toBe(false)
  })
})
