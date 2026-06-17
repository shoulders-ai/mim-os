import { describe, expect, it } from 'vitest'
import {
  addComment,
  addCommentAtRawRange,
  appendCommentReply,
  escapeNoteText,
  findCommentById,
  generateCommentId,
  lineNumberAt,
  parseComments,
  resolveComment,
  stripComments,
  strippedRangeToRawRange,
  unescapeNoteText,
} from './model.js'

describe('comment model', () => {
  const source = 'We propose <comment id="k3f9">a staged rollout<note by="paul" at="2026-06-13T09:14">Too slow &amp; risky</note><note by="ai" at="2026-06-13T09:20">Phase &lt;2&gt; gates it.</note></comment> over six weeks.'

  it('parses comment wrappers with uniform note children', () => {
    const threads = parseComments(source)

    expect(threads).toHaveLength(1)
    expect(threads[0]).toMatchObject({
      id: 'k3f9',
      anchor: 'a staged rollout',
      notes: [
        { by: 'paul', at: '2026-06-13T09:14', text: 'Too slow & risky' },
        { by: 'ai', at: '2026-06-13T09:20', text: 'Phase <2> gates it.' },
      ],
    })
    expect(source.slice(threads[0].anchorFrom, threads[0].anchorTo)).toBe('a staged rollout')
    expect(source.slice(threads[0].tagFrom, threads[0].tagTo)).toMatch(/^<comment/)
  })

  it('strips parsed comments while preserving anchor text and offset mapping', () => {
    const stripped = stripComments(source)

    expect(stripped.text).toBe('We propose a staged rollout over six weeks.')
    const from = stripped.text.indexOf('a staged rollout')
    const to = from + 'a staged rollout'.length
    expect(strippedRangeToRawRange(stripped, from, to)).toEqual({
      from: source.indexOf('a staged rollout'),
      to: source.indexOf('a staged rollout') + 'a staged rollout'.length,
    })
  })

  it('escapes only the note-body characters that break element content', () => {
    expect(escapeNoteText('A&B < C > D')).toBe('A&amp;B &lt; C > D')
    expect(unescapeNoteText('A&amp;B &lt; C &gt; D')).toBe('A&B < C > D')
  })

  it('adds a comment by matching human-visible stripped text', () => {
    const raw = 'Alpha <comment id="old1">Beta<note by="u" at="2026-06-13T09:00">x</note></comment> Gamma.'
    const result = addComment(raw, {
      anchorText: 'Gamma',
      text: 'Check this',
      by: 'Paul Smith',
      at: '2026-06-13T09:30',
      generateId: () => 'new1',
    })

    expect(result.thread.id).toBe('new1')
    expect(stripComments(result.text).text).toBe('Alpha Beta Gamma.')
    expect(result.text).toContain('<comment id="new1">Gamma<note by="Paul-Smith" at="2026-06-13T09:30">Check this</note></comment>')
  })

  it('adds a comment at an exact raw range for editor selections', () => {
    const raw = 'First repeated repeated last.'
    const from = raw.lastIndexOf('repeated')
    const result = addCommentAtRawRange(raw, {
      from,
      to: from + 'repeated'.length,
      text: 'Use the second occurrence',
      by: 'Paul',
      at: '2026-06-13T09:31',
      generateId: () => 'raw2',
    })

    expect(result.text).toBe('First repeated <comment id="raw2">repeated<note by="Paul" at="2026-06-13T09:31">Use the second occurrence</note></comment> last.')
    expect(result.thread.anchorFrom).toBe(result.text.indexOf('repeated<note'))
  })

  it('refuses exact raw ranges that touch hidden comment markup', () => {
    const from = source.indexOf('staged')
    expect(() => addCommentAtRawRange(source, {
      from,
      to: from + 'staged'.length,
      text: 'x',
      at: '2026-06-13T09:31',
      generateId: () => 'raw3',
    })).toThrow(/intersects existing comment/)
  })

  it('falls back to raw matching only when visible matching finds nothing', () => {
    const result = addComment('before **raw** after', {
      anchorText: '**raw**',
      text: 'Markdown syntax included',
      by: 'user',
      at: '2026-06-13T09:30',
      generateId: () => 'raw1',
    })

    expect(result.text).toBe('before <comment id="raw1">**raw**<note by="user" at="2026-06-13T09:30">Markdown syntax included</note></comment> after')
  })

  it('refuses ambiguous visible anchors', () => {
    expect(() => addComment('same same', {
      anchorText: 'same',
      text: 'x',
      by: 'user',
      at: '2026-06-13T09:30',
      generateId: () => 'a1',
    })).toThrow(/matches 2 locations/)
  })

  it('refuses anchors that intersect an existing comment tag', () => {
    expect(() => addComment(source, {
      anchorText: 'a staged rollout',
      text: 'x',
      by: 'user',
      at: '2026-06-13T09:30',
      generateId: () => 'a1',
    })).toThrow(/intersects existing comment/)
  })

  it('appends replies before the closing comment tag', () => {
    const result = appendCommentReply(source, {
      id: 'k3f9',
      text: 'Agreed <mostly>',
      by: 'ai',
      at: '2026-06-13T10:01',
    })

    const thread = findCommentById(result.text, 'k3f9')
    expect(thread?.notes.at(-1)).toEqual({
      by: 'ai',
      at: '2026-06-13T10:01',
      text: 'Agreed <mostly>',
    })
    expect(result.text).toContain('<note by="ai" at="2026-06-13T10:01">Agreed &lt;mostly></note></comment>')
  })

  it('resolves by deleting wrapper and notes while keeping anchor text', () => {
    const result = resolveComment(source, 'k3f9')

    expect(result.text).toBe('We propose a staged rollout over six weeks.')
    expect(result.anchor).toBe('a staged rollout')
  })

  it('ignores malformed comment tags instead of stripping or mutating them', () => {
    const malformed = 'A <comment id="bad">broken<note by="u" at="x">missing close</comment> B'

    expect(parseComments(malformed)).toEqual([])
    expect(stripComments(malformed).text).toBe(malformed)
  })

  it('returns one-based raw line numbers', () => {
    expect(lineNumberAt('a\nb\nc', 0)).toBe(1)
    expect(lineNumberAt('a\nb\nc', 2)).toBe(2)
    expect(lineNumberAt('a\nb\nc', 4)).toBe(3)
  })

  it('generates short unique base36 ids', () => {
    let n = 0
    const id = generateCommentId(new Set(['0000', '0001']), () => n++ / 100000)

    expect(id).toMatch(/^[0-9a-z]{4,6}$/)
    expect(id).not.toBe('0000')
    expect(id).not.toBe('0001')
  })
})
