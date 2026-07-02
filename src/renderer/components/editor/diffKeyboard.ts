// Pure keyboard contract for diff review. The window listener lives in
// DiffReviewBar; this maps a key event to a review action so the rules are
// testable without a DOM.

export interface DiffKeyEventLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
}

export interface DiffKeyTargetLike {
  // input/textarea/contenteditable/CodeMirror content
  isEditable: boolean
  // inside a [data-diff-scope] element (the review bar or the diff view)
  isButton: boolean
  inDiffScope: boolean
  // a modal dialog or palette overlay is open and owns the keyboard
  overlayOpen: boolean
}

export interface DiffKeyStateLike {
  active: boolean
  busy: boolean
  isApproval: boolean
  isBatch: boolean
  viewMode: string
  chunkCount: number
  allChunksResolved: boolean
}

export type DiffKeyAction = 'close' | 'accept' | 'approve' | 'next-chunk' | 'prev-chunk'

export function resolveDiffKeyAction(
  event: DiffKeyEventLike,
  target: DiffKeyTargetLike,
  state: DiffKeyStateLike,
): DiffKeyAction | null {
  if (!state.active || state.busy || event.defaultPrevented || target.overlayOpen) return null
  // Typing surfaces outside the review (chat composer, rename fields) own
  // their keys; typing inside the diff editor still gets review shortcuts
  // that cannot collide with text entry.
  if (target.isEditable && !target.inDiffScope) return null

  const mod = event.metaKey || event.ctrlKey

  if (event.key === 'Escape' && !mod && !event.altKey && !event.shiftKey) return 'close'

  if (event.key === 'Enter' && mod && !event.altKey && !event.shiftKey) {
    return state.isApproval ? 'approve' : 'accept'
  }

  if (event.key === 'Enter' && !mod && !event.altKey && !event.shiftKey) {
    if (state.isApproval || state.isBatch || !state.allChunksResolved) return null
    // Enter on a focused button clicks that button; Enter in an editor types.
    if (target.isEditable || target.isButton) return null
    return 'accept'
  }

  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.altKey && !mod && !event.shiftKey) {
    if (state.isBatch || state.viewMode !== 'diff' || state.chunkCount === 0) return null
    return event.key === 'ArrowDown' ? 'next-chunk' : 'prev-chunk'
  }

  return null
}
