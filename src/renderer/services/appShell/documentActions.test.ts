import { describe, expect, it, vi } from 'vitest'
import {
  createDocumentActions,
  fileExtensionForTelemetry,
  type DocumentActionsDeps,
} from './documentActions.js'

function makeDeps(overrides: Partial<DocumentActionsDeps> = {}) {
  const artifactHost = {
    openDocument: vi.fn(),
    openHistoryForPath: vi.fn(),
    newUntitledTab: vi.fn(),
    saveActiveFile: vi.fn(),
    saveActiveFileAs: vi.fn(),
  }
  const deps: DocumentActionsDeps = {
    activeArtifactHostId: vi.fn(() => 'editor'),
    rightVisible: vi.fn(() => true),
    artifactHost: vi.fn(() => artifactHost),
    openEditorFileArtifact: vi.fn(async () => ({ opened: true })),
    openArtifactEntry: vi.fn(async () => ({ opened: true })),
    setArtifactVisible: vi.fn(),
    railArtifactPane: vi.fn(),
    readFileHead: vi.fn(async () => 'plain text'),
    openNativeFile: vi.fn(async () => ({ opened: 'file.bin' })),
    openFileDialog: vi.fn(async () => null),
    addRecentFile: vi.fn(),
    setArtifactNavigationError: vi.fn(),
    nextTick: vi.fn(async () => {}),
    trackTelemetry: vi.fn(),
    ...overrides,
  }
  return { deps, artifactHost }
}

describe('app shell document actions', () => {
  it('extracts file extensions for telemetry without leaking paths', () => {
    expect(fileExtensionForTelemetry('docs/report.DOCX')).toBe('docx')
    expect(fileExtensionForTelemetry('README')).toBe('none')
    expect(fileExtensionForTelemetry('.env')).toBe('none')
  })

  it('opens absolute paths in the native app and records a native file-open event', async () => {
    const { deps } = makeDeps()
    const actions = createDocumentActions(deps)

    await actions.openFileInEditor('/Users/me/Desktop/report.docx')

    expect(deps.openNativeFile).toHaveBeenCalledWith('/Users/me/Desktop/report.docx')
    expect(deps.addRecentFile).toHaveBeenCalledWith('/Users/me/Desktop/report.docx')
    expect(deps.trackTelemetry).toHaveBeenCalledWith('file_open', {
      ext: 'docx',
      surface: 'native',
    })
    expect(deps.openEditorFileArtifact).not.toHaveBeenCalled()
  })

  it('routes text-like workspace files through the editor Artifact command path', async () => {
    const { deps } = makeDeps()
    const actions = createDocumentActions(deps)

    await actions.openFileInEditor('src/renderer/App.vue')

    expect(deps.openEditorFileArtifact).toHaveBeenCalledWith('src/renderer/App.vue')
    expect(deps.artifactHost().openDocument).not.toHaveBeenCalled()
  })

  it('opens PDF, table, and unsupported workspace files as document-host tabs', async () => {
    const { deps, artifactHost } = makeDeps()
    const actions = createDocumentActions(deps)

    await actions.openFileInEditor('papers/a.pdf')
    await actions.openFileInEditor('data/table.csv')
    await actions.openFileInEditor('docs/report.docx')

    expect(artifactHost.openDocument).toHaveBeenNthCalledWith(1, 'papers/a.pdf', 'pdf')
    expect(artifactHost.openDocument).toHaveBeenNthCalledWith(2, 'data/table.csv', 'table')
    expect(artifactHost.openDocument).toHaveBeenNthCalledWith(3, 'docs/report.docx', 'card')
  })

  it('opens renderable images as image document-host tabs', async () => {
    const { deps, artifactHost } = makeDeps()
    const actions = createDocumentActions(deps)

    await actions.openFileInEditor('outputs/plot.png')
    await actions.openFileInEditor('assets/logo.svg')

    expect(artifactHost.openDocument).toHaveBeenNthCalledWith(1, 'outputs/plot.png', 'image')
    expect(artifactHost.openDocument).toHaveBeenNthCalledWith(2, 'assets/logo.svg', 'image')
    expect(deps.openEditorFileArtifact).not.toHaveBeenCalled()
  })

  it('opens the editor Artifact before adding document-host tabs when needed', async () => {
    const { deps, artifactHost } = makeDeps({
      activeArtifactHostId: vi.fn(() => 'package-artifact'),
    })
    const actions = createDocumentActions(deps)

    await actions.openFileInEditor('papers/a.pdf')

    expect(deps.openArtifactEntry).toHaveBeenCalledWith({
      id: 'artifact:editor',
      kind: 'editor',
      title: 'Editor',
    }, { replace: true })
    expect(deps.setArtifactVisible).toHaveBeenCalledWith(true)
    expect(artifactHost.openDocument).toHaveBeenCalledWith('papers/a.pdf', 'pdf')
  })

  it('does not open document-host tabs when switching to the editor Artifact is blocked', async () => {
    const { deps, artifactHost } = makeDeps({
      activeArtifactHostId: vi.fn(() => 'package-artifact'),
      openArtifactEntry: vi.fn(async () => ({ opened: false, reason: 'needs-confirmation' })),
    })
    const actions = createDocumentActions(deps)

    await actions.openFileInEditor('papers/a.pdf')

    expect(artifactHost.openDocument).not.toHaveBeenCalled()
  })

  it('opens file history after opening the target document', async () => {
    const { deps, artifactHost } = makeDeps()
    const actions = createDocumentActions(deps)

    await actions.openFileHistory('notes.md')

    expect(deps.openEditorFileArtifact).toHaveBeenCalledWith('notes.md')
    expect(deps.nextTick).toHaveBeenCalled()
    expect(artifactHost.openHistoryForPath).toHaveBeenCalledWith('notes.md')
  })

  it('creates untitled documents only after the editor Artifact opens', async () => {
    const { deps, artifactHost } = makeDeps()
    const actions = createDocumentActions(deps)

    await actions.createUntitledInEditor()

    expect(deps.openArtifactEntry).toHaveBeenCalledWith({
      id: 'artifact:editor',
      kind: 'editor',
      title: 'Editor',
    })
    expect(artifactHost.newUntitledTab).toHaveBeenCalledOnce()
  })

  it('routes save commands only to a visible editor Artifact', () => {
    const { deps, artifactHost } = makeDeps()
    const actions = createDocumentActions(deps)

    actions.handleSaveFile(false)
    actions.handleSaveFile(true)

    expect(artifactHost.saveActiveFile).toHaveBeenCalledOnce()
    expect(artifactHost.saveActiveFileAs).toHaveBeenCalledOnce()

    const hidden = makeDeps({ rightVisible: vi.fn(() => false) })
    createDocumentActions(hidden.deps).handleSaveFile(false)
    expect(hidden.artifactHost.saveActiveFile).not.toHaveBeenCalled()
  })

  it('rails the Artifact pane when all document tabs close', () => {
    const { deps } = makeDeps()
    const actions = createDocumentActions(deps)

    actions.handleAllDocumentTabsClosed()

    expect(deps.railArtifactPane).toHaveBeenCalledOnce()
  })
})
