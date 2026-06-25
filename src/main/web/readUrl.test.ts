import { describe, expect, it, vi } from 'vitest'
import { extractReadableContent, readUrl } from './readUrl.js'

describe('extractReadableContent', () => {
  it('extracts article content from HTML and returns markdown', async () => {
    const html = `<html><head><title>Test Article</title></head><body>
      <nav>Site Nav</nav>
      <article>
        <h1>Test Article</h1>
        <p>This is the main content of the article. It has enough text to pass the Readability threshold for content extraction.</p>
        <p>Here is a second paragraph with more meaningful text that helps the extractor identify this as real article content.</p>
        <p>And a third paragraph to make sure we have enough substance for the algorithm to work with properly.</p>
      </article>
      <footer>Footer stuff</footer>
    </body></html>`

    const result = await extractReadableContent(html, 'https://example.com/article')
    expect(result.title).toBe('Test Article')
    expect(result.content).toContain('main content')
    expect(result.content).toContain('second paragraph')
    expect(result.content).not.toContain('<p>')
    expect(result.content).not.toContain('<nav>')
  })

  it('falls back to full-body markdown when Readability returns nothing', async () => {
    const html = `<html><body><p>Short page.</p></body></html>`
    const result = await extractReadableContent(html, 'https://example.com')
    expect(result.content).toContain('Short page')
    expect(result.title).toBe('')
  })

  it('converts links to markdown', async () => {
    const html = `<html><head><title>Links</title></head><body>
      <article>
        <p>Visit <a href="https://example.com">Example</a> for more info. This paragraph has enough text to be considered article content by the extractor algorithm.</p>
        <p>Another paragraph with sufficient content to pass the readability threshold for extraction.</p>
        <p>And yet another paragraph to make absolutely sure readability picks this up properly.</p>
      </article>
    </body></html>`
    const result = await extractReadableContent(html, 'https://example.com')
    expect(result.content).toMatch(/\[Example\]\(https:\/\/example\.com\/?/)
  })

  it('truncates to max_chars and sets truncated flag', async () => {
    const html = `<html><head><title>Long</title></head><body>
      <article>
        <p>${'word '.repeat(500)}</p>
        <p>${'more '.repeat(500)}</p>
        <p>${'text '.repeat(500)}</p>
      </article>
    </body></html>`
    const result = await extractReadableContent(html, 'https://example.com', 100)
    expect(result.content.length).toBeLessThanOrEqual(100)
    expect(result.truncated).toBe(true)
  })

  it('preserves heading structure in markdown', async () => {
    const html = `<html><head><title>Headings</title></head><body>
      <article>
        <h1>Main Heading</h1>
        <p>Intro paragraph with enough text for the extractor to consider this real content worth keeping.</p>
        <h2>Sub Heading</h2>
        <p>Sub content paragraph also with enough text to pass the readability content extraction threshold.</p>
        <p>Additional text to bulk up the article so Readability's heuristics properly classify it.</p>
      </article>
    </body></html>`
    const result = await extractReadableContent(html, 'https://example.com')
    expect(result.content).toMatch(/#{1,2}\s+Main Heading/)
    expect(result.content).toMatch(/#{1,3}\s+Sub Heading/)
  })

  it('handles empty HTML body', async () => {
    const html = `<html><body></body></html>`
    const result = await extractReadableContent(html, 'https://example.com')
    expect(result.content).toBe('')
    expect(result.title).toBe('')
  })
})

describe('readUrl', () => {
  it('rejects non-http URLs', async () => {
    await expect(readUrl({ url: 'file:///etc/passwd' })).rejects.toThrow('http')
    await expect(readUrl({ url: 'ftp://example.com' })).rejects.toThrow('http')
  })

  it('rejects private/loopback IPs', async () => {
    await expect(readUrl({ url: 'http://127.0.0.1' })).rejects.toThrow()
    await expect(readUrl({ url: 'http://localhost' })).rejects.toThrow()
    await expect(readUrl({ url: 'http://0.0.0.0' })).rejects.toThrow()
    await expect(readUrl({ url: 'http://10.0.0.1' })).rejects.toThrow()
    await expect(readUrl({ url: 'http://192.168.1.1' })).rejects.toThrow()
    await expect(readUrl({ url: 'http://172.16.0.1' })).rejects.toThrow()
  })

  it('rejects IPv6 loopback and IPv4-mapped IPv6 private addresses', async () => {
    await expect(readUrl({ url: 'http://[::1]/' })).rejects.toThrow()
    await expect(readUrl({ url: 'http://[::ffff:127.0.0.1]/' })).rejects.toThrow()
    await expect(readUrl({ url: 'http://[::ffff:10.0.0.1]/' })).rejects.toThrow()
    await expect(readUrl({ url: 'http://[::ffff:192.168.1.1]/' })).rejects.toThrow()
  })

  it('rejects cloud metadata endpoint', async () => {
    await expect(readUrl({ url: 'http://169.254.169.254/latest/meta-data/' })).rejects.toThrow()
  })

  it('fetches and extracts content from a URL', async () => {
    const html = `<html><head><title>Remote Page</title></head><body>
      <article>
        <h1>Remote Page</h1>
        <p>Fetched content that is long enough for Readability to extract as article text from the page.</p>
        <p>Another paragraph of sufficient length to ensure the extractor recognizes it properly here.</p>
        <p>Third paragraph providing bulk so the heuristics work correctly in this test case setup.</p>
      </article>
    </body></html>`

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve(html),
    })

    const result = await readUrl({ url: 'https://example.com/page' }, { fetch: mockFetch })
    expect(result.title).toBe('Remote Page')
    expect(result.content).toContain('Fetched content')
    expect(result.url).toBe('https://example.com/page')
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('sends a User-Agent header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve('<html><body><p>ok</p></body></html>'),
    })

    await readUrl({ url: 'https://example.com' }, { fetch: mockFetch })
    const init = mockFetch.mock.calls[0][1]
    expect(init.headers['User-Agent']).toContain('Mozilla')
  })

  it('rejects non-HTML responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve('binary junk'),
    })

    await expect(readUrl({ url: 'https://example.com/file.json' }, { fetch: mockFetch }))
      .rejects.toThrow('HTML or PDF')
  })

  it('fetches selectable PDF responses and returns readable text', async () => {
    const pdf = makeTextPdf({
      title: 'Regeltafel 688',
      author: 'DB Regio',
      text: 'RB24 Ostkreuz Eberswalde Ersatzverkehr vom 12. Juli bis 18. Juli',
    })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf' }),
      arrayBuffer: () => Promise.resolve(bufferToArrayBuffer(pdf)),
      text: () => Promise.resolve(''),
    })

    const result = await readUrl({
      url: 'https://www.bahnhof.de/downloads/schedule/Regeltafel_688.pdf',
      max_chars: 10_000,
    }, { fetch: mockFetch })

    expect(result.format).toBe('pdf')
    expect(result.title).toBe('Regeltafel 688')
    expect(result.byline).toBe('DB Regio')
    expect(result.siteName).toBe('www.bahnhof.de')
    expect(result.pages).toBe(1)
    expect(result.content).toContain('RB24 Ostkreuz Eberswalde')
    expect(result.truncated).toBe(false)
  })

  it('treats .pdf downloads as PDFs even when the server sends a generic content type', async () => {
    const pdf = makeTextPdf({ text: 'Generic download PDF text' })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      arrayBuffer: () => Promise.resolve(bufferToArrayBuffer(pdf)),
      text: () => Promise.resolve(''),
    })

    const result = await readUrl({ url: 'https://example.com/download/file.pdf' }, { fetch: mockFetch })

    expect(result.format).toBe('pdf')
    expect(result.content).toContain('Generic download PDF text')
  })

  it('handles fetch errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({}),
      text: () => Promise.resolve(''),
    })

    await expect(readUrl({ url: 'https://example.com/missing' }, { fetch: mockFetch })).rejects.toThrow('404')
  })

  it('produces a clear timeout error', async () => {
    const mockFetch = vi.fn().mockImplementation(() => {
      const err = new DOMException('The operation was aborted', 'AbortError')
      return Promise.reject(err)
    })

    await expect(readUrl({ url: 'https://example.com', timeout_ms: 100 }, { fetch: mockFetch }))
      .rejects.toThrow(/Timeout.*100ms/)
  })
})

function makeTextPdf(options: { text: string; title?: string; author?: string }): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td ${pdfLiteral(options.text)} Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Title ${pdfLiteral(options.title ?? 'Test PDF')} /Author ${pdfLiteral(options.author ?? 'Test Author')} >>\nendobj\n`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

function pdfLiteral(value: string): string {
  return `(${value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}
