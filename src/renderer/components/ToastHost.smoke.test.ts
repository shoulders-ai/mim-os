// @vitest-environment happy-dom

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { useToastStore } from '../stores/toasts.js'

vi.mock('@tabler/icons-vue', () => ({
  IconX: { name: 'IconX', render: () => h('span', 'x') },
  IconAlertTriangle: { name: 'IconAlertTriangle', render: () => h('span', '!') },
  IconInfoCircle: { name: 'IconInfoCircle', render: () => h('span', 'i') },
}))

const { default: ToastHost } = await import('./ToastHost.vue')

function mount() {
  const pinia = createPinia()
  const app = createApp({ render: () => h(ToastHost) })
  app.use(pinia)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root, pinia }
}

describe('ToastHost', () => {
  let mounted: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    vi.useRealTimers()
  })

  it('renders nothing when no toasts are present', async () => {
    mounted = mount()
    await nextTick()
    expect(document.querySelector('[data-testid="toast-host"]')).toBeNull()
  })

  it('renders an error toast', async () => {
    mounted = mount()
    const store = useToastStore()
    store.push({ kind: 'error', message: 'Write failed', detail: 'EACCES' })
    await nextTick()
    const host = document.querySelector('[data-testid="toast-host"]')
    expect(host).not.toBeNull()
    expect(host!.textContent).toContain('Write failed')
    expect(host!.textContent).toContain('EACCES')
    const errorToast = document.querySelector('[data-testid="toast-error"]')
    expect(errorToast).not.toBeNull()
  })

  it('renders an info toast', async () => {
    mounted = mount()
    const store = useToastStore()
    store.push({ kind: 'info', message: 'File reloaded' })
    await nextTick()
    const infoToast = document.querySelector('[data-testid="toast-info"]')
    expect(infoToast).not.toBeNull()
    expect(infoToast!.textContent).toContain('File reloaded')
  })

  it('dismiss button removes a toast', async () => {
    mounted = mount()
    const store = useToastStore()
    store.push({ kind: 'error', message: 'Oops' })
    await nextTick()
    const btn = document.querySelector('[data-testid="toast-error"] button')
    expect(btn).not.toBeNull()
    ;(btn as HTMLButtonElement).click()
    await nextTick()
    expect(document.querySelector('[data-testid="toast-host"]')).toBeNull()
  })

  it('auto-dismisses after timeout', async () => {
    mounted = mount()
    const store = useToastStore()
    store.push({ kind: 'info', message: 'Bye' })
    await nextTick()
    expect(document.querySelector('[data-testid="toast-host"]')).not.toBeNull()
    vi.advanceTimersByTime(6000)
    await nextTick()
    expect(document.querySelector('[data-testid="toast-host"]')).toBeNull()
  })
})
