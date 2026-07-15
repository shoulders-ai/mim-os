// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import ChatTurnStatus from './ChatTurnStatus.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

function mountStatus(props: Record<string, unknown>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(ChatTurnStatus, props)
  app.mount(root)
  return { app, root }
}

describe('ChatTurnStatus', () => {
  let mounted: ReturnType<typeof mountStatus> | null = null

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
  })

  it('renders the pre-stream context check as a live status row', async () => {
    mounted = mountStatus({ kind: 'compact', phase: 'checking' })
    await flushUi()

    expect(mounted.root.querySelector('[role="status"]')).toBeTruthy()
    expect(mounted.root.textContent).toContain('Checking context before replying')
    expect(mounted.root.textContent).toContain('Mim will summarize older messages if this turn needs it.')
  })

  it('renders the summarizing state with the transcript visibility promise', async () => {
    mounted = mountStatus({ kind: 'compact', phase: 'summarizing' })
    await flushUi()

    expect(mounted.root.textContent).toContain('Summarizing earlier messages before replying')
    expect(mounted.root.textContent).toContain('Full transcript stays visible.')
  })

  it('explains a large first message without claiming compaction happened', async () => {
    mounted = mountStatus({ kind: 'large-first-turn', phase: 'summarizing' })
    await flushUi()

    expect(mounted.root.textContent).toContain('Sending large message')
    expect(mounted.root.textContent).toContain('There is no earlier chat history to summarize yet.')
  })
})
