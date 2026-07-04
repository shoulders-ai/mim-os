import { beforeEach, describe, expect, it } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { clearEditorState, getEditorState, registerEditorStateTools, updateEditorState } from '@main/tools/editorState.js'
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
