import { dirname, extname, join, basename } from 'path'
import { runDocxWorker, type DocxOperation, type DocxWorkerResult } from '@main/docx/worker.js'

export type { DocxOperation, DocxWorkerResult }

export interface AnnotateDocxOptions {
  outputPath?: string
}

export function generateRevisionPath(inputPath: string): string {
  const ext = extname(inputPath) || '.docx'
  const name = basename(inputPath, ext)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return join(dirname(inputPath), `${name}_reviewed_${timestamp}${ext}`)
}

export async function annotateDocx(
  inputPath: string,
  operations: DocxOperation[],
  options: AnnotateDocxOptions = {},
): Promise<DocxWorkerResult> {
  const outputPath = options.outputPath ?? generateRevisionPath(inputPath)
  return runDocxWorker({
    command: 'annotate',
    inputPath,
    outputPath,
    operations,
  })
}

export async function getDocxComments(filePath: string): Promise<DocxWorkerResult> {
  return runDocxWorker({
    command: 'read_comments',
    path: filePath,
  })
}

export async function validateDocx(filePath: string): Promise<DocxWorkerResult> {
  return runDocxWorker({
    command: 'validate',
    path: filePath,
  })
}
