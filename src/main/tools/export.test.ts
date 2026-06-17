import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import mammoth from 'mammoth'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerExportTools } from '@main/tools/export.js'
import { builtinCitationStyleXml } from '@main/export/citations.js'

// 1x1 red PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const FAKE_PDF = Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF', 'latin1')

describe('Export tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>
  let renderPdf: ReturnType<typeof vi.fn>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-export-test-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    renderPdf = vi.fn(async () => FAKE_PDF)
    registerExportTools(tools, { renderPdf })
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('export.pdf renders a markdown file to a sibling pdf by default', async () => {
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs', 'paper.md'), '# Paper\n\nBody text.')
    const result = await tools.call('export.pdf', { path: 'docs/paper.md' }, ctx) as Record<string, unknown>
    expect(result.path).toBe('docs/paper.pdf')
    expect(result.pages).toBe(1)
    expect(readFileSync(join(dir, 'docs', 'paper.pdf')).equals(FAKE_PDF)).toBe(true)

    const [html, options] = renderPdf.mock.calls[0]
    expect(html).toContain('Body text.')
    // Defaults: justified body, no numbering, no page numbers. Assert the exact
    // body class (the _base stylesheet mentions every modifier, so a bare
    // substring check would always pass).
    expect(html).toContain('class="doc doc--justify"')
    expect(options.pageWidthIn).toBeCloseTo(8.27)
    expect(options.pageNumberAlign).toBe('none')
  })

  it('export.pdf honors layout flags, page size, and explicit output path', async () => {
    writeFileSync(join(dir, 'a.md'), '# A')
    const result = await tools.call('export.pdf', {
      path: 'a.md',
      output_path: 'out/custom.pdf',
      numbered_headings: true,
      page_number_position: 'right',
      page_size: 'letter',
    }, ctx) as Record<string, unknown>
    expect(result.path).toBe('out/custom.pdf')
    const [html, options] = renderPdf.mock.calls[0]
    expect(html).toContain('class="doc doc--numbered doc--justify"')
    expect(options.pageWidthIn).toBeCloseTo(8.5)
    expect(options.pageNumberAlign).toBe('right')
  })

  it('export.pdf maps a uniform cm margin into the render options', async () => {
    writeFileSync(join(dir, 'a.md'), '# A')
    await tools.call('export.pdf', { path: 'a.md', margin_cm: 1.5 }, ctx)
    expect(renderPdf.mock.calls[0][1].marginsMm).toEqual({ top: 15, right: 15, bottom: 15, left: 15 })
  })

  it('export.pdf clamps an out-of-range margin', async () => {
    writeFileSync(join(dir, 'a.md'), '# A')
    await tools.call('export.pdf', { path: 'a.md', margin_cm: 99 }, ctx)
    expect(renderPdf.mock.calls[0][1].marginsMm).toEqual({ top: 100, right: 100, bottom: 100, left: 100 })
  })

  it('export.pdf accepts editor buffer markdown with an output path', async () => {
    const result = await tools.call('export.pdf', {
      markdown: '# From Buffer',
      output_path: 'buffer.pdf',
    }, ctx) as Record<string, unknown>
    expect(result.path).toBe('buffer.pdf')
    expect(renderPdf.mock.calls[0][0]).toContain('From Buffer')
  })

  it('strips inline comment notes from exported documents', async () => {
    writeFileSync(join(dir, 'review.md'), 'Keep <comment id="c001">this paragraph<note by="user" at="2026-06-13T09:30">Rewrite the hidden note.</note></comment> visible.')
    await tools.call('export.pdf', { path: 'review.md' }, ctx)

    const html = renderPdf.mock.calls[0][0] as string
    expect(html).toContain('Keep this paragraph visible.')
    expect(html).not.toContain('Rewrite the hidden note')
    expect(html).not.toContain('<comment')
  })

  it('export.pdf requires an output path when exporting buffer markdown', async () => {
    await expect(tools.call('export.pdf', { markdown: '# X' }, ctx)).rejects.toThrow(/output_path/)
  })

  it('rejects path traversal for source and output', async () => {
    writeFileSync(join(dir, 'a.md'), 'x')
    await expect(tools.call('export.pdf', { path: '../outside.md' }, ctx)).rejects.toThrow(/traversal|outside/i)
    await expect(tools.call('export.pdf', { path: 'a.md', output_path: '../evil.pdf' }, ctx)).rejects.toThrow(/traversal|outside/i)
  })

  it('accepts an absolute output_path (user-initiated save dialog may point anywhere)', async () => {
    writeFileSync(join(dir, 'a.md'), '# Title\n\nBody.')
    const outsideDir = mkdtempSync(join(tmpdir(), 'mim-outside-'))
    try {
      const outputPath = join(outsideDir, 'out.pdf')
      const result = await tools.call('export.pdf', { path: 'a.md', output_path: outputPath }, ctx) as Record<string, unknown>
      expect(result.path).toBe(outputPath)
      expect(readFileSync(outputPath).equals(FAKE_PDF)).toBe(true)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects an unknown font with the valid list', async () => {
    writeFileSync(join(dir, 'a.md'), 'x')
    await expect(tools.call('export.pdf', { path: 'a.md', font: 'comic' }, ctx)).rejects.toThrow(/satoshi/)
  })

  it('export.pdf fails clearly when rendering is unavailable (headless)', async () => {
    const headless = createToolRegistry(createTraceLog())
    headless.setWorkspacePath(dir)
    registerExportTools(headless, {})
    writeFileSync(join(dir, 'a.md'), 'x')
    await expect(headless.call('export.pdf', { path: 'a.md' }, ctx)).rejects.toThrow(/not available/i)
  })

  it('export.docx writes a valid docx next to the source', async () => {
    writeFileSync(join(dir, 'note.md'), '# Note\n\nHello docx.')
    const result = await tools.call('export.docx', { path: 'note.md' }, ctx) as Record<string, unknown>
    expect(result.path).toBe('note.docx')
    const buffer = readFileSync(join(dir, 'note.docx'))
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK')
    const text = (await mammoth.extractRawText({ buffer })).value
    expect(text).toContain('Hello docx.')
  })

  it('export.docx works without a pdf renderer (headless parity)', async () => {
    const headless = createToolRegistry(createTraceLog())
    headless.setWorkspacePath(dir)
    registerExportTools(headless, {})
    writeFileSync(join(dir, 'a.md'), 'headless body')
    const result = await headless.call('export.docx', { path: 'a.md' }, ctx) as Record<string, unknown>
    expect(result.path).toBe('a.docx')
  })

  it('export.docx embeds local images', async () => {
    writeFileSync(join(dir, 'img.png'), TINY_PNG)
    writeFileSync(join(dir, 'doc.md'), 'before\n\n![pic](img.png)\n\nafter')
    const result = await tools.call('export.docx', { path: 'doc.md' }, ctx) as Record<string, unknown>
    const buffer = readFileSync(join(dir, 'doc.docx'))
    const text = (await mammoth.extractRawText({ buffer })).value
    expect(text).not.toContain('[pic]')
    expect(result.path).toBe('doc.docx')
  })

  it('resolves citations against a bibtex file and appends references', async () => {
    writeFileSync(join(dir, 'refs.bib'), '@book{doe2019, author={Doe, John}, title={A Long Book}, publisher={Big Press}, year={2019}}')
    writeFileSync(join(dir, 'cited.md'), 'As shown [@doe2019]. Unknown [@missing].')
    const result = await tools.call('export.docx', {
      path: 'cited.md',
      citation_style: 'apa',
      bibtex_path: 'refs.bib',
    }, ctx) as Record<string, unknown>
    expect(result.unresolved_citations).toEqual(['missing'])
    const buffer = readFileSync(join(dir, 'cited.docx'))
    const text = (await mammoth.extractRawText({ buffer })).value
    expect(text).toContain('(Doe')
    expect(text).toContain('2019)')
    expect(text).toContain('References')
    expect(text).toContain('A Long Book')
    expect(text).toContain('[@missing]')
  })

  it('passes citations through to the pdf html', async () => {
    writeFileSync(join(dir, 'refs.bib'), '@book{doe2019, author={Doe, John}, title={A Long Book}, publisher={Big Press}, year={2019}}')
    writeFileSync(join(dir, 'cited.md'), 'As shown [@doe2019].')
    await tools.call('export.pdf', { path: 'cited.md', citation_style: 'ieee', bibtex_path: 'refs.bib' }, ctx)
    const html = renderPdf.mock.calls[0][0] as string
    expect(html).toContain('[1]')
    expect(html).toContain('doc-references')
  })

  it('accepts a workspace-relative CSL style path for citations', async () => {
    mkdirSync(join(dir, 'references', 'styles'), { recursive: true })
    writeFileSync(join(dir, 'references', 'styles', 'apa.csl'), builtinCitationStyleXml('apa')!)
    writeFileSync(join(dir, 'refs.bib'), '@book{doe2019, author={Doe, John}, title={A Long Book}, publisher={Big Press}, year={2019}}')
    writeFileSync(join(dir, 'cited.md'), 'As shown [@doe2019].')

    const result = await tools.call('export.docx', {
      path: 'cited.md',
      citation_style: 'references/styles/apa.csl',
      bibtex_path: 'refs.bib',
    }, ctx) as Record<string, unknown>

    expect(result.citations).toBe(1)
    const text = (await mammoth.extractRawText({ buffer: readFileSync(join(dir, 'cited.docx')) })).value
    expect(text).toContain('Doe')
    expect(text).toContain('A Long Book')
  })

  it('reports page sizes and fonts through export.styles', async () => {
    const result = await tools.call('export.styles', {}, ctx) as {
      page_sizes: Array<Record<string, unknown>>
      fonts: Array<Record<string, unknown>>
      defaults: Record<string, unknown>
    }
    expect(result.page_sizes.map(p => p.id)).toEqual(['a4', 'letter', 'a5'])
    expect(result.fonts.map(f => f.id)).toEqual(['satoshi', 'lora', 'zilla'])
    expect(result.defaults).toMatchObject({ page_size: 'a4', margin_cm: 2.5, font: 'satoshi', font_size_pt: 11 })
  })
})
