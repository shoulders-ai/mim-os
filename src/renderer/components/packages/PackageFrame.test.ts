// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PackageFrame from './PackageFrame.vue'

async function flushUi() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('PackageFrame', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        getPackageLaunchUrl: vi.fn().mockResolvedValue('http://127.0.0.1:1234/packages/demo/index.html?launch=tok'),
        call: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    })
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('appends the current theme tokens to the launch URL fragment', async () => {
    document.documentElement.style.setProperty('--color-surface', '#101010')

    app = createApp(PackageFrame, { packageId: 'demo', viewId: 'main', port: 1234 })
    app.use(createPinia())
    app.mount(root)
    await flushUi()

    const iframe = root.querySelector('iframe')
    expect(iframe).not.toBeNull()
    const src = iframe!.getAttribute('src') ?? ''
    expect(src.startsWith('http://127.0.0.1:1234/packages/demo/index.html?launch=tok#mim-theme=')).toBe(true)

    const fragment = decodeURIComponent(src.split('#mim-theme=')[1])
    expect(JSON.parse(fragment)['--color-surface']).toBe('#101010')

    document.documentElement.style.removeProperty('--color-surface')
  })
})
