import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { extractDocxForReview, type DocxExtractedImage } from '@main/docx/reader.js'
import { parseAuthors, parseBibtex, type BibEntry } from '@main/export/citations.js'

export type ImportMarkdownFormat = 'docx' | 'xlsx' | 'xlsm' | 'bib' | 'pdf'
export type ImportMarkdownFidelity = 'clean' | 'fallbacks'

export interface ImportMarkdownOptions {
  workspacePath: string
  path: string
  outputPath?: string
  maxRows?: number
  maxCols?: number
  maxPages?: number
}

export interface ImportMarkdownResult {
  sourcePath: string
  outputPath: string
  assetsDir?: string
  format: ImportMarkdownFormat
  fidelity: ImportMarkdownFidelity
  title: string
  warnings: string[]
  stats: Record<string, unknown>
}

interface BuiltMarkdown {
  title: string
  body: string
  warnings: string[]
  stats: Record<string, unknown>
  assets?: Array<{ filename: string; bytes: Buffer }>
}

const SUPPORTED_EXTENSIONS = new Set(['.docx', '.xlsx', '.xlsm', '.bib', '.pdf'])
const REFUSED_EXTENSIONS: Record<string, string> = {
  '.doc': 'Legacy .doc files are binary Word documents. Use Word or LibreOffice to save as .docx first.',
  '.xls': 'Legacy .xls files are binary Excel workbooks. Save as .xlsx first.',
  '.xlsb': '.xlsb is not part of the JS-only import path. Save as .xlsx first.',
  '.ods': '.ods is not part of the target import scope. Save as .xlsx first.',
}
const DEFAULT_MAX_ROWS = 1000
const HARD_MAX_ROWS = 5000
const DEFAULT_MAX_COLS = 60
const HARD_MAX_COLS = 120
const DEFAULT_MAX_PAGES = 150
const HARD_MAX_PAGES = 500
const MAX_CELL_CHARS = 500
const MAX_FORMULA_ROWS = 200

export function supportedImportExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS].map(value => value.slice(1))
}

export async function importDocumentToMarkdown(options: ImportMarkdownOptions): Promise<ImportMarkdownResult> {
  const root = resolve(options.workspacePath)
  const source = resolveWorkspaceFile(root, options.path)
  if (!existsSync(source)) throw new Error(`Import source does not exist: ${options.path}`)
  if (!statSync(source).isFile()) throw new Error(`Import source is not a file: ${options.path}`)

  const ext = extname(source).toLowerCase()
  if (REFUSED_EXTENSIONS[ext]) throw new Error(REFUSED_EXTENSIONS[ext])
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported import format: ${ext || '(none)'}. Supported formats: .docx, .xlsx, .xlsm, .bib, .pdf.`)
  }

  const sourceRel = toSlash(relative(root, source))
  const outputRel = normalizeOutputPath(root, sourceRel, options.outputPath)
  const outputAbs = resolveWorkspaceOutput(root, outputRel)
  const assetsRel = assetDirectoryForOutput(outputRel)
  const assetsAbs = resolveWorkspaceOutput(root, assetsRel)

  const common = {
    sourceRel,
    outputRel,
    assetsRel,
    sourceName: basename(source),
  }
  const limits = {
    maxRows: clampPositiveInteger(options.maxRows, DEFAULT_MAX_ROWS, HARD_MAX_ROWS),
    maxCols: clampPositiveInteger(options.maxCols, DEFAULT_MAX_COLS, HARD_MAX_COLS),
    maxPages: clampPositiveInteger(options.maxPages, DEFAULT_MAX_PAGES, HARD_MAX_PAGES),
  }

  let built: BuiltMarkdown
  if (ext === '.docx') built = await buildDocxMarkdown(source, common)
  else if (ext === '.xlsx' || ext === '.xlsm') built = await buildWorkbookMarkdown(source, common, limits, ext === '.xlsm')
  else if (ext === '.bib') built = buildBibMarkdown(source, common)
  else built = await buildPdfMarkdown(source, common, limits)

  const markdown = withImportHeader({
    title: built.title,
    sourceRel,
    outputRel,
    format: ext.slice(1) as ImportMarkdownFormat,
    fidelity: built.warnings.length > 0 ? 'fallbacks' : 'clean',
    warnings: built.warnings,
    body: built.body,
  })

  mkdirSync(dirname(outputAbs), { recursive: true })
  writeFileSync(outputAbs, markdown, 'utf-8')

  if (built.assets && built.assets.length > 0) {
    mkdirSync(assetsAbs, { recursive: true })
    for (const asset of built.assets) {
      writeFileSync(join(assetsAbs, asset.filename), asset.bytes)
    }
  }

  return {
    sourcePath: sourceRel,
    outputPath: outputRel,
    ...(built.assets && built.assets.length > 0 ? { assetsDir: assetsRel } : {}),
    format: ext.slice(1) as ImportMarkdownFormat,
    fidelity: built.warnings.length > 0 ? 'fallbacks' : 'clean',
    title: built.title,
    warnings: built.warnings,
    stats: {
      ...built.stats,
      bytes: statSync(outputAbs).size,
      assets: built.assets?.length ?? 0,
    },
  }
}

async function buildDocxMarkdown(
  source: string,
  common: { sourceRel: string; outputRel: string; assetsRel: string; sourceName: string },
): Promise<BuiltMarkdown> {
  const warnings: string[] = []
  const buffer = readFileSync(source)
  const features = await inspectDocx(buffer)
  warnings.push(...features.warnings)

  const extracted = await extractDocxForReview(source, { maxChars: 300_000 })
  if (extracted.truncated) warnings.push('DOCX text was truncated at the local import limit.')
  if (extracted.images.length > 0) warnings.push('Images were extracted as Markdown assets.')

  const assets = extracted.images.map(imageToAsset)
  let body = extracted.markdown.trim()
  for (const asset of assets) {
    const id = asset.filename.replace(/\.[^.]+$/, '')
    body = body.replace(new RegExp(`\\]\\(${escapeRegExp(id)}\\)`, 'g'), `](${common.assetsRel}/${asset.filename})`)
  }
  if (!body) body = '_No readable Word content was extracted._'

  return {
    title: titleFromMarkdown(body, common.sourceName),
    body,
    warnings: uniqueWarnings(warnings),
    assets,
    stats: {
      tables: features.tableCount,
      images: extracted.images.length,
      characters: extracted.totalChars,
      truncated: extracted.truncated,
    },
  }
}

function imageToAsset(image: DocxExtractedImage): { filename: string; bytes: Buffer } {
  const ext = imageExtension(image.contentType)
  return {
    filename: `${image.id}${ext}`,
    bytes: Buffer.from(image.base64, 'base64'),
  }
}

async function buildWorkbookMarkdown(
  source: string,
  common: { sourceRel: string; outputRel: string; assetsRel: string; sourceName: string },
  limits: { maxRows: number; maxCols: number },
  isMacroWorkbook: boolean,
): Promise<BuiltMarkdown> {
  const warnings: string[] = []
  if (isMacroWorkbook) warnings.push('Macros are ignored. The importer reads cached workbook values only.')

  const buffer = readFileSync(source)
  const archive = await inspectWorkbookArchive(buffer)
  warnings.push(...archive.warnings)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const sections: string[] = []
  let formulaCount = 0
  let mergedCellCount = 0
  let importedSheets = 0

  for (const worksheet of workbook.worksheets) {
    if (worksheet.state === 'hidden' || worksheet.state === 'veryHidden') {
      warnings.push(`Sheet "${worksheet.name}" is hidden; visible cached values were still imported.`)
    }
    const converted = worksheetToMarkdown(worksheet, limits)
    sections.push(converted.markdown)
    importedSheets++
    formulaCount += converted.formulaCount
    mergedCellCount += converted.mergeCount
    warnings.push(...converted.warnings)
  }

  if (workbook.worksheets.length === 0) warnings.push('Workbook has no sheets.')
  if (formulaCount > 0) warnings.push('Formulas are not recalculated. Cached workbook values were imported.')
  if (mergedCellCount > 0) warnings.push('Merged Excel cells were flattened into table cells.')

  return {
    title: stem(common.sourceName),
    body: sections.join('\n\n').trim() || '_No readable worksheet content was extracted._',
    warnings: uniqueWarnings(warnings),
    stats: {
      sheets: importedSheets,
      formulas: formulaCount,
      mergedCells: mergedCellCount,
      charts: archive.charts,
      images: archive.images,
      pivots: archive.pivots,
    },
  }
}

function worksheetToMarkdown(
  sheet: ExcelJS.Worksheet,
  limits: { maxRows: number; maxCols: number },
): { markdown: string; warnings: string[]; formulaCount: number; mergeCount: number } {
  const warnings: string[] = []
  const mergeCount = mergedCellCount(sheet)
  const range = trimWorksheetRange(sheet)
  if (!range) {
    return {
      markdown: `## ${escapeMarkdownHeading(sheet.name)}\n\n_Empty sheet._`,
      warnings,
      formulaCount: 0,
      mergeCount,
    }
  }

  const hiddenRowCount = countHiddenRows(sheet, range)
  const hiddenColCount = countHiddenColumns(sheet, range)
  if (hiddenRowCount > 0) warnings.push(`Sheet "${sheet.name}" has ${hiddenRowCount} hidden rows; hidden values may appear in the import.`)
  if (hiddenColCount > 0) warnings.push(`Sheet "${sheet.name}" has ${hiddenColCount} hidden columns; hidden values may appear in the import.`)

  const totalRows = range.bottom - range.top + 1
  const totalCols = range.right - range.left + 1
  const rowCount = Math.min(totalRows, limits.maxRows)
  const colCount = Math.min(totalCols, limits.maxCols)
  if (totalRows > rowCount) warnings.push(`Sheet "${sheet.name}" has ${totalRows} used rows; imported the first ${rowCount}.`)
  if (totalCols > colCount) warnings.push(`Sheet "${sheet.name}" has ${totalCols} used columns; imported the first ${colCount}.`)

  const rows: string[][] = []
  const formulas: Array<{ cell: string; formula: string; value: string }> = []
  let truncatedCells = 0

  for (let r = range.top; r < range.top + rowCount; r++) {
    const row: string[] = []
    const excelRow = sheet.getRow(r)
    for (let c = range.left; c < range.left + colCount; c++) {
      const cell = excelRow.getCell(c)
      const raw = formatExcelCell(cell)
      const value = raw.length > MAX_CELL_CHARS ? `${raw.slice(0, MAX_CELL_CHARS)}...` : raw
      if (raw.length > MAX_CELL_CHARS) truncatedCells++
      row.push(value)
      const formula = formulaOf(cell.value)
      if (formula && formulas.length < MAX_FORMULA_ROWS) {
        formulas.push({ cell: cell.address, formula, value: raw })
      }
    }
    rows.push(row)
  }

  if (truncatedCells > 0) warnings.push(`Sheet "${sheet.name}" has ${truncatedCells} long cells truncated for Markdown readability.`)

  const formulaCount = countFormulaCells(sheet, range)
  if (formulaCount > MAX_FORMULA_ROWS) warnings.push(`Sheet "${sheet.name}" has ${formulaCount} formula cells; listed the first ${MAX_FORMULA_ROWS}.`)

  const { headers, dataRows } = splitHeaderRows(rows, range.left)
  const parts: string[] = [
    `## ${escapeMarkdownHeading(sheet.name)}`,
    '',
    `_Used range: ${encodeExcelRange(range)}. Imported ${rowCount} of ${totalRows} rows and ${colCount} of ${totalCols} columns._`,
    '',
    markdownTable(headers, dataRows),
  ]

  if (formulas.length > 0) {
    parts.push(
      '',
      '### Formula cells',
      '',
      markdownTable(['Cell', 'Formula', 'Cached value'], formulas.map(item => [item.cell, item.formula, item.value])),
    )
  }

  return {
    markdown: parts.join('\n'),
    warnings,
    formulaCount,
    mergeCount,
  }
}

function buildBibMarkdown(
  source: string,
  common: { sourceRel: string; outputRel: string; assetsRel: string; sourceName: string },
): BuiltMarkdown {
  const raw = readFileSync(source, 'utf-8')
  const entries = parseBibtex(raw)
  const warnings: string[] = []
  if (entries.length === 0) warnings.push('No BibTeX entries were parsed.')
  const body = [
    `# References from ${escapeMarkdownHeading(common.sourceName)}`,
    '',
    `_Entries: ${entries.length}._`,
    '',
    ...entries.map(bibEntryMarkdown),
  ].join('\n')

  return {
    title: stem(common.sourceName),
    body,
    warnings,
    stats: {
      entries: entries.length,
    },
  }
}

function bibEntryMarkdown(entry: BibEntry): string {
  const f = entry.fields
  const authors = f.author ? parseAuthors(f.author).map(author => [author.given, author.family].filter(Boolean).join(' ')).join('; ') : ''
  const lines = [
    `## ${escapeMarkdownHeading(entry.key)}`,
    '',
    `- Type: ${entry.type}`,
  ]
  if (f.title) lines.push(`- Title: ${f.title}`)
  if (authors) lines.push(`- Authors: ${authors}`)
  if (f.year) lines.push(`- Year: ${f.year}`)
  if (f.journal) lines.push(`- Journal: ${f.journal}`)
  if (f.booktitle) lines.push(`- Booktitle: ${f.booktitle}`)
  if (f.publisher) lines.push(`- Publisher: ${f.publisher}`)
  if (f.doi) lines.push(`- DOI: ${f.doi}`)
  if (f.url) lines.push(`- URL: ${f.url}`)
  if (f.abstract) lines.push('', f.abstract)
  return `${lines.join('\n')}\n`
}

async function buildPdfMarkdown(
  source: string,
  common: { sourceRel: string; outputRel: string; assetsRel: string; sourceName: string },
  limits: { maxPages: number },
): Promise<BuiltMarkdown> {
  const warnings: string[] = [
    'Imported selectable PDF text only. Tables, figures, annotations, and exact reading order may be incomplete.',
  ]
  const buffer = readFileSync(source)
  ensurePdfGeometryGlobals()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as {
    getDocument(input: Record<string, unknown>): { promise: Promise<PdfDocumentProxy> }
  }

  let pdf: PdfDocumentProxy
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise
  } catch (err) {
    const message = (err as Error).message || String(err)
    if (/password|encrypted/i.test(message)) {
      throw new Error('This PDF is encrypted or password-protected. JS-only import cannot read it.')
    }
    throw new Error(`PDF import failed: ${message}`)
  }

  const pageLimit = Math.min(pdf.numPages, limits.maxPages)
  if (pdf.numPages > pageLimit) warnings.push(`PDF has ${pdf.numPages} pages; imported the first ${pageLimit}.`)

  const sections: string[] = []
  let characters = 0
  let twoColumnPages = 0

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent({ includeMarkedContent: false })
    const extracted = pdfTextContentToMarkdown(content)
    if (extracted.twoColumn) twoColumnPages++
    characters += extracted.text.length
    sections.push(`## Page ${pageNumber}\n\n${extracted.text || '_No selectable text found on this page._'}`)
  }

  if (twoColumnPages > 0) warnings.push(`${twoColumnPages} PDF pages looked multi-column; reading order was inferred locally.`)
  if (characters < Math.max(80, pageLimit * 20)) {
    throw new Error('This PDF appears to be scanned or image-only. JS-only import cannot reliably convert it to Markdown. Use OCR or advanced conversion.')
  }

  const metadata = await pdf.getMetadata?.().catch(() => null)
  const info = metadata?.info
  const title = typeof info?.Title === 'string' && info.Title.trim()
    ? info.Title.trim()
    : stem(common.sourceName)

  await pdf.destroy?.()

  return {
    title,
    body: [`# ${escapeMarkdownHeading(title)}`, '', ...sections].join('\n\n'),
    warnings: uniqueWarnings(warnings),
    stats: {
      pages: pdf.numPages,
      importedPages: pageLimit,
      characters,
      inferredTwoColumnPages: twoColumnPages,
    },
  }
}

function ensurePdfGeometryGlobals(): void {
  const globalWithGeometry = globalThis as typeof globalThis & { DOMMatrix?: unknown }
  if (typeof globalWithGeometry.DOMMatrix === 'function') return
  globalWithGeometry.DOMMatrix = class MinimalDOMMatrix {
    a = 1
    b = 0
    c = 0
    d = 1
    e = 0
    f = 0

    constructor(init?: unknown) {
      if (Array.isArray(init)) {
        this.a = Number(init[0] ?? 1)
        this.b = Number(init[1] ?? 0)
        this.c = Number(init[2] ?? 0)
        this.d = Number(init[3] ?? 1)
        this.e = Number(init[4] ?? 0)
        this.f = Number(init[5] ?? 0)
      }
    }

    multiplySelf(): this { return this }
    preMultiplySelf(): this { return this }
    translateSelf(): this { return this }
    scaleSelf(): this { return this }
    rotateSelf(): this { return this }
    invertSelf(): this { return this }
    transformPoint(point: { x?: number; y?: number; z?: number; w?: number } = {}): { x: number; y: number; z: number; w: number } {
      return {
        x: point.x ?? 0,
        y: point.y ?? 0,
        z: point.z ?? 0,
        w: point.w ?? 1,
      }
    }
  }
}

interface PdfDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxy>
  getMetadata?: () => Promise<{ info?: { Title?: unknown } }>
  destroy?: () => Promise<void>
}

interface PdfPageProxy {
  getTextContent(options?: Record<string, unknown>): Promise<PdfTextContent>
}

interface PdfTextContent {
  items: Array<unknown>
}

interface PdfTextItem {
  str: string
  width?: number
  height?: number
  transform?: number[]
}

function pdfTextContentToMarkdown(content: PdfTextContent): { text: string; twoColumn: boolean } {
  const items = content.items
    .map(readPdfTextItem)
    .filter((item): item is Required<Pick<PdfTextItem, 'str' | 'transform'>> & PdfTextItem => Boolean(item && item.str.trim()))

  if (items.length === 0) return { text: '', twoColumn: false }
  const split = detectColumnSplit(items)
  if (!split) return { text: linesToParagraphs(groupPdfLines(items)), twoColumn: false }

  const left = items.filter(item => item.transform[4] < split)
  const right = items.filter(item => item.transform[4] >= split)
  if (left.length < 8 || right.length < 8) return { text: linesToParagraphs(groupPdfLines(items)), twoColumn: false }
  return {
    text: [linesToParagraphs(groupPdfLines(left)), linesToParagraphs(groupPdfLines(right))].filter(Boolean).join('\n\n'),
    twoColumn: true,
  }
}

function readPdfTextItem(value: unknown): PdfTextItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as PdfTextItem
  if (typeof item.str !== 'string') return null
  if (!Array.isArray(item.transform) || item.transform.length < 6) return null
  return item
}

function groupPdfLines(items: Array<Required<Pick<PdfTextItem, 'str' | 'transform'>> & PdfTextItem>): string[] {
  const sorted = [...items].sort((a, b) => {
    const y = b.transform[5] - a.transform[5]
    if (Math.abs(y) > 2.5) return y
    return a.transform[4] - b.transform[4]
  })
  const lines: Array<{ y: number; items: typeof sorted }> = []
  for (const item of sorted) {
    const y = item.transform[5]
    const existing = lines.find(line => Math.abs(line.y - y) <= 2.5)
    if (existing) existing.items.push(item)
    else lines.push({ y, items: [item] })
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map(line => line.items.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str.trim()).filter(Boolean).join(' '))
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function linesToParagraphs(lines: string[]): string {
  const paragraphs: string[] = []
  let current = ''
  for (const line of lines) {
    if (!current) {
      current = line
      continue
    }
    if (current.endsWith('-')) current = `${current.slice(0, -1)}${line}`
    else if (/[.!?:;)]$/.test(current) && /^[A-Z0-9]/.test(line)) {
      paragraphs.push(current)
      current = line
    } else {
      current = `${current} ${line}`
    }
  }
  if (current) paragraphs.push(current)
  return paragraphs.join('\n\n')
}

function detectColumnSplit(items: Array<Required<Pick<PdfTextItem, 'str' | 'transform'>> & PdfTextItem>): number | null {
  const xs = items
    .map(item => item.transform[4])
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b)
  if (xs.length < 40) return null
  const start = Math.floor(xs.length * 0.15)
  const end = Math.floor(xs.length * 0.85)
  let bestGap = 0
  let bestSplit = 0
  for (let i = start + 1; i < end; i++) {
    const gap = xs[i] - xs[i - 1]
    if (gap > bestGap) {
      bestGap = gap
      bestSplit = (xs[i] + xs[i - 1]) / 2
    }
  }
  const left = xs.filter(x => x < bestSplit).length
  const right = xs.length - left
  if (bestGap < 80 || left < xs.length * 0.25 || right < xs.length * 0.25) return null
  return bestSplit
}

async function inspectDocx(buffer: Buffer): Promise<{ warnings: string[]; tableCount: number }> {
  const zip = await JSZip.loadAsync(buffer)
  const files = Object.keys(zip.files)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  const warnings: string[] = []
  const tableCount = documentXml ? matchCount(documentXml, /<w:tbl[\s>]/g) : 0

  if (documentXml && /<w:(gridSpan|vMerge)\b/.test(documentXml)) warnings.push('Word tables with merged cells were imported with layout fallbacks.')
  if (documentXml && /<w:txbxContent\b/.test(documentXml)) warnings.push('Text boxes were detected; they may be missing or flattened.')
  if (documentXml && /<w:(ins|del)\b/.test(documentXml)) warnings.push('Tracked changes were detected; accepted/rejected state depends on the saved document XML.')
  if (files.some(name => name.startsWith('word/charts/'))) warnings.push('Word charts were detected; chart visuals may not be editable Markdown.')
  if (files.some(name => name.startsWith('word/diagrams/'))) warnings.push('SmartArt/diagrams were detected and may be skipped or flattened.')
  if (files.some(name => name.startsWith('word/header') || name.startsWith('word/footer'))) warnings.push('Headers and footers were not imported as body content.')
  if (files.includes('word/footnotes.xml') || files.includes('word/endnotes.xml')) warnings.push('Footnotes or endnotes were detected; placement may be imperfect.')
  return { warnings, tableCount }
}

async function inspectWorkbookArchive(buffer: Buffer): Promise<{ warnings: string[]; charts: number; images: number; pivots: number }> {
  const zip = await JSZip.loadAsync(buffer)
  const files = Object.keys(zip.files)
  const charts = files.filter(name => name.startsWith('xl/charts/') && name.endsWith('.xml')).length
  const images = files.filter(name => name.startsWith('xl/media/')).length
  const pivots = files.filter(name => name.startsWith('xl/pivotTables/') && name.endsWith('.xml')).length
  const warnings: string[] = []
  if (charts > 0) warnings.push(`Workbook contains ${charts} chart files; chart visuals were not rendered into Markdown.`)
  if (images > 0) warnings.push(`Workbook contains ${images} embedded images; image extraction is not part of JS-only workbook import.`)
  if (pivots > 0) warnings.push(`Workbook contains ${pivots} pivot tables; visible cached cells were imported, not pivot logic.`)
  if (files.includes('xl/vbaProject.bin')) warnings.push('Workbook contains VBA macros; macros were ignored.')
  return { warnings, charts, images, pivots }
}

interface ExcelRange {
  top: number
  left: number
  bottom: number
  right: number
}

function trimWorksheetRange(sheet: ExcelJS.Worksheet): ExcelRange | null {
  let top = Infinity
  let left = Infinity
  let bottom = -1
  let right = -1
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const value = formatExcelCell(cell)
      if (!value && !formulaOf(cell.value)) return
      top = Math.min(top, rowNumber)
      left = Math.min(left, colNumber)
      bottom = Math.max(bottom, rowNumber)
      right = Math.max(right, colNumber)
    })
  })
  if (bottom < 0) return null
  return { top, left, bottom, right }
}

function countFormulaCells(sheet: ExcelJS.Worksheet, range: ExcelRange): number {
  let count = 0
  for (let r = range.top; r <= range.bottom; r++) {
    const row = sheet.getRow(r)
    for (let c = range.left; c <= range.right; c++) {
      if (formulaOf(row.getCell(c).value)) count++
    }
  }
  return count
}

function countHiddenRows(sheet: ExcelJS.Worksheet, range: ExcelRange): number {
  let count = 0
  for (let r = range.top; r <= range.bottom; r++) {
    if (sheet.getRow(r).hidden) count++
  }
  return count
}

function countHiddenColumns(sheet: ExcelJS.Worksheet, range: ExcelRange): number {
  let count = 0
  for (let c = range.left; c <= range.right; c++) {
    if (sheet.getColumn(c).hidden) count++
  }
  return count
}

function mergedCellCount(sheet: ExcelJS.Worksheet): number {
  const model = sheet.model as { merges?: unknown }
  if (Array.isArray(model.merges)) return model.merges.length
  const internal = sheet as unknown as { _merges?: Record<string, unknown> }
  return internal._merges ? Object.keys(internal._merges).length : 0
}

function formatExcelCell(cell: ExcelJS.Cell): string {
  return normalizeCellText(formatExcelValue(cell.value))
}

function formatExcelValue(value: ExcelJS.CellValue | undefined): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isFormulaValue(value)) return formatExcelValue(value.result as ExcelJS.CellValue | undefined)
  if (isRichTextValue(value)) return value.richText.map(run => run.text).join('')
  if (isHyperlinkValue(value)) return value.text ? `${value.text} (${value.hyperlink})` : value.hyperlink
  if (isTextValue(value)) return value.text
  if (isErrorValue(value)) return value.error
  return String(value)
}

function formulaOf(value: ExcelJS.CellValue | undefined): string | null {
  if (!value || typeof value !== 'object') return null
  if ('formula' in value && typeof value.formula === 'string') return value.formula
  if ('sharedFormula' in value && typeof value.sharedFormula === 'string') return value.sharedFormula
  return null
}

function isFormulaValue(value: unknown): value is { formula?: string; sharedFormula?: string; result?: unknown } {
  return Boolean(value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value))
}

function isRichTextValue(value: unknown): value is { richText: Array<{ text: string }> } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { richText?: unknown }).richText))
}

function isHyperlinkValue(value: unknown): value is { text?: string; hyperlink: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { hyperlink?: unknown }).hyperlink === 'string')
}

function isTextValue(value: unknown): value is { text: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string')
}

function isErrorValue(value: unknown): value is { error: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string')
}

function normalizeCellText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function splitHeaderRows(rows: string[][], startCol: number): { headers: string[]; dataRows: string[][] } {
  if (rows.length === 0) return { headers: [], dataRows: [] }
  const first = rows[0]
  const nonEmpty = first.map(value => value.trim()).filter(Boolean)
  const unique = new Set(nonEmpty.map(value => value.toLowerCase()))
  const mostlyText = nonEmpty.filter(value => /[A-Za-z]/.test(value)).length >= Math.max(1, Math.ceil(nonEmpty.length * 0.6))
  const useFirstRow = nonEmpty.length >= Math.min(2, first.length) && unique.size === nonEmpty.length && mostlyText
  if (useFirstRow) {
    return {
      headers: first.map((value, index) => value.trim() || encodeExcelColumn(startCol + index)),
      dataRows: rows.slice(1),
    }
  }
  return {
    headers: first.map((_, index) => encodeExcelColumn(startCol + index)),
    dataRows: rows,
  }
}

function encodeExcelRange(range: ExcelRange): string {
  return `${encodeExcelColumn(range.left)}${range.top}:${encodeExcelColumn(range.right)}${range.bottom}`
}

function encodeExcelColumn(column: number): string {
  let current = column
  let label = ''
  while (current > 0) {
    const remainder = (current - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    current = Math.floor((current - 1) / 26)
  }
  return label || 'A'
}

function markdownTable(headers: string[], rows: string[][]): string {
  const safeHeaders = headers.length > 0 ? headers : ['Value']
  const divider = safeHeaders.map(() => '---')
  const out = [
    `| ${safeHeaders.map(markdownCell).join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
  ]
  for (const row of rows) {
    out.push(`| ${safeHeaders.map((_, index) => markdownCell(row[index] ?? '')).join(' | ')} |`)
  }
  return out.join('\n')
}

function markdownCell(value: string): string {
  return value
    .replace(/\n+/g, '<br>')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim()
}

function withImportHeader(input: {
  title: string
  sourceRel: string
  outputRel: string
  format: ImportMarkdownFormat
  fidelity: ImportMarkdownFidelity
  warnings: string[]
  body: string
}): string {
  const lines = [
    '---',
    `source: ${yamlString(input.sourceRel)}`,
    `source_format: ${input.format}`,
    `imported_at: ${new Date().toISOString()}`,
    `fidelity: ${input.fidelity}`,
    '---',
    '',
    input.body.trim(),
  ]
  if (input.warnings.length > 0) {
    lines.push(
      '',
      '## Import warnings',
      '',
      ...input.warnings.map(warning => `- ${warning}`),
    )
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`
}

function normalizeOutputPath(root: string, sourceRel: string, outputPath?: string): string {
  if (typeof outputPath === 'string' && outputPath.trim().length > 0) {
    const rel = toSlash(relative(root, resolveWorkspaceOutput(root, outputPath.trim())))
    if (extname(rel).toLowerCase() !== '.md') throw new Error('Import output path must end with .md')
    return rel
  }
  const candidate = join('imports', `${stem(basename(sourceRel))}.md`)
  return nextAvailableRelativePath(root, candidate)
}

function nextAvailableRelativePath(root: string, relPath: string): string {
  let candidate = relPath
  const dir = dirname(relPath)
  const ext = extname(relPath)
  const base = basename(relPath, ext)
  let index = 2
  while (existsSync(resolveWorkspaceOutput(root, candidate))) {
    candidate = join(dir, `${base} ${index}${ext}`)
    index++
  }
  return toSlash(candidate)
}

function assetDirectoryForOutput(outputRel: string): string {
  const dir = dirname(outputRel)
  const base = basename(outputRel, extname(outputRel))
  return toSlash(join(dir, `${base}_assets`))
}

function resolveWorkspaceFile(root: string, relativePath: string): string {
  const resolved = resolve(root, relativePath)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path traversal outside workspace is not allowed')
  return resolved
}

function resolveWorkspaceOutput(root: string, relativePath: string): string {
  const resolved = resolve(root, relativePath)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path traversal outside workspace is not allowed')
  return resolved
}

function clampPositiveInteger(value: unknown, fallback: number, hardMax: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), hardMax)
}

function imageExtension(contentType: string): string {
  if (contentType === 'image/jpeg') return '.jpg'
  if (contentType === 'image/gif') return '.gif'
  if (contentType === 'image/webp') return '.webp'
  return '.png'
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = /^#\s+(.+)$/m.exec(markdown)
  return heading ? heading[1].trim() : stem(fallback)
}

function stem(name: string): string {
  const ext = extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

function toSlash(value: string): string {
  return value.split('\\').join('/')
}

function escapeMarkdownHeading(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/#/g, '\\#').trim()
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))]
}

function matchCount(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
