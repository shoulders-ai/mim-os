// @vitest-environment happy-dom

// Editor settings integration test with REAL CodeMirror (no core.js mock):
// toggling line numbers / spell check in the settings store must take effect
// on the live editor immediately — no reload — and survive tab switches.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../../stores/settings.js'

vi.mock('../../services/ai/ghost.js', () => ({ requestGhostSuggestions: vi.fn(async () => null) }))
vi.mock('./codemirror/livePreview.js', () => ({ livePreviewExtension: vi.fn(() => []) }))
vi.mock('./codemirror/outline.js', () => ({ outlineExtension: vi.fn(() => []) }))
vi.mock('./codemirror/ghost.js', () => ({ ghostExtension: vi.fn(() => []) }))
vi.mock('./codemirror/citations.js', () => ({ citationExtensions: vi.fn(() => []) }))
vi.mock('../../services/currentDocument.js', () => ({
  notifyCurrentDocumentChanged: vi.fn(),
  registerCurrentDocumentProvider: vi.fn(() => vi.fn()),
}))

function stubComponent(name: string) {
  return defineComponent({ name, setup: () => () => h('div') })
}
vi.mock('./EditorTabStrip.vue', () => ({ default: stubComponent('EditorTabStripStub') }))
vi.mock('./EditorToolbar.vue', () => ({ default: stubComponent('EditorToolbarStub') }))
vi.mock('./PreviewPane.vue', () => ({ default: stubComponent('PreviewPaneStub') }))
vi.mock('./InlineAI.vue', () => ({ default: stubComponent('InlineAIStub') }))
vi.mock('./DiffReviewBar.vue', () => ({ default: stubComponent('DiffReviewBarStub') }))
vi.mock('./DiffView.vue', () => ({
  default: defineComponent({
    name: 'DiffViewStub',
    setup(_props, { expose }) {
      expose({ getResolvedContent: () => '' })
      return () => h('div')
    },
  }),
}))
vi.mock('./BatchDiffView.vue', () => ({ default: stubComponent('BatchDiffViewStub') }))
vi.mock('./ConflictBar.vue', () => ({ default: stubComponent('ConflictBarStub') }))

const { default: EditorPanel } = await import('./EditorPanel.vue')

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('EditorPanel live settings (real CodeMirror)', () => {
  let app: ReturnType<typeof createApp> | null = null
  let root: HTMLElement
  let panelRef: ReturnType<typeof ref<any>>
  let fileContents: Record<string, string>

  beforeEach(() => {
    setActivePinia(createPinia())
    fileContents = { 'docs/a.md': 'alpha doc', 'docs/b.md': 'beta doc' }
    const kernelCall = vi.fn(async (tool: string, params: Record<string, unknown> = {}) => {
      if (tool === 'fs.read') {
        const path = String(params.path)
        const content = fileContents[path] ?? ''
        const hash = `hash:${path}`
        return {
          path, content, hash, truncated: false, total_chars: content.length,
          version: { hash, size: content.length, mtimeMs: 1 },
        }
      }
      if (tool === 'settings.set') return { ok: true }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call: kernelCall,
        getWorkspace: vi.fn(async () => '/workspace'),
        saveFileDialog: vi.fn(async () => null),
        watchWorkspaceFile: vi.fn(async () => ({ watching: true })),
        unwatchWorkspaceFile: vi.fn(async () => ({ unwatched: true })),
        pushDirtyTabCount: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    })

    panelRef = ref<any>(null)
    app = createApp({ setup: () => () => h(EditorPanel, { ref: panelRef }) })
    root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  function gutter() {
    return root.querySelector('.cm-gutter.cm-lineNumbers')
  }
  function contentSpellcheck() {
    return root.querySelector('.cm-content')?.getAttribute('spellcheck')
  }

  it('applies line numbers and spell check to the open editor without a reload', async () => {
    await flushUi()
    await panelRef.value.openFile('docs/a.md')
    await flushUi()

    expect(root.querySelector('.cm-content')).toBeTruthy()
    expect(gutter()).toBeNull()
    expect(contentSpellcheck()).not.toBe('true')

    const store = useSettingsStore()
    store.editorLineNumbers = true
    store.editorSpellCheck = true
    await flushUi()

    expect(gutter()).toBeTruthy()
    expect(contentSpellcheck()).toBe('true')

    store.editorLineNumbers = false
    await flushUi()
    expect(gutter()).toBeNull()
  })

  it('keeps toggled settings when switching to a tab opened before the toggle', async () => {
    await flushUi()
    await panelRef.value.openFile('docs/a.md')
    await flushUi()
    await panelRef.value.openFile('docs/b.md')
    await flushUi()

    const store = useSettingsStore()
    store.editorLineNumbers = true
    await flushUi()
    expect(gutter()).toBeTruthy()

    // Tab a was opened (and its state cached) while line numbers were off.
    panelRef.value.onSelectTab?.(0)
    await flushUi()
    expect(gutter()).toBeTruthy()
  })
})
