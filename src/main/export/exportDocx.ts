// Markdown → DOCX. Walks the same marked token stream as the HTML composer
// and maps it onto docx (pure JS) document objects, styled from the shared
// DocumentStyle so PDF and DOCX exports agree. Heading numbers are computed
// here (not Word auto-numbering) so the output matches the CSS counters of
// the PDF path exactly. Images arrive through an injected loader; the module
// itself touches no filesystem and works in headless runtimes.

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  convertMillimetersToTwip,
} from 'docx'
import { marked, type Token, type Tokens } from 'marked'
import type { Reference } from './citations.js'
import { FONT_FAMILIES, MONO_DOCX_NAME, type DocumentStyle, type FontFamilyId } from './documentStyle.js'

export interface DocxImage {
  data: Buffer
  type: 'jpg' | 'png' | 'gif' | 'bmp'
  width: number
  height: number
}

export type ImageLoader = (src: string) => Promise<DocxImage | null>

export interface ComposeDocxOptions {
  markdown: string
  style: DocumentStyle
  fontFamily: FontFamilyId
  fontSizePt: number
  pageSize: { widthIn: number; heightIn: number }
  title?: string
  loadImage?: ImageLoader
  bibliography?: Reference[]
  bibliographyTitle?: string
}

// Heading scale (em-relative, mirrors _base.css).
const HEADING_SCALE: [number, number, number, number] = [1.9, 1.4, 1.15, 1]

const INK = '1C1C1A'
const INK_SOFT = '4A4A45'
const RULE = 'C9C9C2'
const CODE_BG = 'F7F7F4'
const LINK_COLOR = '0B57A4'

export function headingNumberer(): (depth: number) => string {
  const counters = [0, 0, 0]
  return (depth: number): string => {
    if (depth < 1 || depth > 3) return ''
    counters[depth - 1]++
    for (let i = depth; i < counters.length; i++) counters[i] = 0
    return counters.slice(0, depth).join('.')
  }
}

export function fitImage(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (width <= maxWidth) return { width, height }
  const scale = maxWidth / width
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

type Block = Paragraph | Table

interface WalkContext {
  style: DocumentStyle
  contentWidthPx: number
  loadImage?: ImageLoader
  numberHeading: (depth: number) => string
  orderedListInstance: number
  /** Set once the leading title H1 has been consumed (titleFirstH1). */
  sawFirstBlock: boolean
}

export async function composeDocx(options: ComposeDocxOptions): Promise<Buffer> {
  const { style } = options
  const tokens = marked.lexer(options.markdown, { gfm: true })
  const contentWidthIn = options.pageSize.widthIn - (style.marginsMm.left + style.marginsMm.right) / 25.4
  const ctx: WalkContext = {
    style,
    contentWidthPx: Math.floor(contentWidthIn * 96),
    loadImage: options.loadImage,
    numberHeading: headingNumberer(),
    orderedListInstance: 0,
    sawFirstBlock: false,
  }

  const children: Block[] = await walkBlocks(tokens, ctx)
  children.push(...renderBibliography(options.bibliography, options.bibliographyTitle, ctx))
  if (children.length === 0) children.push(new Paragraph({}))

  const bodyFont = FONT_FAMILIES[options.fontFamily].docxName
  const bodySize = Math.round(options.fontSizePt * 2)
  const scales = HEADING_SCALE
  const headingStyle = (level: 1 | 2 | 3 | 4) => ({
    id: `Heading${level}`,
    name: `Heading ${level}`,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: {
      font: bodyFont,
      size: Math.round(bodySize * scales[level - 1]),
      bold: true,
      color: INK,
    },
    paragraph: {
      spacing: { before: Math.round(220 * scales[level - 1]), after: 120 },
      keepNext: true,
    },
  })

  const doc = new Document({
    title: options.title,
    creator: 'Mim',
    styles: {
      default: {
        document: { run: { font: bodyFont, size: bodySize, color: INK } },
      },
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: { font: bodyFont, size: bodySize, color: INK },
          paragraph: { spacing: { line: 300, after: 130 } },
        },
        headingStyle(1),
        headingStyle(2),
        headingStyle(3),
        headingStyle(4),
        {
          id: 'Title',
          name: 'Title',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: bodyFont, size: Math.round(bodySize * 1.75), bold: true, color: INK },
          paragraph: { spacing: { before: 0, after: 360 }, alignment: AlignmentType.CENTER },
        },
        {
          id: 'MimCode',
          name: 'Code Block',
          basedOn: 'Normal',
          run: { font: MONO_DOCX_NAME, size: Math.round(bodySize * 0.82) },
          paragraph: {
            spacing: { line: 276, before: 120, after: 160 },
            shading: { fill: CODE_BG },
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: 'E2E2DB', space: 4 },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E2DB', space: 4 },
              left: { style: BorderStyle.SINGLE, size: 4, color: 'E2E2DB', space: 8 },
              right: { style: BorderStyle.SINGLE, size: 4, color: 'E2E2DB', space: 8 },
            },
            keepLines: true,
          },
        },
        {
          id: 'MimQuote',
          name: 'Block Quote',
          basedOn: 'Normal',
          run: { italics: true, color: INK_SOFT },
          paragraph: {
            indent: { left: 360 },
            border: { left: { style: BorderStyle.SINGLE, size: 16, color: RULE, space: 12 } },
          },
        },
        {
          id: 'MimRef',
          name: 'Reference Entry',
          basedOn: 'Normal',
          run: { size: Math.round(bodySize * 0.92) },
          paragraph: {
            spacing: { line: 280, after: 90 },
            indent: { left: 480, hanging: 480 },
          },
        },
      ],
      characterStyles: [
        {
          id: 'Hyperlink',
          name: 'Hyperlink',
          basedOn: 'DefaultParagraphFont',
          run: { color: LINK_COLOR, underline: {} },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'md-bullets',
          levels: [0, 1, 2, 3].map(level => ({
            level,
            format: LevelFormat.BULLET,
            text: ['•', '◦', '▪', '•'][level],
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540 + level * 360, hanging: 270 } } },
          })),
        },
        {
          reference: 'md-numbers',
          levels: [0, 1, 2, 3].map(level => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 600 + level * 360, hanging: 330 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(options.pageSize.widthIn),
              height: convertInchesToTwip(options.pageSize.heightIn),
            },
            margin: {
              top: convertMillimetersToTwip(style.marginsMm.top),
              right: convertMillimetersToTwip(style.marginsMm.right),
              bottom: convertMillimetersToTwip(style.marginsMm.bottom),
              left: convertMillimetersToTwip(style.marginsMm.left),
            },
          },
          ...(style.columns === 2
            ? { column: { count: 2, space: convertMillimetersToTwip(7) } }
            : {}),
          // A distinct (empty) first-page footer is how Word omits the number
          // on the title page while page 2 onward still count from 1.
          ...(style.pageNumberAlign !== 'none' && style.pageNumbersSkipFirst ? { titlePage: true } : {}),
        },
        ...(style.pageNumberAlign !== 'none'
          ? {
              footers: {
                default: new Footer({ children: [pageNumberParagraph(bodyFont, bodySize, style.pageNumberAlign)] }),
                ...(style.pageNumbersSkipFirst
                  ? { first: new Footer({ children: [new Paragraph({})] }) }
                  : {}),
              },
            }
          : {}),
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}

const FOOTER_ALIGNMENT = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const

function pageNumberParagraph(bodyFont: string, bodySize: number, align: 'left' | 'center' | 'right'): Paragraph {
  return new Paragraph({
    alignment: FOOTER_ALIGNMENT[align],
    children: [
      new TextRun({
        children: [PageNumber.CURRENT],
        font: bodyFont,
        size: Math.round(bodySize * 0.82),
        color: INK_SOFT,
      }),
    ],
  })
}

function renderBibliography(refs: Reference[] | undefined, title: string | undefined, ctx: WalkContext): Block[] {
  if (!refs || refs.length === 0) return []
  const blocks: Block[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(title || 'References')],
    }),
  ]
  for (const ref of refs) {
    const runs: TextRun[] = []
    if (ref.label) runs.push(new TextRun(`${ref.label} `))
    for (const run of ref.runs) runs.push(new TextRun({ text: run.text, italics: run.italic }))
    blocks.push(new Paragraph({ style: 'MimRef', children: runs }))
  }
  return blocks
}

// ── Block walking ──────────────────────────────────────────────────────

async function walkBlocks(tokens: Token[], ctx: WalkContext): Promise<Block[]> {
  const blocks: Block[] = []
  for (const token of tokens) {
    const rendered = await renderBlock(token, ctx)
    blocks.push(...rendered)
    if (token.type !== 'space' && rendered.length > 0) ctx.sawFirstBlock = true
  }
  return blocks
}

async function renderBlock(token: Token, ctx: WalkContext): Promise<Block[]> {
  switch (token.type) {
    case 'heading':
      return [await renderHeading(token as Tokens.Heading, ctx)]
    case 'paragraph':
      return renderParagraphBlock(token as Tokens.Paragraph, ctx)
    case 'text': {
      const text = token as Tokens.Text
      const runs = await renderInline(text.tokens ?? [{ type: 'text', raw: text.raw, text: text.text } as Token], {}, ctx)
      return runs.length > 0 ? [new Paragraph({ children: runs })] : []
    }
    case 'list':
      return renderList(token as Tokens.List, ctx, 0)
    case 'code':
      return [renderCodeBlock(token as Tokens.Code)]
    case 'blockquote':
      return renderBlockquote(token as Tokens.Blockquote, ctx)
    case 'table':
      return [await renderTable(token as Tokens.Table, ctx)]
    case 'hr':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'B5B5AE', space: 1 } },
          spacing: { before: 240, after: 240 },
        }),
      ]
    case 'html': {
      const text = stripHtml((token as Tokens.HTML).text)
      return text ? [new Paragraph({ children: [new TextRun(text)] })] : []
    }
    case 'space':
      return []
    default:
      return 'text' in token && typeof token.text === 'string' && token.text.trim()
        ? [new Paragraph({ children: [new TextRun(token.text)] })]
        : []
  }
}

async function renderHeading(token: Tokens.Heading, ctx: WalkContext): Promise<Paragraph> {
  const depth = Math.min(token.depth, 4)
  const isTitle = ctx.style.titleFirstH1 && token.depth === 1 && !ctx.sawFirstBlock
  const runs = await renderInline(token.tokens, {}, ctx)

  if (isTitle) {
    return new Paragraph({ style: 'Title', children: runs })
  }

  const number = ctx.style.numberedHeadings ? ctx.numberHeading(token.depth) : ''
  const children = number ? [new TextRun(`${number} `), ...runs] : runs
  const headingLevels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4] as const
  return new Paragraph({
    heading: headingLevels[depth - 1],
    children,
  })
}

async function renderParagraphBlock(token: Tokens.Paragraph, ctx: WalkContext): Promise<Block[]> {
  const runs = await renderInline(token.tokens, {}, ctx)
  if (runs.length === 0) return []
  return [
    new Paragraph({
      alignment: ctx.style.justify ? AlignmentType.JUSTIFIED : undefined,
      children: runs,
    }),
  ]
}

async function renderList(list: Tokens.List, ctx: WalkContext, level: number): Promise<Block[]> {
  const blocks: Block[] = []
  if (list.ordered && level === 0) ctx.orderedListInstance++
  for (const item of list.items) {
    let firstParagraphDone = false
    for (const child of item.tokens) {
      if (child.type === 'list') {
        blocks.push(...await renderList(child as Tokens.List, ctx, Math.min(level + 1, 3)))
        continue
      }
      if (child.type === 'text' || child.type === 'paragraph') {
        const inline = await renderInline((child as Tokens.Text).tokens ?? [], {}, ctx)
        const checkbox = item.task && !firstParagraphDone
          ? [new TextRun(`${item.checked ? '☒' : '☐'} `)]
          : []
        blocks.push(new Paragraph({
          numbering: {
            reference: list.ordered ? 'md-numbers' : 'md-bullets',
            level,
            instance: list.ordered ? ctx.orderedListInstance : undefined,
          },
          spacing: { after: 60 },
          children: [...checkbox, ...inline],
        }))
        firstParagraphDone = true
        continue
      }
      blocks.push(...await renderBlock(child, ctx))
    }
  }
  return blocks
}

function renderCodeBlock(token: Tokens.Code): Paragraph {
  const lines = token.text.replace(/\n$/, '').split('\n')
  const runs = lines.flatMap((line, index) =>
    index === 0 ? [new TextRun(line)] : [new TextRun({ text: line, break: 1 })],
  )
  return new Paragraph({ style: 'MimCode', children: runs })
}

// Render blockquote contents directly as MimQuote paragraphs; non-paragraph
// children (nested lists, code) keep their own block rendering.
async function renderBlockquote(token: Tokens.Blockquote, ctx: WalkContext): Promise<Block[]> {
  const blocks: Block[] = []
  for (const child of token.tokens) {
    if (child.type === 'paragraph' || child.type === 'text') {
      const runs = await renderInline((child as Tokens.Paragraph).tokens ?? [], {}, ctx)
      if (runs.length > 0) blocks.push(new Paragraph({ style: 'MimQuote', children: runs }))
    } else {
      blocks.push(...await renderBlock(child, ctx))
    }
  }
  return blocks
}

async function renderTable(token: Tokens.Table, ctx: WalkContext): Promise<Table> {
  const cellMargins = { top: 80, bottom: 80, left: 100, right: 100 }
  const headerRow = new TableRow({
    tableHeader: true,
    children: await Promise.all(token.header.map(async cell => new TableCell({
      margins: cellMargins,
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.SINGLE, size: 10, color: '2A2A26' },
      },
      children: [new Paragraph({ spacing: { after: 0 }, children: await renderInline(cell.tokens, { bold: true }, ctx) })],
    }))),
  })
  const bodyRows = await Promise.all(token.rows.map(async row => new TableRow({
    cantSplit: true,
    children: await Promise.all(row.map(async cell => new TableCell({
      margins: cellMargins,
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D4D4CD' },
      },
      children: [new Paragraph({ spacing: { after: 0 }, children: await renderInline(cell.tokens, {}, ctx) })],
    }))),
  })))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  })
}

// ── Inline rendering ───────────────────────────────────────────────────

interface InlineStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
}

type InlineChild = TextRun | ExternalHyperlink | ImageRun

async function renderInline(tokens: Token[], style: InlineStyle, ctx: WalkContext): Promise<InlineChild[]> {
  const runs: InlineChild[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const inline = token as Tokens.Text
        if (inline.tokens && inline.tokens.length > 0) {
          runs.push(...await renderInline(inline.tokens, style, ctx))
        } else {
          runs.push(new TextRun({ text: decodeEntities(inline.text), ...style }))
        }
        break
      }
      case 'escape':
        runs.push(new TextRun({ text: (token as Tokens.Escape).text, ...style }))
        break
      case 'strong':
        runs.push(...await renderInline((token as Tokens.Strong).tokens, { ...style, bold: true }, ctx))
        break
      case 'em':
        runs.push(...await renderInline((token as Tokens.Em).tokens, { ...style, italics: true }, ctx))
        break
      case 'del':
        runs.push(...await renderInline((token as Tokens.Del).tokens, { ...style, strike: true }, ctx))
        break
      case 'codespan':
        runs.push(new TextRun({
          text: (token as Tokens.Codespan).text,
          font: MONO_DOCX_NAME,
          shading: { fill: 'F4F4F0' },
          ...style,
        }))
        break
      case 'link': {
        const link = token as Tokens.Link
        const inner = await renderInline(link.tokens, style, ctx)
        const textChildren = inner.filter((run): run is TextRun => run instanceof TextRun)
        runs.push(new ExternalHyperlink({
          link: link.href,
          children: textChildren.length > 0 ? textChildren : [new TextRun({ text: link.href, style: 'Hyperlink' })],
        }))
        break
      }
      case 'image': {
        const image = token as Tokens.Image
        runs.push(...await renderImage(image, ctx))
        break
      }
      case 'br':
        runs.push(new TextRun({ text: '', break: 1 }))
        break
      case 'html': {
        const text = stripHtml((token as Tokens.HTML).text)
        if (text) runs.push(new TextRun({ text, ...style }))
        break
      }
      default:
        if ('text' in token && typeof token.text === 'string') {
          runs.push(new TextRun({ text: decodeEntities(token.text), ...style }))
        }
    }
  }
  return runs
}

async function renderImage(token: Tokens.Image, ctx: WalkContext): Promise<InlineChild[]> {
  const alt = token.text || token.href
  if (!ctx.loadImage) return [new TextRun({ text: `[${alt}]`, italics: true })]
  const image = await ctx.loadImage(token.href)
  if (!image) return [new TextRun({ text: `[${alt}]`, italics: true })]
  const { width, height } = fitImage(image.width, image.height, ctx.contentWidthPx)
  return [
    new ImageRun({
      type: image.type,
      data: image.data,
      transformation: { width, height },
      altText: { title: alt, description: alt, name: alt },
    }),
  ]
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
