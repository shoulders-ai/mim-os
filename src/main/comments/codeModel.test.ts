import { describe, expect, it } from 'vitest'
import {
  addCodeComment,
  addCodeCommentAtOffset,
  appendCodeCommentReply,
  commentPrefixForPath,
  deleteCodeCommentNote,
  editCodeCommentNote,
  parseCodeComments,
  resolveAllCodeComments,
  resolveCodeComment,
  supportsCodeCommentPath,
} from './codeModel.js'

describe('code comment model', () => {
  const py = [
    'import math',
    '',
    '# @mim(k3f9) paul 2026-06-13T09:14: This bound looks wrong',
    '# @mim(k3f9) ai 2026-06-13T09:20: Fixed by clamping below',
    'def clamp(x):',
    '    return max(0, x)',
  ].join('\n')

  describe('parseCodeComments', () => {
    it('parses a thread of stacked marker lines anchored to the next code line', () => {
      const threads = parseCodeComments(py)

      expect(threads).toHaveLength(1)
      const thread = threads[0]
      expect(thread.id).toBe('k3f9')
      expect(thread.anchor).toBe('def clamp(x):')
      expect(thread.notes).toEqual([
        { by: 'paul', at: '2026-06-13T09:14', text: 'This bound looks wrong' },
        { by: 'ai', at: '2026-06-13T09:20', text: 'Fixed by clamping below' },
      ])
      expect(py.slice(thread.tagFrom, thread.tagTo)).toBe(
        '# @mim(k3f9) paul 2026-06-13T09:14: This bound looks wrong\n# @mim(k3f9) ai 2026-06-13T09:20: Fixed by clamping below\n',
      )
      expect(py.slice(thread.anchorFrom, thread.anchorTo)).toBe('def clamp(x):')
    })

    it('parses // and <!-- --> marker syntaxes', () => {
      const js = '// @mim(a1b2) paul 2026-06-13T09:14: check this\nconst x = 1\n'
      expect(parseCodeComments(js)[0]).toMatchObject({
        id: 'a1b2',
        anchor: 'const x = 1',
        notes: [{ by: 'paul', at: '2026-06-13T09:14', text: 'check this' }],
      })

      const html = '<!-- @mim(a1b2) paul 2026-06-13T09:14: check this -->\n<div>hello</div>\n'
      expect(parseCodeComments(html)[0]).toMatchObject({
        id: 'a1b2',
        anchor: '<div>hello</div>',
        notes: [{ by: 'paul', at: '2026-06-13T09:14', text: 'check this' }],
      })
    })

    it('separates consecutive marker runs with different ids into stacked threads on the same anchor', () => {
      const doc = [
        '# @mim(aaaa) paul 2026-06-13T09:14: first thread',
        '# @mim(bbbb) ai 2026-06-13T09:15: second thread',
        'target_line = 1',
      ].join('\n')

      const threads = parseCodeComments(doc)
      expect(threads.map(thread => thread.id)).toEqual(['aaaa', 'bbbb'])
      expect(threads[0].anchor).toBe('target_line = 1')
      expect(threads[1].anchor).toBe('target_line = 1')
      expect(threads[0].tagTo).toBe(threads[1].tagFrom)
    })

    it('ignores @mim text that is not a whole-line marker', () => {
      const doc = 'x = 1  # @mim(k3f9) paul 2026-06-13T09:14: trailing\nprint("@mim(k3f9) paul 2026-06-13T09:14: string")\n'
      expect(parseCodeComments(doc)).toEqual([])
    })

    it('anchors a trailing marker block at end of file to an empty anchor', () => {
      const doc = 'x = 1\n# @mim(k3f9) paul 2026-06-13T09:14: dangling'
      const threads = parseCodeComments(doc)
      expect(threads).toHaveLength(1)
      expect(threads[0].anchor).toBe('')
      expect(threads[0].anchorFrom).toBe(doc.length)
    })
  })

  describe('addCodeComment', () => {
    it('inserts a marker line above the unique line containing the anchor text, matching indentation', () => {
      const doc = 'def f(x):\n    return max(0, x)\n'
      const result = addCodeComment(doc, {
        anchorText: 'return max(0, x)',
        text: 'Clamp above too?',
        by: 'paul',
        at: '2026-06-13T09:14',
        generateId: () => 'c001',
        prefix: commentPrefixForPath('f.py')!,
      })

      expect(result.text).toBe('def f(x):\n    # @mim(c001) paul 2026-06-13T09:14: Clamp above too?\n    return max(0, x)\n')
      expect(result.thread.id).toBe('c001')
      expect(result.thread.anchor).toBe('    return max(0, x)')
    })

    it('wraps html markers with the closing sequence', () => {
      const doc = '<div>hello</div>\n'
      const result = addCodeComment(doc, {
        anchorText: '<div>hello</div>',
        text: 'check',
        by: 'paul',
        at: '2026-06-13T09:14',
        generateId: () => 'c001',
        prefix: commentPrefixForPath('page.html')!,
      })
      expect(result.text).toBe('<!-- @mim(c001) paul 2026-06-13T09:14: check -->\n<div>hello</div>\n')
    })

    it('rejects ambiguous and missing anchors', () => {
      const doc = 'same()\nsame()\n'
      const prefix = commentPrefixForPath('f.py')!
      expect(() => addCodeComment(doc, { anchorText: 'same()', text: 'x', prefix })).toThrow(/matches 2 locations/)
      expect(() => addCodeComment(doc, { anchorText: 'missing', text: 'x', prefix })).toThrow(/not found/)
    })

    it('does not match anchor text inside existing marker lines', () => {
      const doc = '# @mim(k3f9) paul 2026-06-13T09:14: fix the clamp\nclamp = 1\n'
      const prefix = commentPrefixForPath('f.py')!
      const result = addCodeComment(doc, {
        anchorText: 'clamp = 1',
        text: 'second',
        by: 'paul',
        at: '2026-06-13T09:15',
        generateId: () => 'c002',
        prefix,
      })
      expect(parseCodeComments(result.text)).toHaveLength(2)
    })

    it('flattens multiline note text to a single marker line', () => {
      const doc = 'x = 1\n'
      const result = addCodeComment(doc, {
        anchorText: 'x = 1',
        text: 'line one\nline two',
        by: 'paul',
        at: '2026-06-13T09:14',
        generateId: () => 'c001',
        prefix: { open: '# ', close: '' },
      })
      expect(result.thread.notes[0].text).toBe('line one line two')
    })
  })

  describe('addCodeCommentAtOffset', () => {
    it('anchors to the line containing the offset', () => {
      const doc = 'a = 1\nb = 2\nc = 3\n'
      const result = addCodeCommentAtOffset(doc, {
        offset: doc.indexOf('b = 2') + 2,
        text: 'why?',
        by: 'paul',
        at: '2026-06-13T09:14',
        generateId: () => 'c001',
        prefix: { open: '# ', close: '' },
      })
      expect(result.text).toBe('a = 1\n# @mim(c001) paul 2026-06-13T09:14: why?\nb = 2\nc = 3\n')
      expect(result.thread.anchor).toBe('b = 2')
    })
  })

  describe('appendCodeCommentReply', () => {
    it('stacks the reply as another marker line with the same id, prefix, and indentation', () => {
      const doc = '    # @mim(k3f9) paul 2026-06-13T09:14: hm\n    x = 1\n'
      const result = appendCodeCommentReply(doc, {
        id: 'k3f9',
        text: 'done',
        by: 'ai',
        at: '2026-06-13T09:20',
      })
      expect(result.text).toBe('    # @mim(k3f9) paul 2026-06-13T09:14: hm\n    # @mim(k3f9) ai 2026-06-13T09:20: done\n    x = 1\n')
      expect(result.thread.notes).toHaveLength(2)
    })

    it('throws for unknown ids', () => {
      expect(() => appendCodeCommentReply('x = 1\n', { id: 'nope', text: 'x' })).toThrow(/not found/i)
    })
  })

  describe('editCodeCommentNote / deleteCodeCommentNote', () => {
    const doc = [
      '# @mim(k3f9) paul 2026-06-13T09:14: first',
      '# @mim(k3f9) ai 2026-06-13T09:20: second',
      'x = 1',
    ].join('\n')

    it('rewrites one note text in place', () => {
      const result = editCodeCommentNote(doc, 'k3f9', 0, 'first, revised')
      expect(result.text).toContain('# @mim(k3f9) paul 2026-06-13T09:14: first, revised\n')
      expect(result.text).toContain('second')
    })

    it('removes a reply line but never the first note', () => {
      const result = deleteCodeCommentNote(doc, 'k3f9', 1)
      expect(result.text).toBe('# @mim(k3f9) paul 2026-06-13T09:14: first\nx = 1')
      expect(() => deleteCodeCommentNote(doc, 'k3f9', 0)).toThrow(/Note not found/)
    })
  })

  describe('resolve', () => {
    it('removes the marker lines and keeps the code', () => {
      const result = resolveCodeComment(py, 'k3f9')
      expect(result.text).toBe([
        'import math',
        '',
        'def clamp(x):',
        '    return max(0, x)',
      ].join('\n'))
      expect(result.anchor).toBe('def clamp(x):')
    })

    it('resolves all threads', () => {
      const doc = [
        '# @mim(aaaa) paul 2026-06-13T09:14: one',
        'x = 1',
        '# @mim(bbbb) paul 2026-06-13T09:15: two',
        'y = 2',
      ].join('\n')
      const result = resolveAllCodeComments(doc)
      expect(result.text).toBe('x = 1\ny = 2')
      expect(result.count).toBe(2)
    })
  })

  describe('commentPrefixForPath / supportsCodeCommentPath', () => {
    it('maps extensions to comment syntax', () => {
      expect(commentPrefixForPath('a.py')).toEqual({ open: '# ', close: '' })
      expect(commentPrefixForPath('a.ts')).toEqual({ open: '// ', close: '' })
      expect(commentPrefixForPath('a.html')).toEqual({ open: '<!-- ', close: ' -->' })
      expect(commentPrefixForPath('a.css')).toEqual({ open: '/* ', close: ' */' })
      expect(commentPrefixForPath('notes.txt')).toEqual({ open: '', close: '' })
    })

    it('refuses formats where comment lines would corrupt the file', () => {
      expect(commentPrefixForPath('data.json')).toBeNull()
      expect(commentPrefixForPath('table.csv')).toBeNull()
      expect(supportsCodeCommentPath('data.json')).toBe(false)
      expect(supportsCodeCommentPath('a.py')).toBe(true)
    })

    it('is not used for markdown paths', () => {
      expect(supportsCodeCommentPath('doc.md')).toBe(false)
    })
  })
})
