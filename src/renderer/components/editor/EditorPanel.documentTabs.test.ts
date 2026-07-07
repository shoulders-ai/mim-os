// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, onMounted, ref } from 'vue'
import { createPinia } from 'pinia'

const editorHarness = vi.hoisted(() => ({
  views: [] as any[],
  parents: [] as HTMLElement[],
}))

const tableHarness = vi.hoisted(() => ({
  serialize: vi.fn(() => 'Name,Score\nAda,11\n'),
  markSaved: vi.fn(),
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
  createEditor: vi.fn(({ parent, doc, onChange, onStats, onActiveFormats }) => {
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
    editorHarness.parents.push(parent)
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
vi.mock('../files/PdfArtifact.vue', () => ({
  default: defineComponent({
    name: 'PdfArtifactStub',
    props: ['path', 'port'],
    setup(props) {
      return () => h('section', {
        'data-testid': 'pdf-artifact',
        'data-path': props.path as string,
        'data-port': String(props.port),
      }, 'PDF')
    },
  }),
}))
vi.mock('../files/FileCardArtifact.vue', () => ({
  default: defineComponent({
    name: 'FileCardArtifactStub',
    props: ['path'],
    setup(props) {
      return () => h('section', {
        'data-testid': 'file-card-artifact',
        'data-path': props.path as string,
      }, 'Card')
    },
  }),
}))
vi.mock('../files/TableArtifact.vue', () => ({
  default: defineComponent({
    name: 'TableArtifactStub',
    props: ['path'],
    emits: ['update:dirty', 'update:stats', 'loaded'],
    setup(props, { emit, expose }) {
      expose({
        serialize: tableHarness.serialize,
        markSaved: tableHarness.markSaved,
      })
      onMounted(() => {
        setTimeout(() => {
          emit('loaded', {
            content: 'Name,Score\nAda,10\n',
            version: { hash: 'hash:table', size: 18, mtimeMs: 100 },
          })
          emit('update:stats', { rows: 1, cols: 2 })
        }, 0)
      })
      return () => h('section', {
        'data-testid': 'table-artifact',
        'data-path': props.path as string,
      }, [
        h('button', {
          'data-testid': 'dirty-table',
          onClick: () => emit('update:dirty', true),
        }, 'Dirty'),
        'Table',
      ])
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
      return () => h(EditorPanel, { ref: panelRef, port: 9234, ...handlers })
    },
  })
  app.use(createPinia())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root, panelRef }
}

describe('EditorPanel document tabs', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null
  let kernelCall: ReturnType<typeof vi.fn>
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

  beforeEach(() => {
    editorHarness.views.length = 0
    editorHarness.parents.length = 0
    tableHarness.serialize.mockReset()
    tableHarness.serialize.mockReturnValue('Name,Score\nAda,11\n')
    tableHarness.markSaved.mockReset()
    fileContents = {
      'docs/a.md': '# A',
    }
    kernelListeners = new Map()
    kernelCall = vi.fn(async (tool: string, params: Record<string, unknown> = {}) => {
      if (tool === 'references.readBib') return { exists: false, references: [] }
      if (tool === 'fs.read') {
        const path = String(params.path)
        if (path === '.mim/editor-tabs.json') throw new Error('no persisted tabs')
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

  it('opens pdf documents as tabs without reading them through fs.read', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openDocument('docs/report.pdf', 'pdf')
    await flushUi()

    expect(rootReadPaths()).not.toContain('docs/report.pdf')
    expect(mounted.root.querySelector('[data-testid="pdf-artifact"]')?.getAttribute('data-path')).toBe('docs/report.pdf')
    expect(mounted.root.textContent).toContain('report.pdf')
  })

  it('emits the active document path for text and non-text tabs', async () => {
    const activeFileChanged = vi.fn()
    mounted = mountPanel({ onActiveFileChanged: activeFileChanged })
    await flushUi()

    await mounted.panelRef.value.openDocument('docs/a.md', 'text')
    await mounted.panelRef.value.openDocument('docs/report.pdf', 'pdf')
    await mounted.panelRef.value.openDocument('inputs/source.docx', 'card')
    await flushUi()

    expect(activeFileChanged).toHaveBeenCalledWith('docs/a.md')
    expect(activeFileChanged).toHaveBeenCalledWith('docs/report.pdf')
    expect(activeFileChanged).toHaveBeenCalledWith('inputs/source.docx')
  })

  it('switches between text, pdf, and card tabs while preserving the text editor view', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openDocument('docs/a.md', 'text')
    await mounted.panelRef.value.openDocument('docs/report.pdf', 'pdf')
    await mounted.panelRef.value.openDocument('inputs/source.docx', 'card')
    await flushUi()

    expect(mounted.root.querySelector('[data-testid="file-card-artifact"]')?.getAttribute('data-path')).toBe('inputs/source.docx')
    expect(editorHarness.views).toHaveLength(1)

    await mounted.panelRef.value.openDocument('docs/a.md', 'text')
    await flushUi()

    expect(mounted.root.querySelector('[data-testid="file-card-artifact"]')).toBeNull()
    expect(mounted.root.querySelector('[data-testid="pdf-artifact"]')).toBeNull()
    expect(editorHarness.views).toHaveLength(1)
    expect(editorHarness.views[0].setState).toHaveBeenCalled()
  })

  it('retargets open document tabs after a workspace folder move', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openDocument('docs/a.md', 'text')
    await mounted.panelRef.value.openDocument('docs/report.pdf', 'pdf')
    await flushUi()

    mounted.panelRef.value.retargetDocumentPath('docs', 'archive/docs', 'directory')
    await flushUi()

    expect(mounted.root.querySelector('[data-testid="pdf-artifact"]')?.getAttribute('data-path')).toBe('archive/docs/report.pdf')

    kernelCall.mockClear()
    await mounted.panelRef.value.openDocument('archive/docs/a.md', 'text')
    await flushUi()

    expect(rootReadPaths()).not.toContain('archive/docs/a.md')
    expect(editorHarness.views[0].setState).toHaveBeenCalled()
  })

  it('restores the text editor scroll snapshot when returning to a tab', async () => {
    fileContents = {
      'docs/a.md': Array.from({ length: 80 }, (_, i) => `A ${i + 1}`).join('\n'),
      'docs/b.md': Array.from({ length: 80 }, (_, i) => `B ${i + 1}`).join('\n'),
    }
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openDocument('docs/a.md', 'text')
    await flushUi()

    const view = editorHarness.views[0]
    const snapshotA = { type: 'scroll-snapshot:a' }
    const snapshotB = { type: 'scroll-snapshot:b' }
    view.scrollSnapshot
      .mockReturnValueOnce(snapshotA)
      .mockReturnValueOnce(snapshotB)

    await mounted.panelRef.value.openDocument('docs/b.md', 'text')
    await flushUi()

    expect(view.scrollSnapshot).toHaveBeenCalledTimes(1)

    view.dispatch.mockClear()
    await mounted.panelRef.value.openDocument('docs/a.md', 'text')
    await flushUi()

    expect(view.scrollSnapshot).toHaveBeenCalledTimes(2)
    expect(view.dispatch).toHaveBeenCalledWith({ effects: snapshotA })
  })

  it('opens table documents as tabs and saves serialized table content with the loaded hash', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openDocument('data/scores.csv', 'table')
    await flushUi()

    expect(rootReadPaths()).not.toContain('data/scores.csv')
    expect(mounted.root.querySelector('[data-testid="table-artifact"]')?.getAttribute('data-path')).toBe('data/scores.csv')
    expect(mounted.root.textContent).toContain('1r x 2c')

    mounted.root.querySelector<HTMLButtonElement>('[data-testid="dirty-table"]')?.click()
    await flushUi()

    await mounted.panelRef.value.saveActiveFile()
    await flushUi()

    expect(kernelCall).toHaveBeenCalledWith('fs.write', {
      path: 'data/scores.csv',
      content: 'Name,Score\nAda,11\n',
      expected_hash: 'hash:table',
    })
    expect(tableHarness.markSaved).toHaveBeenCalledWith('Name,Score\nAda,11\n', undefined)
  })

  it('clears a reverted dirty table without writing unchanged same-path content', async () => {
    tableHarness.serialize.mockReturnValue('Name,Score\nAda,10\n')
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openDocument('data/scores.csv', 'table')
    await flushUi()

    mounted.root.querySelector<HTMLButtonElement>('[data-testid="dirty-table"]')?.click()
    await flushUi()

    kernelCall.mockClear()
    await expect(mounted.panelRef.value.saveActiveFile()).resolves.toBe(true)
    await flushUi()

    expect(writeCalls()).toHaveLength(0)
    expect(tableHarness.markSaved).toHaveBeenCalledWith('Name,Score\nAda,10\n', {
      hash: 'hash:table',
      size: 18,
      mtimeMs: 100,
    })
  })

  it('restores persisted table tabs', async () => {
    kernelCall.mockImplementation(async (tool: string, params: Record<string, unknown> = {}) => {
      if (tool === 'references.readBib') return { exists: false, references: [] }
      if (tool === 'fs.read') {
        const path = String(params.path)
        if (path === '.mim/editor-tabs.json') {
          return {
            content: JSON.stringify({
              version: 1,
              tabs: [{ path: 'data/restored.csv', name: 'restored.csv', kind: 'table' }],
              activeIndex: 0,
            }),
          }
        }
        return fileResult(path, fileContents[path] ?? '')
      }
      if (tool === 'fs.write') return { ok: true }
      if (tool === 'settings.set') return { ok: true }
      return {}
    })

    mounted = mountPanel()
    await flushUi()

    expect(mounted.root.querySelector('[data-testid="table-artifact"]')?.getAttribute('data-path')).toBe('data/restored.csv')
    expect(mounted.root.textContent).toContain('restored.csv')
  })

  it('mounts with no tabs and shows the empty document state when nothing is persisted', async () => {
    mounted = mountPanel()
    await flushUi()

    expect(mounted.root.textContent).toContain('No document open')
    expect(mounted.root.textContent).not.toContain('Untitled')
  })

  it('closes the last tab without spawning an untitled replacement', async () => {
    const onAllTabsClosed = vi.fn()
    mounted = mountPanel({ onAllTabsClosed })
    await flushUi()

    mounted.panelRef.value.createUntitledTab()
    await flushUi()
    expect(mounted.root.textContent).toContain('Untitled')

    mounted.panelRef.value.closeActiveTab()
    await flushUi()
    await new Promise(resolve => setTimeout(resolve, 250))
    await flushUi()

    expect(onAllTabsClosed).toHaveBeenCalledOnce()
    expect(mounted.root.textContent).toContain('No document open')
    expect(mounted.root.textContent).not.toContain('Untitled')
  })

  it('cycleTab wraps forward and backward across text, pdf, and card tabs', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openDocument('docs/a.md', 'text')
    await mounted.panelRef.value.openDocument('docs/report.pdf', 'pdf')
    await mounted.panelRef.value.openDocument('inputs/source.docx', 'card')
    await flushUi()
    expect(mounted.root.querySelector('[data-testid="file-card-artifact"]')?.getAttribute('data-path')).toBe('inputs/source.docx')

    // Wraps from the last tab (card) forward to the first (text)
    mounted.panelRef.value.cycleTab(1)
    await flushUi()
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({ path: 'docs/a.md' })

    // Wraps from the first tab (text) backward to the last (card)
    mounted.panelRef.value.cycleTab(-1)
    await flushUi()
    expect(mounted.root.querySelector('[data-testid="file-card-artifact"]')?.getAttribute('data-path')).toBe('inputs/source.docx')

    mounted.panelRef.value.cycleTab(-1)
    await flushUi()
    expect(mounted.root.querySelector('[data-testid="pdf-artifact"]')?.getAttribute('data-path')).toBe('docs/report.pdf')
  })

  it('cycleTab is a no-op with fewer than two tabs', async () => {
    mounted = mountPanel()
    await flushUi()

    mounted.panelRef.value.createUntitledTab()
    await flushUi()
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({ name: 'Untitled' })

    mounted.panelRef.value.cycleTab(1)
    await flushUi()
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({ name: 'Untitled' })
  })

  it('keeps the editor mount usable after the last tab is closed and a new tab is opened', async () => {
    mounted = mountPanel()
    await flushUi()

    expect(editorHarness.views).toHaveLength(1)
    expect(editorHarness.parents[0]?.isConnected).toBe(true)

    mounted.panelRef.value.createUntitledTab()
    await flushUi()

    mounted.panelRef.value.closeActiveTab()
    await flushUi()
    expect(mounted.root.textContent).toContain('No document open')
    expect(editorHarness.parents[0]?.isConnected).toBe(true)

    mounted.panelRef.value.createUntitledTab()
    await flushUi()

    const view = editorHarness.views[0]
    view.dispatch({ changes: { from: 0, to: 0, insert: '# Reopened' } })
    await flushUi()

    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      name: 'Untitled',
      content: '# Reopened',
      dirty: true,
    })
  })

  it('loads text file content after the last tab is closed', async () => {
    mounted = mountPanel()
    await flushUi()

    mounted.panelRef.value.createUntitledTab()
    await flushUi()
    mounted.panelRef.value.closeActiveTab()
    await flushUi()

    await mounted.panelRef.value.openDocument('docs/a.md', 'text')
    await flushUi()

    expect(rootReadPaths()).toContain('docs/a.md')
    expect(editorHarness.parents[0]?.isConnected).toBe(true)
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/a.md',
      name: 'a.md',
      content: '# A',
      dirty: false,
    })
  })

  it('closes the bibliography popover with x, outside click, and Escape', async () => {
    mounted = mountPanel()
    await flushUi()

    mounted.panelRef.value.createUntitledTab()
    await flushUi()

    editorHarness.views[0].dispatch({
      changes: { from: 0, to: 0, insert: 'This cites [@missing].' },
    })
    await flushUi()

    const statusButton = mounted.root.querySelector<HTMLButtonElement>('[data-testid="editor-citation-status"]')
    expect(statusButton).toBeTruthy()
    expect(statusButton?.textContent).toContain('1 missing')
    expect(statusButton?.getAttribute('aria-label')).toContain('1 citation not found')

    statusButton!.click()
    await flushUi()

    let popover = mounted.root.querySelector<HTMLElement>('[data-testid="bibliography-popover"]')
    expect(popover).toBeTruthy()
    const closeButton = popover!.querySelector<HTMLButtonElement>('[aria-label="Close references popover"]')
    expect(closeButton?.textContent?.trim()).toBe('x')

    closeButton!.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-testid="bibliography-popover"]')).toBeNull()

    statusButton!.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-testid="bibliography-popover"]')).toBeTruthy()

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await flushUi()
    expect(mounted.root.querySelector('[data-testid="bibliography-popover"]')).toBeNull()

    statusButton!.click()
    await flushUi()
    expect(mounted.root.querySelector('[data-testid="bibliography-popover"]')).toBeTruthy()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushUi()
    expect(mounted.root.querySelector('[data-testid="bibliography-popover"]')).toBeNull()
  })

  function rootReadPaths() {
    return kernelCall.mock.calls
      .filter(([tool]) => tool === 'fs.read')
      .map(([, params]) => String((params as Record<string, unknown>)?.path))
  }

  function writeCalls() {
    return kernelCall.mock.calls.filter(([tool]) => tool === 'fs.write')
  }

  function findButton(text: string): HTMLButtonElement | null {
    return [...mounted!.root.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes(text)) ?? null
  }
})
