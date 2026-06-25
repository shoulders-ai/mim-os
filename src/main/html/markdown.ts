export interface HtmlToMarkdownOptions {
  extractLinks?: boolean
  extractImages?: boolean
  maxNewlines?: number
}

export interface HtmlToMarkdownStats {
  method: 'html_to_markdown'
  originalHtmlChars: number
  normalizedHtmlChars: number
  initialMarkdownChars: number
  filteredCharsRemoved: number
  finalMarkdownChars: number
}

export interface HtmlToMarkdownResult {
  markdown: string
  stats: HtmlToMarkdownStats
}

export interface PreprocessMarkdownResult {
  content: string
  charsFiltered: number
}

export interface MarkdownChunk {
  content: string
  chunkIndex: number
  totalChunks: number
  charOffsetStart: number
  charOffsetEnd: number
  overlapPrefix: string
  hasMore: boolean
}

export interface ChunkMarkdownOptions {
  maxChunkChars?: number
  overlapLines?: number
  startFromChar?: number
}

interface DomNode {
  tagName?: string
  nodeType?: number
  nodeValue?: string | null
  textContent: string
  innerHTML?: string
  children: ArrayLike<DomNode>
  childNodes: ArrayLike<DomNode>
  parentNode: { removeChild(node: DomNode): void; replaceChild(insert: DomNode, remove: DomNode): void } | null
  ownerDocument: DomDocument
  querySelectorAll(selector: string): ArrayLike<DomNode>
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  appendChild(node: DomNode): DomNode
  closest(selector: string): DomNode | null
}

interface DomDocument {
  body: DomNode
  documentElement: DomNode
  createElement(tag: string): DomNode
  createTextNode(text: string): DomNode
  querySelectorAll(selector: string): ArrayLike<DomNode>
}

interface TurndownInstance {
  turndown(html: string): string
  use(plugin: unknown): void
}

const INLINE_IMAGE_CONTEXTS = new Set(['td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const TABLE_CELL_TAGS = new Set(['td', 'th'])
const HIDDEN_STYLE_RE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i
const TABLE_TOKEN_PREFIX = '@@MIMHTMLTABLE'
const TABLE_TOKEN_RE = /@@MIMHTMLTABLE(\d+)@@/g

export async function htmlToMarkdown(
  html: string,
  options: HtmlToMarkdownOptions = {},
): Promise<HtmlToMarkdownResult> {
  const doc = await parseHtml(html)
  normalizeHtmlDocument(doc, options)
  const tableMarkdown = replaceTablesWithTokens(doc)
  const normalizedHtml = doc.body?.innerHTML ?? doc.documentElement?.innerHTML ?? html
  const turndown = await createTurndown()
  let markdown = turndown.turndown(normalizedHtml)
  markdown = markdown.replace(TABLE_TOKEN_RE, (_match, rawIndex) => {
    const index = Number(rawIndex)
    return `\n${tableMarkdown[index] ?? ''}\n`
  })
  const initialMarkdownChars = markdown.length
  const preprocessed = preprocessMarkdownContent(markdown, options.maxNewlines)

  return {
    markdown: preprocessed.content,
    stats: {
      method: 'html_to_markdown',
      originalHtmlChars: html.length,
      normalizedHtmlChars: normalizedHtml.length,
      initialMarkdownChars,
      filteredCharsRemoved: preprocessed.charsFiltered,
      finalMarkdownChars: preprocessed.content.length,
    },
  }
}

export function preprocessMarkdownContent(content: string, maxNewlines = 3): PreprocessMarkdownResult {
  const originalLength = content.length

  let filtered = content.replace(/%[0-9A-Fa-f]{2}/g, '')
  filtered = filtered.replace(/`\{["\w][\s\S]*?\}`/g, '')
  filtered = filtered.replace(/\{"\$type":[^}]{100,}\}/g, '')
  filtered = filtered.replace(/\{"[^"]{5,}":\{[^}]{100,}\}/g, '')
  filtered = filtered.replace(/\n{4,}/g, '\n'.repeat(Math.max(1, maxNewlines)))

  const lines = filtered.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    const stripped = line.trim()
    if (!stripped) continue
    if ((stripped.startsWith('{') || stripped.startsWith('[')) && stripped.length > 100) continue
    kept.push(line)
  }

  filtered = kept.join('\n').trim()
  return {
    content: filtered,
    charsFiltered: originalLength - filtered.length,
  }
}

async function parseHtml(html: string): Promise<DomDocument> {
  const mod = await import('@mixmark-io/domino') as unknown as {
    createDocument?: (html: string) => DomDocument
    default?: { createDocument?: (html: string) => DomDocument }
  }
  const createDocument = mod.createDocument ?? mod.default?.createDocument
  if (!createDocument) throw new Error('domino is not available')
  return createDocument(html)
}

async function createTurndown(): Promise<TurndownInstance> {
  const mod = await import('turndown') as unknown as {
    default?: new (opts?: Record<string, unknown>) => TurndownInstance
  }
  const Ctor = mod.default
  if (!Ctor) throw new Error('turndown is not available')
  const turndown = new Ctor({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  const gfm = await loadTurndownGfm()
  if (gfm) turndown.use(gfm)
  return turndown
}

async function loadTurndownGfm(): Promise<unknown | null> {
  try {
    const mod = await import('turndown-plugin-gfm') as unknown as {
      gfm?: unknown
      default?: { gfm?: unknown } | unknown
    }
    if (typeof mod.gfm === 'function') return mod.gfm
    if (mod.default && typeof mod.default === 'object' && typeof (mod.default as { gfm?: unknown }).gfm === 'function') {
      return (mod.default as { gfm: unknown }).gfm
    }
    if (typeof mod.default === 'function') return mod.default
    return null
  } catch {
    return null
  }
}

function normalizeHtmlDocument(doc: DomDocument, options: HtmlToMarkdownOptions): void {
  removeNodes(doc, 'script, style, noscript, meta, link, title')
  removeHiddenAndStateNodes(doc)
  removeDataAttributes(doc)
  removeDataImages(doc)
  normalizeLinks(doc, Boolean(options.extractLinks))
  normalizeInlineImages(doc, Boolean(options.extractImages))
  normalizeTableCellInlineMarkdown(doc, options)
}

function removeNodes(doc: DomDocument, selector: string): void {
  for (const node of all(doc, selector)) removeNode(node)
}

function removeHiddenAndStateNodes(doc: DomDocument): void {
  for (const node of all(doc, '[hidden], [aria-hidden="true"]')) removeNode(node)
  for (const node of all(doc, '[style]')) {
    const style = node.getAttribute('style') ?? ''
    if (HIDDEN_STYLE_RE.test(style)) removeNode(node)
  }
  for (const node of all(doc, 'code')) {
    const style = node.getAttribute('style') ?? ''
    const id = node.getAttribute('id') ?? ''
    if (HIDDEN_STYLE_RE.test(style) || /bpr-guid|data|state/i.test(id)) removeNode(node)
  }
}

function removeDataAttributes(doc: DomDocument): void {
  for (const node of all(doc, '*')) {
    const rawAttributes = (node as unknown as { attributes?: ArrayLike<{ name: string }> }).attributes
    if (!rawAttributes) continue
    const names = Array.from(rawAttributes).map(attr => attr.name).filter(name => name.startsWith('data-'))
    for (const name of names) node.removeAttribute(name)
  }
}

function removeDataImages(doc: DomDocument): void {
  for (const image of all(doc, 'img')) {
    const src = image.getAttribute('src') ?? ''
    if (src.startsWith('data:image/')) removeNode(image)
  }
}

function normalizeLinks(doc: DomDocument, extractLinks: boolean): void {
  if (extractLinks) return
  for (const link of all(doc, 'a')) {
    link.removeAttribute('href')
    link.removeAttribute('title')
  }
}

function normalizeInlineImages(doc: DomDocument, extractImages: boolean): void {
  for (const image of all(doc, 'img')) {
    const context = inlineImageContext(image)
    if (!context) continue
    if (extractImages && !TABLE_CELL_TAGS.has(context)) continue
    replaceWithText(image, imageMarkdownOrAlt(image, extractImages))
  }
}

function normalizeTableCellInlineMarkdown(doc: DomDocument, options: HtmlToMarkdownOptions): void {
  for (const cell of all(doc, 'td, th')) {
    if (options.extractLinks) {
      for (const link of Array.from(cell.querySelectorAll('a'))) {
        replaceWithText(link, linkMarkdownOrText(link))
      }
    }
  }
}

function inlineImageContext(image: DomNode): string | null {
  let current = image.parentNode as DomNode | null
  while (current) {
    const tag = tagName(current)
    if (INLINE_IMAGE_CONTEXTS.has(tag)) return tag
    current = current.parentNode as DomNode | null
  }
  return null
}

function imageMarkdownOrAlt(image: DomNode, extractImages: boolean): string {
  const alt = image.getAttribute('alt') ?? ''
  if (!extractImages) return alt
  const src = image.getAttribute('src') ?? ''
  if (!src) return alt
  const title = image.getAttribute('title') ?? ''
  return `![${escapeMarkdownLinkText(alt)}](${src}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
}

function linkMarkdownOrText(link: DomNode): string {
  const text = link.textContent.trim()
  const href = link.getAttribute('href') ?? ''
  if (!href) return text
  const title = link.getAttribute('title') ?? ''
  return `[${escapeMarkdownLinkText(text)}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`
}

function replaceTablesWithTokens(doc: DomDocument): string[] {
  const tables = all(doc, 'table').filter(table => table.closest('table') === table)
  const markdown: string[] = []
  tables.forEach((table, index) => {
    markdown[index] = tableToMarkdown(table)
    const placeholder = doc.createElement('p')
    placeholder.textContent = `${TABLE_TOKEN_PREFIX}${index}@@`
    table.parentNode?.replaceChild(placeholder, table)
  })
  return markdown
}

function tableToMarkdown(table: DomNode): string {
  for (const br of allFrom(table, 'br')) replaceWithText(br, ' ')

  const rows = allFrom(table, 'tr').filter(row => row.closest('table') === table)
  if (!rows.length) return ''

  const grid: string[][] = []
  const headerFlags: boolean[] = []
  const carries: Array<{ text: string; remaining: number } | undefined> = []
  let columnCount = 0

  rows.forEach((row, rowIndex) => {
    grid[rowIndex] = grid[rowIndex] ?? []
    const cells = Array.from(row.children).filter(child => TABLE_CELL_TAGS.has(tagName(child)))
    headerFlags[rowIndex] = cells.length > 0 && cells.every(cell => tagName(cell) === 'th')
    let column = 0

    const drainCarries = () => {
      while (carries[column] && carries[column]!.remaining > 0) {
        grid[rowIndex][column] = carries[column]!.text
        carries[column]!.remaining--
        column++
      }
    }

    for (const cell of cells) {
      drainCarries()
      const colspan = positiveSpan(cell.getAttribute('colspan'))
      const rowspan = positiveSpan(cell.getAttribute('rowspan'))
      const text = tableCellText(cell)
      for (let k = 0; k < colspan; k++) {
        grid[rowIndex][column] = text
        if (rowspan > 1) carries[column] = { text, remaining: rowspan - 1 }
        column++
      }
    }
    drainCarries()
    columnCount = Math.max(columnCount, column)
  })

  if (!columnCount) return ''
  for (const row of grid) {
    for (let column = 0; column < columnCount; column++) {
      row[column] = row[column] ?? ''
    }
  }

  let headerCount = 0
  while (headerCount < headerFlags.length && headerFlags[headerCount]) headerCount++
  if (headerCount === 0) headerCount = 1

  const header: string[] = []
  for (let column = 0; column < columnCount; column++) {
    const stacked: string[] = []
    for (let row = 0; row < headerCount; row++) {
      const value = grid[row][column]
      if (value && value !== stacked[stacked.length - 1]) stacked.push(value)
    }
    header[column] = stacked.join(' ') || ' '
  }

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${Array(columnCount).fill('---').join(' | ')} |`,
  ]
  for (let row = headerCount; row < grid.length; row++) {
    lines.push(`| ${grid[row].slice(0, columnCount).join(' | ')} |`)
  }
  return lines.join('\n')
}

function tableCellText(cell: DomNode): string {
  const blocks = allFrom(cell, 'p, li')
  const parts = blocks.length ? blocks.map(block => block.textContent) : [cell.textContent]
  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
}

function positiveSpan(value: string | null): number {
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function replaceWithText(node: DomNode, text: string): void {
  node.parentNode?.replaceChild(node.ownerDocument.createTextNode(text), node)
}

function removeNode(node: DomNode): void {
  node.parentNode?.removeChild(node)
}

function tagName(node: DomNode): string {
  return (node.tagName ?? '').toLowerCase()
}

function all(doc: DomDocument, selector: string): DomNode[] {
  return Array.from(doc.querySelectorAll(selector))
}

function allFrom(node: DomNode, selector: string): DomNode[] {
  return Array.from(node.querySelectorAll(selector))
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

enum BlockType {
  Header = 'header',
  CodeFence = 'code_fence',
  Table = 'table',
  ListItem = 'list_item',
  Paragraph = 'paragraph',
  Blank = 'blank',
}

interface AtomicBlock {
  blockType: BlockType
  lines: string[]
  charStart: number
  charEnd: number
}

const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)]) /
const LIST_CONTINUATION_RE = /^(\s{2,}|\t)/

export function chunkMarkdownByStructure(
  content: string,
  options: ChunkMarkdownOptions = {},
): MarkdownChunk[] {
  const maxChunkChars = options.maxChunkChars ?? 100_000
  const overlapLines = options.overlapLines ?? 5
  const startFromChar = options.startFromChar ?? 0

  if (!content) {
    return [{
      content: '',
      chunkIndex: 0,
      totalChunks: 1,
      charOffsetStart: 0,
      charOffsetEnd: 0,
      overlapPrefix: '',
      hasMore: false,
    }]
  }
  if (startFromChar >= content.length) return []

  const blocks = parseAtomicBlocks(content)
  if (!blocks.length) return []

  const rawChunks: AtomicBlock[][] = []
  let currentChunk: AtomicBlock[] = []
  let currentSize = 0

  for (const block of blocks) {
    const blockSize = block.charEnd - block.charStart
    if (currentSize + blockSize > maxChunkChars && currentChunk.length > 0) {
      let bestSplit = currentChunk.length
      for (let index = currentChunk.length - 1; index > 0; index--) {
        if (currentChunk[index].blockType === BlockType.Header) {
          const prefixSize = currentChunk.slice(0, index).reduce((sum, item) => sum + item.charEnd - item.charStart, 0)
          if (prefixSize >= maxChunkChars * 0.5) {
            bestSplit = index
            break
          }
        }
      }
      rawChunks.push(currentChunk.slice(0, bestSplit))
      currentChunk = currentChunk.slice(bestSplit)
      currentSize = currentChunk.reduce((sum, item) => sum + item.charEnd - item.charStart, 0)
    }
    currentChunk.push(block)
    currentSize += blockSize
  }
  if (currentChunk.length > 0) rawChunks.push(currentChunk)

  const totalChunks = rawChunks.length
  const chunks: MarkdownChunk[] = []
  let previousTableHeader: string | null = null

  rawChunks.forEach((chunkBlocks, index) => {
    const chunkText = chunkBlocks.map(blockText).join('\n')
    let overlapPrefix = ''
    if (index > 0) {
      const previousBlocks = rawChunks[index - 1]
      const previousText = previousBlocks.map(blockText).join('\n')
      const previousLines = previousText.split('\n')
      const firstBlock = chunkBlocks[0]
      if (firstBlock.blockType === BlockType.Table && previousTableHeader) {
        const trailing = overlapLines > 0 ? previousLines.slice(-overlapLines) : []
        const combined = previousTableHeader.split('\n')
        for (const line of trailing) {
          if (!combined.includes(line)) combined.push(line)
        }
        overlapPrefix = combined.join('\n')
      } else if (overlapLines > 0) {
        overlapPrefix = previousLines.slice(-overlapLines).join('\n')
      }
    }

    for (const block of chunkBlocks) {
      if (block.blockType === BlockType.Table) {
        const header = tableHeaderFromBlock(block)
        if (header) previousTableHeader = header
      }
    }

    chunks.push({
      content: chunkText,
      chunkIndex: index,
      totalChunks,
      charOffsetStart: chunkBlocks[0].charStart,
      charOffsetEnd: chunkBlocks[chunkBlocks.length - 1].charEnd,
      overlapPrefix,
      hasMore: index < totalChunks - 1,
    })
  })

  if (startFromChar > 0) {
    const startIndex = chunks.findIndex(chunk => chunk.charOffsetEnd > startFromChar)
    return startIndex >= 0 ? chunks.slice(startIndex) : []
  }

  return chunks
}

function parseAtomicBlocks(content: string): AtomicBlock[] {
  const lines = content.split('\n')
  const blocks: AtomicBlock[] = []
  let index = 0
  let offset = 0

  while (index < lines.length) {
    const line = lines[index]
    const lineLength = lenWithNewline(line)

    if (!line.trim()) {
      blocks.push({ blockType: BlockType.Blank, lines: [line], charStart: offset, charEnd: offset + lineLength })
      offset += lineLength
      index++
      continue
    }

    if (line.trim().startsWith('```')) {
      const fenceLines = [line]
      let fenceEnd = offset + lineLength
      index++
      while (index < lines.length) {
        const fenceLine = lines[index]
        const fenceLineLength = lenWithNewline(fenceLine)
        fenceLines.push(fenceLine)
        fenceEnd += fenceLineLength
        index++
        if (fenceLine.trim().startsWith('```') && fenceLines.length > 1) break
      }
      blocks.push({ blockType: BlockType.CodeFence, lines: fenceLines, charStart: offset, charEnd: fenceEnd })
      offset = fenceEnd
      continue
    }

    if (line.trimStart().startsWith('#')) {
      blocks.push({ blockType: BlockType.Header, lines: [line], charStart: offset, charEnd: offset + lineLength })
      offset += lineLength
      index++
      continue
    }

    if (TABLE_ROW_RE.test(line)) {
      const headerLines = [line]
      let headerEnd = offset + lineLength
      index++
      if (index < lines.length && TABLE_ROW_RE.test(lines[index]) && lines[index].includes('---')) {
        const separator = lines[index]
        headerLines.push(separator)
        headerEnd += lenWithNewline(separator)
        index++
      }
      blocks.push({ blockType: BlockType.Table, lines: headerLines, charStart: offset, charEnd: headerEnd })
      offset = headerEnd

      while (index < lines.length && TABLE_ROW_RE.test(lines[index])) {
        const row = lines[index]
        const rowLength = lenWithNewline(row)
        blocks.push({ blockType: BlockType.Table, lines: [row], charStart: offset, charEnd: offset + rowLength })
        offset += rowLength
        index++
      }
      continue
    }

    if (LIST_ITEM_RE.test(line)) {
      const listLines = [line]
      let listEnd = offset + lineLength
      index++
      while (index < lines.length) {
        const nextLine = lines[index]
        const nextLength = lenWithNewline(nextLine)
        if (LIST_ITEM_RE.test(nextLine)) {
          listLines.push(nextLine)
          listEnd += nextLength
          index++
          continue
        }
        if (nextLine.trim() && LIST_CONTINUATION_RE.test(nextLine)) {
          listLines.push(nextLine)
          listEnd += nextLength
          index++
          continue
        }
        break
      }
      blocks.push({ blockType: BlockType.ListItem, lines: listLines, charStart: offset, charEnd: listEnd })
      offset = listEnd
      continue
    }

    const paragraphLines = [line]
    let paragraphEnd = offset + lineLength
    index++
    while (index < lines.length && lines[index].trim()) {
      const nextLine = lines[index]
      if (
        nextLine.trimStart().startsWith('#') ||
        nextLine.trim().startsWith('```') ||
        TABLE_ROW_RE.test(nextLine) ||
        LIST_ITEM_RE.test(nextLine)
      ) {
        break
      }
      paragraphLines.push(nextLine)
      paragraphEnd += lenWithNewline(nextLine)
      index++
    }
    blocks.push({ blockType: BlockType.Paragraph, lines: paragraphLines, charStart: offset, charEnd: paragraphEnd })
    offset = paragraphEnd
  }

  if (blocks.length > 0 && content && !content.endsWith('\n')) {
    blocks[blocks.length - 1] = {
      ...blocks[blocks.length - 1],
      charEnd: content.length,
    }
  }

  return blocks
}

function lenWithNewline(line: string): number {
  return line.length + 1
}

function blockText(block: AtomicBlock): string {
  return block.lines.join('\n')
}

function tableHeaderFromBlock(block: AtomicBlock): string | null {
  if (block.blockType !== BlockType.Table || block.lines.length < 2) return null
  return block.lines[1].includes('---') || block.lines[1].includes('- -')
    ? `${block.lines[0]}\n${block.lines[1]}`
    : null
}
