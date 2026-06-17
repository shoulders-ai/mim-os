import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import { registerDocumentTools } from '@main/tools/documents.js'

const mammothState = vi.hoisted(() => ({
  html: '<p>Default body</p>',
}))

vi.mock('mammoth', () => {
  const convertToHtml = async () => ({ value: mammothState.html })
  const images = { imgElement: (handler: unknown) => handler }
  return { default: { convertToHtml, images }, convertToHtml, images }
})

// Echoes the worker request back inside the JSON response so tests can assert
// exactly what request the documents tools assembled. The child process is the
// system boundary, per src/main/docx/worker.test.ts.
const ECHO_WORKER = `#!/usr/bin/env node
const fs = require('fs')
const request = JSON.parse(fs.readFileSync(process.argv[3], 'utf-8'))
const response = { success: true, request }
if (request.outputPath) response.outputPath = request.outputPath
console.log(JSON.stringify(response))
`

describe('documents tools', () => {
  const originalWorkerPath = process.env.DOCX_WORKER_PATH
  const ctx = { actor: 'user' as const }
  let dir: string
  let workerDir: string
  let workerPath: string
  let tools: ReturnType<typeof createToolRegistry>

  function installWorker(source: string): void {
    writeFileSync(workerPath, source, 'utf-8')
    chmodSync(workerPath, 0o755)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-documents-test-'))
    workerDir = mkdtempSync(join(tmpdir(), 'mim-documents-worker-'))
    workerPath = join(workerDir, 'docx-worker')
    installWorker(ECHO_WORKER)
    process.env.DOCX_WORKER_PATH = workerPath

    mammothState.html = '<p>Default body</p>'
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    registerDocumentTools(tools)
    writeFileSync(join(dir, 'doc.docx'), 'fake docx bytes')
  })

  afterEach(() => {
    if (originalWorkerPath === undefined) delete process.env.DOCX_WORKER_PATH
    else process.env.DOCX_WORKER_PATH = originalWorkerPath
    rmSync(dir, { recursive: true, force: true })
    rmSync(workerDir, { recursive: true, force: true })
  })

  describe('workspace scoping and param validation (shared resolveDocxPath)', () => {
    it('rejects a missing path parameter', async () => {
      await expect(tools.call('documents.docx.read', {}, ctx))
        .rejects.toThrow('Missing required parameter: path')
    })

    it('rejects relative traversal outside the workspace', async () => {
      await expect(tools.call('documents.docx.read', { path: '../escape.docx' }, ctx))
        .rejects.toThrow('Path traversal outside workspace is not allowed')
    })

    it('rejects absolute paths outside the workspace', async () => {
      const outside = join(tmpdir(), 'outside.docx')
      await expect(tools.call('documents.docx.read', { path: outside }, ctx))
        .rejects.toThrow('Path traversal outside workspace is not allowed')
    })

    it('rejects files that do not exist', async () => {
      await expect(tools.call('documents.docx.read', { path: 'missing.docx' }, ctx))
        .rejects.toThrow('DOCX file does not exist: missing.docx')
    })

    it('rejects paths that are not files', async () => {
      mkdirSync(join(dir, 'folder.docx'))
      await expect(tools.call('documents.docx.read', { path: 'folder.docx' }, ctx))
        .rejects.toThrow('DOCX path is not a file: folder.docx')
    })

    it('rejects non-.docx extensions but accepts uppercase .DOCX', async () => {
      writeFileSync(join(dir, 'notes.txt'), 'text')
      await expect(tools.call('documents.docx.read', { path: 'notes.txt' }, ctx))
        .rejects.toThrow('Expected a .docx file: notes.txt')

      writeFileSync(join(dir, 'UPPER.DOCX'), 'fake')
      const result = await tools.call('documents.docx.read', { path: 'UPPER.DOCX' }, ctx) as { path: string }
      expect(result.path).toBe('UPPER.DOCX')
    })

    it('fails when no workspace is open', async () => {
      const bare = createToolRegistry(createTraceLog())
      registerDocumentTools(bare)
      await expect(bare.call('documents.docx.read', { path: 'doc.docx' }, ctx))
        .rejects.toThrow('No workspace open')
    })
  })

  describe('documents.docx.read', () => {
    it('returns readable text, comments, and a workspace-relative path', async () => {
      mkdirSync(join(dir, 'docs'))
      writeFileSync(join(dir, 'docs', 'nested.docx'), 'fake')
      mammothState.html = '<p>Intro<sup><a href="#comment-1" id="comment-ref-1">[1]</a></sup> end</p>'
        + '<dl><dt><a id="comment-1">[1]</a></dt><dd><p>Tighten this</p></dd></dl>'

      const result = await tools.call('documents.docx.read', { path: 'docs/nested.docx' }, ctx) as {
        path: string
        text: string
        total_chars: number
        truncated: boolean
        comments: Record<string, { author: string; text: string }>
      }

      expect(result.path).toBe('docs/nested.docx')
      expect(result.comments).toEqual({ '1': { author: 'Reviewer', text: 'Tighten this' } })
      expect(result.text).toContain('[[Comment #1 by Reviewer: "Tighten this"]]')
      expect(result.truncated).toBe(false)
      expect(result.total_chars).toBe(result.text.length)
    })

    it('honors numeric max_chars and ignores non-numeric values', async () => {
      mammothState.html = '<p>abcdefghij</p>'

      const truncatedResult = await tools.call('documents.docx.read', { path: 'doc.docx', max_chars: 4 }, ctx) as {
        text: string; truncated: boolean; total_chars: number
      }
      expect(truncatedResult.text).toBe('abcd')
      expect(truncatedResult.truncated).toBe(true)
      expect(truncatedResult.total_chars).toBe(10)

      const ignoredResult = await tools.call('documents.docx.read', { path: 'doc.docx', max_chars: '4' }, ctx) as {
        text: string; truncated: boolean
      }
      expect(ignoredResult.text).toBe('abcdefghij')
      expect(ignoredResult.truncated).toBe(false)
    })
  })

  describe('documents.docx.extract', () => {
    it('returns html, markdown, text, and images with a workspace-relative path', async () => {
      mammothState.html = '<h1>Title</h1><p>Hello <strong>world</strong></p>'

      const result = await tools.call('documents.docx.extract', { path: 'doc.docx' }, ctx) as {
        path: string
        html: string
        markdown: string
        text: string
        images: unknown[]
        total_chars: number
        truncated: boolean
      }

      expect(result.path).toBe('doc.docx')
      expect(result.html).toBe(mammothState.html)
      expect(result.markdown).toContain('# Title')
      expect(result.markdown).toContain('Hello **world**')
      expect(result.text).toBe(result.markdown)
      expect(result.images).toEqual([])
      expect(result.truncated).toBe(false)
      expect(result.total_chars).toBe(result.markdown.length)
    })

    it('preserves simple tables as GFM markdown tables', async () => {
      mammothState.html = '<h1>Table</h1><table><tr><th>Measure</th><th>Value</th></tr><tr><td>N</td><td>42</td></tr></table>'

      const result = await tools.call('documents.docx.extract', { path: 'doc.docx' }, ctx) as {
        markdown: string
      }

      expect(result.markdown).toContain('| Measure | Value |')
      expect(result.markdown).toContain('| N | 42 |')
    })
  })

  describe('documents.pdf.extract', () => {
    it('extracts selectable PDF text and metadata from a workspace PDF', async () => {
      writeFileSync(join(dir, 'paper.pdf'), makeTextPdf({
        text: 'The paper DOI is 10.1000/example and the title is Useful Evidence.',
        title: 'Useful Evidence Metadata',
        author: 'Jane Smith',
        doi: '10.1000/metadata',
      }))

      const result = await tools.call('documents.pdf.extract', {
        path: 'paper.pdf',
      }, ctx) as {
        path: string
        text: string
        pages: number
        total_chars: number
        truncated: boolean
        info: Record<string, unknown>
      }

      expect(result.path).toBe('paper.pdf')
      expect(result.pages).toBe(1)
      expect(result.text).toContain('10.1000/example')
      expect(result.total_chars).toBeGreaterThan(result.text.length - 1)
      expect(result.truncated).toBe(false)
      expect(result.info).toMatchObject({
        Title: 'Useful Evidence Metadata',
        Author: 'Jane Smith',
      })
      expect(String(result.info.doi ?? result.info.DOI ?? '')).toContain('10.1000/metadata')
    })

    it('honors max_chars while still reporting total character count', async () => {
      writeFileSync(join(dir, 'paper.pdf'), makeTextPdf({
        text: 'abcdefghijklmnopqrstuvwxyz',
      }))

      const result = await tools.call('documents.pdf.extract', {
        path: 'paper.pdf',
        max_chars: 10,
      }, ctx) as { text: string; total_chars: number; truncated: boolean }

      expect(result.text.length).toBeLessThanOrEqual(10)
      expect(result.total_chars).toBeGreaterThan(10)
      expect(result.truncated).toBe(true)
    })

    it('rejects traversal and non-PDF files', async () => {
      writeFileSync(join(dir, 'notes.txt'), 'not a pdf')

      await expect(tools.call('documents.pdf.extract', { path: '../escape.pdf' }, ctx))
        .rejects.toThrow('traversal')
      await expect(tools.call('documents.pdf.extract', { path: 'notes.txt' }, ctx))
        .rejects.toThrow('Expected a .pdf file')
    })
  })

  describe('documents.importMarkdown', () => {
    it('imports DOCX to a markdown file', async () => {
      const zip = new JSZip()
      zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>')
      writeFileSync(join(dir, 'doc.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
      mammothState.html = '<h1>Imported</h1><p>Hello <strong>world</strong></p><table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr></table>'

      const result = await tools.call('documents.importMarkdown', {
        path: 'doc.docx',
        output_path: 'imports/doc.md',
      }, ctx) as { outputPath: string; format: string; fidelity: string; warnings: string[] }

      expect(result.outputPath).toBe('imports/doc.md')
      expect(result.format).toBe('docx')
      expect(result.fidelity).toBe('clean')
      expect(result.warnings).toEqual([])
      const content = readFileSync(join(dir, 'imports', 'doc.md'), 'utf-8')
      expect(content).toContain('source_format: docx')
      expect(content).toContain('# Imported')
      expect(content).toContain('| A | B |')
    })

    it('imports a workbook as sheet sections with formula warnings', async () => {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Data')
      sheet.addRow(['Name', 'Value', 'Double'])
      sheet.addRow(['Alpha', 2, { formula: 'B2*2', result: 4 }])
      sheet.addRow(['Beta', 3, { formula: 'B3*2', result: 6 }])
      sheet.mergeCells('A4:B4')
      await workbook.xlsx.writeFile(join(dir, 'book.xlsx'))

      const result = await tools.call('documents.importMarkdown', {
        path: 'book.xlsx',
        output_path: 'imports/book.md',
      }, ctx) as { outputPath: string; format: string; warnings: string[]; stats: Record<string, unknown> }

      expect(result.outputPath).toBe('imports/book.md')
      expect(result.format).toBe('xlsx')
      expect(result.stats.sheets).toBe(1)
      expect(result.stats.formulas).toBe(2)
      expect(result.warnings.join('\n')).toContain('Formulas are not recalculated')
      expect(result.warnings.join('\n')).toContain('Merged Excel cells were flattened')
      const content = readFileSync(join(dir, 'imports', 'book.md'), 'utf-8')
      expect(content).toContain('## Data')
      expect(content).toContain('| Name | Value | Double |')
      expect(content).toContain('| Alpha | 2 | 4 |')
      expect(content).toContain('### Formula cells')
      expect(content).toContain('| B2*2 |')
    })

    it('imports BibTeX as reference notes', async () => {
      writeFileSync(join(dir, 'references.bib'), `@article{smith2024,
  title = {Useful Evidence},
  author = {Jane Smith and Max Doe},
  year = {2024},
  journal = {Evidence Journal},
  doi = {10.1000/example}
}`)

      const result = await tools.call('documents.importMarkdown', {
        path: 'references.bib',
        output_path: 'imports/references.md',
      }, ctx) as { outputPath: string; format: string; stats: Record<string, unknown> }

      expect(result.outputPath).toBe('imports/references.md')
      expect(result.format).toBe('bib')
      expect(result.stats.entries).toBe(1)
      const content = readFileSync(join(dir, 'imports', 'references.md'), 'utf-8')
      expect(content).toContain('## smith2024')
      expect(content).toContain('- Title: Useful Evidence')
      expect(content).toContain('- Authors: Jane Smith; Max Doe')
    })

    it('refuses unsupported and legacy formats', async () => {
      writeFileSync(join(dir, 'notes.txt'), 'plain text')
      writeFileSync(join(dir, 'legacy.doc'), 'old')

      await expect(tools.call('documents.importMarkdown', { path: 'notes.txt' }, ctx))
        .rejects.toThrow('Unsupported import format')
      await expect(tools.call('documents.importMarkdown', { path: 'legacy.doc' }, ctx))
        .rejects.toThrow('Legacy .doc files')
    })

    it('lists supported import formats', async () => {
      const result = await tools.call('documents.importMarkdown.formats', {}, ctx) as { extensions: string[] }
      expect(result.extensions).toEqual(['docx', 'xlsx', 'xlsm', 'bib', 'pdf'])
    })
  })

  describe('documents.docx.annotate', () => {
    it('rejects an empty operations array', async () => {
      await expect(tools.call('documents.docx.annotate', { path: 'doc.docx', operations: [] }, ctx))
        .rejects.toThrow('operations must be a non-empty array')
    })

    it('rejects non-array operations', async () => {
      await expect(tools.call('documents.docx.annotate', { path: 'doc.docx', operations: 'nope' }, ctx))
        .rejects.toThrow('operations must be a non-empty array')
    })

    it('rejects more than 100 operations', async () => {
      const operations = Array.from({ length: 101 }, () => ({ type: 'add_comment' }))
      await expect(tools.call('documents.docx.annotate', { path: 'doc.docx', operations }, ctx))
        .rejects.toThrow('operations may contain at most 100 items')
    })

    it('rejects operations that are not objects or have invalid types', async () => {
      await expect(tools.call('documents.docx.annotate', { path: 'doc.docx', operations: ['x'] }, ctx))
        .rejects.toThrow('operations[0] must be an object')
      await expect(tools.call('documents.docx.annotate', {
        path: 'doc.docx',
        operations: [{ type: 'add_comment' }, { type: 'delete_everything' }],
      }, ctx)).rejects.toThrow('operations[1].type is invalid')
    })

    it('rejects output paths that do not end in .docx or escape the workspace', async () => {
      await expect(tools.call('documents.docx.annotate', {
        path: 'doc.docx',
        output_path: 'out.txt',
        operations: [{ type: 'add_comment' }],
      }, ctx)).rejects.toThrow('DOCX output path must end with .docx')

      await expect(tools.call('documents.docx.annotate', {
        path: 'doc.docx',
        output_path: '../out.docx',
        operations: [{ type: 'add_comment' }],
      }, ctx)).rejects.toThrow('Path traversal outside workspace is not allowed')
    })

    it('sends normalized operations to the worker and rewrites outputPath workspace-relative', async () => {
      const result = await tools.call('documents.docx.annotate', {
        path: 'doc.docx',
        output_path: 'reviewed.docx',
        operations: [{
          type: 'add_comment',
          anchorText: 'Intro',
          commentText: 'Check',
          occurrenceIndex: 2,
          position: 'sideways', // invalid -> dropped
          author: 42, // wrong type -> dropped
          bogus: true, // unknown -> dropped
        }],
      }, ctx) as {
        success: boolean
        outputPath: string
        request: { command: string; inputPath: string; outputPath: string; operations: Array<Record<string, unknown>> }
      }

      expect(result.success).toBe(true)
      expect(result.outputPath).toBe('reviewed.docx')
      expect(result.request.command).toBe('annotate')
      expect(result.request.inputPath).toBe(join(dir, 'doc.docx'))
      expect(result.request.outputPath).toBe(join(dir, 'reviewed.docx'))
      expect(result.request.operations).toEqual([{
        type: 'add_comment',
        anchorText: 'Intro',
        commentText: 'Check',
        occurrenceIndex: 2,
      }])
    })

    it('defaults the output to a timestamped revision next to the input', async () => {
      const result = await tools.call('documents.docx.annotate', {
        path: 'doc.docx',
        operations: [{ type: 'tracked_insertion', anchorText: 'a', insertionText: 'b', position: 'after' }],
      }, ctx) as { outputPath: string; request: { operations: Array<Record<string, unknown>> } }

      expect(result.outputPath).toMatch(/^doc_reviewed_.+\.docx$/)
      expect(result.outputPath).not.toContain('/')
      expect(result.request.operations[0].position).toBe('after')
    })
  })

  describe('documents.docx.comments / validate / workerStatus', () => {
    it('comments sends a read_comments request with the absolute path', async () => {
      const result = await tools.call('documents.docx.comments', { path: 'doc.docx' }, ctx) as {
        success: boolean
        request: { command: string; path: string }
      }
      expect(result.success).toBe(true)
      expect(result.request).toEqual({ command: 'read_comments', path: join(dir, 'doc.docx') })
    })

    it('validate sends a validate request with the absolute path', async () => {
      const result = await tools.call('documents.docx.validate', { path: 'doc.docx' }, ctx) as {
        request: { command: string; path: string }
      }
      expect(result.request).toEqual({ command: 'validate', path: join(dir, 'doc.docx') })
    })

    it('workerStatus reports the resolved worker binary', async () => {
      const result = await tools.call('documents.docx.workerStatus', {}, ctx) as {
        available: boolean
        path?: string
      }
      expect(result).toEqual({ available: true, path: workerPath })
    })
  })

  describe('worker failure mapping', () => {
    it('surfaces non-JSON worker crashes as thrown errors', async () => {
      installWorker(`#!/usr/bin/env node
console.error('OpenXML engine missing')
process.exit(2)
`)
      await expect(tools.call('documents.docx.validate', { path: 'doc.docx' }, ctx))
        .rejects.toThrow('docx-worker failed: OpenXML engine missing')
    })

    it('passes through structured worker failures as results', async () => {
      installWorker(`#!/usr/bin/env node
console.log(JSON.stringify({
  success: false,
  results: [{ index: 0, success: false, error: 'Text not found in document' }],
  summary: { total: 1, succeeded: 0, failed: 1 }
}))
process.exit(1)
`)
      const result = await tools.call('documents.docx.annotate', {
        path: 'doc.docx',
        operations: [{ type: 'add_comment', anchorText: 'nope' }],
      }, ctx) as { success: boolean; summary: Record<string, unknown> }

      expect(result.success).toBe(false)
      expect(result.summary).toEqual({ total: 1, succeeded: 0, failed: 1 })
    })
  })
})

function makeTextPdf(options: { text: string; title?: string; author?: string; doi?: string }): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td ${pdfLiteral(options.text)} Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    `6 0 obj\n<< /Title ${pdfLiteral(options.title ?? 'Test PDF')} /Author ${pdfLiteral(options.author ?? 'Test Author')} /doi ${pdfLiteral(options.doi ?? '')} >>\nendobj\n`,
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
