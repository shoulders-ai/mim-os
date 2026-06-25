// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../../stores/settings.js'
import { useEditorSettingsEffects } from './useEditorSettingsEffects.js'

vi.mock('./codemirror/core.js', () => ({
  editorSettingsEffects: vi.fn(() => []),
}))

const { editorSettingsEffects } = await import('./codemirror/core.js')

async function flushWatchers() {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
}

describe('useEditorSettingsEffects', () => {
  let app: ReturnType<typeof createApp> | null = null
  let root: HTMLElement
  let mockDispatch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    mockDispatch = vi.fn()
    root = document.createElement('div')
    document.body.appendChild(root)

    const container = ref<HTMLElement>(root)
    const mockView = { dispatch: mockDispatch }

    app = createApp(defineComponent({
      setup() {
        const store = useSettingsStore()
        useEditorSettingsEffects({
          settingsStore: store,
          editorContainer: container,
          getEditorView: () => mockView,
        })
        return () => h('div')
      },
    }))
    app.mount(root)
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.clearAllMocks()
  })

  it('dispatches when editorLivePreview changes', async () => {
    const store = useSettingsStore()
    mockDispatch.mockClear()
    ;(editorSettingsEffects as ReturnType<typeof vi.fn>).mockClear()

    store.editorLivePreview = false
    await flushWatchers()

    expect(editorSettingsEffects).toHaveBeenCalled()
    expect(mockDispatch).toHaveBeenCalledWith({ effects: [] })
  })

  it('dispatches when editorWordWrap changes', async () => {
    const store = useSettingsStore()
    mockDispatch.mockClear()

    store.editorWordWrap = false
    await flushWatchers()

    expect(mockDispatch).toHaveBeenCalled()
  })

  it('dispatches when editorSpellCheck changes', async () => {
    const store = useSettingsStore()
    mockDispatch.mockClear()

    store.editorSpellCheck = true
    await flushWatchers()

    expect(mockDispatch).toHaveBeenCalled()
  })

  it('dispatches when editorLineNumbers changes', async () => {
    const store = useSettingsStore()
    mockDispatch.mockClear()

    store.editorLineNumbers = true
    await flushWatchers()

    expect(mockDispatch).toHaveBeenCalled()
  })
})
