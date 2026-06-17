import Papa from 'papaparse'

export interface FileVersion {
  hash: string
  size?: number
  mtimeMs?: number
  modifiedAt?: string
}

export interface TableColumn {
  id: string
  index: number
  label: string
  rawHeader: string
}

export interface TableStats {
  rows: number
  cols: number
}

export interface TableModel {
  rows: string[][]
  columns: TableColumn[]
  delimiter: string
  newline: string
  trailingNewline: boolean
  originalSerialized: string
  errors: string[]
}

export interface TableRowRecord {
  __rowIndex: number
  [field: string]: string | number
}

export function extractFileVersion(result: unknown): FileVersion | undefined {
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  const version = record.version && typeof record.version === 'object'
    ? record.version as Record<string, unknown>
    : undefined
  const hash = typeof version?.hash === 'string'
    ? version.hash
    : typeof record.hash === 'string'
      ? record.hash
      : undefined
  if (!hash) return undefined
  return {
    hash,
    size: typeof version?.size === 'number' ? version.size : undefined,
    mtimeMs: typeof version?.mtimeMs === 'number' ? version.mtimeMs : undefined,
    modifiedAt: typeof version?.modifiedAt === 'string' ? version.modifiedAt : undefined,
  }
}

export function parseDelimitedTable(content: string, path = ''): TableModel {
  const newline = detectNewline(content)
  const trailingNewline = hasTrailingNewline(content)
  const fallbackDelimiter = fallbackDelimiterForPath(path)
  const parsed = Papa.parse<string[]>(content, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
    delimiter: fallbackDelimiter === ',' ? undefined : fallbackDelimiter,
  })
  const rows = normalizeParsedRows(parsed.data)
  if (trailingNewline && rows.length > 0 && isSingleEmptyCellRow(rows[rows.length - 1])) {
    rows.pop()
  }

  const delimiter = fallbackDelimiter !== ','
    ? fallbackDelimiter
    : (validDelimiter(parsed.meta.delimiter) ? parsed.meta.delimiter : fallbackDelimiter)
  const columns = buildColumns(rows)
  const model: TableModel = {
    rows,
    columns,
    delimiter,
    newline,
    trailingNewline,
    originalSerialized: '',
    errors: parsed.errors.map(error => error.message),
  }
  model.originalSerialized = serializeDelimitedTable(model)
  return model
}

export function serializeDelimitedTable(model: Pick<TableModel, 'rows' | 'delimiter' | 'newline' | 'trailingNewline'>): string {
  if (model.rows.length === 0) return ''
  const serialized = Papa.unparse(model.rows, {
    delimiter: model.delimiter,
    newline: model.newline,
    header: false,
  })
  return model.trailingNewline ? `${serialized}${model.newline}` : serialized
}

export function tableStats(model: Pick<TableModel, 'rows' | 'columns'>): TableStats {
  return {
    rows: Math.max(0, model.rows.length - 1),
    cols: model.columns.length,
  }
}

export function rowsToRecords(model: TableModel): TableRowRecord[] {
  return model.rows.slice(1).map((row, rowIndex) => rowToRecord(row, rowIndex, model.columns))
}

export function rowToRecord(row: string[], rowIndex: number, columns: TableColumn[]): TableRowRecord {
  const record: TableRowRecord = { __rowIndex: rowIndex }
  for (const column of columns) {
    record[column.id] = row[column.index] ?? ''
  }
  return record
}

export function fieldToColumnIndex(field: unknown): number | null {
  if (typeof field !== 'string') return null
  const match = /^c(\d+)$/.exec(field)
  if (!match) return null
  const index = Number(match[1])
  return Number.isInteger(index) && index >= 0 ? index : null
}

export function setCellValue(model: TableModel, dataRowIndex: number, columnIndex: number, value: string): void {
  const rowIndex = dataRowIndex + 1
  while (model.rows.length <= rowIndex) model.rows.push([])
  const row = model.rows[rowIndex]
  while (row.length <= columnIndex) row.push('')
  row[columnIndex] = value
  if (columnIndex >= model.columns.length) {
    model.columns = buildColumns(model.rows)
  }
}

function normalizeParsedRows(rows: unknown[]): string[][] {
  const normalized: string[][] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    normalized.push(row.map(value => value == null ? '' : String(value)))
  }
  return normalized
}

function buildColumns(rows: string[][]): TableColumn[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const header = rows[0] ?? []
  return Array.from({ length: width }, (_, index) => {
    const rawHeader = header[index] ?? ''
    const trimmed = rawHeader.trim()
    return {
      id: `c${index}`,
      index,
      label: trimmed || `Column ${index + 1}`,
      rawHeader,
    }
  })
}

function detectNewline(content: string): string {
  const match = /\r\n|\n|\r/.exec(content)
  return match?.[0] ?? '\n'
}

function hasTrailingNewline(content: string): boolean {
  return /\r\n$|\n$|\r$/.test(content)
}

function isSingleEmptyCellRow(row: string[] | undefined): boolean {
  return Array.isArray(row) && row.length === 1 && row[0] === ''
}

function validDelimiter(delimiter: unknown): delimiter is string {
  return typeof delimiter === 'string' && delimiter.length > 0 && !Papa.BAD_DELIMITERS.includes(delimiter)
}

function fallbackDelimiterForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext === 'tsv' || ext === 'tab' ? '\t' : ','
}
