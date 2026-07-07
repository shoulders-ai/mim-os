// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createPinia } from 'pinia'
import { useToastStore } from '../../stores/toasts.js'

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
      const state = {} as any
      Object.defineProperty(state, 'doc', {
        get() {
          return { length: text.length, toString: () => text }
        },
      })
      return state
    }
    let currentState = makeState()
    const view = {
      get state() { return currentState },
      focus: vi.fn(),
      destroy: vi.fn(),
      scrollSnapshot: vi.fn(() => ({ type: 'scroll-snapshot', text })),
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
  isMarkdownPath: vi.fn((path: string) => path.endsWith('.md') || path === ''),
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

vi.mock('./EditorToolbar.vue', () => ({ default: stubComponent('EditorToolbarStub') }))
vi.mock('./ExportDialog.vue', () => ({ default: stubComponent('ExportDialogStub') }))
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
vi.mock('./comments/CommentsMargin.vue', () => ({ default: stubComponent('CommentsMarginStub') }))
vi.mock('../ui/MimContextMenu.vue', () => ({ default: stubComponent('MimContextMenuStub') }))
vi.mock('../ui/MimMenuItem.vue', () => ({ default: stubComponent('MimMenuItemStub') }))
vi.mock('../files/PdfArtifact.vue', () => ({ default: stubComponent('PdfArtifactStub') }))
vi.mock('../files/FileCardArtifact.vue', () => ({ default: stubComponent('FileCardArtifactStub') }))
vi.mock('../files/TableArtifact.vue', () => ({ default: stubComponent('TableArtifactStub') }))

const { default: EditorPanel } = await import('./EditorPanel.vue')

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function mountPanel(props: Record<string, unknown> = {}) {
  const panelRef = ref<any>(null)
  const app = createApp({
    setup() {
      return () => h(EditorPanel, { ref: panelRef, port: 9234, ...props })
    },
  })
  const pinia = createPinia()
  app.use(pinia)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root, panelRef, pinia }
}

describe('EditorPanel pop-out transfer', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null
  let kernelCall: ReturnType<typeof vi.fn>
  let popoutOpenWithTab: ReturnType<typeof vi.fn>
  let popoutReturnTab: ReturnType<typeof vi.fn>
  let fileContents: Record<string, string>
  let tabPersistenceReads: number

  function fileResult(path: string, content: string) {
    const hash = `hash:${content}`
    return {
      path,
      content,
      hash,
      version: { hash, size: content.length, mtimeMs: content.length + 100 },
    }
  }

  beforeEach(() => {
    editorHarness.views.length = 0
    tabPersistenceReads = 0
    fileContents = { 'docs/a.md': '# A' }
    popoutOpenWithTab = vi.fn(async () => ({ ok: true }))
    popoutReturnTab = vi.fn(async () => ({ ok: true }))
    kernelCall = vi.fn(async (tool: string, params: Record<string, unknown> = {}) => {
      if (tool === 'references.readBib') return { exists: false, references: [] }
      if (tool === 'fs.read') {
        const path = String(params.path)
        if (path === '.mim/editor-tabs.json') {
          tabPersistenceReads += 1
          throw new Error('no persisted tabs')
        }
        return fileResult(path, fileContents[path] ?? '')
      }
      if (tool === 'fs.write') return { ok: true }
      if (tool === 'settings.set') return { ok: true }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call: kernelCall,
        getWorkspace: vi.fn(async () => '/workspace'),
        saveFileDialog: vi.fn(),
        watchWorkspaceFile: vi.fn(async () => ({ watching: true })),
        unwatchWorkspaceFile: vi.fn(async () => ({ unwatched: true })),
        pushDirtyTabCount: vi.fn(),
        popoutOpenWithTab,
        popoutReturnTab,
        on: vi.fn(),
        off: vi.fn(),
      },
    })
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
    vi.restoreAllMocks()
  })

  function popoutButton() {
    return mounted!.root.querySelector('[data-testid="editor-popout-button"]') as HTMLButtonElement | null
  }

  function tabNames() {
    return Array.from(mounted!.root.querySelectorAll('.etab')).map(el =>
      el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    )
  }

  async function makeActiveTabDirty(insert: string) {
    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: 0, to: 0, insert } })
    await flushUi()
  }

  it('shows no pop-out button without an open tab', async () => {
    mounted = mountPanel()
    await flushUi()
    expect(popoutButton()).toBeNull()
  })

  it('renders the move-to-new-window button in main role', async () => {
    mounted = mountPanel()
    await flushUi()
    await mounted.panelRef.value.openFile('docs/a.md')
    await flushUi()

    const btn = popoutButton()
    expect(btn).not.toBeNull()
    expect(btn!.getAttribute('title')).toBe('Move tab to new window')
  })

  it('renders the move-to-main-window variant in popout role', async () => {
    mounted = mountPanel({ windowRole: 'popout' })
    await flushUi()
    await mounted.panelRef.value.openFile('docs/a.md')
    await flushUi()

    const btn = popoutButton()
    expect(btn).not.toBeNull()
    expect(btn!.getAttribute('title')).toBe('Move tab to main window')
  })

  it('serializes a dirty tab with baseline and closes it after a successful pop-out', async () => {
    mounted = mountPanel()
    await flushUi()
    await mounted.panelRef.value.openFile('docs/a.md')
    await flushUi()
    await makeActiveTabDirty('edited ')

    popoutButton()!.click()
    await flushUi()

    expect(popoutOpenWithTab).toHaveBeenCalledTimes(1)
    const sent = popoutOpenWithTab.mock.calls[0][0]
    expect(sent.path).toBe('docs/a.md')
    expect(sent.kind).toBe('text')
    expect(sent.dirty).toBe(true)
    expect(sent.content).toBe('edited # A')
    // Disk baseline travels with the tab: dirty tracking + stale-write hash.
    expect(sent.originalContent).toBe('# A')
    expect(sent.version?.hash).toBe('hash:# A')
    await vi.waitFor(() => expect(tabNames()).toEqual([]))
  })

  it('keeps the tab and toasts when the pop-out invoke reports failure', async () => {
    popoutOpenWithTab.mockResolvedValueOnce({ ok: false })
    mounted = mountPanel()
    await flushUi()
    await mounted.panelRef.value.openFile('docs/a.md')
    await flushUi()

    popoutButton()!.click()
    await flushUi()

    expect(tabNames()).toEqual(['a.md'])
    const toasts = useToastStore(mounted.pinia)
    expect(toasts.list.some(t => t.kind === 'error')).toBe(true)
  })

  it('keeps the tab and toasts when the pop-out invoke rejects', async () => {
    popoutOpenWithTab.mockRejectedValueOnce(new Error('no handler'))
    mounted = mountPanel()
    await flushUi()
    await mounted.panelRef.value.openFile('docs/a.md')
    await flushUi()

    popoutButton()!.click()
    await flushUi()

    expect(tabNames()).toEqual(['a.md'])
    const toasts = useToastStore(mounted.pinia)
    expect(toasts.list.some(t => t.kind === 'error')).toBe(true)
  })

  it('routes through popoutReturnTab in popout role', async () => {
    mounted = mountPanel({ windowRole: 'popout' })
    await flushUi()
    await mounted.panelRef.value.openFile('docs/a.md')
    await flushUi()

    popoutButton()!.click()
    await flushUi()

    await vi.waitFor(() => expect(popoutReturnTab).toHaveBeenCalledTimes(1))
    expect(popoutOpenWithTab).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(tabNames()).toEqual([]))
  })

  it('does not touch tab persistence in popout role', async () => {
    mounted = mountPanel({ windowRole: 'popout' })
    await flushUi()
    await mounted.panelRef.value.openFile('docs/a.md')
    await flushUi()
    expect(tabPersistenceReads).toBe(0)
  })

  it('restores persisted tabs in main role', async () => {
    mounted = mountPanel()
    await flushUi()
    expect(tabPersistenceReads).toBeGreaterThan(0)
  })

  it('adopts a dirty text tab with carried content, baseline, and dirty flag', async () => {
    mounted = mountPanel({ windowRole: 'popout' })
    await flushUi()

    await mounted.panelRef.value.adoptTab({
      path: 'docs/carried.md',
      kind: 'text',
      name: 'carried.md',
      dirty: true,
      content: 'modified body',
      originalContent: 'disk body',
      version: { hash: 'hash:disk body' },
    })
    await flushUi()

    // No disk read — the buffer travelled with the tab.
    const readPaths = kernelCall.mock.calls
      .filter(([tool]) => tool === 'fs.read')
      .map(([, params]) => String((params as Record<string, unknown>).path))
    expect(readPaths).not.toContain('docs/carried.md')
    expect(tabNames()[0]).toContain('carried.md')
    expect(mounted.root.querySelector('[data-testid="tab-dirty-dot"]')).not.toBeNull()

    // The adopted buffer is the carried content, not the disk state.
    const doc = mounted.panelRef.value.getCurrentDocument()
    expect(doc?.content).toBe('modified body')
  })

  it('adopts a clean tab by re-reading it from disk', async () => {
    fileContents['docs/clean.md'] = 'clean body'
    mounted = mountPanel({ windowRole: 'popout' })
    await flushUi()

    await mounted.panelRef.value.adoptTab({
      path: 'docs/clean.md',
      kind: 'text',
      name: 'clean.md',
      dirty: false,
    })
    await flushUi()

    const readPaths = kernelCall.mock.calls
      .filter(([tool]) => tool === 'fs.read')
      .map(([, params]) => String((params as Record<string, unknown>).path))
    expect(readPaths).toContain('docs/clean.md')
    expect(tabNames()[0]).toContain('clean.md')
    expect(mounted.root.querySelector('[data-testid="tab-dirty-dot"]')).toBeNull()
  })

  it('adopts an untitled tab with carried draft content', async () => {
    mounted = mountPanel({ windowRole: 'popout' })
    await flushUi()

    await mounted.panelRef.value.adoptTab({
      path: null,
      kind: 'text',
      name: 'Untitled',
      dirty: true,
      content: 'draft text',
    })
    await flushUi()

    expect(tabNames()[0]).toContain('Untitled')
    const doc = mounted.panelRef.value.getCurrentDocument()
    expect(doc?.content).toBe('draft text')
  })

  it('ignores malformed adopt payloads', async () => {
    mounted = mountPanel({ windowRole: 'popout' })
    await flushUi()

    await mounted.panelRef.value.adoptTab({ kind: 'text', name: 'x' } as never)
    await flushUi()

    expect(tabNames()).toEqual([])
  })
})
