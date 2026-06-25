import { readFileSync } from 'fs'
import { htmlToMarkdown } from '@main/html/markdown.js'

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

  const markdown = (await htmlToMarkdown(result.value, { extractLinks: true, extractImages: true })).markdown
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
