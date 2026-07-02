// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderSplitRevertControl, renderUnifiedControl } from './merge.js'

// This is the DOM glue that DiffView.vue's auto-advance depends on: clicking a
// chunk control must report the button's screen position via onChunkResolved
// *after* the resolve action has applied, so the host can locate the next
// pending chunk. CodeMirror owns these as raw DOM nodes (not Vue), so they are
// tested directly rather than through a mounted view.

describe('renderUnifiedControl', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs the resolve action before reporting the chunk position', () => {
    const order: string[] = []
    const action = vi.fn(() => order.push('action'))
    const onChunkResolved = vi.fn(() => order.push('resolved'))
    const button = renderUnifiedControl('accept', action, onChunkResolved)
    button.getBoundingClientRect = () => ({ top: 42 } as DOMRect)
    document.body.appendChild(button)

    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(onChunkResolved).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(onChunkResolved).toHaveBeenCalledWith({ y: 42 })
    expect(order).toEqual(['action', 'resolved'])
    button.remove()
  })

  it('does not schedule a callback when none is given', () => {
    const action = vi.fn()
    const button = renderUnifiedControl('reject', action, undefined)
    document.body.appendChild(button)

    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    vi.runAllTimers()
    expect(action).toHaveBeenCalledTimes(1)
    button.remove()
  })

  it('labels accept and reject distinctly', () => {
    expect(renderUnifiedControl('accept', vi.fn()).title).toBe('Accept this chunk')
    expect(renderUnifiedControl('reject', vi.fn()).title).toBe('Reject this chunk')
  })
})

describe('renderSplitRevertControl', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reports the chunk position after MergeView applies the revert', () => {
    const onChunkResolved = vi.fn()
    const button = renderSplitRevertControl(onChunkResolved)
    button.getBoundingClientRect = () => ({ top: 7 } as DOMRect)
    document.body.appendChild(button)

    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(onChunkResolved).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(onChunkResolved).toHaveBeenCalledWith({ y: 7 })
    button.remove()
  })

  it('does not attach a listener when no callback is given', () => {
    const button = renderSplitRevertControl(undefined)
    expect(() => button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).not.toThrow()
  })
})
