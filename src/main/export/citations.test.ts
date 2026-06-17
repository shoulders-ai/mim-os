import { describe, expect, it } from 'vitest'
import {
  buildBibliography,
  builtinCitationStyleXml,
  formatAuthorsApa,
  parseAuthors,
  parseBibtex,
  resolveCitations,
  type BibEntry,
} from './citations.js'

const BIB = `
@article{smith2020,
  author = {Smith, Alice B. and Jones, Carol},
  title = {On the Nature of Things},
  journal = {Journal of Important Results},
  year = {2020},
  volume = {12},
  number = {3},
  pages = {45--67},
  doi = {10.1000/xyz},
}

@book{doe2019,
  author = "Doe, John",
  title = "A Long Book",
  publisher = "Big Press",
  year = "2019",
}

@misc{webthing2021,
  author = {Roe, Richard},
  title = {Some Web Thing},
  year = {2021},
  url = {https://example.com/thing},
}
`

describe('parseBibtex', () => {
  it('parses brace and quote delimited entries', () => {
    const entries = parseBibtex(BIB)
    expect(entries.map(e => e.key)).toEqual(['smith2020', 'doe2019', 'webthing2021'])
    expect(entries[0].type).toBe('article')
    expect(entries[0].fields.title).toBe('On the Nature of Things')
    expect(entries[1].fields.publisher).toBe('Big Press')
  })

  it('tolerates nested braces and strips LaTeX grouping braces', () => {
    const entries = parseBibtex(`@article{k1, title = {The {HIV} Study {of} 2020}, year = {2020} }`)
    expect(entries[0].fields.title).toBe('The HIV Study of 2020')
  })

  it('normalizes whitespace and double-dash page ranges', () => {
    const entries = parseBibtex(`@article{k1, pages = {10--20}, title={A\n  B} }`)
    expect(entries[0].fields.pages).toBe('10–20')
    expect(entries[0].fields.title).toBe('A B')
  })

  it('skips comments and garbage between entries', () => {
    const entries = parseBibtex(`% a comment\njunk text\n@comment{ignored}\n@article{ok, year={2000}}`)
    expect(entries.map(e => e.key)).toEqual(['ok'])
  })

  it('returns empty array for empty or invalid input', () => {
    expect(parseBibtex('')).toEqual([])
    expect(parseBibtex('no entries here')).toEqual([])
  })
})

describe('parseAuthors', () => {
  it('splits on "and" and handles Last, First order', () => {
    expect(parseAuthors('Smith, Alice B. and Jones, Carol')).toEqual([
      { family: 'Smith', given: 'Alice B.' },
      { family: 'Jones', given: 'Carol' },
    ])
  })

  it('handles First Last order', () => {
    expect(parseAuthors('Alice Smith and Bob de la Cruz')).toEqual([
      { family: 'Smith', given: 'Alice' },
      { family: 'de la Cruz', given: 'Bob' },
    ])
  })
})

describe('formatAuthorsApa', () => {
  it('renders initials with ampersand', () => {
    expect(formatAuthorsApa([
      { family: 'Smith', given: 'Alice B.' },
      { family: 'Jones', given: 'Carol' },
    ])).toBe('Smith, A. B., & Jones, C.')
  })
})

describe('resolveCitations', () => {
  const entries = parseBibtex(BIB)

  it('replaces [@key] with APA author-year', () => {
    const result = resolveCitations('As shown [@smith2020].', entries, 'apa')
    expect(result.markdown).toBe('As shown (Smith & Jones, 2020).')
    expect(result.usedKeys).toEqual(['smith2020'])
    expect(result.unresolvedKeys).toEqual([])
  })

  it('groups multi-key citations [@a; @b]', () => {
    const result = resolveCitations('Known [@smith2020; @doe2019].', entries, 'apa')
    expect(result.markdown).toBe('Known (Smith & Jones, 2020; Doe, 2019).')
  })

  it('numbers citations in order of first appearance for IEEE', () => {
    const result = resolveCitations('B [@doe2019]. A [@smith2020]. B again [@doe2019].', entries, 'ieee')
    expect(result.markdown).toBe('B [1]. A [2]. B again [1].')
    expect(result.usedKeys).toEqual(['doe2019', 'smith2020'])
  })

  it('renders chicago author-date without comma', () => {
    const result = resolveCitations('See [@doe2019].', entries, 'chicago')
    expect(result.markdown).toBe('See (Doe 2019).')
  })

  it('uses et al. for three or more authors', () => {
    const three = parseBibtex(`@article{trio2022, author={A, X and B, Y and C, Z}, year={2022}}`)
    const result = resolveCitations('[@trio2022]', three, 'apa')
    expect(result.markdown).toBe('(A et al., 2022)')
  })

  it('skips fenced code blocks and inline code', () => {
    const md = 'Real [@smith2020].\n\n```\nfake [@doe2019]\n```\n\nAnd `inline [@doe2019]` stays.'
    const result = resolveCitations(md, entries, 'apa')
    expect(result.markdown).toContain('Real (Smith & Jones, 2020).')
    expect(result.markdown).toContain('fake [@doe2019]')
    expect(result.markdown).toContain('`inline [@doe2019]`')
    expect(result.usedKeys).toEqual(['smith2020'])
  })

  it('keeps unknown keys verbatim and reports them', () => {
    const result = resolveCitations('Missing [@nope].', entries, 'apa')
    expect(result.markdown).toBe('Missing [@nope].')
    expect(result.unresolvedKeys).toEqual(['nope'])
  })

  it('does not touch email-like or escaped brackets', () => {
    const result = resolveCitations('mail me at a@b.com [no cite]', entries, 'apa')
    expect(result.markdown).toBe('mail me at a@b.com [no cite]')
  })
})

describe('buildBibliography', () => {
  const entries = parseBibtex(BIB)

  it('builds APA references alphabetically with italic journal runs', () => {
    const refs = buildBibliography(entries, ['smith2020', 'doe2019'], 'apa')
    expect(refs.map(r => r.key)).toEqual(['doe2019', 'smith2020'])
    const smith = refs[1]
    const text = smith.runs.map(r => r.text).join('')
    expect(text).toBe('Smith, A. B., & Jones, C. (2020). On the Nature of Things. Journal of Important Results, 12(3), 45–67. https://doi.org/10.1000/xyz')
    const italicParts = smith.runs.filter(r => r.italic).map(r => r.text)
    expect(italicParts).toContain('Journal of Important Results')
  })

  it('italicizes book titles in APA', () => {
    const refs = buildBibliography(entries, ['doe2019'], 'apa')
    const doe = refs[0]
    expect(doe.runs.map(r => r.text).join('')).toBe('Doe, J. (2019). A Long Book. Big Press.')
    expect(doe.runs.find(r => r.text === 'A Long Book')?.italic).toBe(true)
  })

  it('numbers IEEE references in citation order', () => {
    const refs = buildBibliography(entries, ['doe2019', 'smith2020'], 'ieee')
    expect(refs[0].label).toBe('[1]')
    expect(refs[0].key).toBe('doe2019')
    const text = refs[1].runs.map(r => r.text).join('')
    expect(text).toContain('A. B. Smith and C. Jones')
    expect(text).toContain('vol. 12')
    expect(text).toContain('no. 3')
    expect(text).toContain('pp. 45–67')
  })

  it('formats chicago with quoted article titles', () => {
    const refs = buildBibliography(entries, ['smith2020'], 'chicago')
    const text = refs[0].runs.map(r => r.text).join('')
    expect(text).toBe('Smith, Alice B., and Carol Jones. 2020. “On the Nature of Things.” Journal of Important Results 12 (3): 45–67. https://doi.org/10.1000/xyz.')
  })

  it('includes url for misc entries', () => {
    const refs = buildBibliography(entries, ['webthing2021'], 'apa')
    const text = refs[0].runs.map(r => r.text).join('')
    expect(text).toContain('https://example.com/thing')
  })

  it('only includes used keys', () => {
    const refs = buildBibliography(entries, ['doe2019'], 'apa')
    expect(refs).toHaveLength(1)
  })

  it('can render built-in styles through citeproc CSL', () => {
    const styleXml = builtinCitationStyleXml('apa')!
    const resolved = resolveCitations('As shown [@smith2020].', entries, 'apa', { styleXml })
    expect(resolved.markdown).toContain('Smith')
    expect(resolved.markdown).toContain('2020')
    const refs = buildBibliography(entries, resolved.usedKeys, 'apa', { styleXml })
    const smith = refs.find(ref => ref.key === 'smith2020')!
    expect(smith.runs.map(run => run.text).join('')).toContain('On the Nature of Things')
    expect(smith.runs.some(run => run.italic && run.text.includes('Journal of Important Results'))).toBe(true)
  })

  it('renders IEEE numbering through citeproc in first-citation order', () => {
    const styleXml = builtinCitationStyleXml('ieee')!
    const resolved = resolveCitations('B [@doe2019]. A [@smith2020]. B again [@doe2019].', entries, 'ieee', { styleXml })
    expect(resolved.markdown).toBe('B [1]. A [2]. B again [1].')
    const refs = buildBibliography(entries, resolved.usedKeys, 'ieee', { styleXml })
    expect(refs.map(ref => ref.label)).toEqual(['[1]', '[2]'])
    expect(refs.map(ref => ref.key)).toEqual(['doe2019', 'smith2020'])
  })
})

describe('round trip', () => {
  it('resolves and builds a consistent IEEE document', () => {
    const entries: BibEntry[] = parseBibtex(BIB)
    const resolved = resolveCitations('First [@webthing2021], then [@smith2020; @doe2019].', entries, 'ieee')
    expect(resolved.markdown).toBe('First [1], then [2, 3].')
    const refs = buildBibliography(entries, resolved.usedKeys, 'ieee')
    expect(refs.map(r => r.label)).toEqual(['[1]', '[2]', '[3]'])
    expect(refs.map(r => r.key)).toEqual(['webthing2021', 'smith2020', 'doe2019'])
  })
})
