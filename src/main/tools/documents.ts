import { existsSync, statSync } from 'fs'
import { dirname, extname, isAbsolute, relative, resolve } from 'path'
import { extractDocxForReview, readDocxAsText } from '@main/docx/reader.js'
import { annotateDocx, getDocxComments, validateDocx, type DocxOperation } from '@main/docx/writer.js'
import { getDocxWorkerStatus } from '@main/docx/worker.js'
import { importDocumentToMarkdown, supportedImportExtensions } from '@main/documents/importMarkdown.js'
import { extractPdfText } from '@main/documents/pdfExtract.js'
import type { ToolRegistry } from '@main/tools/registry.js'

export function registerDocumentTools(tools: ToolRegistry): void {
  tools.register({
    name: 'documents.docx.read',
    description: 'Read a workspace DOCX file into LLM-readable text.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      max_chars: { type: 'number' },
    }, ['path']),
    execute: async (params) => {
      const absolutePath = resolveDocxPath(tools, requireString(params, 'path'))
      const result = await readDocxAsText(absolutePath, {
        maxChars: optionalNumber(params, 'max_chars'),
      })
      return {
        path: toWorkspaceRelative(tools, absolutePath),
        text: result.text,
        total_chars: result.totalChars,
        truncated: result.truncated,
        comments: result.comments,
      }
    },
  })

  tools.register({
    name: 'documents.docx.extract',
    description: 'Extract a workspace DOCX file into review HTML, markdown, text, and images.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      max_chars: { type: 'number' },
    }, ['path']),
    execute: async (params) => {
      const absolutePath = resolveDocxPath(tools, requireString(params, 'path'))
      const result = await extractDocxForReview(absolutePath, {
        maxChars: optionalNumber(params, 'max_chars'),
      })
      return {
        path: toWorkspaceRelative(tools, absolutePath),
        html: result.html,
        markdown: result.markdown,
        text: result.text,
        images: result.images,
        total_chars: result.totalChars,
        truncated: result.truncated,
      }
    },
  })

  tools.register({
    name: 'documents.docx.annotate',
    description: 'Create a reviewed DOCX copy with Word comments or tracked changes. The original file is not modified.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      output_path: { type: 'string' },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            anchorText: { type: 'string' },
            commentText: { type: 'string' },
            author: { type: 'string' },
            occurrenceIndex: { type: 'number' },
            parentCommentId: { type: 'string' },
            replyText: { type: 'string' },
            commentId: { type: 'string' },
            insertionText: { type: 'string' },
            position: { type: 'string' },
            deleteText: { type: 'string' },
          },
        },
      },
    }, ['path', 'operations']),
    execute: async (params) => {
      const absolutePath = resolveDocxPath(tools, requireString(params, 'path'))
      const outputPath = optionalString(params, 'output_path')
      const absoluteOutputPath = outputPath ? resolveWorkspacePath(tools, outputPath) : undefined
      if (absoluteOutputPath && extname(absoluteOutputPath).toLowerCase() !== '.docx') {
        throw new Error('DOCX output path must end with .docx')
      }
      const operations = readOperations(params.operations)
      const result = await annotateDocx(absolutePath, operations, { outputPath: absoluteOutputPath })
      return rewriteWorkerPaths(tools, result)
    },
  })

  tools.register({
    name: 'documents.docx.comments',
    description: 'Read existing Word comments from a workspace DOCX file.',
    inputSchema: objectSchema({ path: { type: 'string' } }, ['path']),
    execute: async (params) => {
      const absolutePath = resolveDocxPath(tools, requireString(params, 'path'))
      return getDocxComments(absolutePath)
    },
  })

  tools.register({
    name: 'documents.docx.validate',
    description: 'Validate a workspace DOCX file with the Open XML validator.',
    inputSchema: objectSchema({ path: { type: 'string' } }, ['path']),
    execute: async (params) => {
      const absolutePath = resolveDocxPath(tools, requireString(params, 'path'))
      return validateDocx(absolutePath)
    },
  })

  tools.register({
    name: 'documents.docx.workerStatus',
    description: 'Check whether the DOCX Open XML worker binary is available.',
    inputSchema: objectSchema({}),
    execute: async () => getDocxWorkerStatus(),
  })

  tools.register({
    name: 'documents.pdf.extract',
    description: 'Extract selectable text and embedded metadata from a workspace PDF.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      max_chars: { type: 'number' },
    }, ['path']),
    execute: async (params) => {
      const absolutePath = resolvePdfPath(tools, requireString(params, 'path'))
      const result = await extractPdfText(absolutePath, {
        maxChars: optionalNumber(params, 'max_chars'),
      })
      return {
        path: toWorkspaceRelative(tools, absolutePath),
        text: result.text,
        pages: result.pages,
        info: result.info,
        total_chars: result.totalChars,
        truncated: result.truncated,
      }
    },
  })

  tools.register({
    name: 'documents.importMarkdown',
    description: 'Convert a workspace .docx, .xlsx/.xlsm, .bib, or selectable .pdf file into AI-ready Markdown. JS/TS-only; scanned PDFs and legacy Office files are refused.',
    inputSchema: objectSchema({
      path: { type: 'string' },
      output_path: { type: 'string' },
      max_rows: { type: 'number' },
      max_cols: { type: 'number' },
      max_pages: { type: 'number' },
    }, ['path']),
    execute: async (params) => {
      const workspacePath = tools.getWorkspacePath()
      if (!workspacePath) throw new Error('No workspace open')
      return importDocumentToMarkdown({
        workspacePath,
        path: requireString(params, 'path'),
        outputPath: optionalString(params, 'output_path'),
        maxRows: optionalNumber(params, 'max_rows'),
        maxCols: optionalNumber(params, 'max_cols'),
        maxPages: optionalNumber(params, 'max_pages'),
      })
    },
  })

  tools.register({
    name: 'documents.importMarkdown.formats',
    description: 'List file formats supported by documents.importMarkdown.',
    inputSchema: objectSchema({}),
    execute: async () => ({ extensions: supportedImportExtensions() }),
  })
}

function resolveDocxPath(tools: ToolRegistry, path: string): string {
  const resolved = resolveWorkspacePath(tools, path)
  if (!existsSync(resolved)) throw new Error(`DOCX file does not exist: ${path}`)
  if (!statSync(resolved).isFile()) throw new Error(`DOCX path is not a file: ${path}`)
  if (extname(resolved).toLowerCase() !== '.docx') throw new Error(`Expected a .docx file: ${path}`)
  return resolved
}

function resolvePdfPath(tools: ToolRegistry, path: string): string {
  const resolved = resolveWorkspacePath(tools, path)
  if (!existsSync(resolved)) throw new Error(`PDF file does not exist: ${path}`)
  if (!statSync(resolved).isFile()) throw new Error(`PDF path is not a file: ${path}`)
  if (extname(resolved).toLowerCase() !== '.pdf') throw new Error(`Expected a .pdf file: ${path}`)
  return resolved
}

function resolveWorkspacePath(tools: ToolRegistry, relativePath: string): string {
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  const root = resolve(workspace)
  const resolved = resolve(root, relativePath)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path traversal outside workspace is not allowed')
  }
  return resolved
}

function toWorkspaceRelative(tools: ToolRegistry, absolutePath: string): string {
  return relative(tools.getWorkspacePath()!, absolutePath).replace(/\\/g, '/')
}

function rewriteWorkerPaths(tools: ToolRegistry, result: Record<string, unknown>): Record<string, unknown> {
  const outputPath = typeof result.outputPath === 'string'
    ? toWorkspaceRelative(tools, result.outputPath)
    : undefined
  return outputPath ? { ...result, outputPath } : result
}

function readOperations(value: unknown): DocxOperation[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('operations must be a non-empty array')
  if (value.length > 100) throw new Error('operations may contain at most 100 items')
  return value.map((item, index) => readOperation(item, index))
}

function readOperation(value: unknown, index: number): DocxOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`operations[${index}] must be an object`)
  }
  const raw = value as Record<string, unknown>
  const type = raw.type
  if (
    type !== 'add_comment' &&
    type !== 'reply_comment' &&
    type !== 'resolve_comment' &&
    type !== 'tracked_insertion' &&
    type !== 'tracked_deletion'
  ) {
    throw new Error(`operations[${index}].type is invalid`)
  }
  return {
    type,
    anchorText: readOptionalString(raw.anchorText),
    commentText: readOptionalString(raw.commentText),
    author: readOptionalString(raw.author),
    occurrenceIndex: typeof raw.occurrenceIndex === 'number' ? raw.occurrenceIndex : undefined,
    parentCommentId: readOptionalString(raw.parentCommentId),
    replyText: readOptionalString(raw.replyText),
    commentId: readOptionalString(raw.commentId),
    insertionText: readOptionalString(raw.insertionText),
    position: raw.position === 'before' || raw.position === 'after' || raw.position === 'replace' ? raw.position : undefined,
    deleteText: readOptionalString(raw.deleteText),
  }
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required parameter: ${key}`)
  return value
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  return typeof params[key] === 'string' && params[key].length > 0 ? params[key] : undefined
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  return typeof params[key] === 'number' && Number.isFinite(params[key]) ? params[key] : undefined
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}
