import { describe, expect, it } from 'vitest'
import {
  fieldToColumnIndex,
  parseDelimitedTable,
  rowsToRecords,
  serializeDelimitedTable,
  setCellValue,
  tableStats,
} from './tableArtifactModel.js'

describe('tableArtifactModel', () => {
  it('parses CSV with headers and preserves trailing newline on serialize', () => {
    const model = parseDelimitedTable('Name,Score\nAda,10\nBen,8\n', 'data/scores.csv')

    expect(model.delimiter).toBe(',')
    expect(model.newline).toBe('\n')
    expect(model.trailingNewline).toBe(true)
    expect(model.columns.map(column => column.label)).toEqual(['Name', 'Score'])
    expect(tableStats(model)).toEqual({ rows: 2, cols: 2 })
    expect(rowsToRecords(model)).toEqual([
      { __rowIndex: 0, c0: 'Ada', c1: '10' },
      { __rowIndex: 1, c0: 'Ben', c1: '8' },
    ])
    expect(serializeDelimitedTable(model)).toBe('Name,Score\nAda,10\nBen,8\n')
  })

  it('uses synthetic column ids so duplicate and blank headers are not lossy', () => {
    const model = parseDelimitedTable('Name,Name,\nAda,One,Two\n', 'data/dupes.csv')

    expect(model.columns).toMatchObject([
      { id: 'c0', label: 'Name', rawHeader: 'Name' },
      { id: 'c1', label: 'Name', rawHeader: 'Name' },
      { id: 'c2', label: 'Column 3', rawHeader: '' },
    ])
    expect(serializeDelimitedTable(model)).toBe('Name,Name,\nAda,One,Two\n')
  })

  it('preserves ragged rows unless a user edits beyond the original width', () => {
    const model = parseDelimitedTable('A,B,C\n1\n2,3\n', 'data/ragged.csv')

    expect(rowsToRecords(model)).toEqual([
      { __rowIndex: 0, c0: '1', c1: '', c2: '' },
      { __rowIndex: 1, c0: '2', c1: '3', c2: '' },
    ])
    expect(serializeDelimitedTable(model)).toBe('A,B,C\n1\n2,3\n')

    setCellValue(model, 0, 2, 'filled')

    expect(serializeDelimitedTable(model)).toBe('A,B,C\n1,,filled\n2,3\n')
  })

  it('keeps TSV delimiter and CRLF newline', () => {
    const model = parseDelimitedTable('A\tB\r\n1\t2\r\n', 'data/input.tsv')

    expect(model.delimiter).toBe('\t')
    expect(model.newline).toBe('\r\n')
    expect(serializeDelimitedTable(model)).toBe('A\tB\r\n1\t2\r\n')
  })

  it('maps AG Grid field ids back to column indexes', () => {
    expect(fieldToColumnIndex('c0')).toBe(0)
    expect(fieldToColumnIndex('c12')).toBe(12)
    expect(fieldToColumnIndex('name')).toBeNull()
    expect(fieldToColumnIndex(null)).toBeNull()
  })
})
