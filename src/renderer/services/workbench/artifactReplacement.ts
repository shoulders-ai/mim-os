import type { ArtifactEntry } from './entries.js'
import type { ArtifactReplacementDecision } from '../../stores/workbench.js'

export interface EditorDocumentState {
  path: string
  name: string
  dirty: boolean
}

export function editorArtifactReplacementDecision(
  current: ArtifactEntry,
  next: ArtifactEntry | null,
  document: EditorDocumentState | null,
): ArtifactReplacementDecision {
  if (current.id === next?.id) return 'yes'
  if (!document?.dirty) return 'yes'

  if (current.kind === 'file') {
    return document.path === current.path ? 'needs-confirmation' : 'yes'
  }

  if (current.kind === 'editor') {
    return 'needs-confirmation'
  }

  return 'yes'
}
