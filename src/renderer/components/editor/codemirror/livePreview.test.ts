/* @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { Strikethrough } from '@lezer/markdown'
import {
  buildDecorations,
  ImageWidget,
  livePreviewExtension,
  parseMarkdownTable,
  resolveImagePath,
} from './livePreview.js'

function makeView(doc: string, cursorPos = 0) {
  const parent = document.createElement('div')
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [Strikethrough] }),
    ],
  })
  const view = new EditorView({ state, parent })
  ensureSyntaxTree(view.state, view.state.doc.length, 1000)
  return view
}

function getDecos(doc: string, cursorPos = 0) {
  const view = makeView(doc, cursorPos)
  const decos = buildDecorations(view, () => true, () => '/test/file.md')
  const result: Array<{
    from: number
    to: number
    className?: string
    widget?: string
    replace: boolean
  }> = []
  const iter = decos.iter()
  while (iter.value) {
    const isReplace = iter.value.spec?.widget !== undefined || (iter.value.startSide > 0 && !iter.value.spec?.class)
    result.push({
      from: iter.from,
      to: iter.to,
      className: iter.value.spec?.class,
      widget: iter.value.spec?.widget?.constructor?.name,
      replace: isReplace,
    })
    iter.next()
  }
  view.destroy()
  return result
}

function makeLivePreviewView(doc: string, cursorPos = 0) {
  const parent = document.createElement('div')
  const state = EditorState.create({
    doc,
    selection: { anchor: cursorPos },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [Strikethrough] }),
      livePreviewExtension(() => true, () => '/test/file.md'),
    ],
  })
  const view = new EditorView({ state, parent })
  ensureSyntaxTree(view.state, view.state.doc.length, 1000)
  view.dispatch({ selection: { anchor: cursorPos } })
  return view
}

describe('livePreview', () => {
  describe('ImageWidget', () => {
    it('loads local images through the kernel bridge without file URLs', async () => {
      const calls: Array<{ tool: string; params: Record<string, unknown> }> = []
      ;(window as any).kernel = {
        call: async (tool: string, params: Record<string, unknown>) => {
          calls.push({ tool, params })
          return { dataUrl: 'data:image/png;base64,AAECAw==' }
        },
      }

      const dom = new ImageWidget('pixel.png', 'docs/pixel.png').toDOM()
      const img = dom.querySelector('img')!

      expect(img.src).not.toContain('file://')
      await Promise.resolve()
      await Promise.resolve()

      expect(calls).toEqual([{ tool: 'fs.readImageDataUrl', params: { path: 'docs/pixel.png' } }])
      expect(img.src).toBe('data:image/png;base64,AAECAw==')
    })

    it('keeps remote images as remote URLs', () => {
      const dom = new ImageWidget('https://example.com/pixel.png', 'https://example.com/pixel.png').toDOM()
      const img = dom.querySelector('img')!
      expect(img.src).toBe('https://example.com/pixel.png')
    })
  })

  describe('buildDecorations', () => {
    it('returns no decorations when disabled', () => {
      const view = makeView('**bold**')
      const decos = buildDecorations(view, () => false, null)
      expect(decos.size).toBe(0)
      view.destroy()
    })

    it('hides bold markers and styles content when cursor is elsewhere', () => {
      const doc = '**bold**\n\nother line'
      const decos = getDecos(doc, doc.indexOf('other'))
      expect(decos.filter(d => d.replace && !d.className)).toHaveLength(2)
      expect(decos.filter(d => d.className === 'cm-lp-bold')).toHaveLength(1)
    })

    it('does not hide bold markers when cursor is on the same line', () => {
      expect(getDecos('**bold** text', 3)).toHaveLength(0)
    })

    it('hides italic markers and styles content', () => {
      const doc = '*italic*\n\nother'
      const decos = getDecos(doc, doc.indexOf('other'))
      expect(decos.filter(d => d.replace && !d.className)).toHaveLength(2)
      expect(decos.filter(d => d.className === 'cm-lp-italic')).toHaveLength(1)
    })

    it('hides strikethrough markers', () => {
      const doc = '~~struck~~\n\nother'
      const decos = getDecos(doc, doc.indexOf('other'))
      expect(decos.filter(d => d.replace && !d.className)).toHaveLength(2)
      expect(decos.filter(d => d.className === 'cm-lp-strike')).toHaveLength(1)
    })

    it('hides inline code backticks and styles content', () => {
      const doc = '`code`\n\nother'
      const decos = getDecos(doc, doc.indexOf('other'))
      expect(decos.filter(d => d.replace && !d.className)).toHaveLength(2)
      expect(decos.filter(d => d.className === 'cm-lp-inline-code')).toHaveLength(1)
    })

    it('hides link syntax and styles link text', () => {
      const doc = '[text](https://example.com)\n\nother'
      const decos = getDecos(doc, doc.indexOf('other'))
      expect(decos.filter(d => d.replace && !d.className).length).toBeGreaterThanOrEqual(2)
      expect(decos.filter(d => d.className === 'cm-lp-link')).toHaveLength(1)
    })

    it('hides heading marks when cursor is away', () => {
      const doc = '# Heading\n\nother'
      const decos = getDecos(doc, doc.indexOf('other'))
      expect(decos.filter(d => d.replace && !d.className)).toHaveLength(1)
    })

    it('does not hide heading marks when cursor is on heading line', () => {
      expect(getDecos('# Heading', 3)).toHaveLength(0)
    })

    it('replaces horizontal rule with widget', () => {
      const doc = '---\n\nother'
      const decos = getDecos(doc, doc.indexOf('other'))
      expect(decos.filter(d => d.widget === 'HrWidget')).toHaveLength(1)
    })

    it('does not process markup inside fenced code blocks but adds block styling', () => {
      const doc = '```\n**bold**\n```\n\nother'
      const decos = getDecos(doc, doc.indexOf('other'))
      expect(decos.filter(d => d.className === 'cm-lp-bold')).toHaveLength(0)
      expect(decos.filter(d => d.className === 'cm-lp-code-block-line').length).toBeGreaterThanOrEqual(1)
    })

    it('dims fence lines when cursor is away, reveals when cursor is on them', () => {
      const doc = '```js\nconst x = 1\n```\n\nother'
      const awayDecos = getDecos(doc, doc.indexOf('other'))
      expect(awayDecos.filter(d => d.className === 'cm-lp-fence-line')).toHaveLength(2)
      expect(awayDecos.filter(d => d.className === 'cm-lp-code-block-line')).toHaveLength(3)

      const onFenceDecos = getDecos(doc, 0)
      expect(onFenceDecos.filter(d => d.className === 'cm-lp-fence-line')).toHaveLength(1)
      expect(onFenceDecos.filter(d => d.className === 'cm-lp-code-block-line')).toHaveLength(3)
    })

    it('does not crash on a blockquote (replace mark + line deco at the same from)', () => {
      // A blockquote yields a replace decoration for the `>` quote mark and a
      // line decoration for the blockquote line, both anchored at the line
      // start. These share (from, startSide); the decoration set must sort
      // them by the full Range comparator or RangeSetBuilder rejects the set
      // with "Ranges must be added sorted by `from` position and `startSide`".
      const doc = '> quote\n\nother'
      const view = makeView(doc, doc.indexOf('other'))
      expect(() => buildDecorations(view, () => true, null)).not.toThrow()
      view.destroy()
    })

    it('does not crash on a nested blockquote', () => {
      const doc = '> > deep\n\nother'
      const view = makeView(doc, doc.indexOf('other'))
      expect(() => buildDecorations(view, () => true, null)).not.toThrow()
      view.destroy()
    })

    it('handles multi-line selection keeping selected lines raw', () => {
      const doc = '**line1**\n**line2**\n**line3**'
      const baseView = makeView(doc)
      const stateWithSelection = baseView.state.update({
        selection: { anchor: 0, head: doc.indexOf('line2') + 3 },
      }).state
      const view = new EditorView({
        state: stateWithSelection,
        parent: document.createElement('div'),
      })
      ensureSyntaxTree(view.state, view.state.doc.length, 1000)

      const decos = buildDecorations(view, () => true, null)
      const result: Array<{ from: number; className?: string }> = []
      const iter = decos.iter()
      while (iter.value) {
        result.push({ from: iter.from, className: iter.value.spec?.class })
        iter.next()
      }

      expect(result.filter(d => d.className === 'cm-lp-bold' && d.from >= doc.indexOf('line3'))).toHaveLength(1)

      baseView.destroy()
      view.destroy()
    })

    it('reveals table source when clicking a rendered table widget', () => {
      const doc = 'before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter'
      const tableFrom = doc.indexOf('| A | B |')
      const view = makeLivePreviewView(doc, 0)
      const widget = view.dom.querySelector('.cm-lp-table-wrap')

      expect(widget).toBeTruthy()
      widget!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

      expect(view.state.selection.main.head).toBe(tableFrom)
      expect(view.dom.querySelector('.cm-lp-table-wrap')).toBeNull()

      view.destroy()
    })
  })

  describe('parseMarkdownTable', () => {
    it('parses a simple table', () => {
      const result = parseMarkdownTable('| A | B |\n| --- | --- |\n| 1 | 2 |')
      expect(result).not.toBeNull()
      expect(result?.headers).toEqual(['A', 'B'])
      expect(result?.rows).toEqual([['1', '2']])
      expect(result?.alignments).toEqual(['left', 'left'])
    })

    it('detects column alignment', () => {
      const result = parseMarkdownTable('| L | C | R |\n| --- | :---: | ---: |\n| a | b | c |')
      expect(result?.alignments).toEqual(['left', 'center', 'right'])
    })

    it('returns null for invalid table', () => {
      expect(parseMarkdownTable('not a table')).toBeNull()
      expect(parseMarkdownTable('| header |\n| nope |')).toBeNull()
    })

    it('handles escaped pipes', () => {
      const result = parseMarkdownTable('| A |\n| --- |\n| a\\|b |')
      expect(result?.rows[0]).toEqual(['a|b'])
    })
  })

  describe('resolveImagePath', () => {
    it('returns remote URLs unchanged', () => {
      expect(resolveImagePath('https://example.com/img.png', '/a/b.md')).toBe('https://example.com/img.png')
    })

    it('treats leading-slash paths as workspace-root relative', () => {
      expect(resolveImagePath('/abs/path/img.png', '/a/b.md')).toBe('abs/path/img.png')
    })

    it('resolves relative paths against file directory', () => {
      expect(resolveImagePath('img.png', '/docs/file.md')).toBe('/docs/img.png')
      expect(resolveImagePath('../img.png', '/docs/sub/file.md')).toBe('/docs/img.png')
      expect(resolveImagePath('img.png', 'docs/file.md')).toBe('docs/img.png')
      expect(resolveImagePath('img.png', 'file.md')).toBe('img.png')
    })

    it('decodes URI-encoded paths', () => {
      expect(resolveImagePath('my%20image.png', '/docs/file.md')).toBe('/docs/my image.png')
    })

    it('keeps data URLs unchanged', () => {
      expect(resolveImagePath('data:image/png;base64,abc', 'docs/file.md')).toBe('data:image/png;base64,abc')
    })
  })
})
