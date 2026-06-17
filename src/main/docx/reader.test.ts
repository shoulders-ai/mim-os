import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  extractCommentsFromHtml,
  extractDocxForReview,
  htmlToReadable,
  readDocxAsText,
} from '@main/docx/reader.js'

interface FakeImage {
  contentType?: string
  data: string
}

const mammothState = vi.hoisted(() => ({
  html: '',
  images: [] as Array<{ contentType?: string; data: string }>,
  lastOptions: undefined as Record<string, unknown> | undefined,
  lastReadFormat: undefined as string | undefined,
}))

vi.mock('mammoth', () => {
  const convertToHtml = async (_input: unknown, options: Record<string, unknown> = {}) => {
    mammothState.lastOptions = options
    let html = mammothState.html
    const convertImage = options.convertImage as
      | ((image: { contentType?: string; read(format: string): Promise<string> }) => Promise<{ src: string; alt: string }>)
      | undefined
    if (convertImage) {
      for (const image of mammothState.images as FakeImage[]) {
        const attrs = await convertImage({
          contentType: image.contentType,
          read: async (format: string) => {
            mammothState.lastReadFormat = format
            return image.data
          },
        })
        html += `<p><img src="${attrs.src}" alt="${attrs.alt}" /></p>`
      }
    }
    return { value: html }
  }
  const images = { imgElement: (handler: unknown) => handler }
  return { default: { convertToHtml, images }, convertToHtml, images }
})

describe('htmlToReadable', () => {
  it('converts headings and paragraphs to markdown-style text', () => {
    const text = htmlToReadable('<h1>Title</h1><h2>Sub</h2><h3>Deep</h3><p>Body text.</p>')
    expect(text).toContain('# Title')
    expect(text).toContain('## Sub')
    expect(text).toContain('### Deep')
    expect(text).toContain('Body text.')
  })

  it('renders tables as pipe-delimited rows', () => {
    const text = htmlToReadable('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>')
    expect(text).toContain('| A | B |')
    expect(text).toContain('| 1 | 2 |')
  })

  it('renders list items as dashes', () => {
    const text = htmlToReadable('<ul><li>One</li><li>Two</li></ul><ol><li>Three</li></ol>')
    expect(text).toContain('- One')
    expect(text).toContain('- Two')
    expect(text).toContain('- Three')
  })

  it('inlines comment references and strips the trailing comment definition list', () => {
    const html = '<p>Intro<sup><a href="#comment-7" id="comment-ref-7">[1]</a></sup> end</p>'
      + '<dl><dt><a id="comment-7">[1]</a></dt><dd><p>Needs a source</p></dd></dl>'
    const text = htmlToReadable(html, { '7': { author: 'Reviewer', text: 'Needs a source' } })
    expect(text).toContain('[[Comment #7 by Reviewer: "Needs a source"]]')
    expect(text).not.toContain('Needs a source"]]  end\n\nNeeds') // dl body removed, not duplicated
    expect(text).not.toContain('<dl>')
  })

  it('describes standalone images with and without alt text', () => {
    const text = htmlToReadable('<img src="a.png" alt="Sales chart"><br><img src="b.png">')
    expect(text).toContain('[Image: Sales chart]')
    expect(text).toContain('[Image]')
  })

  it('keeps strong/em emphasis markers outside paragraphs', () => {
    const text = htmlToReadable('<strong>Bold</strong> and <em>soft</em>')
    expect(text).toBe('**Bold** and *soft*')
  })

  it('decodes HTML entities and collapses runs of blank lines', () => {
    const text = htmlToReadable('<p>Fish &amp; Chips&nbsp;&#39;here&#39; &lt;now&gt;</p><p></p><p></p><p>Tail</p>')
    expect(text).toContain("Fish & Chips 'here' <now>")
    expect(text).not.toMatch(/\n{3,}/)
    expect(text.endsWith('Tail')).toBe(true)
  })
})

describe('extractCommentsFromHtml', () => {
  it('parses comment entries from a trailing definition list', () => {
    const html = '<p>Body</p><dl>'
      + '<dt><a id="comment-0">[1]</a></dt><dd><p>First note</p></dd>'
      + '<dt><a id="comment-12">[2]</a></dt><dd><p>Cite &amp; verify</p></dd>'
      + '</dl>'
    expect(extractCommentsFromHtml(html)).toEqual({
      '0': { author: 'Reviewer', text: 'First note' },
      '12': { author: 'Reviewer', text: 'Cite & verify' },
    })
  })

  it('returns an empty map when there is no trailing definition list', () => {
    expect(extractCommentsFromHtml('<p>Body</p>')).toEqual({})
    expect(extractCommentsFromHtml('<dl><dt><a id="comment-0">[1]</a></dt><dd>x</dd></dl><p>after</p>')).toEqual({})
  })
})

describe('readDocxAsText / extractDocxForReview', () => {
  let dir: string
  let docxPath: string
  let validPngBase64: string
  let largePngBuffer: Buffer

  beforeAll(async () => {
    const sharp = (await import('sharp')).default
    validPngBase64 = (
      await sharp({ create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } } })
        .png()
        .toBuffer()
    ).toString('base64')
    largePngBuffer = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: { r: 80, g: 120, b: 160 } } })
      .png()
      .toBuffer()
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-docx-reader-test-'))
    docxPath = join(dir, 'doc.docx')
    writeFileSync(docxPath, 'fake docx bytes')
    mammothState.html = ''
    mammothState.images = []
    mammothState.lastOptions = undefined
    mammothState.lastReadFormat = undefined
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('readDocxAsText converts with the comment style map and extracts comments', async () => {
    mammothState.html = '<p>Intro<sup><a href="#comment-3" id="comment-ref-3">[1]</a></sup> end</p>'
      + '<dl><dt><a id="comment-3">[1]</a></dt><dd><p>Fix this</p></dd></dl>'

    const result = await readDocxAsText(docxPath)
    expect(mammothState.lastOptions).toMatchObject({ styleMap: ['comment-reference => sup'] })
    expect(result.html).toBe(mammothState.html)
    expect(result.comments).toEqual({ '3': { author: 'Reviewer', text: 'Fix this' } })
    expect(result.text).toContain('[[Comment #3 by Reviewer: "Fix this"]]')
    expect(result.truncated).toBe(false)
    expect(result.totalChars).toBe(result.text.length)
  })

  it('readDocxAsText truncates by maxChars but reports full length', async () => {
    mammothState.html = '<p>abcdefghij</p>'
    const result = await readDocxAsText(docxPath, { maxChars: 4 })
    expect(result.text).toBe('abcd')
    expect(result.truncated).toBe(true)
    expect(result.totalChars).toBe(10)
  })

  it('readDocxAsText ignores non-positive maxChars and uses the default budget', async () => {
    mammothState.html = '<p>short text</p>'
    const result = await readDocxAsText(docxPath, { maxChars: 0 })
    expect(result.text).toBe('short text')
    expect(result.truncated).toBe(false)
  })

  it('readDocxAsText clamps maxChars to the 300k hard limit', async () => {
    mammothState.html = `<p>${'a'.repeat(310_000)}</p>`
    const result = await readDocxAsText(docxPath, { maxChars: 999_999 })
    expect(result.text.length).toBe(300_000)
    expect(result.truncated).toBe(true)
    expect(result.totalChars).toBe(310_000)
  })

  it('extractDocxForReview inlines supported images as data URLs and produces markdown', async () => {
    const base64 = Buffer.from('fake-jpeg-bytes').toString('base64')
    mammothState.html = '<h1>Title</h1><p>Hello <strong>world</strong></p>'
    mammothState.images = [{ contentType: 'image/jpeg', data: base64 }]

    const result = await extractDocxForReview(docxPath)
    expect(mammothState.lastReadFormat).toBe('base64')
    expect(result.images).toEqual([{ id: 'image-1', base64, contentType: 'image/jpeg' }])
    expect(result.html).toContain(`src="data:image/jpeg;base64,${base64}"`)
    expect(result.markdown).toContain('# Title')
    expect(result.markdown).toContain('Hello **world**')
    expect(result.truncated).toBe(false)
    expect(result.totalChars).toBe(result.markdown.length)
  })

  it('extractDocxForReview converts unsupported image types to PNG', async () => {
    mammothState.html = '<p>Doc</p>'
    mammothState.images = [{ contentType: 'image/bmp', data: validPngBase64 }]

    const result = await extractDocxForReview(docxPath)
    expect(result.images).toHaveLength(1)
    expect(result.images[0].contentType).toBe('image/png')
    expect(result.images[0].id).toBe('image-1')
    expect(result.html).toContain('src="data:image/png;base64,')
  })

  it('extractDocxForReview drops images whose data cannot be converted', async () => {
    mammothState.html = '<p>Doc</p>'
    mammothState.images = [{ contentType: 'image/x-emf', data: Buffer.from('not an image').toString('base64') }]

    const result = await extractDocxForReview(docxPath)
    expect(result.images).toEqual([])
    expect(result.html).not.toContain('data:image')
  })

  it('extractDocxForReview downscales large supported images', async () => {
    mammothState.html = '<p>Doc</p>'
    mammothState.images = [{ contentType: 'image/png', data: largePngBuffer.toString('base64') }]

    const result = await extractDocxForReview(docxPath)
    expect(result.images).toHaveLength(1)
    const resized = Buffer.from(result.images[0].base64, 'base64')
    const metadata = await (await import('sharp')).default(resized).metadata()
    expect(Math.max(metadata.width || 0, metadata.height || 0)).toBeLessThanOrEqual(1568)
    expect(resized.length).toBeLessThan(largePngBuffer.length)
    expect(result.html).toContain(`src="data:image/png;base64,${result.images[0].base64}"`)
  })

  it('extractDocxForReview truncates markdown text by maxChars', async () => {
    mammothState.html = '<p>0123456789</p>'
    const result = await extractDocxForReview(docxPath, { maxChars: 4 })
    expect(result.text).toBe(result.markdown.slice(0, 4))
    expect(result.truncated).toBe(true)
    expect(result.totalChars).toBe(result.markdown.length)
  })

  // Returns every markdown table as { header, separator, body[] } so tests can
  // assert column alignment instead of substring-matching whitespace.
  function parseTables(markdown: string): Array<{ rows: string[][] }> {
    const lines = markdown.split('\n')
    const tables: Array<{ rows: string[][] }> = []
    let current: { rows: string[][] } | null = null
    const cells = (line: string) =>
      line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(c => c.trim())
    for (const line of lines) {
      if (/^\s*\|.*\|\s*$/.test(line)) {
        if (!current) { current = { rows: [] }; tables.push(current) }
        current.rows.push(cells(line))
      } else {
        current = null
      }
    }
    return tables
  }

  it('renders a simple table as an aligned GFM pipe table', async () => {
    mammothState.html =
      '<table><tr><th>Arm</th><th>N</th><th>Mean</th></tr>' +
      '<tr><td>Placebo</td><td>120</td><td>3.4</td></tr>' +
      '<tr><td>Active</td><td>118</td><td>5.1</td></tr></table>'
    const { markdown } = await extractDocxForReview(docxPath)
    const [table] = parseTables(markdown)
    expect(table.rows[0]).toEqual(['Arm', 'N', 'Mean'])
    expect(table.rows[1]).toEqual(['---', '---', '---'])
    expect(table.rows[2]).toEqual(['Placebo', '120', '3.4'])
    expect(table.rows[3]).toEqual(['Active', '118', '5.1'])
    expect(table.rows.every(r => r.length === 3)).toBe(true)
  })

  it('keeps every row aligned when headers span columns (colspan/rowspan)', async () => {
    mammothState.html =
      '<table>' +
      '<tr><th rowspan="2">Endpoint</th><th colspan="2">Active</th><th colspan="2">Placebo</th></tr>' +
      '<tr><th>n</th><th>%</th><th>n</th><th>%</th></tr>' +
      '<tr><td>Responders</td><td>80</td><td>67.8</td><td>54</td><td>45.0</td></tr>' +
      '</table>'
    const { markdown } = await extractDocxForReview(docxPath)
    const [table] = parseTables(markdown)
    // Stacked header rows merge per column; data row keeps all five values aligned.
    expect(table.rows[0]).toEqual(['Endpoint', 'Active n', 'Active %', 'Placebo n', 'Placebo %'])
    expect(table.rows[2]).toEqual(['Responders', '80', '67.8', '54', '45.0'])
    expect(table.rows.every(r => r.length === 5)).toBe(true)
  })

  it('flattens multi-paragraph and <br> cell content onto one line, escaping pipes', async () => {
    mammothState.html =
      '<table><tr><th>Var</th><th>Definition</th></tr>' +
      '<tr><td>Age</td><td><p>Years at entry.</p><p>Used for matching</p></td></tr>' +
      '<tr><td>Site</td><td>Hospital<br>or clinic | unit</td></tr></table>'
    const { markdown } = await extractDocxForReview(docxPath)
    const [table] = parseTables(markdown)
    expect(table.rows[2]).toEqual(['Age', 'Years at entry. Used for matching'])
    // <br> becomes a space; literal pipe is escaped so it stays in one cell.
    expect(table.rows[3]).toEqual(['Site', 'Hospital or clinic \\| unit'])
    expect(table.rows.every(r => r.length === 2)).toBe(true)
    expect(markdown).not.toMatch(/\|\s*\n\s*\n/) // no shredded rows
  })

  it('carries a rowspan value down into the rows it spans', async () => {
    mammothState.html =
      '<table><tr><th>Group</th><th>Visit</th><th>Val</th></tr>' +
      '<tr><td rowspan="2">A</td><td>1</td><td>10</td></tr>' +
      '<tr><td>2</td><td>12</td></tr></table>'
    const { markdown } = await extractDocxForReview(docxPath)
    const [table] = parseTables(markdown)
    expect(table.rows[2]).toEqual(['A', '1', '10'])
    expect(table.rows[3]).toEqual(['A', '2', '12'])
  })
})
