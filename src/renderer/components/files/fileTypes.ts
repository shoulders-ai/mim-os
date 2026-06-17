export type Mode = 'browse' | 'recent' | 'changed'
export type TableMode = Mode | 'search'
export type SortKey = 'name' | 'kindOrLocation' | 'size' | 'modifiedAt' | 'createdAt'
export type SortDirection = 'asc' | 'desc'

export interface FsEntry {
  path: string
  name: string
  type: 'directory' | 'file'
  size?: number
  modifiedAt?: string
  createdAt?: string
  lastChangedBy?: string
}

export interface FileRow {
  path: string
  name: string
  dir: string
  type: 'directory' | 'file'
  kind: string
  size?: number
  modifiedAt?: string
  createdAt?: string
  lastChangedBy?: string
  searchLine?: number
  searchSnippet?: string
  positions: number[]
  level: number
  gi: number
  // Set on mounted resource collection roots (see docs/resources.md).
  collection?: string
  readonly?: boolean
  // Unavailable collections (missing binding/source, not synced) stay listed
  // for discoverability but are inert.
  disabled?: boolean
  statusLabel?: string
  // Renders a group header above this row (first resource root).
  sectionLabel?: string
}

export type FileRowBase = Omit<FileRow, 'gi'>

export interface ResourceRoot {
  id: string
  name: string
  mountPath: string
  write: 'readonly' | 'direct'
  status: string
}

export interface FileContentMatch {
  path: string
  line: number
  snippet: string
}

export interface BreadcrumbItem {
  label: string
  path: string
}

export interface HighlightPart {
  text: string
  hl: boolean
}

export interface RowCompareOptions {
  sortKey: SortKey
  sortDirection: SortDirection
  showLocationColumn: boolean
}
