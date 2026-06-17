import { beforeEach, describe, expect, it, vi } from 'vitest'
import { basename, dirname } from 'path'
import { annotateDocx, generateRevisionPath, getDocxComments, validateDocx } from '@main/docx/writer.js'
import type { DocxOperation, DocxWorkerResult } from '@main/docx/writer.js'

const worker = vi.hoisted(() => ({
  runDocxWorker: vi.fn<(request: Record<string, unknown>) => Promise<DocxWorkerResult>>(),
}))

vi.mock('@main/docx/worker.js', () => ({
  runDocxWorker: worker.runDocxWorker,
}))

const TIMESTAMP_SUFFIX = /_reviewed_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.docx$/

describe('generateRevisionPath', () => {
  it('keeps the directory and extension and inserts a reviewed timestamp', () => {
    const path = generateRevisionPath('/tmp/work/report.docx')
    expect(dirname(path)).toBe('/tmp/work')
    expect(basename(path)).toMatch(/^report_reviewed_/)
    expect(path).toMatch(TIMESTAMP_SUFFIX)
  })

  it('defaults to a .docx extension when the input has none', () => {
    const path = generateRevisionPath('/tmp/work/notes')
    expect(dirname(path)).toBe('/tmp/work')
    expect(basename(path)).toMatch(/^notes_reviewed_/)
    expect(path.endsWith('.docx')).toBe(true)
  })
})

describe('writer request assembly', () => {
  beforeEach(() => {
    worker.runDocxWorker.mockReset()
    worker.runDocxWorker.mockResolvedValue({ success: true })
  })

  it('annotateDocx defaults the output path to a revision next to the input', async () => {
    const operations: DocxOperation[] = [{ type: 'add_comment', anchorText: 'Intro', commentText: 'Check' }]
    await annotateDocx('/tmp/work/in.docx', operations)

    expect(worker.runDocxWorker).toHaveBeenCalledTimes(1)
    const request = worker.runDocxWorker.mock.calls[0][0]
    expect(request.command).toBe('annotate')
    expect(request.inputPath).toBe('/tmp/work/in.docx')
    expect(request.operations).toBe(operations)
    expect(request.outputPath).toMatch(/^\/tmp\/work\/in_reviewed_/)
    expect(request.outputPath).toMatch(TIMESTAMP_SUFFIX)
  })

  it('annotateDocx uses an explicit output path when provided', async () => {
    await annotateDocx('/tmp/in.docx', [{ type: 'tracked_deletion', deleteText: 'old' }], {
      outputPath: '/tmp/out.docx',
    })
    expect(worker.runDocxWorker).toHaveBeenCalledWith({
      command: 'annotate',
      inputPath: '/tmp/in.docx',
      outputPath: '/tmp/out.docx',
      operations: [{ type: 'tracked_deletion', deleteText: 'old' }],
    })
  })

  it('annotateDocx returns the worker result unchanged, including failures', async () => {
    const failure: DocxWorkerResult = {
      success: false,
      error: 'anchor not found',
      summary: { total: 1, succeeded: 0, failed: 1 },
    }
    worker.runDocxWorker.mockResolvedValue(failure)
    await expect(annotateDocx('/tmp/in.docx', [{ type: 'add_comment' }])).resolves.toBe(failure)
  })

  it('getDocxComments issues a read_comments request for the file', async () => {
    await getDocxComments('/tmp/doc.docx')
    expect(worker.runDocxWorker).toHaveBeenCalledWith({ command: 'read_comments', path: '/tmp/doc.docx' })
  })

  it('validateDocx issues a validate request for the file', async () => {
    await validateDocx('/tmp/doc.docx')
    expect(worker.runDocxWorker).toHaveBeenCalledWith({ command: 'validate', path: '/tmp/doc.docx' })
  })
})
