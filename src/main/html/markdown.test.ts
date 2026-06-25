import { describe, expect, it } from 'vitest'
import {
  chunkMarkdownByStructure,
  htmlToMarkdown,
  preprocessMarkdownContent,
} from './markdown.js'

function pipeRows(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter(line => /^\s*\|.*\|\s*$/.test(line))
    .map(line => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map(cell => cell.trim()))
}

describe('htmlToMarkdown', () => {
  it('converts semantic HTML to clean Markdown with browser-use defaults', async () => {
    const result = await htmlToMarkdown(`
      <html>
        <head><title>Ignored title</title><script>window.noise = true</script></head>
        <body>
          <h1>Catalog</h1>
          <p>Pick <strong>one</strong> or <em>two</em>.</p>
          <ul><li>Small</li><li>Large</li></ul>
          <pre><code>const ok = true</code></pre>
        </body>
      </html>
    `)

    expect(result.markdown).toContain('# Catalog')
    expect(result.markdown).toContain('Pick **one** or _two_.')
    expect(result.markdown).toContain('-   Small')
    expect(result.markdown).toContain('```')
    expect(result.markdown).toContain('const ok = true')
    expect(result.markdown).not.toContain('Ignored title')
    expect(result.markdown).not.toContain('window.noise')
    expect(result.stats.originalHtmlChars).toBeGreaterThan(result.stats.finalMarkdownChars)
    expect(result.stats.method).toBe('html_to_markdown')
  })

  it('removes link targets by default and preserves them when requested', async () => {
    const html = '<p>Visit <a href="https://example.com/docs" title="Docs">docs</a> now.</p>'

    await expect(htmlToMarkdown(html)).resolves.toMatchObject({
      markdown: 'Visit docs now.',
    })
    await expect(htmlToMarkdown(html, { extractLinks: true })).resolves.toMatchObject({
      markdown: 'Visit [docs](https://example.com/docs "Docs") now.',
    })
  })

  it('keeps block image URLs but hides table and heading image URLs unless image extraction is enabled', async () => {
    const html = `
      <div><img src="https://cdn.example.com/block.jpg" alt="Block image"></div>
      <h2><img src="https://cdn.example.com/heading.jpg" alt="Heading image"> Featured</h2>
      <table>
        <tr><th>Image</th><th>Name</th></tr>
        <tr><td><img src="https://cdn.example.com/widget.jpg" alt="Widget image"></td><td>Widget A</td></tr>
      </table>
    `

    const withoutInlineImages = await htmlToMarkdown(html)
    expect(withoutInlineImages.markdown).toContain('![Block image](https://cdn.example.com/block.jpg)')
    expect(withoutInlineImages.markdown).toContain('## Heading image Featured')
    expect(withoutInlineImages.markdown).toContain('| Widget image | Widget A |')
    expect(withoutInlineImages.markdown).not.toContain('heading.jpg')
    expect(withoutInlineImages.markdown).not.toContain('widget.jpg')

    const withInlineImages = await htmlToMarkdown(html, { extractImages: true })
    expect(withInlineImages.markdown).toContain('heading.jpg')
    expect(withInlineImages.markdown).toContain('widget.jpg')
  })

  it('drops base64 inline images and hidden SPA state code', async () => {
    const result = await htmlToMarkdown(`
      <p>Visible text.</p>
      <img src="data:image/png;base64,abc123" alt="Tracking pixel">
      <code id="bpr-guid-123" style="display:none">{"key":"${'x'.repeat(120)}"}</code>
      <p>Tail text.</p>
    `)

    expect(result.markdown).toContain('Visible text.')
    expect(result.markdown).toContain('Tail text.')
    expect(result.markdown).not.toContain('Tracking pixel')
    expect(result.markdown).not.toContain('bpr-guid')
    expect(result.markdown).not.toContain('"key"')
  })

  it('normalizes header-only first table rows into stable GFM tables', async () => {
    const result = await htmlToMarkdown(`
      <table>
        <tr><th>Name</th><th>Value</th></tr>
        <tr><td>A</td><td>1</td></tr>
        <tr><td>B</td><td>2</td></tr>
      </table>
    `)

    expect(pipeRows(result.markdown)).toEqual([
      ['Name', 'Value'],
      ['---', '---'],
      ['A', '1'],
      ['B', '2'],
    ])
  })

  it('applies link extraction inside custom-rendered table cells', async () => {
    const html = `
      <table>
        <tr><th>Name</th><th>URL</th></tr>
        <tr><td>Docs</td><td><a href="https://example.com/docs" title="Docs">Open</a></td></tr>
      </table>
    `

    expect((await htmlToMarkdown(html)).markdown).toContain('| Docs | Open |')
    expect((await htmlToMarkdown(html, { extractLinks: true })).markdown)
      .toContain('| Docs | [Open](https://example.com/docs "Docs") |')
  })

  it('expands rowspan and colspan so table rows stay rectangular', async () => {
    const result = await htmlToMarkdown(`
      <table>
        <tr><th rowspan="2">Endpoint</th><th colspan="2">Active</th><th colspan="2">Placebo</th></tr>
        <tr><th>n</th><th>%</th><th>n</th><th>%</th></tr>
        <tr><td>Responders</td><td>80</td><td>67.8</td><td>54</td><td>45.0</td></tr>
      </table>
    `)

    const rows = pipeRows(result.markdown)
    expect(rows[0]).toEqual(['Endpoint', 'Active n', 'Active %', 'Placebo n', 'Placebo %'])
    expect(rows[1]).toEqual(['---', '---', '---', '---', '---'])
    expect(rows[2]).toEqual(['Responders', '80', '67.8', '54', '45.0'])
    expect(rows.every(row => row.length === 5)).toBe(true)
  })
})

describe('preprocessMarkdownContent', () => {
  it('preserves short useful lines while removing blank lines and large JSON blobs', () => {
    const json = '{"key":"' + 'x'.repeat(120) + '"}'
    const result = preprocessMarkdownContent(`Header\n\nCA\n1\n- a\n${json}\nFooter`)

    expect(result.content.split('\n')).toEqual(['Header', 'CA', '1', '- a', 'Footer'])
    expect(result.charsFiltered).toBeGreaterThan(json.length)
  })

  it('removes URL-encoded byte noise before filtering', () => {
    const result = preprocessMarkdownContent('Hello%20World\nTail%3A')
    expect(result.content).toBe('HelloWorld\nTail')
  })
})

describe('chunkMarkdownByStructure', () => {
  it('returns one chunk for short or empty content', () => {
    expect(chunkMarkdownByStructure('', { maxChunkChars: 50 })).toEqual([
      {
        content: '',
        chunkIndex: 0,
        totalChunks: 1,
        charOffsetStart: 0,
        charOffsetEnd: 0,
        overlapPrefix: '',
        hasMore: false,
      },
    ])

    const content = '# Hello\n\nShort.'
    expect(chunkMarkdownByStructure(content, { maxChunkChars: 1000 })[0]).toMatchObject({
      content,
      chunkIndex: 0,
      totalChunks: 1,
      hasMore: false,
    })
  })

  it('prefers splitting before a header when the prefix is substantial', () => {
    const content = `${'A'.repeat(600)}\n\n# Section B\n\n${'B'.repeat(100)}`
    const chunks = chunkMarkdownByStructure(content, { maxChunkChars: 700 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].content).not.toContain('# Section B')
    expect(chunks[1].content.trimStart()).toMatch(/^# Section B/)
  })

  it('does not split at a header when that would create a tiny prefix chunk', () => {
    const content = `# Section A\n\n${'A'.repeat(30)}\n\n# Section B\n\n${'B'.repeat(600)}`
    const chunks = chunkMarkdownByStructure(content, { maxChunkChars: 700 })

    expect(chunks[0].content).toContain('# Section A')
    expect(chunks[0].content).toContain('# Section B')
  })

  it('keeps code fences and list continuations intact', () => {
    const content = [
      '# Title',
      '',
      '```ts',
      ...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i}`),
      '```',
      '',
      '- Item',
      '  continuation',
      '- Next',
    ].join('\n')

    const chunks = chunkMarkdownByStructure(content, { maxChunkChars: 60 })
    const codeChunk = chunks.find(chunk => chunk.content.includes('```ts'))
    expect(codeChunk?.content).toContain('```ts')
    expect(codeChunk?.content).toContain('```')
    expect(chunks.map(chunk => chunk.content).join('\n')).toContain('- Item\n  continuation')
  })

  it('carries table headers in overlap prefixes across table continuations', () => {
    const table = [
      '| Col1 | Col2 |',
      '| --- | --- |',
      ...Array.from({ length: 80 }, (_, i) => `| row${i} | data${i} |`),
    ].join('\n')
    const chunks = chunkMarkdownByStructure(table, { maxChunkChars: 220, overlapLines: 2 })

    expect(chunks.length).toBeGreaterThan(2)
    for (const chunk of chunks.slice(1)) {
      expect(chunk.overlapPrefix).toContain('| Col1 | Col2 |')
      expect(chunk.overlapPrefix).toContain('| --- | --- |')
    }
  })

  it('keeps chunk offsets contiguous across the full original content', () => {
    const content = '# A\n\nAlpha text.\n\n# B\n\nBeta text.\n\n# C\n\nGamma text.'
    const chunks = chunkMarkdownByStructure(content, { maxChunkChars: 18 })

    expect(chunks[0].charOffsetStart).toBe(0)
    for (let index = 1; index < chunks.length; index++) {
      expect(chunks[index].charOffsetStart).toBe(chunks[index - 1].charOffsetEnd)
    }
    expect(chunks[chunks.length - 1].charOffsetEnd).toBe(content.length)
  })

  it('returns chunks from the chunk containing startFromChar', () => {
    const content = '# A\n\nAlpha text.\n\n# B\n\nBeta text.'
    const all = chunkMarkdownByStructure(content, { maxChunkChars: 20 })
    const fromSecond = chunkMarkdownByStructure(content, {
      maxChunkChars: 20,
      startFromChar: all[1].charOffsetStart + 1,
    })

    expect(fromSecond[0].chunkIndex).toBe(all[1].chunkIndex)
    expect(chunkMarkdownByStructure(content, { startFromChar: 99_999 })).toEqual([])
  })
})
