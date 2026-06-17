import { readFileSync } from 'fs'

export interface PdfExtractOptions {
  maxChars?: number
}

export interface PdfExtractResult {
  text: string
  pages: number
  info: Record<string, unknown>
  totalChars: number
  truncated: boolean
}

const DEFAULT_MAX_CHARS = 200_000
const HARD_MAX_CHARS = 1_000_000

export async function extractPdfText(path: string, options: PdfExtractOptions = {}): Promise<PdfExtractResult> {
  const maxChars = normalizeMaxChars(options.maxChars)
  const buffer = readFileSync(path)
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
      throw new Error('This PDF is encrypted or password-protected.')
    }
    throw new Error(`PDF extraction failed: ${message}`)
  }

  try {
    const chunks: string[] = []
    let totalChars = 0
    let emittedChars = 0

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent({ includeMarkedContent: false })
      const text = textContentToPlainText(content)
      totalChars += text.length
      if (emittedChars < maxChars) {
        const remaining = maxChars - emittedChars
        const selected = text.slice(0, remaining)
        if (selected) {
          chunks.push(selected)
          emittedChars += selected.length
        }
      }
    }

    const metadata = await pdf.getMetadata?.().catch(() => null)
    return {
      text: chunks.join('\n\n'),
      pages: pdf.numPages,
      info: {
        ...sanitizePdfInfo(metadata?.info),
        ...readCustomPdfInfo(buffer),
      },
      totalChars,
      truncated: totalChars > emittedChars,
    }
  } finally {
    await pdf.destroy?.()
  }
}

interface PdfDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxy>
  getMetadata?: () => Promise<{ info?: Record<string, unknown> } | null>
  destroy?: () => Promise<void> | void
}

interface PdfPageProxy {
  getTextContent(options?: Record<string, unknown>): Promise<PdfTextContent>
}

interface PdfTextContent {
  items: Array<{ str?: string; hasEOL?: boolean }>
}

function textContentToPlainText(content: PdfTextContent): string {
  const out: string[] = []
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue
    if (item.str) out.push(item.str)
    if (item.hasEOL) out.push('\n')
  }
  return out.join(' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function sanitizePdfInfo(info: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!info) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(info)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return out
}

function readCustomPdfInfo(buffer: Buffer): Record<string, string> {
  const source = buffer.toString('latin1')
  const doi = readPdfLiteralAfterName(source, 'doi') ?? readPdfLiteralAfterName(source, 'DOI')
  return doi ? { doi } : {}
}

function readPdfLiteralAfterName(source: string, name: string): string | null {
  let at = source.indexOf(`/${name}`)
  while (at !== -1) {
    let i = at + name.length + 1
    if (/[A-Za-z0-9_-]/.test(source[i] ?? '')) {
      at = source.indexOf(`/${name}`, i)
      continue
    }
    while (/\s/.test(source[i] ?? '')) i++
    if (source[i] !== '(') {
      at = source.indexOf(`/${name}`, i)
      continue
    }
    return readPdfLiteral(source, i)
  }
  return null
}

function readPdfLiteral(source: string, open: number): string {
  let out = ''
  for (let i = open + 1; i < source.length; i++) {
    const ch = source[i]
    if (ch === ')') return out
    if (ch === '\\') {
      const next = source[++i]
      if (next === 'n') out += '\n'
      else if (next === 'r') out += '\r'
      else if (next === 't') out += '\t'
      else if (next) out += next
      continue
    }
    out += ch
  }
  return out
}

function normalizeMaxChars(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_CHARS
  return Math.max(0, Math.min(HARD_MAX_CHARS, Math.floor(value)))
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
    multiplySelf() { return this }
    preMultiplySelf() { return this }
    translateSelf() { return this }
    scaleSelf() { return this }
    rotateSelf() { return this }
    invertSelf() { return this }
    transformPoint(point: { x?: number; y?: number } = {}) {
      return { x: point.x ?? 0, y: point.y ?? 0 }
    }
  }
}
