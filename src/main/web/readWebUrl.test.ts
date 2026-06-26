import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { addResearchBrowserDomain } from './researchSettings.js'
import { readWebUrl, type WebPageRenderer } from './readWebUrl.js'

function rendererReturning(html: string, title = 'Rendered Page'): WebPageRenderer {
  return vi.fn(async ({ url }) => ({
    requestedUrl: url,
    finalUrl: `${url}#rendered`,
    title,
    html,
  }))
}

function headResponse(status = 405, contentType = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 405 ? 'Method Not Allowed' : 'OK',
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
    text: async () => '',
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function withWorkspace<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'mim-web-read-'))
  return Promise.resolve(fn(dir)).finally(() => {
    rmSync(dir, { recursive: true, force: true })
  })
}

describe('readWebUrl', () => {
  it('renders ordinary pages through stateless Chromium and returns the workhorse shape only', async () => {
    const fetch = vi.fn(async () => headResponse())
    const render = rendererReturning('<body><main><h1>Hydrated</h1><p>Client rendered content.</p></main></body>')

    const result = await readWebUrl({
      url: 'https://example.com/article',
      max_chars: 100_000,
    }, {
      fetch,
      renderRendered: render,
      now: () => 1_000,
    })

    expect(result).toMatchObject({
      url: 'https://example.com/article',
      final_url: 'https://example.com/article#rendered',
      title: 'Rendered Page',
      source: 'rendered',
      elapsed_ms: 0,
    })
    expect(result.content).toContain('# Hydrated')
    expect(result.content).toContain('Client rendered content.')
    expect(result.content_length).toBe(result.content.length)
    expect(result).not.toHaveProperty('status')
    expect(result).not.toHaveProperty('attention_required')
    expect(result).not.toHaveProperty('attempts')
    expect(result).not.toHaveProperty('capture')
    expect(result).not.toHaveProperty('stats')
    expect(render).toHaveBeenCalledWith({
      url: 'https://example.com/article',
      timeoutMs: 30_000,
    })
  })

  it('uses the persistent renderer only for granted stateful domains', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'example.com')
      const fetch = vi.fn(async () => headResponse())
      const render = rendererReturning('<body><h1>Account Page</h1><p>Logged-in content.</p></body>', 'Account')

      const result = await readWebUrl({
        url: 'https://example.com/private',
        stateful: true,
      }, {
        workspacePath,
        fetch,
        renderResearch: render,
        now: () => 2_500,
      })

      expect(result.source).toBe('rendered-stateful')
      expect(result.final_url).toBe('https://example.com/private#rendered')
      expect(result.content).toContain('# Account Page')
      expect(render).toHaveBeenCalledOnce()
    })
  })

  it('refuses ungranted stateful domains before opening the persistent profile', async () => {
    await withWorkspace(async (workspacePath) => {
      addResearchBrowserDomain(workspacePath, 'allowed.example')
      const fetch = vi.fn(async () => headResponse())
      const render = rendererReturning('<body>Never reached</body>')

      await expect(readWebUrl({
        url: 'https://blocked.example/private',
        stateful: true,
      }, {
        workspacePath,
        fetch,
        renderResearch: render,
      })).rejects.toThrow('Research Browser is not allowed for blocked.example')

      expect(render).not.toHaveBeenCalled()
    })
  })

  it('keeps selectable PDF downloads on the local PDF extractor path', async () => {
    const pdf = makeTextPdf({
      title: 'Regeltafel 688',
      author: 'DB Regio',
      text: 'RB24 Ostkreuz Eberswalde Ersatzverkehr vom 12. Juli bis 18. Juli',
    })
    const fetch = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'HEAD') return headResponse(200, 'application/octet-stream')
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => bufferToArrayBuffer(pdf),
        text: async () => '',
      }
    })
    const render = rendererReturning('<body>Never reached</body>')

    const result = await readWebUrl({
      url: 'https://example.com/download/Regeltafel_688.pdf',
      max_chars: 10_000,
    }, {
      fetch,
      renderRendered: render,
      now: () => 5_000,
    })

    expect(result.source).toBe('pdf')
    expect(result.title).toBe('Regeltafel 688')
    expect(result.content).toContain('RB24 Ostkreuz Eberswalde')
    expect(render).not.toHaveBeenCalled()
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
  const offsets: number[] = [0]
  let body = '%PDF-1.4\n'
  for (let i = 0; i < objects.length; i++) {
    offsets[i + 1] = Buffer.byteLength(body, 'latin1')
    body += objects[i]
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1')
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
  ].join('\n')
  return Buffer.from(body + xref, 'latin1')
}

function pdfLiteral(text: string): string {
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}
