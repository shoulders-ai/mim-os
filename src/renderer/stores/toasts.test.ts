import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from './toasts.js'

describe('useToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pushes a toast and exposes it in list', () => {
    const store = useToastStore()
    const id = store.push({ kind: 'error', message: 'Save failed' })
    expect(store.list).toHaveLength(1)
    expect(store.list[0]).toMatchObject({ id, kind: 'error', message: 'Save failed' })
  })

  it('pushes a toast with an optional detail', () => {
    const store = useToastStore()
    store.push({ kind: 'info', message: 'Opened', detail: 'docs/readme.md' })
    expect(store.list[0]).toMatchObject({ kind: 'info', message: 'Opened', detail: 'docs/readme.md' })
  })

  it('keeps an optional action callback', () => {
    const store = useToastStore()
    const action = vi.fn()
    store.push({ kind: 'info', message: 'Resolved', actionLabel: 'Undo', action })
    expect(store.list[0]?.actionLabel).toBe('Undo')
    store.list[0]?.action?.()
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('auto-dismisses after timeout', () => {
    const store = useToastStore()
    store.push({ kind: 'error', message: 'Gone soon' })
    expect(store.list).toHaveLength(1)
    vi.advanceTimersByTime(6000)
    expect(store.list).toHaveLength(0)
  })

  it('manual dismiss removes immediately', () => {
    const store = useToastStore()
    const id = store.push({ kind: 'error', message: 'Dismiss me' })
    expect(store.list).toHaveLength(1)
    store.dismiss(id)
    expect(store.list).toHaveLength(0)
  })

  it('manual dismiss prevents auto-dismiss timer from firing', () => {
    const store = useToastStore()
    const id = store.push({ kind: 'error', message: 'Early dismiss' })
    store.dismiss(id)
    // Advancing time should not cause errors (timer was cleared)
    vi.advanceTimersByTime(10000)
    expect(store.list).toHaveLength(0)
  })

  it('clear removes all toasts and clears timers', () => {
    const store = useToastStore()
    store.push({ kind: 'error', message: 'one' })
    store.push({ kind: 'info', message: 'two' })
    expect(store.list).toHaveLength(2)
    store.clear()
    expect(store.list).toHaveLength(0)
    // Advancing time should not re-add anything
    vi.advanceTimersByTime(10000)
    expect(store.list).toHaveLength(0)
  })

  it('assigns unique ids to multiple toasts', () => {
    const store = useToastStore()
    const id1 = store.push({ kind: 'error', message: 'first' })
    const id2 = store.push({ kind: 'info', message: 'second' })
    expect(id1).not.toBe(id2)
    expect(store.list).toHaveLength(2)
  })

  it('dismissing a non-existent id is a no-op', () => {
    const store = useToastStore()
    store.push({ kind: 'error', message: 'exists' })
    store.dismiss(999)
    expect(store.list).toHaveLength(1)
  })
})
