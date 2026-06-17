// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import PaneRecoveryState from './PaneRecoveryState.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

describe('PaneRecoveryState', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null

  afterEach(() => {
    app?.unmount()
    app = null
    root?.remove()
    vi.restoreAllMocks()
  })

  it('renders pane-local error copy and recovery actions', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    const onRetry = vi.fn()
    const onBack = vi.fn()
    const onRemove = vi.fn()
    const onDismiss = vi.fn()

    app = createApp({
      render: () => h(PaneRecoveryState, {
        pane: 'artifact',
        error: new Error('File disappeared'),
        canBack: true,
        canRemove: true,
        onRetry,
        onBack,
        onRemove,
        onDismiss,
      }),
    })
    app.mount(root)
    await flushUi()

    expect(root.querySelector('[data-pane-recovery="artifact"]')).toBeTruthy()
    expect(root.textContent).toContain('Artifact failed to open')
    expect(root.textContent).toContain('File disappeared')

    ;(root.querySelector('button[title="Retry"]') as HTMLButtonElement).click()
    ;(root.querySelector('button[title="Go back"]') as HTMLButtonElement).click()
    ;(root.querySelector('button[title="Remove from history"]') as HTMLButtonElement).click()
    ;(root.querySelector('button[title="Dismiss"]') as HTMLButtonElement).click()

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onBack).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
