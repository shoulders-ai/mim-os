// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { usePointerReorder } from './usePointerReorder.js'

type Harness = ReturnType<typeof usePointerReorder>

function pointerEvent(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
}

describe('usePointerReorder', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let harness!: Harness
  let onReorder: ReturnType<typeof vi.fn>
  const keys = ['a', 'b', 'c']

  function mountRows() {
    root = document.createElement('div')
    root.className = 'list'
    document.body.appendChild(root)
    keys.forEach((key, index) => {
      const row = document.createElement('div')
      row.dataset.rowKey = key
      // happy-dom has no layout; rows are 30px tall, stacked from y=0.
      row.getBoundingClientRect = () =>
        ({ top: index * 30, height: 30, bottom: index * 30 + 30, left: 0, right: 100, width: 100, x: 0, y: index * 30 }) as DOMRect
      root.appendChild(row)
    })

    onReorder = vi.fn()
    app = createApp(defineComponent({
      setup() {
        harness = usePointerReorder({
          rowSelector: '.list [data-row-key]',
          keyAttr: 'rowKey',
          keys: () => keys,
          onReorder,
        })
        return () => h('div')
      },
    }))
    app.mount(document.createElement('div'))
  }

  beforeEach(() => mountRows())

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
  })

  it('does not activate below the drag threshold and keeps clicks', () => {
    harness.onPointerDown(pointerEvent('pointerdown', 10, 5) as PointerEvent, 'a')
    document.dispatchEvent(pointerEvent('pointermove', 11, 6))
    expect(harness.dragging.value).toBe(false)

    document.dispatchEvent(pointerEvent('pointerup', 11, 6))
    expect(onReorder).not.toHaveBeenCalled()
    expect(harness.suppressClick.value).toBe(false)
  })

  it('activates past the threshold, tracks the drop slot, and commits the reorder', () => {
    harness.onPointerDown(pointerEvent('pointerdown', 10, 5) as PointerEvent, 'a')
    document.dispatchEvent(pointerEvent('pointermove', 10, 80))
    expect(harness.dragging.value).toBe(true)
    expect(harness.drag.value?.key).toBe('a')
    // y=80 is past row c's midline (75): drop after c.
    expect(harness.dropIndicator.value).toEqual({ beforeKey: null, afterKey: 'c' })

    document.dispatchEvent(pointerEvent('pointerup', 10, 80))
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])
    // The click that follows the drop must not select the dragged row.
    expect(harness.suppressClick.value).toBe(true)
    expect(harness.drag.value).toBeNull()
    expect(harness.dropIndicator.value).toBeNull()
  })

  it('drops before a row when released above its midline', () => {
    harness.onPointerDown(pointerEvent('pointerdown', 10, 80) as PointerEvent, 'c')
    document.dispatchEvent(pointerEvent('pointermove', 10, 10))
    // y=10 is above row a's midline (15): drop before a.
    expect(harness.dropIndicator.value).toEqual({ beforeKey: 'a', afterKey: null })

    document.dispatchEvent(pointerEvent('pointerup', 10, 10))
    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b'])
  })

  it('ignores non-primary buttons and input targets', () => {
    const rightClick = new MouseEvent('pointerdown', { clientX: 0, clientY: 0, button: 2 })
    harness.onPointerDown(rightClick as PointerEvent, 'a')
    expect(harness.drag.value).toBeNull()

    const input = document.createElement('input')
    document.body.appendChild(input)
    const fromInput = new MouseEvent('pointerdown', { clientX: 0, clientY: 0, button: 0 })
    Object.defineProperty(fromInput, 'target', { value: input })
    harness.onPointerDown(fromInput as PointerEvent, 'a')
    expect(harness.drag.value).toBeNull()
    input.remove()
  })

  it('detaches document listeners on unmount mid-drag', () => {
    harness.onPointerDown(pointerEvent('pointerdown', 10, 5) as PointerEvent, 'a')
    app?.unmount()
    app = null

    document.dispatchEvent(pointerEvent('pointermove', 10, 80))
    document.dispatchEvent(pointerEvent('pointerup', 10, 80))
    expect(onReorder).not.toHaveBeenCalled()
  })
})
