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
vi.mock('./ConflictBar.vue', () => ({ default: stubComponent('ConflictBarStub') }))

const { default: EditorPanel } = await import('./EditorPanel.vue')

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

async function flushMicrotasks() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
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

describe('EditorPanel save behavior', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null
  let kernelCall: ReturnType<typeof vi.fn>
  let saveFileDialog: ReturnType<typeof vi.fn>
  let fileContents: Record<string, string>
  let historyVersions: any[]
  let historyPreviewContents: Record<string, string>
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
      'docs/existing.md': 'old',
    }
    historyVersions = []
    historyPreviewContents = {}
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
      if (tool === 'history.list') {
        const path = String(params.path)
        return {
          path,
          current: {
            bytes: (fileContents[path] ?? '').length,
            deleted: false,
            kind: 'text',
            modifiedAt: '2026-06-14T11:58:00Z',
          },
          versions: historyVersions,
          totalVersions: historyVersions.length,
          foldedCount: 0,
        }
      }
      if (tool === 'history.preview') {
        const versionId = String(params.version_id)
        const content = historyPreviewContents[versionId] ?? ''
        return { kind: 'text', content, bytes: content.length, deleted: false }
      }
      if (tool === 'history.restore') {
        const path = String(params.path)
        const versionId = String(params.version_id)
        fileContents[path] = historyPreviewContents[versionId] ?? ''
        return { ok: true }
      }
      if (tool === 'history.openVersion') return { path: '/tmp/history-copy.md' }
      if (tool === 'settings.set') return { ok: true }
      return {}
    })
    saveFileDialog = vi.fn(async () => 'docs/new-note.md')
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        call: kernelCall,
        getWorkspace: vi.fn(async () => '/workspace'),
        saveFileDialog,
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('prompts for a workspace path and persists an untitled document on save', async () => {
    const onArtifactActivated = vi.fn()
    mounted = mountPanel({ onArtifactActivated })
    await flushUi()
    mounted.panelRef.value.createUntitledTab()
    await flushUi()

    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: 0, to: 0, insert: '# Draft' } })
    await flushUi()

    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: '',
      dirty: true,
      content: '# Draft',
    })

    const saved = await mounted.panelRef.value.saveActiveFile()
    await flushUi()

    expect(saved).toBe(true)
    expect(saveFileDialog).toHaveBeenCalledWith({ defaultPath: 'Untitled.md' })
    expect(kernelCall).toHaveBeenCalledWith('fs.write', {
      path: 'docs/new-note.md',
      content: '# Draft',
    })
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/new-note.md',
      name: 'new-note.md',
      dirty: false,
      content: '# Draft',
    })
    expect(onArtifactActivated).toHaveBeenLastCalledWith({
      id: 'file:docs/new-note.md',
      kind: 'file',
      title: 'new-note.md',
      path: 'docs/new-note.md',
    })
    expect(window.kernel.watchWorkspaceFile).toHaveBeenCalledWith('docs/new-note.md')
  })

  it('keeps an untitled document dirty when the save dialog is cancelled', async () => {
    saveFileDialog.mockResolvedValueOnce(null)
    mounted = mountPanel()
    await flushUi()
    mounted.panelRef.value.createUntitledTab()
    await flushUi()

    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: 0, to: 0, insert: '# Unsaved' } })
    await flushUi()

    const saved = await mounted.panelRef.value.saveActiveFile()
    await flushUi()

    expect(saved).toBe(false)
    expect(saveFileDialog).toHaveBeenCalledWith({ defaultPath: 'Untitled.md' })
    expect(kernelCall.mock.calls.some(([tool]) => tool === 'fs.write')).toBe(false)
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: '',
      dirty: true,
      content: '# Unsaved',
    })
  })

  it('opens read-only tabs as non-dirty, non-persisted, deduplicated documents', async () => {
    mounted = mountPanel()
    await flushUi()

    vi.useFakeTimers()
    await mounted.panelRef.value.openReadOnlyTab('Slides README.md', '# Slides', 'package:slides:readme')
    await flushMicrotasks()

    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: '',
      name: 'Slides README.md',
      content: '# Slides',
      dirty: false,
    })
    expect(window.kernel.pushDirtyTabCount).not.toHaveBeenCalledWith(expect.objectContaining({ count: 1 }))

    const saved = await mounted.panelRef.value.saveActiveFile()
    expect(saved).toBe(false)
    expect(saveFileDialog).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1500)
    await flushMicrotasks()
    const persisted = kernelCall.mock.calls.filter(([tool, params]: any[]) =>
      tool === 'fs.write' && params.path === '.mim/editor-tabs.json'
    )
    expect(persisted.at(-1)?.[1]).toMatchObject({
      path: '.mim/editor-tabs.json',
      content: expect.stringContaining('"tabs": []'),
    })

    await mounted.panelRef.value.openReadOnlyTab('Slides README.md', '# Updated', 'package:slides:readme')
    await flushMicrotasks()
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      content: '# Updated',
      dirty: false,
    })

    mounted.panelRef.value.closeActiveTab()
    await flushMicrotasks()
    expect(mounted.panelRef.value.getCurrentDocument()).toBeNull()
  })

  it('opens Mim origin documents read-only through the normal file path', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('.mim/origins/mim/skills/build-app/SKILL.md')
    await flushMicrotasks()

    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: '.mim/origins/mim/skills/build-app/SKILL.md',
      dirty: false,
    })
    expect(await mounted.panelRef.value.saveActiveFile()).toBe(false)
  })

  it('save as writes an existing file to a new path and updates the active tab', async () => {
    const onArtifactActivated = vi.fn()
    saveFileDialog.mockResolvedValueOnce('docs/copy.md')
    mounted = mountPanel({ onArtifactActivated })
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()

    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' updated' } })
    await flushUi()

    const saved = await mounted.panelRef.value.saveActiveFileAs()
    await flushUi()

    expect(saved).toBe(true)
    expect(saveFileDialog).toHaveBeenCalledWith({ defaultPath: 'docs/existing.md' })
    expect(kernelCall).toHaveBeenCalledWith('fs.write', {
      path: 'docs/copy.md',
      content: 'old updated',
    })
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/copy.md',
      name: 'copy.md',
      dirty: false,
      content: 'old updated',
    })
    expect(onArtifactActivated).toHaveBeenLastCalledWith({
      id: 'file:docs/copy.md',
      kind: 'file',
      title: 'copy.md',
      path: 'docs/copy.md',
    })
  })

  it('reloads a clean open file after an external workspace change', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()
    expect(window.kernel.watchWorkspaceFile).toHaveBeenCalledWith('docs/existing.md')
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'old',
      dirty: false,
    })

    fileContents['docs/existing.md'] = 'external edit'
    emitKernel('workspace:files-changed', {
      paths: ['docs/existing.md'],
      changes: [{ path: 'docs/existing.md', kind: 'change' }],
    })
    await flushUi()

    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'external edit',
      dirty: false,
    })
  })

  it('unregisters watched files when tabs close', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()
    mounted.panelRef.value.closeActiveTab()
    await flushUi()

    expect(window.kernel.unwatchWorkspaceFile).toHaveBeenCalledWith('docs/existing.md')
  })

  it('keeps a dirty open file local and blocks save after an external workspace change', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()
    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' local' } })
    await flushUi()
    kernelCall.mockClear()

    fileContents['docs/existing.md'] = 'external edit'
    emitKernel('workspace:files-changed', {
      paths: ['docs/existing.md'],
      changes: [{ path: 'docs/existing.md', kind: 'change' }],
    })
    await flushUi()

    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'old local',
      dirty: true,
    })
    const diskStatus = mounted.root.querySelector<HTMLElement>('[data-testid="editor-disk-status"]')
    expect(diskStatus?.getAttribute('title')).toBe('Changed on disk')
    expect(diskStatus?.textContent).toContain('Disk')

    const saved = await mounted.panelRef.value.saveActiveFile()
    expect(saved).toBe(false)
    expect(kernelCall.mock.calls.some(([tool]) => tool === 'fs.write')).toBe(false)
    expect(fileContents['docs/existing.md']).toBe('external edit')
  })

  it('does not replace the active editor when an autosave watcher event reports the same content', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()

    vi.useFakeTimers()
    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' autosaved' } })
    await flushMicrotasks()

    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    expect(fileContents['docs/existing.md']).toBe('old autosaved')
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'old autosaved',
      dirty: false,
    })

    view.dispatch.mockClear()
    emitKernel('workspace:files-changed', {
      paths: ['docs/existing.md'],
      changes: [{ path: 'docs/existing.md', kind: 'change' }],
    })
    await flushMicrotasks()

    expect(view.dispatch).not.toHaveBeenCalled()
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      content: 'old autosaved',
      dirty: false,
    })
  })

  it('keeps newer edits dirty when an older autosave finishes later', async () => {
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()

    let resolveWrite!: (value: unknown) => void
    const writeDone = new Promise(resolve => { resolveWrite = resolve })
    const defaultCall = kernelCall.getMockImplementation()
    kernelCall.mockImplementation(async (tool: string, params: Record<string, unknown>) => {
      if (tool === 'fs.write' && params.path === 'docs/existing.md') return writeDone
      return defaultCall?.(tool, params)
    })

    vi.useFakeTimers()
    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' first' } })
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    expect(kernelCall).toHaveBeenCalledWith('fs.write', {
      path: 'docs/existing.md',
      content: 'old first',
      expected_hash: 'hash:old',
    })

    view.dispatch({ changes: { from: view.state.doc.length, to: view.state.doc.length, insert: ' second' } })
    await flushMicrotasks()

    resolveWrite({
      written: 'docs/existing.md',
      hash: 'hash:old first',
      version: {
        hash: 'hash:old first',
        size: 'old first'.length,
        mtimeMs: 200,
      },
    })
    await flushMicrotasks()

    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'old first second',
      dirty: true,
    })
  })

  it('previews a clicked history version in the editor and cancels back to the current file', async () => {
    fileContents['docs/existing.md'] = 'current version'
    historyVersions = [{
      id: 'v-old',
      path: 'docs/existing.md',
      at: '2026-06-14T11:30:00Z',
      actor: 'user',
      event: 'save',
      kind: 'text',
      bytes: 16,
      deleted: false,
      anchor: false,
    }]
    historyPreviewContents['v-old'] = 'previous version'
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()
    const view = editorHarness.views[editorHarness.views.length - 1]
    expect(view.state.doc.toString()).toBe('current version')

    mounted.panelRef.value.openHistoryForPath('docs/existing.md')
    await flushUi()
    const row = mounted.root.querySelector('[data-testid="history-version-row-v-old"]') as HTMLButtonElement
    row.click()
    await flushUi()

    expect(view.state.doc.toString()).toBe('previous version')
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'current version',
      dirty: false,
    })
    expect(mounted.root.textContent).toContain('Use this version')
    expect(mounted.root.textContent).toContain('Current file is unchanged')

    const cancel = mounted.root.querySelector('[data-testid="history-cancel-preview"]') as HTMLButtonElement
    cancel.click()
    await flushUi()

    expect(view.state.doc.toString()).toBe('current version')
    expect(mounted.root.textContent).not.toContain('Use this version')
  })

  it('uses the previewed history version without opening it in a native app', async () => {
    fileContents['docs/existing.md'] = 'current version'
    historyVersions = [{
      id: 'v-old',
      path: 'docs/existing.md',
      at: '2026-06-14T11:30:00Z',
      actor: 'user',
      event: 'save',
      kind: 'text',
      bytes: 16,
      deleted: false,
      anchor: false,
    }]
    historyPreviewContents['v-old'] = 'previous version'
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()
    mounted.panelRef.value.openHistoryForPath('docs/existing.md')
    await flushUi()

    const row = mounted.root.querySelector('[data-testid="history-version-row-v-old"]') as HTMLButtonElement
    row.click()
    await flushUi()
    const useVersion = mounted.root.querySelector('[data-testid="history-use-version"]') as HTMLButtonElement
    useVersion.click()
    await flushUi()

    expect(kernelCall).toHaveBeenCalledWith('history.restore', {
      path: 'docs/existing.md',
      version_id: 'v-old',
    })
    expect(kernelCall.mock.calls.some(([tool]) => tool === 'history.openVersion')).toBe(false)
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'previous version',
      dirty: false,
    })
    expect(mounted.root.textContent).not.toContain('Use this version')
  })

  it('preserves dirty current content before using a previewed history version', async () => {
    fileContents['docs/existing.md'] = 'current version'
    historyVersions = [{
      id: 'v-old',
      path: 'docs/existing.md',
      at: '2026-06-14T11:30:00Z',
      actor: 'user',
      event: 'save',
      kind: 'text',
      bytes: 16,
      deleted: false,
      anchor: false,
    }]
    historyPreviewContents['v-old'] = 'previous version'
    mounted = mountPanel()
    await flushUi()

    await mounted.panelRef.value.openFile('docs/existing.md')
    await flushUi()
    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({
      changes: {
        from: view.state.doc.length,
        to: view.state.doc.length,
        insert: ' edited',
      },
    })
    await flushUi()
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'current version edited',
      dirty: true,
    })

    mounted.panelRef.value.openHistoryForPath('docs/existing.md')
    await flushUi()
    const row = mounted.root.querySelector('[data-testid="history-version-row-v-old"]') as HTMLButtonElement
    row.click()
    await flushUi()
    expect(view.state.doc.toString()).toBe('previous version')
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'current version edited',
      dirty: true,
    })

    const useVersion = mounted.root.querySelector('[data-testid="history-use-version"]') as HTMLButtonElement
    useVersion.click()
    await flushUi()

    const preserveIndex = kernelCall.mock.calls.findIndex(([tool, params]) =>
      tool === 'fs.write' &&
      (params as Record<string, unknown>)?.path === 'docs/existing.md' &&
      (params as Record<string, unknown>)?.content === 'current version edited'
    )
    const restoreIndex = kernelCall.mock.calls.findIndex(([tool]) => tool === 'history.restore')
    expect(preserveIndex).toBeGreaterThanOrEqual(0)
    expect(restoreIndex).toBeGreaterThan(preserveIndex)
    expect(kernelCall.mock.calls[preserveIndex][1]).toMatchObject({
      path: 'docs/existing.md',
      content: 'current version edited',
      expected_hash: 'hash:current version',
    })
    expect(mounted.panelRef.value.getCurrentDocument()).toMatchObject({
      path: 'docs/existing.md',
      content: 'previous version',
      dirty: false,
    })
  })

  it('creates a writable blank document on a new tab and exposes no launcher', async () => {
    mounted = mountPanel()
    await flushUi()

    const panel = mounted.panelRef.value
    // "+" / Cmd+T now make a real document, not a file-finder landing page.
    expect(typeof panel.createUntitledTab).toBe('function')
    expect(panel.createLauncherTab).toBeUndefined()

    panel.createUntitledTab()
    await flushUi()

    // A fresh tab is an editable untitled doc (path ''), never a null launcher slot.
    const doc = panel.getCurrentDocument()
    expect(doc).toMatchObject({ path: '', dirty: false })

    const view = editorHarness.views[editorHarness.views.length - 1]
    view.dispatch({ changes: { from: 0, to: 0, insert: 'hello' } })
    await flushUi()
    expect(panel.getCurrentDocument()).toMatchObject({ content: 'hello', dirty: true })
  })
})
