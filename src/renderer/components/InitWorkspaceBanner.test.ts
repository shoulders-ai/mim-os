// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import InitWorkspaceBanner from './InitWorkspaceBanner.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mount(props: { missing: string[] }, handlers: Record<string, unknown> = {}) {
  const app = createApp(InitWorkspaceBanner, { ...props, ...handlers })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root }
}

describe('InitWorkspaceBanner', () => {
  let mounted: ReturnType<typeof mount> | null = null

  beforeEach(() => { mounted = null })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
  })

  it('renders a concise uninitialized workspace hint', async () => {
    mounted = mount({ missing: ['mim.yaml', 'AGENTS.md', 'CLAUDE.md'] })
    await flushUi()
    const text = mounted.root.textContent ?? ''
    expect(text).toContain('Workspace not initialized')
    expect(text).not.toContain('mim.yaml')
    expect(text).not.toContain('AGENTS.md')
    expect(text).not.toContain('CLAUDE.md')
  })

  it('emits initialize exactly once when the Initialize button is clicked', async () => {
    const initialize = vi.fn()
    mounted = mount({ missing: ['mim.yaml'] }, { onInitialize: initialize })
    await flushUi()

    const button = [...mounted.root.querySelectorAll('button')]
      .find(b => /initialize/i.test(b.textContent ?? ''))
    expect(button).toBeTruthy()
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushUi()

    expect(initialize).toHaveBeenCalledTimes(1)
  })
})
