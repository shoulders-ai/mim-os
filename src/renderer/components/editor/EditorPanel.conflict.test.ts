// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createPinia } from 'pinia'

const editorHarness = vi.hoisted(() => ({
  views: [] as any[],
}))

vi.mock('@codemirror/state', () => ({
  Prec: { highest: (value: unknown) => value },
  StateEffect: {
    define: vi.fn((spec: Record<string, unknown> = {}) => {
      const effectType: any = {
        ...spec,
        of: vi.fn((value: unknown) => ({ value, is: (other: unknown) => other === effectType })),
      }
      return effectType
    }),
  },
  StateField: { define: vi.fn((spec: unknown) => spec) },
}))

vi.mock('@codemirror/view', () => {
  const decorationSet = (ranges: unknown[] = []) => ({ ranges, map: vi.fn(() => decorationSet(ranges)) })
  const none = decorationSet()
  return {
    keymap: { of: (bindings: unknown) => bindings },
    Decoration: {
      none,
      mark: vi.fn(() => ({ range: vi.fn((from: number, to: number) => ({ from, to })) })),
      set: vi.fn((ranges: unknown[]) => decorationSet(ranges)),
    },
    EditorView: {
      lineWrapping: {},
      contentAttributes: { of: (attrs: unknown) => attrs },
      decorations: { from: vi.fn((field: unknown) => field) },
      theme: vi.fn(() => []),
    },
  }
})

vi.mock('./codemirror/core.js', () => ({
  createEditor: vi.fn(({ doc, onChange, onStats, onActiveFormats }) => {
    let text = String(doc ?? '')
    function makeState() {
      const s = {} as any
      Object.defineProperty(s, 'doc', {
        get() {
          return { length: text.length, toString: () => text }
        },
      })
      return s
    }
    let currentState = makeState()
    const view = {
      get state() { return currentState },
      focus: vi.fn(),
      destroy: vi.fn(),
      dispatch: vi.fn((update: { changes?: { from: number; to: number; insert: string } }) => {
        if (!update?.changes) return
        const { from, to, insert } = update.changes
        text = text.slice(0, from) + insert + text.slice(to)
        currentState = makeState()
        onChange?.({ state: currentState })
      }),
      setState: vi.fn((newState: any) => {
        currentState = newState
        if (newState?.doc?.toString) text = newState.doc.toString()
      }),
    }
    editorHarness.views.push(view)
    onStats?.({ words: 0, characters: text.length })
    onActiveFormats?.([])
    return view
  }),
  createEditorState: vi.fn(({ doc }: { doc?: string }) => {
    const text = String(doc ?? '')
    return { doc: { length: text.length, toString: () => text } }
  }),
  computeStats: vi.fn((state: { doc: { toString: () => string } }) => {
    const text = state.doc.toString()
    return { words: text.trim() ? text.trim().split(/\s+/).length : 0, characters: text.length }
  }),
  computeSelectionStats: vi.fn(() => null),
  editorSettingsEffects: vi.fn(() => []),
  wrapCompartment: { reconfigure: vi.fn() },
  spellcheckCompartment: { reconfigure: vi.fn() },
  lineNumbersCompartment: { reconfigure: vi.fn() },
  languageCompartment: { reconfigure: vi.fn(() => []) },
  lineNumbers: vi.fn(() => []),
}))

vi.mock('./codemirror/language.js', () => ({
  isMarkdownPath: vi.fn(() => true),
  languageExtensionForPath: vi.fn(async () => []),
}))
vi.mock('./codemirror/livePreview.js', () => ({ livePreviewExtension: vi.fn(() => []) }))
vi.mock('./codemirror/outline.js', () => ({ outlineExtension: vi.fn(() => []) }))
vi.mock('./codemirror/ghost.js', () => ({ ghostExtension: vi.fn(() => []) }))
vi.mock('./codemirror/citations.js', () => ({ citationExtensions: vi.fn(() => []) }))
vi.mock('./codemirror/comments.js', () => ({
  commentMutation: { of: vi.fn((value: unknown) => ({ type: 'commentMutation', value })) },
  commentsExtension: vi.fn(() => []),
  getCommentState: vi.fn(() => ({ threads: [] })),
  setActiveComment: { of: vi.fn((value: unknown) => ({ type: 'setActiveComment', value })) },
}))
vi.mock('./codemirror/formatting.js', () => ({
  toggleBold: vi.fn(),
  toggleItalic: vi.fn(),
  toggleCode: vi.fn(),
  toggleStrikethrough: vi.fn(),
  toggleHeading: vi.fn(),
  toggleBulletList: vi.fn(),
  toggleNumberedList: vi.fn(),
  toggleCheckbox: vi.fn(),
  toggleBlockquote: vi.fn(),
  insertLink: vi.fn(),
  insertImage: vi.fn(),
  insertHorizontalRule: vi.fn(),
  insertCitation: vi.fn(),
}))

vi.mock('../../services/ai/ghost.js', () => ({ requestGhostSuggestions: vi.fn() }))
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

// ConflictBar: render with data-testid and emit events on method calls for testing
vi.mock('./ConflictBar.vue', () => ({
  default: defineComponent({
    name: 'ConflictBarStub',
    props: ['externalState'],
    emits: ['reload', 'overwrite', 'compare'],
    setup(props) {
      return () => h('div', { 'data-testid': 'conflict-bar', 'data-external-state': props.externalState }, `conflict:${props.externalState}`)
    },
  }),
}))

const { default: EditorPanel } = await import('./EditorPanel.vue')

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function mountPanel(handlers: Record<string, unknown> = {}) {
  const panelRef = ref<any>(null)
  const app = createApp({
    setup() {
      return () => h(EditorPanel, { ref: panelRef, ...handlers })
    },
  })
  app.use(createPinia())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root, panelRef }
}

describe('EditorPanel conflict bar', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null
  let kernelCall: ReturnType<typeof vi.fn>
  let saveFileDialog: ReturnType<typeof vi.fn>
  let fileContents: Record<string, string>
  let kernelListeners: Map<string, Set<(...args: unknown[]) => void>>

  function fileResult(path: string, content: string) {
    const hash = `hash:${content}`
    return {
      path,
      content,
      hash,
      version: {
        hash,
        size: content.length,
        mtimeMs: content.length + 100,
      },
    }
  }

  function emitKernel(channel: string, ...args: unknown[]) {
    for (const listener of kernelListeners.get(channel) ?? []) listener(...args)
  }

  beforeEach(() => {
    editorHarness.views.length = 0
    fileContents = {
      'docs/existing.md': 'original content',
    }
    kernelListeners = new Map()
    kernelCall = vi.fn(async (tool: string, params: Record<string, unknown>) => {
      if (tool === 'fs.read') {
        const path = String(params.path)
        return fileResult(path, fileContents[path] ?? '')
      }
      if (tool === 'fs.write') {
        const path = String(params.path)
        const content = String(params.content)
        fileContents[path] = content
        return {
          written: path,
          hash: `hash:${content}`,
          version: {
            hash: `hash:${content}`,
            size: content.length,
            mtimeMs: content.length + 100,
          },
        }
      }
      if (tool === 'settings.set') return { ok: true }
      return {}
    })
    saveFileDialog = vi.fn(async () => null)
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call: kernelCall,
        getWorkspace: vi.fn(async () => '/workspace'),
        saveFileDialog,
        pushDirtyTabCount: vi.fn(),
        on: vi.fn((channel: string, cb: (...args: unknown[]) => void) => {
          if (!kernelListeners.has(channel)) kernelListeners.set(channel, new Set())
          kernelListeners.get(channel)!.add(cb)
        }),
        off: vi.fn((channel: string, cb: (...args: unknown[]) => void) => {
          kernelListeners.get(channel)?.delete(cb)
        }),
      },
    })
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    vi.restoreAllMocks()
  })

  it('shows a conflict bar when the active tab has externalState "changed"', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()

    // Make a local edit to make it dirty
    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' edited' } })
    await flushUi()

    // Simulate external change on disk
    fileContents['docs/existing.md'] = 'disk edit'
    emitKernel('workspace:files-changed', {
      paths: ['docs/existing.md'],
      changes: [{ path: 'docs/existing.md', kind: 'change' }],
    })
    await flushUi()

    // Conflict bar should be visible
    const conflictBar = mounted.root.querySelector('[data-testid="conflict-bar"]')
    expect(conflictBar).not.toBeNull()
    expect(conflictBar?.getAttribute('data-external-state')).toBe('changed')
  })

  it('shows a conflict bar when the active tab has externalState "deleted"', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()

    // Make a local edit
    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' edited' } })
    await flushUi()

    // Simulate file deleted on disk
    emitKernel('workspace:files-changed', {
      changes: [{ path: 'docs/existing.md', kind: 'unlink' }],
    })
    await flushUi()

    const conflictBar = mounted.root.querySelector('[data-testid="conflict-bar"]')
    expect(conflictBar).not.toBeNull()
    expect(conflictBar?.getAttribute('data-external-state')).toBe('deleted')
  })

  it('Cmd+S while in conflict surfaces a toast explaining why it did not save', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()

    // Make a local edit
    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' local' } })
    await flushUi()

    // Simulate external change
    fileContents['docs/existing.md'] = 'external edit'
    emitKernel('workspace:files-changed', {
      paths: ['docs/existing.md'],
      changes: [{ path: 'docs/existing.md', kind: 'change' }],
    })
    await flushUi()

    // Try to save — should be blocked and push a toast
    const { useToastStore } = await import('../../stores/toasts.js')
    const toastStore = useToastStore()
    const before = toastStore.list.length

    const saved = await mounted.panelRef.value.saveActiveFile()
    expect(saved).toBe(false)
    expect(toastStore.list.length).toBe(before + 1)
    expect(toastStore.list[toastStore.list.length - 1].message).toBe('Save blocked')
  })
})
