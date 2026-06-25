// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'

function canvasContextStub() {
  return {
    canvas: {},
    fillRect() {},
    clearRect() {},
    getImageData() { return { data: [] } },
    putImageData() {},
    createImageData() { return [] },
    setTransform() {},
    drawImage() {},
    save() {},
    fillText() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    translate() {},
    scale() {},
    rotate() {},
    arc() {},
    fill() {},
    measureText() { return { width: 8 } },
    transform() {},
    rect() {},
    clip() {},
  } as unknown as CanvasRenderingContext2D
}

function dispatchKey(target: HTMLElement, options: KeyboardEventInit & { keyCode: number }) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...options,
  })
  Object.defineProperty(event, 'keyCode', { configurable: true, value: options.keyCode })
  Object.defineProperty(event, 'which', { configurable: true, value: options.keyCode })
  target.dispatchEvent(event)
}

describe('xterm keyboard encoding', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        width: 800,
        height: 400,
        top: 0,
        right: 800,
        bottom: 400,
        left: 0,
        toJSON: () => ({}),
      }),
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContextStub())
  })

  afterEach(() => {
    root.remove()
    vi.restoreAllMocks()
  })

  it('encodes Alt/Option arrows as xterm modified cursor sequences', () => {
    const terminal = new Terminal({ cols: 80, rows: 24 })
    const data: string[] = []
    terminal.onData(chunk => data.push(chunk))
    terminal.open(root)

    dispatchKey(terminal.textarea!, { key: 'ArrowLeft', keyCode: 37, altKey: true })
    dispatchKey(terminal.textarea!, { key: 'ArrowRight', keyCode: 39, altKey: true })

    expect(data).toEqual(['\x1b[1;3D', '\x1b[1;3C'])
    terminal.dispose()
  })
})
