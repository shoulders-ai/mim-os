import mammoth from 'mammoth'
import { describe, expect, it } from 'vitest'
import { composeDocx, fitImage, headingNumberer } from './exportDocx.js'
import { DEFAULT_DOCUMENT_STYLE, PAGE_SIZES, type DocumentStyle } from './documentStyle.js'

// 1x1 red PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const style = (overrides: Partial<DocumentStyle> = {}): DocumentStyle => ({ ...DEFAULT_DOCUMENT_STYLE, ...overrides })

const baseOptions = {
  markdown: '# Hello\n\nWorld paragraph.',
  style: style(),
  fontFamily: 'lora' as const,
  fontSizePt: 11,
  pageSize: PAGE_SIZES.a4,
}

async function rawText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

describe('composeDocx', () => {
  it('produces a valid docx with heading and paragraph text', async () => {
    const buffer = await composeDocx(baseOptions)
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
    const text = await rawText(buffer)
    expect(text).toContain('Hello')
    expect(text).toContain('World paragraph.')
  })

  it('numbers headings when numberedHeadings is set', async () => {
    const buffer = await composeDocx({
      ...baseOptions,
      style: style({ numberedHeadings: true }),
      markdown: '# Intro\n\nx\n\n## Background\n\ny\n\n# Methods\n\n## Design\n\nz',
    })
    const text = await rawText(buffer)
    expect(text).toContain('1 Intro')
    expect(text).toContain('1.1 Background')
    expect(text).toContain('2 Methods')
    expect(text).toContain('2.1 Design')
  })

  it('keeps a leading H1 unnumbered when titleFirstH1 is set', async () => {
    const buffer = await composeDocx({
      ...baseOptions,
      style: style({ numberedHeadings: true, titleFirstH1: true }),
      markdown: '# My Paper\n\nintro\n\n# Methods\n\nbody',
    })
    const text = await rawText(buffer)
    expect(text).toContain('My Paper')
    expect(text).not.toContain(' My Paper')
    expect(text).toContain('1 Methods')
  })

  it('omits the first-page number when page numbers skip the first page', async () => {
    const buffer = await composeDocx({
      ...baseOptions,
      style: style({ pageNumberAlign: 'center', pageNumbersSkipFirst: true }),
    })
    // A title-page section + a distinct empty first-page footer is how Word
    // leaves the first page unnumbered while page 2 onward still count from 1.
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(buffer)
    const documentXml = await zip.file('word/document.xml')!.async('string')
    expect(documentXml).toContain('w:titlePg')
    const footerFiles = Object.keys(zip.files).filter(name => /word\/footer\d+\.xml/.test(name))
    expect(footerFiles.length).toBeGreaterThanOrEqual(2)
  })

  it('right-aligns page numbers when requested', async () => {
    const buffer = await composeDocx({ ...baseOptions, style: style({ pageNumberAlign: 'right' }) })
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(buffer)
    const footerName = Object.keys(zip.files).find(name => /word\/footer\d+\.xml/.test(name))!
    const footerXml = await zip.file(footerName)!.async('string')
    expect(footerXml).toContain('w:val="right"')
    expect(footerXml).toContain('PAGE')
  })

  it('renders lists, nested lists, and task items', async () => {
    const buffer = await composeDocx({
      ...baseOptions,
      markdown: '- alpha\n- beta\n  - gamma\n\n1. one\n2. two\n\n- [x] done item\n- [ ] open item',
    })
    const text = await rawText(buffer)
    for (const item of ['alpha', 'beta', 'gamma', 'one', 'two']) expect(text).toContain(item)
    expect(text).toContain('☒ done item')
    expect(text).toContain('☐ open item')
  })

  it('renders tables with header and body cells', async () => {
    const buffer = await composeDocx({
      ...baseOptions,
      markdown: '| Col A | Col B |\n|---|---|\n| a1 | b1 |',
    })
    const text = await rawText(buffer)
    for (const cell of ['Col A', 'Col B', 'a1', 'b1']) expect(text).toContain(cell)
  })

  it('renders code blocks, inline styles, and blockquotes', async () => {
    const buffer = await composeDocx({
      ...baseOptions,
      markdown: '> quoted wisdom\n\n```js\nconst x = 1\nconst y = 2\n```\n\nMix of **bold**, *italic*, ~~gone~~, and `inline()`.',
    })
    const text = await rawText(buffer)
    expect(text).toContain('quoted wisdom')
    expect(text).toContain('const x = 1')
    expect(text).toContain('const y = 2')
    expect(text).toContain('bold')
    expect(text).toContain('inline()')
  })

  it('renders hyperlinks with their text', async () => {
    const buffer = await composeDocx({ ...baseOptions, markdown: 'See [the docs](https://example.com).' })
    const text = await rawText(buffer)
    expect(text).toContain('the docs')
  })

  it('embeds images via the loader and falls back to alt text', async () => {
    const loads: string[] = []
    const buffer = await composeDocx({
      ...baseOptions,
      markdown: '![diagram](figs/d.png)\n\n![missing](figs/gone.png)',
      loadImage: async (src) => {
        loads.push(src)
        if (src.includes('gone')) return null
        return { data: TINY_PNG, type: 'png', width: 1, height: 1 }
      },
    })
    expect(loads).toEqual(['figs/d.png', 'figs/gone.png'])
    const text = await rawText(buffer)
    expect(text).toContain('[missing]')
  })

  it('appends the bibliography with labels and runs', async () => {
    const buffer = await composeDocx({
      ...baseOptions,
      markdown: 'Cited [1].',
      bibliography: [
        { key: 'a', label: '[1]', runs: [{ text: 'Doe, J. (2019). ' }, { text: 'A Long Book', italic: true }] },
      ],
    })
    const text = await rawText(buffer)
    expect(text).toContain('References')
    expect(text).toContain('[1] Doe, J. (2019). A Long Book')
  })

  it('handles empty markdown without crashing', async () => {
    const buffer = await composeDocx({ ...baseOptions, markdown: '' })
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})

describe('headingNumberer', () => {
  it('produces dotted section numbers and resets deeper levels', () => {
    const next = headingNumberer()
    expect(next(1)).toBe('1')
    expect(next(2)).toBe('1.1')
    expect(next(3)).toBe('1.1.1')
    expect(next(2)).toBe('1.2')
    expect(next(1)).toBe('2')
    expect(next(2)).toBe('2.1')
  })

  it('returns empty string beyond level 3', () => {
    const next = headingNumberer()
    expect(next(4)).toBe('')
  })
})

describe('fitImage', () => {
  it('scales down to the content width preserving aspect', () => {
    expect(fitImage(1200, 600, 600)).toEqual({ width: 600, height: 300 })
  })

  it('keeps small images at natural size', () => {
    expect(fitImage(100, 80, 600)).toEqual({ width: 100, height: 80 })
  })
})
