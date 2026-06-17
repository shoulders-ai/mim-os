import { describe, expect, it } from 'vitest'
import {
  backHistory,
  createPaneHistory,
  forwardHistory,
  openHistoryEntry,
  removeHistoryEntry,
  replaceHistoryEntry,
} from './history.js'

interface TestEntry {
  id: string
  title: string
}

function entry(id: string): TestEntry {
  return { id, title: id.toUpperCase() }
}

describe('pane history', () => {
  it('opens entries, tracks back history, and clears forward history', () => {
    let history = createPaneHistory<TestEntry>()

    history = openHistoryEntry(history, entry('a'))
    history = openHistoryEntry(history, entry('b'))
    history = openHistoryEntry(history, entry('c'))

    expect(history.current?.id).toBe('c')
    expect(history.backStack.map(item => item.id)).toEqual(['a', 'b'])
    expect(history.forwardStack).toEqual([])

    history = backHistory(history)
    expect(history.current?.id).toBe('b')
    expect(history.forwardStack.map(item => item.id)).toEqual(['c'])

    history = openHistoryEntry(history, entry('d'))
    expect(history.current?.id).toBe('d')
    expect(history.backStack.map(item => item.id)).toEqual(['a', 'b'])
    expect(history.forwardStack).toEqual([])
  })

  it('moves backward and forward without losing entries', () => {
    let history = createPaneHistory<TestEntry>()
    history = openHistoryEntry(history, entry('a'))
    history = openHistoryEntry(history, entry('b'))
    history = openHistoryEntry(history, entry('c'))

    history = backHistory(history)
    history = backHistory(history)
    expect(history.current?.id).toBe('a')
    expect(history.backStack).toEqual([])
    expect(history.forwardStack.map(item => item.id)).toEqual(['b', 'c'])

    history = forwardHistory(history)
    expect(history.current?.id).toBe('b')
    expect(history.backStack.map(item => item.id)).toEqual(['a'])
    expect(history.forwardStack.map(item => item.id)).toEqual(['c'])
  })

  it('collapses duplicate consecutive entries by stable id', () => {
    let history = createPaneHistory<TestEntry>()
    history = openHistoryEntry(history, entry('a'))
    history = openHistoryEntry(history, { id: 'a', title: 'Renamed A' })

    expect(history.current).toEqual({ id: 'a', title: 'Renamed A' })
    expect(history.backStack).toEqual([])
  })

  it('can replace current without pushing to back stack', () => {
    let history = createPaneHistory<TestEntry>()
    history = openHistoryEntry(history, entry('a'))
    history = replaceHistoryEntry(history, entry('b'))

    expect(history.current?.id).toBe('b')
    expect(history.backStack).toEqual([])
    expect(history.forwardStack).toEqual([])
  })

  it('keeps failed entries as normal history entries until explicitly removed', () => {
    let history = createPaneHistory<TestEntry & { failed?: boolean }>()
    history = openHistoryEntry(history, entry('a'))
    history = openHistoryEntry(history, { ...entry('missing'), failed: true })

    expect(history.current?.id).toBe('missing')

    history = backHistory(history)
    expect(history.current?.id).toBe('a')
    expect(history.forwardStack.map(item => item.id)).toEqual(['missing'])

    history = removeHistoryEntry(history, 'missing')
    expect(history.forwardStack).toEqual([])
  })
})
