// Document export tools: markdown → PDF (Chromium printToPDF via an injected
// Electron boundary) and markdown → DOCX (pure JS, works headless). Both run
// the same pipeline — citation resolution, one shared DocumentStyle — so the
// two formats always agree. `export.styles` feeds the pickers (dialog, AI)
// with the available page sizes, margins, and fonts.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import sharp from 'sharp'
import {
  buildBibliography,
  builtinCitationStyleXml,
  parseBibtex,
  resolveCitations,
  type BibEntry,
  type Reference,
} from '@main/export/citations.js'
import { composeDocx, type DocxImage, type ImageLoader } from '@main/export/exportDocx.js'
import { buildFontFaceCss, composeDocumentHtml } from '@main/export/exportHtml.js'
import type { RenderDocumentHtmlToPdf } from '@main/export/exportPdfTypes.js'
import {
  DEFAULT_DOCUMENT_STYLE,
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE_PT,
  DEFAULT_MARGIN_CM,
  FONT_FAMILIES,
  PAGE_SIZES,
  fontFamilyById,
  pageSizeById,
  uniformMarginsMm,
  type DocumentStyle,
  type PageNumberAlign,
} from '@main/export/documentStyle.js'
import { countPdfPages } from '@main/tools/render.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import { stripComments } from '@main/comments/model.js'

export interface ExportToolOptions {
  /** Electron printToPDF boundary. Absent in headless runtimes, where export.pdf fails with a clear message. */
  renderPdf?: RenderDocumentHtmlToPdf
}

const BUILTIN_CITATION_STYLES = ['apa', 'chicago', 'chicago-author-date', 'ieee']
const MIN_FONT_PT = 6
const MAX_FONT_PT = 22

const SHARED_INPUT_PROPERTIES = {
  path: { type: 'string', description: 'Workspace-relative path to the markdown source file' },
  markdown: { type: 'string', description: 'Literal markdown content (e.g. an unsaved editor buffer). Overrides the file content when both are given; requires output_path when no path is given.' },
  output_path: { type: 'string', description: 'Workspace-relative output path. Defaults to the source path with the export extension.' },
  page_size: { type: 'string', description: `Page size: ${Object.keys(PAGE_SIZES).join(', ')}. Default a4.` },
  margin_cm: { type: 'number', description: `Uniform page margin in centimetres (all four sides). Default ${DEFAULT_MARGIN_CM}.` },
  font: { type: 'string', description: `Body font: ${Object.keys(FONT_FAMILIES).join(', ')}. Default ${DEFAULT_FONT}.` },
  font_size_pt: { type: 'number', description: `Body font size in points. Default ${DEFAULT_FONT_SIZE_PT}.` },
  numbered_headings: { type: 'boolean', description: 'Number headings (1, 1.1, 1.1.1). Default false.' },
  justify: { type: 'boolean', description: 'Justify body text (flush to both margins) instead of left-aligning. Default true.' },
  page_number_position: { type: 'string', description: 'Page-number placement in the footer: none, left, center, or right. Default none.' },
  page_numbers_skip_first: { type: 'boolean', description: 'Omit the page number on the first page (DOCX only; the PDF engine numbers every page). Default false.' },
  center_first_heading: { type: 'boolean', description: 'Treat a leading H1 as a centered, unnumbered document title. Default false.' },
  columns: { type: 'number', description: 'Body column count: 1 or 2. Default 1.' },
  citation_style: { type: 'string', description: 'Resolve [@key] citations: apa, chicago-author-date, ieee, or a workspace-relative .csl path. Requires bibtex_path.' },
  bibtex_path: { type: 'string', description: 'Workspace-relative BibTeX file for citation resolution.' },
  title: { type: 'string', description: 'Document title for metadata. Defaults to the first heading.' },
} as const

const PAGE_NUMBER_ALIGNS = new Set<PageNumberAlign>(['none', 'left', 'center', 'right'])

function buildDocumentStyle(params: Record<string, unknown>): DocumentStyle {
  const bool = (key: string, fallback: boolean): boolean =>
    typeof params[key] === 'boolean' ? params[key] as boolean : fallback
  const align = typeof params.page_number_position === 'string' && PAGE_NUMBER_ALIGNS.has(params.page_number_position as PageNumberAlign)
    ? params.page_number_position as PageNumberAlign
    : DEFAULT_DOCUMENT_STYLE.pageNumberAlign
  const marginCm = typeof params.margin_cm === 'number' && Number.isFinite(params.margin_cm) ? params.margin_cm : DEFAULT_MARGIN_CM
  return {
    numberedHeadings: bool('numbered_headings', DEFAULT_DOCUMENT_STYLE.numberedHeadings),
    titleFirstH1: bool('center_first_heading', DEFAULT_DOCUMENT_STYLE.titleFirstH1),
    pageNumberAlign: align,
    pageNumbersSkipFirst: bool('page_numbers_skip_first', DEFAULT_DOCUMENT_STYLE.pageNumbersSkipFirst),
    justify: bool('justify', DEFAULT_DOCUMENT_STYLE.justify),
    columns: params.columns === 2 ? 2 : 1,
    marginsMm: uniformMarginsMm(marginCm),
  }
}

export function registerExportTools(tools: ToolRegistry, options: ExportToolOptions = {}): void {
  tools.register({
    name: 'export.pdf',
    description: 'Export a markdown document to a styled PDF (layout options, fonts, optional BibTeX citations). Reads a workspace file or literal markdown.',
    inputSchema: {
      type: 'object',
      properties: SHARED_INPUT_PROPERTIES,
    },
    execute: async (params) => {
      if (!options.renderPdf) throw new Error('PDF export is not available in this runtime (no rendering window). Use export.docx instead.')
      const job = prepareJob(tools, params, '.pdf')
      const pageSize = pageSizeById(typeof params.page_size === 'string' ? params.page_size : 'a4')
      const html = composeDocumentHtml({
        markdown: job.markdown,
        style: job.style,
        fontFamily: job.fontId,
        fontSizePt: job.fontSizePt,
        title: job.title,
        baseHref: `${pathToFileURL(job.baseDir).href}/`,
        workspaceHref: `${pathToFileURL(job.workspace).href}/`,
        fontsCss: fontsCss(),
        baseCss: readTemplateCss('_base.css'),
        bibliography: job.bibliography,
      })
      const pdf = await options.renderPdf(html, {
        pageWidthIn: pageSize.widthIn,
        pageHeightIn: pageSize.heightIn,
        marginsMm: job.style.marginsMm,
        pageNumberAlign: job.style.pageNumberAlign,
      })
      atomicWrite(job.outputAbs, pdf)
      return {
        ...job.result,
        format: 'pdf',
        bytes: pdf.length,
        pages: countPdfPages(pdf),
      }
    },
  })

  tools.register({
    name: 'export.docx',
    description: 'Export a markdown document to a Word (.docx) file with the same layout options and citation handling as export.pdf. Works headless.',
    inputSchema: {
      type: 'object',
      properties: SHARED_INPUT_PROPERTIES,
    },
    execute: async (params) => {
      const job = prepareJob(tools, params, '.docx')
      const pageSize = pageSizeById(typeof params.page_size === 'string' ? params.page_size : 'a4')
      const buffer = await composeDocx({
        markdown: job.markdown,
        style: job.style,
        fontFamily: job.fontId,
        fontSizePt: job.fontSizePt,
        pageSize,
        title: job.title,
        loadImage: createImageLoader(job.baseDir, job.workspace),
        bibliography: job.bibliography,
      })
      atomicWrite(job.outputAbs, buffer)
      return {
        ...job.result,
        format: 'docx',
        bytes: buffer.length,
      }
    },
  })

  tools.register({
    name: 'export.styles',
    description: 'List the page sizes and fonts available to export.pdf / export.docx, with their defaults.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({
      page_sizes: Object.entries(PAGE_SIZES).map(([id, size]) => ({ id, label: size.label })),
      fonts: Object.entries(FONT_FAMILIES).map(([id, font]) => ({ id, label: font.label })),
      defaults: {
        page_size: 'a4',
        margin_cm: DEFAULT_MARGIN_CM,
        font: DEFAULT_FONT,
        font_size_pt: DEFAULT_FONT_SIZE_PT,
      },
    }),
  })
}

// ── Shared job preparation ─────────────────────────────────────────────

interface ExportJob {
  markdown: string
  style: DocumentStyle
  fontId: keyof typeof FONT_FAMILIES
  fontSizePt: number
  title?: string
  baseDir: string
  workspace: string
  outputAbs: string
  bibliography?: Reference[]
  result: Record<string, unknown>
}

function prepareJob(tools: ToolRegistry, params: Record<string, unknown>, extension: string): ExportJob {
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  const root = resolve(workspace)

  const sourceRel = typeof params.path === 'string' && params.path ? params.path : null
  const literal = typeof params.markdown === 'string' ? params.markdown : null
  if (!sourceRel && literal === null) throw new Error('Provide path or markdown')

  let markdown: string
  let baseDir = root
  if (sourceRel) {
    const sourceAbs = resolveInside(root, sourceRel)
    if (!existsSync(sourceAbs)) throw new Error(`Source file not found: ${sourceRel}`)
    markdown = literal ?? readFileSync(sourceAbs, 'utf-8')
    baseDir = dirname(sourceAbs)
  } else {
    markdown = literal!
  }
  markdown = stripComments(markdown).text

  const outputRel = typeof params.output_path === 'string' && params.output_path
    ? params.output_path
    : sourceRel
      ? sourceRel.replace(/\.(md|markdown|txt)$/i, '') + extension
      : null
  if (!outputRel) throw new Error(`output_path is required when exporting literal markdown`)
  // Absolute paths are permitted when the path came from a user-initiated save
  // dialog (the native OS picker is sufficient authorization). Workspace-relative
  // paths go through resolveInside so AI-originated calls stay within the workspace.
  const outputAbs = isAbsolute(outputRel) ? outputRel : resolveInside(root, outputRel)

  const documentStyle = buildDocumentStyle(params)
  const fontId = (typeof params.font === 'string' && params.font ? params.font : DEFAULT_FONT) as keyof typeof FONT_FAMILIES
  fontFamilyById(fontId)
  const rawSize = typeof params.font_size_pt === 'number' && Number.isFinite(params.font_size_pt)
    ? params.font_size_pt
    : DEFAULT_FONT_SIZE_PT
  const fontSizePt = Math.min(MAX_FONT_PT, Math.max(MIN_FONT_PT, rawSize))

  const result: Record<string, unknown> = { path: toSlashPath(outputRel) }
  let bibliography: Reference[] | undefined
  if (typeof params.bibtex_path === 'string' && params.bibtex_path) {
    const styleRaw = typeof params.citation_style === 'string' ? params.citation_style : 'apa'
    const styleXml = resolveCitationStyleXml(root, styleRaw)
    const bibAbs = resolveInside(root, params.bibtex_path)
    if (!existsSync(bibAbs)) throw new Error(`BibTeX file not found: ${params.bibtex_path}`)
    const entries: BibEntry[] = parseBibtex(readFileSync(bibAbs, 'utf-8'))
    const resolved = resolveCitations(markdown, entries, styleRaw, { styleXml })
    markdown = resolved.markdown
    bibliography = buildBibliography(entries, resolved.usedKeys, styleRaw, { styleXml })
    result.unresolved_citations = resolved.unresolvedKeys
    result.citations = resolved.usedKeys.length
  }

  return {
    markdown,
    style: documentStyle,
    fontId,
    fontSizePt,
    title: typeof params.title === 'string' && params.title ? params.title : undefined,
    baseDir,
    workspace: root,
    outputAbs,
    bibliography,
    result,
  }
}

function resolveCitationStyleXml(root: string, style: string): string {
  const builtIn = builtinCitationStyleXml(style)
  if (builtIn) return builtIn
  if (/\.csl$/i.test(style)) {
    const styleAbs = resolveInside(root, style)
    if (!existsSync(styleAbs)) throw new Error(`CSL style file not found: ${style}`)
    return readFileSync(styleAbs, 'utf-8')
  }
  throw new Error(`Unknown citation style: ${style}. Valid: ${BUILTIN_CITATION_STYLES.join(', ')}, or a workspace-relative .csl path`)
}

// ── Image loading (DOCX) ───────────────────────────────────────────────

const SHARP_PASSTHROUGH: Record<string, DocxImage['type']> = {
  jpeg: 'jpg',
  png: 'png',
  gif: 'gif',
}

// Local files resolve against the document directory ('/' means workspace
// root, matching the live preview); remote images fetch with a hard timeout.
// Every failure degrades to null → the mapper renders an [alt] placeholder,
// so one broken image never sinks an export.
function createImageLoader(baseDir: string, workspaceRoot: string): ImageLoader {
  return async (src: string): Promise<DocxImage | null> => {
    try {
      let buffer: Buffer
      if (/^https?:\/\//i.test(src)) {
        const response = await fetch(src, { signal: AbortSignal.timeout(8000) })
        if (!response.ok) return null
        buffer = Buffer.from(await response.arrayBuffer())
      } else if (src.startsWith('data:')) {
        const match = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(src)
        if (!match) return null
        buffer = Buffer.from(match[1], 'base64')
      } else {
        const abs = src.startsWith('/')
          ? resolve(workspaceRoot, src.replace(/^\/+/, ''))
          : resolve(baseDir, src)
        // Keep reads inside the workspace — the export tools are AI-callable
        // and must not become a file disclosure channel.
        const rel = relative(workspaceRoot, abs)
        if (rel.startsWith('..') || isAbsolute(rel)) return null
        buffer = readFileSync(abs)
      }
      const meta = await sharp(buffer).metadata()
      if (!meta.width || !meta.height) return null
      const passthrough = meta.format ? SHARP_PASSTHROUGH[meta.format] : undefined
      if (passthrough) return { data: buffer, type: passthrough, width: meta.width, height: meta.height }
      const png = await sharp(buffer).png().toBuffer()
      return { data: png, type: 'png', width: meta.width, height: meta.height }
    } catch {
      return null
    }
  }
}

// ── Template assets ────────────────────────────────────────────────────

const cssCache = new Map<string, string>()

export function readTemplateCss(name: string): string {
  const cached = cssCache.get(name)
  if (cached !== undefined) return cached
  const css = readFileSync(resolveExportResource(name), 'utf-8')
  cssCache.set(name, css)
  return css
}

// Same multi-root resolution as resolveRegistryPath in ai.ts: dev runs from
// the repo, packaged runs from out/main/chunks inside the asar.
function appRoots(): string[] {
  return Array.from(new Set([
    process.cwd(),
    resolve(import.meta.dirname, '../..'),
    resolve(import.meta.dirname, '../../..'),
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    typeof process.resourcesPath === 'string' ? resolve(process.resourcesPath, '..') : '',
  ].filter(Boolean)))
}

function resolveExportResource(name: string): string {
  const candidates = appRoots().flatMap(root => [
    join(root, 'resources', 'export-templates', name),
    join(root, 'app.asar', 'resources', 'export-templates', name),
  ])
  const found = candidates.find(candidate => existsSync(candidate))
  if (found) return found
  throw new Error(`Export template asset ${name} not found. Checked: ${candidates.slice(0, 6).join(', ')}`)
}

let cachedFontsCss: string | null | undefined

// Bundled font files live in public/fonts (dev) or out/renderer/fonts
// (built). Missing fonts degrade to the CSS fallback stacks, never an error.
function fontsCss(): string | undefined {
  if (cachedFontsCss !== undefined) return cachedFontsCss ?? undefined
  const dirs = appRoots().flatMap(root => [
    join(root, 'public', 'fonts'),
    join(root, 'out', 'renderer', 'fonts'),
    join(root, 'app.asar', 'out', 'renderer', 'fonts'),
  ])
  const found = dirs.find(dir => existsSync(join(dir, 'Lora-VariableFont_wght.ttf')))
  cachedFontsCss = found ? buildFontFaceCss(pathToFileURL(found).href) : null
  return cachedFontsCss ?? undefined
}

// ── Path + write helpers ───────────────────────────────────────────────

function resolveInside(root: string, relativePath: string): string {
  const resolved = resolve(root, relativePath)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path traversal outside workspace is not allowed')
  }
  return resolved
}

// Write through a temp sibling + rename so a failed export never leaves a
// truncated PDF/DOCX where a good file may have been.
function atomicWrite(outputAbs: string, data: Buffer): void {
  mkdirSync(dirname(outputAbs), { recursive: true })
  const temp = `${outputAbs}.tmp-${process.pid}`
  try {
    writeFileSync(temp, data)
    renameSync(temp, outputAbs)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}
