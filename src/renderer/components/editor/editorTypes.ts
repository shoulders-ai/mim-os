import type { DocumentCitationGroup } from '../../services/citationHealth.js'
import type { PersistedTabKind } from '../../services/editorTabPersistence.js'

export type TabKind = PersistedTabKind

export interface FileVersion {
  hash: string
  size?: number
  mtimeMs?: number
  modifiedAt?: string
}

export interface TabState {
  id: string
  kind: TabKind
  path: string
  name: string
  content: string
  originalContent: string
  version?: FileVersion
  dirty: boolean
  readOnly?: boolean
  externalState?: 'changed' | 'deleted'
  truncated?: boolean
  editorState?: any
  editorScrollSnapshot?: any
}

export type ViewMode = 'source' | 'split' | 'preview'

export const VIEW_MODES: ViewMode[] = ['source', 'split', 'preview']

export interface HistoryPreviewPayload {
  path: string
  versionId: string
  kind: 'text' | 'deleted'
  content: string
  label: string
  relativeTime: string
  exactTime: string
  event: string
  actor: string
  added: number
  removed: number
}

export interface EditorReference {
  key: string
  author: string
  year: string
  title: string
  fields?: Record<string, string>
  source?: string
  venue?: string
  journal?: string
  booktitle?: string
  doi?: string
  url?: string
  file?: string
  type?: string
  [key: string]: unknown
}

export interface BibliographyCandidate {
  path: string
  source: string
  matched: number
  total: number
  unresolvedKeys?: string[]
}

export type DocumentCitation = DocumentCitationGroup<EditorReference>
