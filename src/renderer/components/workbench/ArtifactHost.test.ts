// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import ArtifactHost from './ArtifactHost.vue'

const editorCalls = vi.hoisted(() => ({
  openFile: vi.fn(),
  openDocument: vi.fn(),
  createUntitledTab: vi.fn(),
  closeActiveTab: vi.fn(),
  saveActiveFile: vi.fn(async () => true),
  saveActiveFileAs: vi.fn(async () => true),
  getArtifactReplacementDecision: vi.fn(() => 'needs-confirmation'),
}))

vi.mock('../editor/EditorPanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'EditorPanelStub',
      emits: ['artifactActivated', 'allTabsClosed', 'openFileDialogRequested'],
      setup(_props, { emit, expose }) {
        expose({
          openFile: editorCalls.openFile,
          openDocument: editorCalls.openDocument,
          createUntitledTab: editorCalls.createUntitledTab,
          closeActiveTab: editorCalls.closeActiveTab,
          saveActiveFile: editorCalls.saveActiveFile,
          saveActiveFileAs: editorCalls.saveActiveFileAs,
          getArtifactReplacementDecision: editorCalls.getArtifactReplacementDecision,
        })
        return () => h('section', { 'data-testid': 'editor-panel' }, [
          h('button', {
            'data-testid': 'activate-artifact',
            onClick: () => emit('artifactActivated', {
              id: 'file:notes.md',
              kind: 'file',
              title: 'notes.md',
              path: 'notes.md',
            }),
          }, 'Activate'),
          h('button', {
            'data-testid': 'all-tabs-closed',
            onClick: () => emit('allTabsClosed'),
          }, 'Close all'),
          h('button', {
            'data-testid': 'open-file-dialog',
            onClick: () => emit('openFileDialogRequested'),
          }, 'Open file'),
        ])
      },
    }),
  }
})

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('ArtifactHost', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>
  let hostRef: any
  let getPackageLaunchUrl: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    hostRef = ref(null)
    getPackageLaunchUrl = vi.fn(async () => 'about:blank')
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { getPackageLaunchUrl },
    })
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  it('owns editor Artifact methods and pane header rendering', () => {
    app = createApp({
      setup() {
        return () => h(ArtifactHost, {
          ref: hostRef,
          activeHostId: 'editor',
          port: 1234,
          packages: [],
          width: 480,
        }, {
          'pane-header': () => h('div', { 'data-testid': 'artifact-header' }, 'Artifact'),
        })
      },
    })
    app.mount(root)

    hostRef.value.openFile('notes.md')
    hostRef.value.openDocument('deck.pdf', 'pdf')
    hostRef.value.newUntitledTab()
    expect(hostRef.value.openLauncher).toBeUndefined()
    hostRef.value.closeActiveTab()
    hostRef.value.saveActiveFile()
    hostRef.value.saveActiveFileAs()
    const decision = hostRef.value.getArtifactReplacementDecision(
      { id: 'artifact:editor', kind: 'editor', title: 'Editor' },
      { id: 'file:notes.md', kind: 'file', title: 'notes.md', path: 'notes.md' },
    )

    expect(root.querySelector('[data-testid="editor-panel"]')).toBeTruthy()
    expect(root.querySelector('[data-testid="artifact-header"]')).toBeTruthy()
    expect(editorCalls.openFile).toHaveBeenCalledWith('notes.md')
    expect(editorCalls.openDocument).toHaveBeenCalledWith('deck.pdf', 'pdf')
    expect(editorCalls.createUntitledTab).toHaveBeenCalledOnce()
    expect(editorCalls.closeActiveTab).toHaveBeenCalledOnce()
    expect(editorCalls.saveActiveFile).toHaveBeenCalledOnce()
    expect(editorCalls.saveActiveFileAs).toHaveBeenCalledOnce()
    expect(decision).toBe('needs-confirmation')
  })

  it('renders the Artifact pane flush with no rounding and no left border', () => {
    // Edge-to-edge: Artifact is a flush chrome-high frame (header) over a
    // surface content area. The Work/Artifact divider is the resize handle's
    // hairline, never a border on Artifact itself; there is no card rounding.
    app = createApp({
      setup() {
        return () => h(ArtifactHost, {
          ref: hostRef,
          activeHostId: 'editor',
          port: 1234,
          packages: [],
          width: 480,
        })
      },
    })
    app.mount(root)

    const aside = root.querySelector('aside') as HTMLElement
    expect(aside.className).not.toContain('rounded')
    expect(aside.className).not.toContain('border-l')
    expect(aside.className).toContain('bg-chrome-high')
  })

  it('forwards editor Artifact activation upward', () => {
    const onArtifactActivated = vi.fn()
    app = createApp({
      setup() {
        return () => h(ArtifactHost, {
          ref: hostRef,
          activeHostId: 'editor',
          port: 1234,
          packages: [],
          onArtifactActivated,
        })
      },
    })
    app.mount(root)

    root.querySelector<HTMLButtonElement>('[data-testid="activate-artifact"]')?.click()

    expect(onArtifactActivated).toHaveBeenCalledWith({
      id: 'file:notes.md',
      kind: 'file',
      title: 'notes.md',
      path: 'notes.md',
    })
  })

  it('forwards editor empty-state events upward', async () => {
    const onAllTabsClosed = vi.fn()
    const onOpenFileDialog = vi.fn()
    app = createApp({
      setup() {
        return () => h(ArtifactHost, {
          ref: hostRef,
          activeHostId: 'editor',
          port: 1234,
          packages: [],
          onAllTabsClosed,
          onOpenFileDialog,
        })
      },
    })
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="all-tabs-closed"]')?.click()
    root.querySelector<HTMLButtonElement>('[data-testid="open-file-dialog"]')?.click()

    expect(onAllTabsClosed).toHaveBeenCalledOnce()
    expect(onOpenFileDialog).toHaveBeenCalledOnce()
  })

  it('keeps external records on the editor host until a resolver exists', async () => {
    app = createApp({
      setup() {
        return () => h(ArtifactHost, {
          ref: hostRef,
          activeHostId: 'editor',
          activeArtifact: {
            id: 'external:issues:issue-1',
            kind: 'external-record',
            title: 'Plan board',
            source: 'issues',
            recordId: 'issue-1',
          },
          port: 1234,
          packages: [],
        })
      },
    })
    app.mount(root)
    await flushUi()

    expect(root.querySelector('[data-testid="editor-panel"]')).toBeTruthy()
    expect(root.textContent).not.toContain('Plan board cannot open in Artifact yet.')
  })
})
