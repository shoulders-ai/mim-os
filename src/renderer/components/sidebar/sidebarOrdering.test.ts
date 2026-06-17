import { describe, expect, it } from 'vitest'
import { applyManualOrder, reorderKeys, sortWithManualOrder } from './sidebarOrdering.js'

describe('sidebar ordering', () => {
  it('puts new unordered activity above manually ordered rows', () => {
    const rows = [
      { key: 'chat:old', updatedAt: '2026-01-01T00:00:00.000Z' },
      { key: 'chat:new', updatedAt: '2026-01-03T00:00:00.000Z' },
      { key: 'package:run', updatedAt: '2026-01-02T00:00:00.000Z' },
    ]

    expect(sortWithManualOrder(rows, ['chat:old']).map(row => row.key)).toEqual([
      'chat:new',
      'package:run',
      'chat:old',
    ])
  })

  it('respects manual order for rows already in the saved order', () => {
    const rows = [
      { key: 'chat:first', updatedAt: '2026-01-03T00:00:00.000Z' },
      { key: 'chat:second', updatedAt: '2026-01-02T00:00:00.000Z' },
      { key: 'package:run', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]

    expect(sortWithManualOrder(rows, ['package:run', 'chat:second', 'chat:first']).map(row => row.key)).toEqual([
      'package:run',
      'chat:second',
      'chat:first',
    ])
  })

  it('moves a dragged key before the drop target', () => {
    expect(reorderKeys(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('moves a dragged key to the end when there is no before target', () => {
    expect(reorderKeys(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a'])
  })
})

describe('applyManualOrder', () => {
  const rows = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]

  it('keeps canonical order when no manual order is saved', () => {
    expect(applyManualOrder(rows, []).map(row => row.key)).toEqual(['a', 'b', 'c'])
  })

  it('puts manually ordered rows first, in saved order', () => {
    expect(applyManualOrder(rows, ['c', 'a']).map(row => row.key)).toEqual(['c', 'a', 'b'])
  })

  it('appends rows missing from the saved order in canonical order', () => {
    // New destinations (e.g. a freshly enabled package) appear after the
    // saved order rather than disappearing or jumping to the top.
    expect(applyManualOrder(rows, ['b']).map(row => row.key)).toEqual(['b', 'a', 'c'])
  })

  it('ignores saved keys whose rows no longer exist', () => {
    expect(applyManualOrder(rows, ['gone', 'b']).map(row => row.key)).toEqual(['b', 'a', 'c'])
  })
})
