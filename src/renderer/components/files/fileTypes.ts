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
  disabled?: boolean
  // Renders a group header above the Team Files root.
  sectionLabel?: string
}

export type FileRowBase = Omit<FileRow, 'gi'>

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
