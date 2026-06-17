import { describe, expect, it, vi } from 'vitest'
import {
  artifactFrameStyle,
  availableArtifactPanelMaxWidth,
  clampPanelWidth,
  createPaneResizeActions,
  type PaneResizeActionsDeps,
} from './paneSizing.js'

function makeFakeDocument() {
  const listeners = new Map<string, Set<(event?: unknown) => void>>()
  const document = {
    body: {
      style: {
        cursor: '',
        userSelect: '',
      },
    },
    addEventListener: vi.fn((type: string, handler: (event?: unknown) => void) => {
      const handlers = listeners.get(type) ?? new Set()
      handlers.add(handler)
      listeners.set(type, handlers)
    }),
    removeEventListener: vi.fn((type: string, handler: (event?: unknown) => void) => {
      listeners.get(type)?.delete(handler)
    }),
  }
  return {
    document,
    emit: (type: string, event?: unknown) => {
      for (const handler of [...(listeners.get(type) ?? [])]) {
        handler(event)
      }
    },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  }
}

function makeDeps(
  overrides: Partial<PaneResizeActionsDeps> = {},
) {
  const fakeDocument = makeFakeDocument()
  let sidebarWidth = 220
  let artifactWidth = 420
  let artifactMaxWidth = 620
  const deps: PaneResizeActionsDeps = {
    document: fakeDocument.document,
    getSidebarWidth: vi.fn(() => sidebarWidth),
    setSidebarWidth: vi.fn(width => { sidebarWidth = width }),
    setSidebarDragging: vi.fn(),
    persistSidebarWidth: vi.fn(width => { sidebarWidth = width }),
    getArtifactWidth: vi.fn(() => artifactWidth),
    getArtifactMaxWidth: vi.fn(() => artifactMaxWidth),
    setArtifactWidth: vi.fn(width => { artifactWidth = width }),
    setArtifactDragging: vi.fn(),
    persistArtifactWidth: vi.fn(width => { artifactWidth = width }),
    ...overrides,
  }
  return {
    deps,
    fakeDocument,
    getSidebarWidth: () => sidebarWidth,
    getArtifactWidth: () => artifactWidth,
    setArtifactMaxWidth: (width: number) => { artifactMaxWidth = width },
  }
}

describe('app shell pane sizing', () => {
  it('computes available Artifact width from viewport, Navigator, and Work pane state', () => {
    expect(availableArtifactPanelMaxWidth({
      viewportWidth: 1440,
      navigatorVisible: true,
      navigatorWidth: 260,
      workPaneState: 'expanded',
    })).toBe(830)

    expect(availableArtifactPanelMaxWidth({
      viewportWidth: 1440,
      navigatorVisible: false,
      navigatorWidth: 260,
      navigatorSpineWidth: 96,
      workPaneState: 'rail',
    })).toBe(1286)
  })

  it('never returns less than the minimum Artifact width', () => {
    expect(availableArtifactPanelMaxWidth({
      viewportWidth: 520,
      navigatorVisible: true,
      navigatorWidth: 320,
      workPaneState: 'expanded',
    })).toBe(336)
  })

  it('clamps non-finite and out-of-range panel widths', () => {
    expect(clampPanelWidth(Number.NaN, { min: 336, max: 700 })).toBe(336)
    expect(clampPanelWidth(260, { min: 336, max: 700 })).toBe(336)
    expect(clampPanelWidth(860, { min: 336, max: 700 })).toBe(700)
    expect(clampPanelWidth(512, { min: 336, max: 700 })).toBe(512)
  })

  it('uses flex when Artifact is expanded and fixed width otherwise', () => {
    expect(artifactFrameStyle({ expanded: true, width: 480 })).toEqual({ flex: 1 })
    expect(artifactFrameStyle({ expanded: false, width: 480 })).toEqual({ width: '480px' })
  })

  it('drags and persists Navigator width with the existing bounds', () => {
    const { deps, fakeDocument, getSidebarWidth } = makeDeps()
    const actions = createPaneResizeActions(deps)

    actions.onSidebarResize({ clientX: 100 } as PointerEvent)
    fakeDocument.emit('pointermove', { clientX: 310 } as PointerEvent)
    fakeDocument.emit('pointerup')

    expect(deps.setSidebarDragging).toHaveBeenNthCalledWith(1, true)
    expect(deps.setSidebarWidth).toHaveBeenCalledWith(360)
    expect(deps.setSidebarDragging).toHaveBeenNthCalledWith(2, false)
    expect(deps.persistSidebarWidth).toHaveBeenCalledWith(360)
    expect(getSidebarWidth()).toBe(360)
    expect(fakeDocument.document.body.style.cursor).toBe('')
    expect(fakeDocument.document.body.style.userSelect).toBe('')
    expect(fakeDocument.listenerCount('pointermove')).toBe(0)
    expect(fakeDocument.listenerCount('pointerup')).toBe(0)
  })

  it('drags and persists Artifact width against the current computed maximum', () => {
    const { deps, fakeDocument, getArtifactWidth } = makeDeps()
    const actions = createPaneResizeActions(deps)

    actions.onArtifactResize({ clientX: 800 } as PointerEvent)
    fakeDocument.emit('pointermove', { clientX: 560 } as PointerEvent)
    fakeDocument.emit('pointerup')

    expect(deps.setArtifactDragging).toHaveBeenNthCalledWith(1, true)
    expect(deps.setArtifactWidth).toHaveBeenCalledWith(620)
    expect(deps.setArtifactDragging).toHaveBeenNthCalledWith(2, false)
    expect(deps.persistArtifactWidth).toHaveBeenCalledWith(620)
    expect(getArtifactWidth()).toBe(620)
    expect(fakeDocument.listenerCount('pointermove')).toBe(0)
    expect(fakeDocument.listenerCount('pointerup')).toBe(0)
  })
})
