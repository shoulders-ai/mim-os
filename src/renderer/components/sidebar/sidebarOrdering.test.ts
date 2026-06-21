import { describe, expect, it } from 'vitest'
import { applyManualOrder, reorderKeys, sortWithManualOrder } from './sidebarOrdering.js'

describe('sidebar ordering', () => {
  it('keeps unordered activity rows in stable input order (no recency jump)', () => {
    const rows = [
      { key: 'chat:old' },
      { key: 'chat:new' },
      { key: 'package:run' },
    ]

    expect(sortWithManualOrder(rows, ['chat:old']).map(row => row.key)).toEqual([
      'chat:new',
      'package:run',
      'chat:old',
    ])
  })

  it('does not reorder unordered rows when timestamps differ', () => {
    const rows = [
      { key: 'chat:a' },
      { key: 'chat:b' },
      { key: 'chat:c' },
    ]

    expect(sortWithManualOrder(rows, []).map(row => row.key)).toEqual([
      'chat:a',
      'chat:b',
      'chat:c',
    ])
  })

  it('respects manual order for rows already in the saved order', () => {
    const rows = [
      { key: 'chat:first' },
      { key: 'chat:second' },
      { key: 'package:run' },
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
    // New destinations (e.g. a freshly enabled app) appear after the
    // saved order rather than disappearing or jumping to the top.
    expect(applyManualOrder(rows, ['b']).map(row => row.key)).toEqual(['b', 'a', 'c'])
  })

  it('ignores saved keys whose rows no longer exist', () => {
    expect(applyManualOrder(rows, ['gone', 'b']).map(row => row.key)).toEqual(['b', 'a', 'c'])
  })
})
