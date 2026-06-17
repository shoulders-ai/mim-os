import { describe, expect, it } from 'vitest'
import { buildFontFaceCss, composeDocumentHtml } from './exportHtml.js'
import { DEFAULT_DOCUMENT_STYLE, type DocumentStyle } from './documentStyle.js'

const style = (overrides: Partial<DocumentStyle> = {}): DocumentStyle => ({ ...DEFAULT_DOCUMENT_STYLE, ...overrides })

const baseOptions = {
  markdown: '# Title\n\nHello *world*.',
  style: style(),
  fontFamily: 'lora' as const,
  fontSizePt: 11,
  baseCss: '/* base-css-marker */',
}

describe('composeDocumentHtml', () => {
  it('produces a complete html document with rendered markdown', () => {
    const html = composeDocumentHtml(baseOptions)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<em>world</em>')
    expect(html).toContain('/* base-css-marker */')
  })

  it('escapes the title and falls back to Document', () => {
    const html = composeDocumentHtml({ ...baseOptions, title: 'A <b>&</b> B' })
    expect(html).toContain('<title>A &lt;b&gt;&amp;&lt;/b&gt; B</title>')
    expect(composeDocumentHtml(baseOptions)).toContain('<title>Title</title>')
  })

  it('derives the fallback title from the first heading', () => {
    const html = composeDocumentHtml({ ...baseOptions, markdown: 'intro\n\n## First Section\n\nbody' })
    expect(html).toContain('<title>First Section</title>')
  })

  it('translates style flags into body classes', () => {
    const html = composeDocumentHtml({
      ...baseOptions,
      style: style({ numberedHeadings: true, justify: true, titleFirstH1: true }),
    })
    expect(html).toContain('doc--numbered')
    expect(html).toContain('doc--justify')
    expect(html).toContain('doc--title-h1')
    expect(composeDocumentHtml({ ...baseOptions, style: style({ columns: 2 }) })).toContain('doc--two-col')
  })

  it('omits flag classes that are off', () => {
    const html = composeDocumentHtml({ ...baseOptions, style: style({ justify: false }) })
    expect(html).not.toContain('doc--numbered')
    expect(html).not.toContain('doc--justify')
    expect(html).not.toContain('doc--two-col')
  })

  it('injects font stack and size variables', () => {
    const html = composeDocumentHtml({ ...baseOptions, fontFamily: 'satoshi', fontSizePt: 12.5 })
    expect(html).toContain("--doc-font: 'Satoshi'")
    expect(html).toContain('--doc-size: 12.5pt')
  })

  it('adds a base href when given', () => {
    const html = composeDocumentHtml({ ...baseOptions, baseHref: 'file:///ws/docs/' })
    expect(html).toContain('<base href="file:///ws/docs/">')
  })

  it('rewrites workspace-rooted image paths and keeps relative ones', () => {
    const html = composeDocumentHtml({
      ...baseOptions,
      markdown: '![a](/assets/a.png)\n\n![b](figures/b.png)',
      workspaceHref: 'file:///ws/',
    })
    expect(html).toContain('src="file:///ws/assets/a.png"')
    expect(html).toContain('src="figures/b.png"')
  })

  it('strips scripts and inline event handlers from embedded html', () => {
    const html = composeDocumentHtml({
      ...baseOptions,
      markdown: 'before\n\n<script>alert(1)</script>\n\n<img src="x.png" onerror="alert(2)">\n\n<a href="javascript:alert(3)">x</a>',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('onerror=')
    expect(html).not.toContain('javascript:alert(3)')
  })

  it('highlights fenced code blocks', () => {
    const html = composeDocumentHtml({
      ...baseOptions,
      markdown: '```ts\nconst x: number = 1\n```',
    })
    expect(html).toContain('hljs')
    expect(html).toContain('<code')
  })

  it('renders a bibliography section with italic runs', () => {
    const html = composeDocumentHtml({
      ...baseOptions,
      bibliography: [
        { key: 'a', label: '[1]', runs: [{ text: 'Author, X. ' }, { text: 'Journal', italic: true }] },
      ],
    })
    expect(html).toContain('References')
    expect(html).toContain('[1]')
    expect(html).toContain('<em>Journal</em>')
  })

  it('omits the bibliography section when empty', () => {
    const html = composeDocumentHtml({ ...baseOptions, bibliography: [] })
    expect(html).not.toContain('doc-references')
  })

  it('renders gfm tables and task lists', () => {
    const html = composeDocumentHtml({
      ...baseOptions,
      markdown: '| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo',
    })
    expect(html).toContain('<table>')
    expect(html).toContain('checkbox')
  })
})

describe('buildFontFaceCss', () => {
  it('declares all bundled families against the fonts directory url', () => {
    const css = buildFontFaceCss('file:///app/fonts')
    for (const family of ['Lora', 'Satoshi', 'Zilla Slab', 'JetBrains Mono']) {
      expect(css).toContain(`font-family: '${family}'`)
    }
    expect(css).toContain("url('file:///app/fonts/Lora-VariableFont_wght.ttf')")
    expect(css).toContain('font-style: italic')
  })
})
