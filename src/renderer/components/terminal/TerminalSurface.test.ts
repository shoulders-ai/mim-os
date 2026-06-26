// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import TerminalSurface from './TerminalSurface.vue'

/* ── xterm mocks (system boundary: third-party renderer) ── */

const xterm = vi.hoisted(() => {
  const instances: TerminalStub[] = []

  class TerminalStub {
    options: Record<string, unknown>
    cols = 80
    rows = 24
    write = vi.fn()
    clear = vi.fn()
    focus = vi.fn()
    dispose = vi.fn()
    selectAll = vi.fn()
    getSelection = vi.fn(() => 'selected-text')
    loadAddon = vi.fn()
    open = vi.fn()
    onDataCb: ((data: string) => void) | null = null
    keyHandler: ((event: KeyboardEvent) => boolean) | null = null

    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }

    onData(cb: (data: string) => void) {
      this.onDataCb = cb
    }

    attachCustomKeyEventHandler(cb: (event: KeyboardEvent) => boolean) {
      this.keyHandler = cb
    }
  }

  return { instances, TerminalStub }
})

vi.mock('@xterm/xterm', () => ({ Terminal: xterm.TerminalStub }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn() } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('TerminalSurface', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let pinia: Pinia
  let call: ReturnType<typeof vi.fn>
  let on: ReturnType<typeof vi.fn>
  let off: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    pinia = createPinia()
    setActivePinia(pinia)
    xterm.instances.length = 0
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      top: 0,
      right: 640,
      bottom: 360,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect))
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      cb(0)
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    call = vi.fn(async () => ({}))
    on = vi.fn()
    off = vi.fn()
    const ptyWrite = vi.fn()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on, off, ptyWrite },
    })
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function lastTerminal() {
    const instance = xterm.instances.at(-1)
    if (!instance) throw new Error('No xterm instance was created')
    return instance
  }

  function channelHandler(channel: string): (...args: unknown[]) => void {
    const match = on.mock.calls.find(([name]) => name === channel)
    if (!match) throw new Error(`No kernel listener for ${channel}`)
    return match[1] as (...args: unknown[]) => void
  }

  function mountSurface(props: Record<string, unknown>, listeners: Record<string, unknown> = {}) {
    const reactiveProps = ref(props)
    app = createApp({
      setup() {
        return () => h(TerminalSurface, { ...reactiveProps.value, ...listeners })
      },
    })
    app.use(pinia)
    app.mount(root)
    return reactiveProps
  }

  function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
    return {
      type: 'keydown',
      key: '',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      ...overrides,
    } as unknown as KeyboardEvent
  }

  function stubPlatform(platform: string) {
    vi.stubGlobal('navigator', { platform })
  }

  it('live mode subscribes to the pty channels, renders output, forwards input, and cleans up on unmount', async () => {
    mountSurface({ ptyId: 7 })
    await flushUi()

    expect(on).toHaveBeenCalledWith('pty:output:7', expect.any(Function))
    expect(on).toHaveBeenCalledWith('pty:exit:7', expect.any(Function))

    const terminal = lastTerminal()
    expect(terminal.open).toHaveBeenCalled()

    channelHandler('pty:output:7')('hello from pty')
    expect(terminal.write).toHaveBeenCalledWith('hello from pty')

    terminal.onDataCb?.('ls\r')
    expect(window.kernel.ptyWrite).toHaveBeenCalledWith(7, 'ls\r')

    app?.unmount()
    app = null
    expect(off).toHaveBeenCalledWith('pty:output:7', expect.any(Function))
    expect(off).toHaveBeenCalledWith('pty:exit:7', expect.any(Function))
    expect(terminal.dispose).toHaveBeenCalled()
  })

  it('binds when ptyId arrives after mount', async () => {
    const props = mountSurface({ ptyId: null })
    await flushUi()

    expect(on).not.toHaveBeenCalled()

    props.value = { ptyId: 5 }
    await flushUi()

    expect(on).toHaveBeenCalledWith('pty:output:5', expect.any(Function))
    expect(on).toHaveBeenCalledWith('pty:exit:5', expect.any(Function))
  })

  it('waits to open xterm until the surface has visible dimensions', async () => {
    let visible = false
    ;(HTMLElement.prototype.getBoundingClientRect as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      x: 0,
      y: 0,
      width: visible ? 640 : 0,
      height: visible ? 360 : 0,
      top: 0,
      right: visible ? 640 : 0,
      bottom: visible ? 360 : 0,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect))

    const props = mountSurface({ ptyId: 7, active: false })
    await flushUi()
    const terminal = lastTerminal()
    expect(terminal.open).not.toHaveBeenCalled()

    visible = true
    props.value = { ptyId: 7, active: true }
    await flushUi()

    expect(terminal.open).toHaveBeenCalled()
  })

  it('keeps pty output that arrives before xterm opens', async () => {
    on.mockImplementation((channel: string, cb: (data: unknown) => void) => {
      if (channel === 'pty:output:7') cb('early prompt')
    })

    mountSurface({ ptyId: 7 })
    await flushUi()

    expect(lastTerminal().write).toHaveBeenCalledWith('early prompt')
  })

  it('repeats focus after the next paint so the opened terminal accepts typing', async () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const props = mountSurface({ ptyId: null })
    await flushUi()

    const terminal = lastTerminal()
    terminal.focus.mockClear()
    props.value = { ptyId: 5 }
    await flushUi()

    expect(terminal.focus).not.toHaveBeenCalled()
    for (let i = 0; frames.length > 0 && i < 4; i++) {
      frames.shift()?.(0)
    }
    expect(terminal.open).toHaveBeenCalled()
    expect(terminal.focus).toHaveBeenCalled()
  })

  it('emits exited with the exit code, unsubscribes, and reroutes input to the input emit', async () => {
    const exited = vi.fn()
    const input = vi.fn()
    mountSurface({ ptyId: 9 }, { onExited: exited, onInput: input })
    await flushUi()

    channelHandler('pty:exit:9')(1)
    await flushUi()

    expect(exited).toHaveBeenCalledWith(1)
    expect(off).toHaveBeenCalledWith('pty:output:9', expect.any(Function))
    expect(off).toHaveBeenCalledWith('pty:exit:9', expect.any(Function))

    call.mockClear()
    ;(window.kernel.ptyWrite as ReturnType<typeof vi.fn>).mockClear()
    lastTerminal().onDataCb?.('x')
    expect(window.kernel.ptyWrite).not.toHaveBeenCalled()
    expect(input).toHaveBeenCalledWith('x')
  })

  it('writes OS shortcut shim sequences to the pty instead of letting xterm handle them', async () => {
    mountSurface({ ptyId: 7 })
    await flushUi()

    const handled = lastTerminal().keyHandler?.(keyEvent({ key: 'ArrowLeft', ctrlKey: true }))

    expect(handled).toBe(false)
    expect(window.kernel.ptyWrite).toHaveBeenCalledWith(7, '\x01')
  })

  it('keeps the shell Shift+Enter literal-newline fallback by default', async () => {
    mountSurface({ ptyId: 7 })
    await flushUi()

    const event = keyEvent({ key: 'Enter', shiftKey: true })
    const handled = lastTerminal().keyHandler?.(event)

    expect(handled).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(window.kernel.ptyWrite).toHaveBeenCalledWith(7, '\x16\n')
  })

  it('uses the agent Shift+Enter fallback for agent keybinding profiles', async () => {
    mountSurface({ ptyId: 7, keybindingProfile: 'claude-code' })
    await flushUi()

    const event = keyEvent({ key: 'Enter', shiftKey: true })
    const handled = lastTerminal().keyHandler?.(event)

    expect(handled).toBe(false)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(window.kernel.ptyWrite).toHaveBeenCalledWith(7, '\x1b\r')
  })

  it('uses agent Home/End fallbacks for macOS Cmd+Arrow before xterm writes legacy bytes', async () => {
    stubPlatform('MacIntel')
    mountSurface({ ptyId: 7, keybindingProfile: 'codex' })
    await flushUi()

    const left = keyEvent({ key: 'ArrowLeft', metaKey: true })
    const right = keyEvent({ key: 'ArrowRight', metaKey: true })

    expect(lastTerminal().keyHandler?.(left)).toBe(false)
    expect(lastTerminal().keyHandler?.(right)).toBe(false)
    expect(left.preventDefault).toHaveBeenCalled()
    expect(left.stopPropagation).toHaveBeenCalled()
    expect(right.preventDefault).toHaveBeenCalled()
    expect(right.stopPropagation).toHaveBeenCalled()
    expect(window.kernel.ptyWrite).toHaveBeenNthCalledWith(1, 7, '\x1b[H')
    expect(window.kernel.ptyWrite).toHaveBeenNthCalledWith(2, 7, '\x1b[F')
  })

  it('writes explicit xterm modified cursor sequences for macOS Option+Arrow in terminal profiles', async () => {
    stubPlatform('MacIntel')
    mountSurface({ ptyId: 7 })
    await flushUi()

    const optionLeft = keyEvent({ key: 'ArrowLeft', altKey: true })
    const optionRight = keyEvent({ key: 'ArrowRight', altKey: true })
    expect(lastTerminal().keyHandler?.(optionLeft)).toBe(false)
    expect(lastTerminal().keyHandler?.(optionRight)).toBe(false)
    expect(optionLeft.preventDefault).toHaveBeenCalled()
    expect(optionLeft.stopPropagation).toHaveBeenCalled()
    expect(optionRight.preventDefault).toHaveBeenCalled()
    expect(optionRight.stopPropagation).toHaveBeenCalled()
    expect(window.kernel.ptyWrite).toHaveBeenNthCalledWith(1, 7, '\x1b[1;3D')
    expect(window.kernel.ptyWrite).toHaveBeenNthCalledWith(2, 7, '\x1b[1;3C')
  })

  it('does not let macOS Option+Shift+Arrow fall through to the shell in terminal profiles', async () => {
    stubPlatform('MacIntel')
    mountSurface({ ptyId: 7 })
    await flushUi()

    const optionShiftLeft = keyEvent({ key: 'ArrowLeft', altKey: true, shiftKey: true })
    const optionShiftRight = keyEvent({ key: 'ArrowRight', altKey: true, shiftKey: true })
    expect(lastTerminal().keyHandler?.(optionShiftLeft)).toBe(false)
    expect(lastTerminal().keyHandler?.(optionShiftRight)).toBe(false)
    expect(optionShiftLeft.preventDefault).toHaveBeenCalled()
    expect(optionShiftLeft.stopPropagation).toHaveBeenCalled()
    expect(optionShiftRight.preventDefault).toHaveBeenCalled()
    expect(optionShiftRight.stopPropagation).toHaveBeenCalled()
    expect(window.kernel.ptyWrite).toHaveBeenNthCalledWith(1, 7, '\x1b[1;3D')
    expect(window.kernel.ptyWrite).toHaveBeenNthCalledWith(2, 7, '\x1b[1;3C')
  })

  it('maps macOS terminal Option+Backspace to shell word delete', async () => {
    stubPlatform('MacIntel')
    mountSurface({ ptyId: 7 })
    await flushUi()

    const optionBackspace = keyEvent({ key: 'Backspace', altKey: true })
    expect(lastTerminal().keyHandler?.(optionBackspace)).toBe(false)
    expect(optionBackspace.preventDefault).toHaveBeenCalled()
    expect(optionBackspace.stopPropagation).toHaveBeenCalled()
    expect(window.kernel.ptyWrite).toHaveBeenCalledWith(7, '\x17')
  })

  it('leaves macOS Option+Arrow and Backspace/Delete to xterm for agent profiles', async () => {
    stubPlatform('MacIntel')
    mountSurface({ ptyId: 7, keybindingProfile: 'gemini-cli' })
    await flushUi()

    const optionLeft = keyEvent({ key: 'ArrowLeft', altKey: true })
    const optionRight = keyEvent({ key: 'ArrowRight', altKey: true })
    expect(lastTerminal().keyHandler?.(optionLeft)).toBe(true)
    expect(lastTerminal().keyHandler?.(optionRight)).toBe(true)
    expect(optionLeft.preventDefault).not.toHaveBeenCalled()
    expect(optionLeft.stopPropagation).not.toHaveBeenCalled()
    expect(optionRight.preventDefault).not.toHaveBeenCalled()
    expect(optionRight.stopPropagation).not.toHaveBeenCalled()

    expect(lastTerminal().keyHandler?.(keyEvent({ key: 'Backspace' }))).toBe(true)
    expect(lastTerminal().keyHandler?.(keyEvent({ key: 'Delete' }))).toBe(true)
    expect(window.kernel.ptyWrite).not.toHaveBeenCalled()
  })

  it('does not advertise incomplete Kitty keyboard protocol support', async () => {
    mountSurface({ ptyId: 7, keybindingProfile: 'claude-code' })
    await flushUi()

    channelHandler('pty:output:7')('\x1b[?u')
    expect(window.kernel.ptyWrite).not.toHaveBeenCalled()
  })

  it('replay mode writes the scrollback once and forwards nothing', async () => {
    mountSurface({ replay: 'old session output' })
    await flushUi()

    const terminal = lastTerminal()
    expect(terminal.write).toHaveBeenCalledTimes(1)
    expect(terminal.write).toHaveBeenCalledWith('old session output')
    expect(on).not.toHaveBeenCalled()
    expect(terminal.onDataCb).toBeNull()
    expect(window.kernel.ptyWrite).not.toHaveBeenCalled()
  })
})
