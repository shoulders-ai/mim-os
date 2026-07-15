// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import ContextDonut from './ContextDonut.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountDonut(props = {}, listeners = {}) {
  const app = createApp(ContextDonut, {
    ...props,
    ...listeners,
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root }
}

describe('ContextDonut', () => {
  let mounted: ReturnType<typeof mountDonut> | null = null

  beforeEach(() => {
    mounted = null
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
  })

  it('renders the track without a fill arc at zero percent', async () => {
    mounted = mountDonut({ percent: 0, size: 16, tokenCount: 0, contextWindow: 200000 })
    await flushUi()

    expect(mounted.root.querySelector('svg')).toBeTruthy()
    expect(mounted.root.querySelectorAll('circle')).toHaveLength(1)
    expect(mounted.root.textContent).toContain('Context: 0 / 200k (0%)')
  })

  it('renders a styled tooltip with context and cost', async () => {
    mounted = mountDonut({
      percent: 0.25,
      size: 16,
      tokenCount: 50000,
      contextWindow: 200000,
      costLabel: '$0.42',
    })
    await flushUi()

    const circles = mounted.root.querySelectorAll('circle')
    expect(circles).toHaveLength(2)
    expect(mounted.root.textContent).toContain('Context: 50k / 200k (25%)')
    expect(mounted.root.textContent).toContain('Cost: $0.42')
    expect(mounted.root.querySelector('[aria-label]')?.getAttribute('aria-label')).toContain('Cost: $0.42')
    const exposedText = [
      mounted.root.textContent,
      mounted.root.querySelector('[aria-label]')?.getAttribute('aria-label'),
    ].join('\n')
    expect(exposedText).not.toMatch(/last turn|billed|across \d+ calls|cache/i)
  })

  it('colors the fill by usage threshold', async () => {
    mounted = mountDonut({ percent: 0.9, size: 16, tokenCount: 180000, contextWindow: 200000 })
    await flushUi()

    const fill = mounted.root.querySelectorAll('circle')[1]
    expect(fill.getAttribute('stroke')).toBe('currentColor')
    expect(fill.classList.contains('text-rem')).toBe(true)
  })

  it('keeps the high-context tooltip informational instead of opening a fresh thread', async () => {
    mounted = mountDonut({ percent: 0.87, size: 16, tokenCount: 174000, contextWindow: 200000 })
    await flushUi()

    expect(mounted.root.textContent).toContain('Context: 174k / 200k (87%)')
    expect(mounted.root.textContent).toContain('Checks each turn and summarizes older messages when needed.')
    expect(mounted.root.querySelector('button')).toBeNull()
    expect(mounted.root.textContent).not.toContain('Start fresh')
  })

  it('shows when the displayed context is compacted', async () => {
    mounted = mountDonut({
      percent: 0.54,
      size: 16,
      tokenCount: 2700,
      contextWindow: 5000,
      compacted: true,
      compactionTokensBefore: 30000,
      compactionTokensAfter: 2700,
    })
    await flushUi()

    expect(mounted.root.textContent).toContain('Context: 3k / 5k (54%)')
    expect(mounted.root.textContent).toContain('Using compacted context: 3k from 30k')
    expect(mounted.root.textContent).toContain('Full chat stays visible.')
    expect(mounted.root.querySelector('[aria-label]')?.getAttribute('aria-label')).toContain('Using compacted context')
  })

  it('does not render an action button below 85%', async () => {
    mounted = mountDonut({ percent: 0.5, size: 16, tokenCount: 100000, contextWindow: 200000 })
    await flushUi()
    const button = mounted.root.querySelector('button')
    expect(button).toBeFalsy()
  })
})
