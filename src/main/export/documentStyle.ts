// Document export style — the parameters that shape a styled PDF/DOCX export.
// There are no presets: the export dialog exposes these decisions directly, and
// both renderers consume one DocumentStyle so the two formats never drift. The
// page-size and font registries live here too since they share the same role.

export type PageSizeId = 'a4' | 'letter' | 'a5'
export type FontFamilyId = 'lora' | 'satoshi' | 'zilla'
export type PageNumberAlign = 'none' | 'left' | 'center' | 'right'

export interface Margins { top: number; right: number; bottom: number; left: number }

// The independent decisions that shape a document. Font family and size are not
// here — they are separate top-level export parameters with their own pickers,
// so baking a body typeface into the document "style" would be contradictory.
export interface DocumentStyle {
  numberedHeadings: boolean
  /** Treat a document-leading H1 as an unnumbered centered title. */
  titleFirstH1: boolean
  /** Page-number placement in the bottom margin; 'none' omits them. */
  pageNumberAlign: PageNumberAlign
  /** Omit the page number on the first page (DOCX only — see exportDocx). */
  pageNumbersSkipFirst: boolean
  justify: boolean
  columns: 1 | 2
  marginsMm: Margins
}

export const DEFAULT_MARGIN_CM = 2.5
const MIN_MARGIN_CM = 0
const MAX_MARGIN_CM = 10

// One uniform margin, given in centimetres (the unit people actually think in)
// and stored as the millimetres the renderers want. Clamped so a stray value
// can't push the content off the page.
export function uniformMarginsMm(cm: number): Margins {
  const clamped = Number.isFinite(cm) ? Math.min(MAX_MARGIN_CM, Math.max(MIN_MARGIN_CM, cm)) : DEFAULT_MARGIN_CM
  const mm = clamped * 10
  return { top: mm, right: mm, bottom: mm, left: mm }
}

export const DEFAULT_DOCUMENT_STYLE: DocumentStyle = {
  numberedHeadings: false,
  titleFirstH1: false,
  pageNumberAlign: 'none',
  pageNumbersSkipFirst: false,
  justify: true,
  columns: 1,
  marginsMm: uniformMarginsMm(DEFAULT_MARGIN_CM),
}

export const PAGE_SIZES: Record<PageSizeId, { label: string; widthIn: number; heightIn: number }> = {
  a4: { label: 'A4', widthIn: 8.27, heightIn: 11.69 },
  letter: { label: 'US Letter', widthIn: 8.5, heightIn: 11 },
  a5: { label: 'A5', widthIn: 5.83, heightIn: 8.27 },
}

// docxName is the literal font name written into the .docx (resolved on the
// reader's machine, not embedded); cssStack carries print fallbacks for the
// PDF path where the bundled files are loaded via @font-face.
export const FONT_FAMILIES: Record<FontFamilyId, { label: string; cssStack: string; docxName: string }> = {
  satoshi: { label: 'Satoshi (sans)', cssStack: "'Satoshi', 'Helvetica Neue', Arial, sans-serif", docxName: 'Satoshi' },
  lora: { label: 'Lora (serif)', cssStack: "'Lora', Georgia, 'Times New Roman', serif", docxName: 'Lora' },
  zilla: { label: 'Zilla Slab', cssStack: "'Zilla Slab', Georgia, serif", docxName: 'Zilla Slab' },
}

export const DEFAULT_FONT: FontFamilyId = 'satoshi'
export const DEFAULT_FONT_SIZE_PT = 11

export const MONO_CSS_STACK = "'JetBrains Mono', Menlo, Consolas, monospace"
export const MONO_DOCX_NAME = 'JetBrains Mono'

export function pageSizeById(id: string): { label: string; widthIn: number; heightIn: number } {
  const size = PAGE_SIZES[id as PageSizeId]
  if (!size) throw new Error(`Unknown page size: ${id}. Valid: ${Object.keys(PAGE_SIZES).join(', ')}`)
  return size
}

export function fontFamilyById(id: string): { label: string; cssStack: string; docxName: string } {
  const font = FONT_FAMILIES[id as FontFamilyId]
  if (!font) throw new Error(`Unknown font family: ${id}. Valid: ${Object.keys(FONT_FAMILIES).join(', ')}`)
  return font
}
