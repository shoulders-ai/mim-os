import type { PaneState } from '../workbench/entries.js'

export const WORK_MIN_WIDTH = 336
export const ARTIFACT_MIN_WIDTH = 336
export const ARTIFACT_RESIZE_HANDLE_WIDTH = 6
export const PANE_RAIL_WIDTH = 44
export const WORKBENCH_STAGE_HORIZONTAL_INSET = 8

export interface AvailableArtifactPanelWidthInput {
  viewportWidth: number
  navigatorVisible: boolean
  navigatorWidth: number
  navigatorSpineWidth?: number
  workPaneState: PaneState
  workMinWidth?: number
  workRailWidth?: number
  artifactMinWidth?: number
  artifactResizeHandleWidth?: number
  stageHorizontalInset?: number
}

export interface PanelWidthBounds {
  min: number
  max: number
}

export interface ArtifactFrameStyleInput {
  expanded: boolean
  width: number
}

export interface PaneResizeDocument {
  body: {
    style: Pick<CSSStyleDeclaration, 'cursor' | 'userSelect'>
  }
  addEventListener(type: 'pointermove', handler: (event: PointerEvent) => void): void
  addEventListener(type: 'pointerup', handler: () => void): void
  removeEventListener(type: 'pointermove', handler: (event: PointerEvent) => void): void
  removeEventListener(type: 'pointerup', handler: () => void): void
}

export interface PaneResizeActionsDeps {
  document: PaneResizeDocument
  getSidebarWidth(): number
  setSidebarWidth(width: number): void
  setSidebarDragging(dragging: boolean): void
  persistSidebarWidth(width: number): void
  getArtifactWidth(): number
  getArtifactMaxWidth(): number
  setArtifactWidth(width: number): void
  setArtifactDragging(dragging: boolean): void
  persistArtifactWidth(width: number): void
}

export function availableArtifactPanelMaxWidth(input: AvailableArtifactPanelWidthInput): number {
  const artifactMinWidth = input.artifactMinWidth ?? ARTIFACT_MIN_WIDTH
  const navigatorWidth = input.navigatorVisible
    ? input.navigatorWidth
    : input.navigatorSpineWidth ?? 0
  const bodyWidth = Math.max(0, input.viewportWidth - navigatorWidth)
  const workWidth = input.workPaneState === 'rail'
    ? input.workRailWidth ?? PANE_RAIL_WIDTH
    : input.workMinWidth ?? WORK_MIN_WIDTH
  const max = bodyWidth
    - (input.stageHorizontalInset ?? WORKBENCH_STAGE_HORIZONTAL_INSET)
    - workWidth
    - (input.artifactResizeHandleWidth ?? ARTIFACT_RESIZE_HANDLE_WIDTH)
  return Math.max(artifactMinWidth, max)
}

export function clampPanelWidth(width: number, bounds: PanelWidthBounds): number {
  const finiteWidth = Number.isFinite(width) ? width : bounds.min
  return Math.max(bounds.min, Math.min(bounds.max, finiteWidth))
}

export function artifactFrameStyle(input: ArtifactFrameStyleInput): { flex: number } | { width: string } {
  return input.expanded ? { flex: 1 } : { width: `${input.width}px` }
}

export function createPaneResizeActions(deps: PaneResizeActionsDeps) {
  function onSidebarResize(e: PointerEvent) {
    const startX = e.clientX
    const startW = deps.getSidebarWidth()
    deps.setSidebarDragging(true)
    deps.document.body.style.cursor = 'col-resize'
    deps.document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => {
      deps.setSidebarWidth(clampPanelWidth(startW + ev.clientX - startX, { min: 160, max: 360 }))
    }
    const onUp = () => {
      deps.setSidebarDragging(false)
      deps.document.body.style.cursor = ''
      deps.document.body.style.userSelect = ''
      deps.document.removeEventListener('pointermove', onMove)
      deps.document.removeEventListener('pointerup', onUp)
      deps.persistSidebarWidth(deps.getSidebarWidth())
    }
    deps.document.addEventListener('pointermove', onMove)
    deps.document.addEventListener('pointerup', onUp)
  }

  function onArtifactResize(e: PointerEvent) {
    const startX = e.clientX
    const startW = clampArtifactWidth(deps.getArtifactWidth())
    deps.setArtifactDragging(true)
    deps.document.body.style.cursor = 'col-resize'
    deps.document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent) => {
      deps.setArtifactWidth(clampArtifactWidth(startW - (ev.clientX - startX)))
    }
    const onUp = () => {
      deps.setArtifactDragging(false)
      deps.document.body.style.cursor = ''
      deps.document.body.style.userSelect = ''
      deps.document.removeEventListener('pointermove', onMove)
      deps.document.removeEventListener('pointerup', onUp)
      deps.persistArtifactWidth(clampArtifactWidth(deps.getArtifactWidth()))
    }
    deps.document.addEventListener('pointermove', onMove)
    deps.document.addEventListener('pointerup', onUp)
  }

  function clampArtifactWidth(width: number): number {
    return clampPanelWidth(width, { min: ARTIFACT_MIN_WIDTH, max: deps.getArtifactMaxWidth() })
  }

  return {
    onSidebarResize,
    onArtifactResize,
  }
}
