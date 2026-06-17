import { describe, expect, it } from 'vitest'
import {
  computeCitationHealth,
  groupDocumentCitations,
  nextCitationOccurrence,
} from './citationHealth.js'

const refs = [
  { key: 'smith2020', author: 'Smith, Jane', year: '2020', title: 'A Study' },
  { key: 'doe2019', author: 'Doe, John', year: '2019', title: 'A Book' },
]

describe('computeCitationHealth', () => {
  it('stays dormant when no bibliography is active', () => {
    expect(computeCitationHealth('See [@missing].', refs, false)).toEqual({
      enabled: false,
      total: 0,
      unresolved: [],
      allResolved: true,
    })
  })

  it('counts resolved and unresolved citation keys', () => {
    const result = computeCitationHealth('See [@smith2020; @missing] and @doe2019.', refs, true)

    expect(result.total).toBe(3)
    expect(result.allResolved).toBe(false)
    expect(result.unresolved).toEqual([
      expect.objectContaining({ key: 'missing' }),
    ])
  })

  it('ignores fenced code blocks and inline code spans', () => {
    const markdown = [
      'See [@smith2020].',
      '',
      '```',
      'not prose [@missing]',
      '```',
      '',
      'Ignore `[@alsoMissing]` too.',
    ].join('\n')

    const result = computeCitationHealth(markdown, refs, true)

    expect(result.total).toBe(1)
    expect(result.unresolved).toEqual([])
    expect(result.allResolved).toBe(true)
  })

  it('returns source positions so the editor can jump to the next unresolved key', () => {
    const markdown = 'First [@missing]. Then [@smith2020].'
    const result = computeCitationHealth(markdown, refs, true)

    expect(result.unresolved).toEqual([
      {
        key: 'missing',
        from: markdown.indexOf('@missing'),
        to: markdown.indexOf('@missing') + '@missing'.length,
      },
    ])
  })
})

describe('groupDocumentCitations', () => {
  it('returns an empty list when the document cites nothing', () => {
    expect(groupDocumentCitations('No citations here.', refs)).toEqual([])
  })

  it('groups repeated keys, counts occurrences, and resolves references', () => {
    const markdown = 'See [@smith2020]. Later [@doe2019] and again [@smith2020].'
    const groups = groupDocumentCitations(markdown, refs)

    expect(groups.map(group => group.key)).toEqual(['smith2020', 'doe2019'])

    const smith = groups[0]
    expect(smith.resolved).toBe(true)
    expect(smith.reference?.title).toBe('A Study')
    expect(smith.occurrences).toHaveLength(2)
    expect(smith.occurrences.map(item => item.from)).toEqual([
      markdown.indexOf('@smith2020'),
      markdown.lastIndexOf('@smith2020'),
    ])
  })

  it('sorts unresolved keys first while preserving document order within each group', () => {
    const markdown = 'A [@smith2020], B [@missing], C [@doe2019], D [@alsoMissing].'
    const groups = groupDocumentCitations(markdown, refs)

    expect(groups.map(group => group.key)).toEqual(['missing', 'alsoMissing', 'smith2020', 'doe2019'])
    expect(groups.map(group => group.resolved)).toEqual([false, false, true, true])
    expect(groups.find(group => group.key === 'missing')?.reference).toBeNull()
  })
})

describe('nextCitationOccurrence', () => {
  const markdown = 'One [@smith2020]. Two [@smith2020]. Three [@smith2020].'
  const positions = [
    markdown.indexOf('@smith2020'),
    markdown.indexOf('@smith2020', markdown.indexOf('@smith2020') + 1),
    markdown.lastIndexOf('@smith2020'),
  ]

  it('returns the first occurrence after the cursor', () => {
    expect(nextCitationOccurrence(markdown, 'smith2020', 0)?.from).toBe(positions[0])
    expect(nextCitationOccurrence(markdown, 'smith2020', positions[0])?.from).toBe(positions[1])
    expect(nextCitationOccurrence(markdown, 'smith2020', positions[1])?.from).toBe(positions[2])
  })

  it('wraps back to the first occurrence past the last one', () => {
    expect(nextCitationOccurrence(markdown, 'smith2020', positions[2])?.from).toBe(positions[0])
  })

  it('returns null when the key is not cited in the document', () => {
    expect(nextCitationOccurrence(markdown, 'doe2019', 0)).toBeNull()
  })
})
