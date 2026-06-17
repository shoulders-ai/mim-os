// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import TerminalPanel from './TerminalPanel.vue'

vi.mock('./TerminalSurface.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'TerminalSurfaceStub',
      props: {
        active: Boolean,
        ptyId: { type: Number, default: null },
      },
      setup(props, { expose }) {
        expose({
          fit: vi.fn(),
          focus: vi.fn(),
          clear: vi.fn(),
          selectAll: vi.fn(),
          getSelection: vi.fn(() => ''),
          write: vi.fn(),
          dimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
        })
        return () => h('div', {
          'data-testid': 'terminal-surface',
          'data-active': props.active ? 'true' : 'false',
          'data-pty-id': props.ptyId == null ? '' : String(props.ptyId),
        })
      },
    }),
  }
})

async function flushUi() {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve()
    await nextTick()
  }
}

describe('TerminalPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let call: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    call = vi.fn(async (tool: string) => {
      if (tool === 'terminal.spawn') return { id: 123 }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call,
        ptyWrite: vi.fn(),
      },
    })
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.restoreAllMocks()
  })

  it('pushes the spawned pty id through to the active surface immediately', async () => {
    app = createApp(TerminalPanel, { active: true })
    app.mount(root)

    await flushUi()

    expect(call).toHaveBeenCalledWith('terminal.spawn', { cols: 80, rows: 24 })
    const surface = root.querySelector('[data-testid="terminal-surface"]')
    expect(surface?.getAttribute('data-pty-id')).toBe('123')
  })
})
