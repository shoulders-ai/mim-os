import { readFileSync } from 'fs'

export interface DocxReadOptions {
  maxChars?: number
}

export interface DocxReadResult {
  text: string
  html: string
  totalChars: number
  truncated: boolean
  comments: Record<string, { author: string; text: string }>
}

export interface DocxExtractedImage {
  id: string
  base64: string
  contentType: string
}

export interface DocxExtractResult {
  html: string
  markdown: string
  text: string
  images: DocxExtractedImage[]
  totalChars: number
  truncated: boolean
}

const DEFAULT_MAX_CHARS = 180_000
const HARD_MAX_CHARS = 300_000
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const DOWNSCALED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const IMAGE_MAX_EDGE = 1568

function strip(html: string): string {
  // Do not decode entities here: htmlToReadable strips remaining tags after
  // all handlers run, so decoding early would let text like &lt;x&gt; be
  // mistaken for a tag and removed. decodeHtml runs once at the end instead.
  return html.replace(/<[^>]+>/g, '').trim()
}

export function htmlToReadable(html: string, commentMap: Record<string, { author: string; text: string }> = {}): string {
  let text = html

  for (const [id, comment] of Object.entries(commentMap)) {
    const pattern = new RegExp(
      `<sup><a href="#comment-${escapeRegExp(id)}" id="comment-ref-${escapeRegExp(id)}">\\[\\d+\\]</a></sup>`,
      'g',
    )
    text = text.replace(pattern, ` [[Comment #${id} by ${comment.author}: "${comment.text}"]] `)
  }

  text = text.replace(/<dl>[\s\S]*?<\/dl>\s*$/gi, '')
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, (_, value) => `\n# ${strip(value)}\n`)
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, value) => `\n## ${strip(value)}\n`)
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, (_, value) => `\n### ${strip(value)}\n`)
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, (_, value) => `\n#### ${strip(value)}\n`)
  text = text.replace(/<h5[^>]*>(.*?)<\/h5>/gi, (_, value) => `\n##### ${strip(value)}\n`)
  text = text.replace(/<h6[^>]*>(.*?)<\/h6>/gi, (_, value) => `\n###### ${strip(value)}\n`)
  text = text.replace(/<table[^>]*>/gi, '\n')
  text = text.replace(/<\/table>/gi, '\n')
  text = text.replace(/<tr[^>]*>/gi, '| ')
  text = text.replace(/<\/tr>/gi, '\n')
  text = text.replace(/<t[dh][^>]*>/gi, '')
  text = text.replace(/<\/t[dh]>/gi, ' | ')
  text = text.replace(/<ul[^>]*>/gi, '\n')
  text = text.replace(/<\/ul>/gi, '\n')
  text = text.replace(/<ol[^>]*>/gi, '\n')
  text = text.replace(/<\/ol>/gi, '\n')
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, (_, value) => `- ${strip(value)}\n`)
  text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, (_, value) => `${strip(value)}\n\n`)
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, alt) => `[Image: ${decodeHtml(alt)}]`)
  text = text.replace(/<img[^>]*>/gi, '[Image]')
  text = text.replace(/<figure[^>]*>/gi, '\n')
  text = text.replace(/<\/figure>/gi, '\n')
  text = text.replace(/<figcaption[^>]*>(.*?)<\/figcaption>/gi, (_, value) => `Caption: ${strip(value)}\n`)
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
  text = text.replace(/<[^>]+>/g, '')
  text = decodeHtml(text)
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

export function extractCommentsFromHtml(html: string): Record<string, { author: string; text: string }> {
  const commentMap: Record<string, { author: string; text: string }> = {}
  const dlMatch = html.match(/<dl>([\s\S]*?)<\/dl>\s*$/i)
  if (!dlMatch) return commentMap

  const entryPattern = /<dt><a id="comment-(\d+)">[^<]*<\/a><\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi
  let match: RegExpExecArray | null
  while ((match = entryPattern.exec(dlMatch[1])) !== null) {
    const id = match[1]
    commentMap[id] = { author: 'Reviewer', text: decodeHtml(strip(match[2])) }
  }
  return commentMap
}

export async function readDocxAsText(filePath: string, options: DocxReadOptions = {}): Promise<DocxReadResult> {
  const buffer = readFileSync(filePath)
  const mammoth = await import('mammoth') as unknown as {
    default?: { convertToHtml?: Function }
    convertToHtml?: Function
  }
  const convertToHtml = mammoth.default?.convertToHtml ?? mammoth.convertToHtml
  if (typeof convertToHtml !== 'function') throw new Error('mammoth.convertToHtml is not available')

  const result = await convertToHtml(
    { buffer },
    { styleMap: ['comment-reference => sup'] },
  ) as { value: string }

  const comments = extractCommentsFromHtml(result.value)
  const readable = htmlToReadable(result.value, comments)
  const maxChars = clampMaxChars(options.maxChars)
  const truncated = readable.length > maxChars

  return {
    text: truncated ? readable.slice(0, maxChars) : readable,
    html: result.value,
    totalChars: readable.length,
    truncated,
    comments,
  }
}

export async function extractDocxForReview(filePath: string, options: DocxReadOptions = {}): Promise<DocxExtractResult> {
  const buffer = readFileSync(filePath)
  const mammoth = await import('mammoth') as unknown as {
    default?: { convertToHtml?: Function; images?: { imgElement: Function } }
    convertToHtml?: Function
    images?: { imgElement: Function }
  }
  const TurndownService = (await import('turndown') as unknown as {
    default?: new (options?: Record<string, unknown>) => {
      turndown(html: string): string
      use(plugin: unknown): void
    }
  }).default
  if (!TurndownService) throw new Error('turndown is not available')
  const convertToHtml = mammoth.default?.convertToHtml ?? mammoth.convertToHtml
  const imagesApi = mammoth.default?.images ?? mammoth.images
  if (typeof convertToHtml !== 'function') throw new Error('mammoth.convertToHtml is not available')

  let imageCounter = 0
  const images: DocxExtractedImage[] = []
  const convertImage = imagesApi?.imgElement?.((image: { contentType?: string; read(format: string): Promise<string> }) =>
    image.read('base64').then(async (data) => {
      let contentType = image.contentType || 'image/png'
      let imageBuffer = Buffer.from(data, 'base64')
      if (!SUPPORTED_IMAGE_TYPES.has(contentType)) {
        const converted = await convertImageToPng(imageBuffer)
        if (!converted) return { src: '', alt: '' }
        imageBuffer = converted
        contentType = 'image/png'
      }
      const downscaled = await downscaleImage(imageBuffer, contentType)
      imageBuffer = downscaled.buffer
      contentType = downscaled.contentType
      const base64 = imageBuffer.toString('base64')
      const id = `image-${++imageCounter}`
      images.push({ id, base64, contentType })
      return { src: id, alt: id }
    }),
  )

  const result = await convertToHtml({ buffer }, convertImage ? { convertImage } : {}) as { value: string }
  let html = result.value
  for (const image of images) {
    html = html.replace(
      new RegExp(`src="${escapeRegExp(image.id)}"`, 'g'),
      `src="data:${image.contentType};base64,${image.base64}"`,
    )
  }

  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  const gfm = await loadTurndownGfm()
  if (gfm) turndown.use(gfm)
  const markdown = await htmlToMarkdownWithTables(result.value, turndown)
  const maxChars = clampMaxChars(options.maxChars)
  const truncated = markdown.length > maxChars
  const text = truncated ? markdown.slice(0, maxChars) : markdown

  return {
    html,
    markdown,
    text,
    images,
    totalChars: markdown.length,
    truncated,
  }
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

// Minimal DOM surface we rely on from @mixmark-io/domino (no bundled types).
interface DomNode {
  tagName: string
  children: ArrayLike<DomNode>
  textContent: string
  parentNode: { replaceChild(insert: DomNode, remove: DomNode): void } | null
  ownerDocument: { createTextNode(text: string): DomNode }
  querySelectorAll(selector: string): ArrayLike<DomNode>
  getAttribute(name: string): string | null
  closest(selector: string): DomNode | null
}
interface DomDocument {
  body: { innerHTML: string }
  querySelectorAll(selector: string): ArrayLike<DomNode>
  createElement(tag: string): DomNode & { textContent: string }
}

async function loadDomino(): Promise<{ createDocument(html: string): DomDocument } | null> {
  try {
    const mod = await import('@mixmark-io/domino') as unknown as {
      createDocument?: (html: string) => DomDocument
      default?: { createDocument?: (html: string) => DomDocument }
    }
    if (typeof mod.createDocument === 'function') return mod as { createDocument(html: string): DomDocument }
    if (mod.default && typeof mod.default.createDocument === 'function') {
      return mod.default as { createDocument(html: string): DomDocument }
    }
    return null
  } catch {
    return null
  }
}

// A Word table cell holds whole paragraphs; flatten them to one line, collapse
// whitespace, and escape pipes so the cell can sit inside a markdown table row.
function tableCellText(cell: DomNode): string {
  const blocks = Array.from(cell.querySelectorAll('p, li'))
  const parts = blocks.length ? blocks.map(block => block.textContent) : [cell.textContent]
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

// Convert one HTML table to a GFM pipe table. Expands colspan (repeat the value)
// and rowspan (carry the value into the rows below) so EVERY row has the same
// column count — the round-trip through turndown's GFM rule mangles exactly this.
// Leading all-<th> rows are merged into a single descriptive header per column.
function tableToMarkdown(table: DomNode): string {
  for (const br of Array.from(table.querySelectorAll('br'))) {
    br.parentNode?.replaceChild(table.ownerDocument.createTextNode(' '), br)
  }
  const rows = Array.from(table.querySelectorAll('tr')).filter(tr => tr.closest('table') === table)
  if (!rows.length) return ''

  const grid: string[][] = []
  const headerFlags: boolean[] = []
  const carries: Array<{ text: string; remaining: number } | undefined> = []
  let columnCount = 0

  rows.forEach((tr, r) => {
    grid[r] = grid[r] || []
    const cells = Array.from(tr.children).filter(el => /^(td|th)$/i.test(el.tagName))
    headerFlags[r] = cells.length > 0 && cells.every(cell => cell.tagName.toLowerCase() === 'th')
    let c = 0
    const drainCarries = () => {
      while (carries[c] && carries[c]!.remaining > 0) {
        grid[r][c] = carries[c]!.text
        carries[c]!.remaining--
        c++
      }
    }
    for (const cell of cells) {
      drainCarries()
      const colspan = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1)
      const rowspan = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1)
      const text = tableCellText(cell)
      for (let k = 0; k < colspan; k++) {
        grid[r][c] = text
        if (rowspan > 1) carries[c] = { text, remaining: rowspan - 1 }
        c++
      }
    }
    drainCarries()
    columnCount = Math.max(columnCount, c)
  })
  if (!columnCount) return ''
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < columnCount; c++) if (grid[r][c] == null) grid[r][c] = ''
  }

  let headerCount = 0
  while (headerCount < headerFlags.length && headerFlags[headerCount]) headerCount++
  if (headerCount === 0) headerCount = 1

  const header: string[] = []
  for (let c = 0; c < columnCount; c++) {
    const stacked: string[] = []
    for (let r = 0; r < headerCount; r++) {
      const value = grid[r][c]
      if (value && value !== stacked[stacked.length - 1]) stacked.push(value)
    }
    header[c] = stacked.join(' ') || ' '
  }

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${Array(columnCount).fill('---').join(' | ')} |`,
  ]
  for (let r = headerCount; r < grid.length; r++) {
    lines.push(`| ${grid[r].slice(0, columnCount).join(' | ')} |`)
  }
  return lines.join('\n')
}

// Render tables ourselves (faithful grid), let turndown handle everything else.
// Each top-level table is swapped for a placeholder paragraph, turndown runs on
// the rest, then the clean table markdown is spliced back in. Falls back to plain
// turndown if the DOM parser is unavailable or anything throws.
async function htmlToMarkdownWithTables(
  html: string,
  turndown: { turndown(html: string): string },
): Promise<string> {
  const domino = await loadDomino()
  if (!domino) return turndown.turndown(html)
  try {
    const doc = domino.createDocument(`<body>${html}</body>`)
    const tables = Array.from(doc.querySelectorAll('table')).filter(table => table.closest('table') === table)
    if (!tables.length) return turndown.turndown(html)
    const tableMarkdown: string[] = []
    tables.forEach((table, i) => {
      tableMarkdown[i] = tableToMarkdown(table)
      const placeholder = doc.createElement('p')
      placeholder.textContent = `@@MIMTABLE${i}@@`
      table.parentNode?.replaceChild(placeholder, table)
    })
    const markdown = turndown.turndown(doc.body.innerHTML)
    return markdown.replace(/@@MIMTABLE(\d+)@@/g, (_match, index) => `\n${tableMarkdown[Number(index)] || ''}\n`)
  } catch {
    return turndown.turndown(html)
  }
}

async function convertImageToPng(buffer: Buffer): Promise<Buffer | null> {
  try {
    const mod = await import('sharp') as unknown as {
      default?: (input: Buffer) => { png(): { toBuffer(): Promise<Buffer> } }
    }
    const sharp = mod.default
    return sharp ? await sharp(buffer).png().toBuffer() : null
  } catch {
    return null
  }
}

async function downscaleImage(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (!DOWNSCALED_IMAGE_TYPES.has(contentType)) return { buffer, contentType }
  try {
    const mod = await import('sharp') as unknown as {
      default?: (input: Buffer) => {
        resize(width: number, height: number, options: Record<string, unknown>): unknown
        png(): { toBuffer(): Promise<Buffer> }
        jpeg(): { toBuffer(): Promise<Buffer> }
        webp(): { toBuffer(): Promise<Buffer> }
      }
    }
    const sharp = mod.default
    if (!sharp) return { buffer, contentType }
    const image = sharp(buffer).resize(IMAGE_MAX_EDGE, IMAGE_MAX_EDGE, { fit: 'inside', withoutEnlargement: true }) as {
      png(): { toBuffer(): Promise<Buffer> }
      jpeg(): { toBuffer(): Promise<Buffer> }
      webp(): { toBuffer(): Promise<Buffer> }
    }
    if (contentType === 'image/jpeg') return { buffer: await image.jpeg().toBuffer(), contentType }
    if (contentType === 'image/webp') return { buffer: await image.webp().toBuffer(), contentType }
    return { buffer: await image.png().toBuffer(), contentType: 'image/png' }
  } catch {
    return { buffer, contentType }
  }
}

function clampMaxChars(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_MAX_CHARS
  return Math.min(Math.floor(value), HARD_MAX_CHARS)
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#xa0;/g, ' ')
    .replace(/&nbsp;/g, ' ')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
