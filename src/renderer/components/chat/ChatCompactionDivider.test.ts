// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import ChatCompactionDivider from './ChatCompactionDivider.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

function mountDivider() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(ChatCompactionDivider, {
    record: {
      id: 'cmp_1',
      summary: 'Goal: keep the session alive.\nOpen: verify the UI marker.',
      createdAt: '2026-07-09T12:00:00.000Z',
    },
  })
  app.mount(root)
  return { app, root }
}

describe('ChatCompactionDivider', () => {
  let mounted: ReturnType<typeof mountDivider> | null = null

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
  })

  it('renders a compact marker without exposing the summary by default', () => {
    mounted = mountDivider()

    expect(mounted.root.textContent).toContain('Context compacted')
    expect(mounted.root.textContent).toContain('Earlier messages were summarized for the model.')
    expect(mounted.root.textContent).not.toContain('keep the session alive')
    expect(mounted.root.querySelector('[data-testid="chat-compaction-summary"]')).toBeNull()
  })

  it('expands and collapses the historical summary', async () => {
    mounted = mountDivider()
    const button = mounted.root.querySelector<HTMLButtonElement>('button')!

    expect(button.getAttribute('aria-expanded')).toBe('false')
    button.click()
    await flushUi()

    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(mounted.root.textContent).toContain('Goal: keep the session alive.')
    expect(mounted.root.textContent).toContain('Open: verify the UI marker.')

    button.click()
    await flushUi()

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(mounted.root.textContent).not.toContain('keep the session alive')
  })
})
