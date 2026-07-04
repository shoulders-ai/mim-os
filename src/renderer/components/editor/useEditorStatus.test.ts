// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, reactive, ref } from 'vue'
import { useEditorStatus } from './useEditorStatus.js'
import type { TabState } from './editorTypes.js'

const pushEditorState = vi.fn()
const pushDirtyTabCount = vi.fn()

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    kind: 'text',
    path: 'notes/plan.md',
    name: 'plan.md',
    content: '',
    originalContent: '',
    dirty: false,
    ...overrides,
  } as TabState
}

function mountStatus(tabs: TabState[], activeIndex = 0) {
  return useEditorStatus({
    tabs,
    activeTab: computed(() => tabs[activeIndex] ?? null),
    activeIsText: computed(() => true),
    stats: ref({ words: 0, characters: 0 }),
    activeTableStats: ref({ rows: 0, cols: 0 }),
    citationHealth: computed(() => ({ total: 0, unresolved: [] })),
    referenceLibraryActive: ref(false),
    activeReferencePath: ref(''),
  })
}

describe('useEditorStatus editor-state push', () => {
  beforeEach(() => {
    pushEditorState.mockClear()
    pushDirtyTabCount.mockClear()
    ;(window as any).kernel = { pushEditorState, pushDirtyTabCount }
  })

  it('pushes the tab snapshot immediately on mount', () => {
    const tabs = reactive([
      makeTab(),
      makeTab({ id: 'tab-2', kind: 'table', path: 'data/results.csv', name: 'results.csv' }),
    ]) as TabState[]

    mountStatus(tabs)

    expect(pushEditorState).toHaveBeenCalledWith({
      activeDocument: { path: 'notes/plan.md', name: 'plan.md', kind: 'text', dirty: false },
      openTabs: [
        { path: 'notes/plan.md', name: 'plan.md', kind: 'text', dirty: false, active: true },
        { path: 'data/results.csv', name: 'results.csv', kind: 'table', dirty: false, active: false },
      ],
    })
  })

  it('pushes again when a tab becomes dirty', async () => {
    const tabs = reactive([makeTab()]) as TabState[]
    mountStatus(tabs)
    pushEditorState.mockClear()

    tabs[0].dirty = true
    await nextTick()

    expect(pushEditorState).toHaveBeenCalledTimes(1)
    expect(pushEditorState.mock.calls[0][0].activeDocument).toEqual(
      { path: 'notes/plan.md', name: 'plan.md', kind: 'text', dirty: true },
    )
  })

  it('reports an untitled tab with a null path and content-based dirty', () => {
    const tabs = reactive([
      makeTab({ id: 'untitled', path: '', name: 'Untitled', content: 'draft text' }),
    ]) as TabState[]

    mountStatus(tabs)

    expect(pushEditorState).toHaveBeenCalledWith({
      activeDocument: { path: null, name: 'Untitled', kind: 'text', dirty: true },
      openTabs: [{ path: null, name: 'Untitled', kind: 'text', dirty: true, active: true }],
    })
  })

  it('never reports read-only tabs as dirty', () => {
    const tabs = reactive([makeTab({ readOnly: true, dirty: true })]) as TabState[]

    mountStatus(tabs)

    expect(pushEditorState.mock.calls[0][0].openTabs[0].dirty).toBe(false)
  })

  it('reports no active document when no tab is active', () => {
    const tabs = reactive([]) as TabState[]

    mountStatus(tabs)

    expect(pushEditorState).toHaveBeenCalledWith({ activeDocument: null, openTabs: [] })
  })
})
