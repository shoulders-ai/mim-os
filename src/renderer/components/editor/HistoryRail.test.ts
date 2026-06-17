// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import HistoryRail from './HistoryRail.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await vi.runOnlyPendingTimersAsync()
  await nextTick()
}

function mountRail(props: Record<string, unknown>, handlers: Record<string, unknown> = {}) {
  const root = document.createElement('div')
  const railRef = ref<unknown>(null)
  document.body.appendChild(root)
  const app = createApp({
    setup() {
      return () => h(HistoryRail, { ref: railRef, ...props, ...handlers })
    },
  })
  app.mount(root)
  return { app, root }
}

describe('HistoryRail', () => {
  let kernelCall: ReturnType<typeof vi.fn>
  let openNativeFile: ReturnType<typeof vi.fn>
  let mounted: ReturnType<typeof mountRail> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
    kernelCall = vi.fn(async (tool: string, params: Record<string, unknown>) => {
      if (tool === 'history.list') {
        return {
          path: params.path,
          current: {
            bytes: 18,
            deleted: false,
            kind: 'text',
            modifiedAt: '2026-06-14T11:58:00Z',
          },
          versions: [
            {
              id: 'v-old',
              path: params.path,
              at: '2026-06-14T11:30:00Z',
              actor: 'user',
              event: 'save',
              kind: 'text',
              bytes: 10,
              deleted: false,
              anchor: false,
            },
            {
              id: 'v-binary',
              path: params.path,
              at: '2026-06-14T10:00:00Z',
              actor: 'external',
              event: 'external',
              kind: 'binary',
              bytes: 4096,
              deleted: false,
              anchor: false,
            },
          ],
          totalVersions: 2,
          foldedCount: 12,
        }
      }
      if (tool === 'history.preview') {
        return { kind: 'text', content: 'one\nthree', bytes: 9, deleted: false }
      }
      if (tool === 'history.openVersion') return { path: '/tmp/history-copy.bin' }
      return {}
    })
    openNativeFile = vi.fn()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call: kernelCall, openNativeFile },
    })
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('clicks a text save to emit an editor preview instead of expanding or opening it', async () => {
    const onPreview = vi.fn()
    const onShowCurrent = vi.fn()
    mounted = mountRail(
      {
        path: 'docs/note.md',
        currentText: 'one\ntwo\nthree',
      },
      {
        onPreview,
        onShowCurrent,
      },
    )
    await flushUi()

    expect(mounted.root.textContent).toContain('30 minutes ago')
    expect(mounted.root.textContent).toContain('+1')
    expect(mounted.root.textContent).toContain('-0')
    expect(mounted.root.textContent).toContain('Show older saves')
    expect(mounted.root.textContent).not.toContain('Restore')
    expect(mounted.root.textContent).not.toContain('one\nthree')

    const row = mounted.root.querySelector('[data-testid="history-version-row-v-old"]') as HTMLButtonElement
    row.click()
    await flushUi()

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
      path: 'docs/note.md',
      versionId: 'v-old',
      content: 'one\nthree',
      added: 1,
      removed: 0,
    }))
    expect(kernelCall.mock.calls.some(([tool]) => tool === 'history.openVersion')).toBe(false)
    expect(openNativeFile).not.toHaveBeenCalled()

    const current = mounted.root.querySelector('[data-testid="history-current-row"]') as HTMLButtonElement
    current.click()
    await flushUi()
    expect(onShowCurrent).toHaveBeenCalled()
  })

  it('keeps binary history rows out of text preview and opens only a temporary copy', async () => {
    const onPreview = vi.fn()
    mounted = mountRail(
      {
        path: 'docs/note.md',
        currentText: 'one\ntwo\nthree',
      },
      { onPreview },
    )
    await flushUi()

    const previewCallsBefore = kernelCall.mock.calls.filter(([tool]) => tool === 'history.preview').length
    const binaryRow = mounted.root.querySelector('[data-testid="history-version-row-v-binary"]') as HTMLButtonElement
    binaryRow.click()
    await flushUi()

    expect(onPreview).not.toHaveBeenCalled()
    expect(kernelCall.mock.calls.filter(([tool]) => tool === 'history.preview')).toHaveLength(previewCallsBefore)

    const openCopy = Array.from(mounted.root.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Open copy')) as HTMLButtonElement
    openCopy.click()
    await flushUi()

    expect(kernelCall).toHaveBeenCalledWith('history.openVersion', {
      path: 'docs/note.md',
      version_id: 'v-binary',
    })
    expect(openNativeFile).toHaveBeenCalledWith('/tmp/history-copy.bin')
  })
})
