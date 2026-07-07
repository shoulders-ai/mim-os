import { beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import {
  clearEditorState,
  dropWindow,
  findWindowIdForPath,
  getEditorState,
  noteWindowFocused,
  registerEditorStateTools,
  setMainWindowId,
  updateEditorState,
  updateWindowEditorState,
} from '@main/tools/editorState.js'
import { toolEffect } from '@main/security/gate.js'

const ctx = { actor: 'user' as const }

function makeTools() {
  const tools = createToolRegistry(createTraceLog())
  registerEditorStateTools(tools)
  return tools
}

describe('editor.state', () => {
  beforeEach(() => {
    clearEditorState()
  })

  it('reports unavailable before the renderer pushes any state', async () => {
    const tools = makeTools()

    const result = await tools.call('editor.state', {}, ctx)

    expect(result).toEqual({ available: false, activeDocument: null, openTabs: [] })
  })

  it('returns the pushed active document and open tabs', async () => {
    const tools = makeTools()
    updateEditorState({
      activeDocument: { path: 'notes/plan.md', name: 'plan.md', kind: 'text', dirty: true },
      openTabs: [
        { path: 'notes/plan.md', name: 'plan.md', kind: 'text', dirty: true, active: true },
        { path: 'data/results.csv', name: 'results.csv', kind: 'table', dirty: false, active: false },
      ],
    })

    const result = await tools.call('editor.state', {}, ctx)

    expect(result).toEqual({
      available: true,
      activeDocument: { path: 'notes/plan.md', name: 'plan.md', kind: 'text', dirty: true },
      openTabs: [
        { path: 'notes/plan.md', name: 'plan.md', kind: 'text', dirty: true, active: true },
        { path: 'data/results.csv', name: 'results.csv', kind: 'table', dirty: false, active: false },
      ],
    })
  })

  it('represents an untitled active tab with a null path', () => {
    updateEditorState({
      activeDocument: { path: '', name: 'Untitled', kind: 'text', dirty: true },
      openTabs: [{ path: '', name: 'Untitled', kind: 'text', dirty: true, active: true }],
    })

    const state = getEditorState()

    expect(state.activeDocument).toEqual({ path: null, name: 'Untitled', kind: 'text', dirty: true })
    expect(state.openTabs).toEqual([{ path: null, name: 'Untitled', kind: 'text', dirty: true, active: true }])
  })

  it('sanitizes malformed payload entries', () => {
    updateEditorState({
      activeDocument: 'nonsense',
      openTabs: [
        null,
        42,
        { path: 'ok.md', dirty: 'yes', active: 1 },
        { name: 7, kind: null },
      ],
    })

    const state = getEditorState()

    expect(state.available).toBe(true)
    expect(state.activeDocument).toBeNull()
    expect(state.openTabs).toEqual([
      { path: 'ok.md', name: 'ok.md', kind: 'text', dirty: true, active: true },
      { path: null, name: 'Untitled', kind: 'text', dirty: false, active: false },
    ])
  })

  it('treats a non-object push as no editor state', () => {
    updateEditorState({
      activeDocument: { path: 'a.md', name: 'a.md', kind: 'text', dirty: false },
      openTabs: [],
    })
    updateEditorState(null)

    expect(getEditorState()).toEqual({ available: false, activeDocument: null, openTabs: [] })
  })

  it('clears state on demand (workspace switch)', () => {
    updateEditorState({ activeDocument: null, openTabs: [] })
    expect(getEditorState().available).toBe(true)

    clearEditorState()

    expect(getEditorState()).toEqual({ available: false, activeDocument: null, openTabs: [] })
  })

  it('caps the reported tab list', () => {
    updateEditorState({
      activeDocument: null,
      openTabs: Array.from({ length: 500 }, (_, i) => ({
        path: `file-${i}.md`, name: `file-${i}.md`, kind: 'text', dirty: false, active: false,
      })),
    })

    expect(getEditorState().openTabs).toHaveLength(200)
  })

  it('classifies as a read effect so Normal mode never prompts', () => {
    expect(toolEffect('editor.state')).toBe('read')
  })
})

// ── Multi-window editor state ──

describe('editor.state multi-window', () => {
  const MAIN_ID = 10
  const POPOUT_ID = 20

  beforeEach(() => {
    clearEditorState()
    setMainWindowId(MAIN_ID)
  })

  it('merges tabs from multiple windows', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: { path: 'a.md', name: 'a.md', kind: 'text', dirty: false },
      openTabs: [{ path: 'a.md', name: 'a.md', kind: 'text', dirty: false, active: true }],
    })
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: { path: 'b.md', name: 'b.md', kind: 'text', dirty: true },
      openTabs: [{ path: 'b.md', name: 'b.md', kind: 'text', dirty: true, active: true }],
    })

    const state = getEditorState()

    expect(state.available).toBe(true)
    expect(state.openTabs).toHaveLength(2)
    const tabPaths = state.openTabs.map(t => t.path)
    expect(tabPaths).toContain('a.md')
    expect(tabPaths).toContain('b.md')
  })

  it('adds window field to tabs from per-window updates', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: null,
      openTabs: [{ path: 'a.md', name: 'a.md', kind: 'text', dirty: false, active: true }],
    })
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: null,
      openTabs: [{ path: 'b.md', name: 'b.md', kind: 'text', dirty: false, active: true }],
    })

    const state = getEditorState()
    const mainTab = state.openTabs.find(t => t.path === 'a.md')
    const popoutTab = state.openTabs.find(t => t.path === 'b.md')

    expect(mainTab?.window).toBe('main')
    expect(popoutTab?.window).toBe('popout')
  })

  it('activeDocument comes from most recently focused window', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: { path: 'main.md', name: 'main.md', kind: 'text', dirty: false },
      openTabs: [{ path: 'main.md', name: 'main.md', kind: 'text', dirty: false, active: true }],
    })
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: { path: 'popout.md', name: 'popout.md', kind: 'text', dirty: true },
      openTabs: [{ path: 'popout.md', name: 'popout.md', kind: 'text', dirty: true, active: true }],
    })

    // Focus the popout
    noteWindowFocused(POPOUT_ID)
    let state = getEditorState()
    expect(state.activeDocument?.path).toBe('popout.md')

    // Focus the main
    noteWindowFocused(MAIN_ID)
    state = getEditorState()
    expect(state.activeDocument?.path).toBe('main.md')
  })

  it('dropWindow removes that window\'s tabs from merged view', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: null,
      openTabs: [{ path: 'a.md', name: 'a.md', kind: 'text', dirty: false, active: true }],
    })
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: { path: 'b.md', name: 'b.md', kind: 'text', dirty: true },
      openTabs: [{ path: 'b.md', name: 'b.md', kind: 'text', dirty: true, active: true }],
    })

    dropWindow(POPOUT_ID)

    const state = getEditorState()
    expect(state.openTabs).toHaveLength(1)
    expect(state.openTabs[0].path).toBe('a.md')
  })

  it('falls back to any remaining window for activeDocument when focused window is dropped', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: { path: 'main.md', name: 'main.md', kind: 'text', dirty: false },
      openTabs: [{ path: 'main.md', name: 'main.md', kind: 'text', dirty: false, active: true }],
    })
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: { path: 'popout.md', name: 'popout.md', kind: 'text', dirty: true },
      openTabs: [{ path: 'popout.md', name: 'popout.md', kind: 'text', dirty: true, active: true }],
    })
    noteWindowFocused(POPOUT_ID)
    dropWindow(POPOUT_ID)

    const state = getEditorState()
    expect(state.activeDocument?.path).toBe('main.md')
  })

  it('clearEditorState clears all per-window state', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: null,
      openTabs: [{ path: 'a.md', name: 'a.md', kind: 'text', dirty: false, active: true }],
    })
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: null,
      openTabs: [{ path: 'b.md', name: 'b.md', kind: 'text', dirty: false, active: true }],
    })

    clearEditorState()

    expect(getEditorState()).toEqual({ available: false, activeDocument: null, openTabs: [] })
  })

  it('legacy updateEditorState still works for single-window compatibility', () => {
    updateEditorState({
      activeDocument: { path: 'legacy.md', name: 'legacy.md', kind: 'text', dirty: false },
      openTabs: [{ path: 'legacy.md', name: 'legacy.md', kind: 'text', dirty: false, active: true }],
    })

    const state = getEditorState()
    expect(state.available).toBe(true)
    expect(state.activeDocument?.path).toBe('legacy.md')
    expect(state.openTabs).toHaveLength(1)
  })

  it('tabs from legacy updateEditorState do not have a window field', () => {
    updateEditorState({
      activeDocument: null,
      openTabs: [{ path: 'x.md', name: 'x.md', kind: 'text', dirty: false, active: true }],
    })

    const state = getEditorState()
    expect(state.openTabs[0]).not.toHaveProperty('window')
  })

  it('per-window tabs preserve active only within their own window', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: { path: 'a.md', name: 'a.md', kind: 'text', dirty: false },
      openTabs: [
        { path: 'a.md', name: 'a.md', kind: 'text', dirty: false, active: true },
        { path: 'c.md', name: 'c.md', kind: 'text', dirty: false, active: false },
      ],
    })
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: { path: 'b.md', name: 'b.md', kind: 'text', dirty: true },
      openTabs: [{ path: 'b.md', name: 'b.md', kind: 'text', dirty: true, active: true }],
    })

    const state = getEditorState()
    expect(state.openTabs).toHaveLength(3)
    // Both windows can have an active tab
    const activeTabs = state.openTabs.filter(t => t.active)
    expect(activeTabs).toHaveLength(2)
  })
})

// ── findWindowIdForPath ──

describe('findWindowIdForPath', () => {
  const MAIN_ID = 10
  const POPOUT_ID = 20
  const POPOUT2_ID = 30

  beforeEach(() => {
    clearEditorState()
    setMainWindowId(MAIN_ID)
  })

  it('returns null when no windows have state', () => {
    expect(findWindowIdForPath('docs/readme.md')).toBeNull()
  })

  it('returns null for empty path', () => {
    expect(findWindowIdForPath('')).toBeNull()
  })

  it('returns null when only the main window has the path', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: null,
      openTabs: [{ path: 'docs/readme.md', name: 'readme.md', kind: 'text', dirty: false, active: true }],
    })
    expect(findWindowIdForPath('docs/readme.md')).toBeNull()
  })

  it('returns the pop-out window id when a pop-out has the path', () => {
    updateWindowEditorState(MAIN_ID, {
      activeDocument: null,
      openTabs: [{ path: 'a.md', name: 'a.md', kind: 'text', dirty: false, active: true }],
    })
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: null,
      openTabs: [{ path: 'docs/readme.md', name: 'readme.md', kind: 'text', dirty: false, active: true }],
    })
    expect(findWindowIdForPath('docs/readme.md')).toBe(POPOUT_ID)
  })

  it('returns the first matching pop-out when multiple pop-outs exist', () => {
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: null,
      openTabs: [{ path: 'docs/readme.md', name: 'readme.md', kind: 'text', dirty: false, active: true }],
    })
    updateWindowEditorState(POPOUT2_ID, {
      activeDocument: null,
      openTabs: [{ path: 'docs/readme.md', name: 'readme.md', kind: 'text', dirty: false, active: true }],
    })
    // Should return one of them (the first one found)
    const result = findWindowIdForPath('docs/readme.md')
    expect([POPOUT_ID, POPOUT2_ID]).toContain(result)
  })

  it('is case-sensitive', () => {
    updateWindowEditorState(POPOUT_ID, {
      activeDocument: null,
      openTabs: [{ path: 'docs/README.md', name: 'README.md', kind: 'text', dirty: false, active: true }],
    })
    expect(findWindowIdForPath('docs/readme.md')).toBeNull()
    expect(findWindowIdForPath('docs/README.md')).toBe(POPOUT_ID)
  })
})
