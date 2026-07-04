import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useEditorFileSync } from './useEditorFileSync.js'
import type { TabState } from './editorTypes.js'

function makeTab(overrides: Partial<TabState>): TabState {
  return {
    id: 'text:notes.md-1',
    kind: 'text',
    path: 'notes.md',
    name: 'notes.md',
    content: 'hello',
    originalContent: 'hello',
    dirty: false,
    ...overrides,
  }
}

function makeSync(tabs: TabState[]) {
  const activeTabIndex = ref(0)
  const options = {
    tabs,
    activeTab: computed(() => tabs[activeTabIndex.value] ?? null),
    activeTabIndex,
    tableArtifactRef: ref(null),
    settingsStore: {} as any,
    diffStore: {} as any,
    toastStore: { push: vi.fn() } as any,
    historyPreviewActive: computed(() => false),
    getEditorView: () => null,
    liveContentForTab: (index: number) => tabs[index]?.content ?? '',
    cancelHistoryPreview: vi.fn(),
    switchToTabState: vi.fn(),
    switchToDoc: vi.fn(),
    notifyCurrentDocumentChanged: vi.fn(),
    notifyActiveEditorArtifactChanged: vi.fn(),
    referencesFileChanged: vi.fn(() => false),
    loadReferences: vi.fn(),
  }
  return { sync: useEditorFileSync(options as any), options }
}

const kernelCall = vi.fn()

beforeEach(() => {
  kernelCall.mockReset()
  kernelCall.mockResolvedValue({ content: 'hello', hash: 'h1' })
  ;(globalThis as any).window = { kernel: { call: kernelCall } }
})

afterEach(() => {
  delete (globalThis as any).window
})

describe('useEditorFileSync workspace change handling for non-text tabs', () => {
  it('remounts open image and pdf tabs when their file changes on disk', async () => {
    const image = makeTab({ id: 'image:outputs/plot.png-1', kind: 'image', path: 'outputs/plot.png' })
    const pdf = makeTab({ id: 'pdf:report.pdf-1', kind: 'pdf', path: 'report.pdf' })
    const { sync } = makeSync([image, pdf])

    await sync.onWorkspaceFilesChanged({
      changes: [
        { path: 'outputs/plot.png', kind: 'change' },
        { path: 'report.pdf', kind: 'change' },
      ],
    })

    expect(image.id).not.toBe('image:outputs/plot.png-1')
    expect(image.id.startsWith('image:outputs/plot.png-')).toBe(true)
    expect(pdf.id).not.toBe('pdf:report.pdf-1')
    expect(image.dirty).toBe(false)
    expect(image.externalState).toBeUndefined()
    expect(kernelCall).not.toHaveBeenCalled()
  })

  it('leaves image tabs alone when the file is deleted', async () => {
    const image = makeTab({ id: 'image:outputs/plot.png-1', kind: 'image', path: 'outputs/plot.png' })
    const { sync } = makeSync([image])

    await sync.onWorkspaceFilesChanged({ changes: [{ path: 'outputs/plot.png', kind: 'unlink' }] })

    expect(image.id).toBe('image:outputs/plot.png-1')
    expect(image.dirty).toBe(false)
  })

  it('still reloads clean text tabs from disk on change', async () => {
    const text = makeTab({})
    const { sync } = makeSync([text])

    await sync.onWorkspaceFilesChanged({ changes: [{ path: 'notes.md', kind: 'change' }] })

    expect(kernelCall).toHaveBeenCalledWith('fs.read', { path: 'notes.md', full: true })
  })

  it('ignores change events for paths without an open tab', async () => {
    const image = makeTab({ id: 'image:outputs/plot.png-1', kind: 'image', path: 'outputs/plot.png' })
    const { sync } = makeSync([image])

    await sync.onWorkspaceFilesChanged({ changes: [{ path: 'other/file.png', kind: 'change' }] })

    expect(image.id).toBe('image:outputs/plot.png-1')
    expect(kernelCall).not.toHaveBeenCalled()
  })

  it('skips card tabs entirely', async () => {
    const card = makeTab({ id: 'card:report.docx-1', kind: 'card', path: 'report.docx' })
    const { sync } = makeSync([card])

    await sync.onWorkspaceFilesChanged({ changes: [{ path: 'report.docx', kind: 'change' }] })

    expect(card.id).toBe('card:report.docx-1')
    expect(kernelCall).not.toHaveBeenCalled()
  })
})
