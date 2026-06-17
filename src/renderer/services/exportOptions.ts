// Pure helpers behind ExportDialog: option persistence, output naming, and
// citation detection. Kept out of the component so they are unit-testable.

// The export decisions, exposed directly in the dialog (no template presets).
// These map one-to-one onto export.pdf / export.docx tool params.
export type PageNumberAlign = 'none' | 'left' | 'center' | 'right'

export interface ExportUiOptions {
  format: 'pdf' | 'docx'
  pageSize: string
  marginCm: number
  font: string
  fontSizePt: number
  numberedHeadings: boolean
  justify: boolean
  pageNumberPosition: PageNumberAlign
  pageNumbersSkipFirst: boolean
  citationStyle: 'apa' | 'chicago' | 'ieee'
}

export const DEFAULT_EXPORT_OPTIONS: ExportUiOptions = {
  format: 'pdf',
  pageSize: 'a4',
  marginCm: 2.5,
  font: 'satoshi',
  fontSizePt: 11,
  numberedHeadings: false,
  justify: true,
  pageNumberPosition: 'none',
  pageNumbersSkipFirst: false,
  citationStyle: 'apa',
}

const STORAGE_KEY = 'mim:export-options'
const FORMATS = new Set(['pdf', 'docx'])
const PAGE_NUMBER_POSITIONS = new Set(['none', 'left', 'center', 'right'])
const CITATION_STYLES = new Set(['apa', 'chicago', 'ieee'])

export function loadExportOptions(storage: Storage): ExportUiOptions {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_EXPORT_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<ExportUiOptions>
    const bool = (key: keyof ExportUiOptions): boolean =>
      typeof parsed[key] === 'boolean' ? parsed[key] as boolean : DEFAULT_EXPORT_OPTIONS[key] as boolean
    return {
      format: FORMATS.has(parsed.format as string) ? parsed.format as ExportUiOptions['format'] : DEFAULT_EXPORT_OPTIONS.format,
      pageSize: typeof parsed.pageSize === 'string' ? parsed.pageSize : DEFAULT_EXPORT_OPTIONS.pageSize,
      marginCm: typeof parsed.marginCm === 'number' && Number.isFinite(parsed.marginCm)
        ? parsed.marginCm
        : DEFAULT_EXPORT_OPTIONS.marginCm,
      font: typeof parsed.font === 'string' ? parsed.font : DEFAULT_EXPORT_OPTIONS.font,
      fontSizePt: typeof parsed.fontSizePt === 'number' && Number.isFinite(parsed.fontSizePt)
        ? parsed.fontSizePt
        : DEFAULT_EXPORT_OPTIONS.fontSizePt,
      numberedHeadings: bool('numberedHeadings'),
      justify: bool('justify'),
      pageNumberPosition: PAGE_NUMBER_POSITIONS.has(parsed.pageNumberPosition as string)
        ? parsed.pageNumberPosition as PageNumberAlign
        : DEFAULT_EXPORT_OPTIONS.pageNumberPosition,
      pageNumbersSkipFirst: bool('pageNumbersSkipFirst'),
      citationStyle: CITATION_STYLES.has(parsed.citationStyle as string)
        ? parsed.citationStyle as ExportUiOptions['citationStyle']
        : DEFAULT_EXPORT_OPTIONS.citationStyle,
    }
  } catch {
    return { ...DEFAULT_EXPORT_OPTIONS }
  }
}

export function saveExportOptions(storage: Storage, options: ExportUiOptions): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // Persistence is a convenience; never block an export on it.
  }
}

export function defaultOutputName(documentPath: string, documentName: string, format: 'pdf' | 'docx'): string {
  if (documentPath) return documentPath.replace(/\.(md|markdown|txt)$/i, '') + `.${format}`
  const stem = (documentName || 'Document').replace(/\.(md|markdown|txt)$/i, '').trim() || 'Document'
  return `${stem}.${format}`
}

// Heuristic for showing the bibliography section: a [@key] outside fenced
// blocks and inline code. The export tool re-checks for real during render.
export function detectCitations(markdown: string): boolean {
  const withoutFences = markdown.replace(/^\s*(```+|~~~+)[\s\S]*?^\s*\1\s*$/gm, '')
  const withoutInline = withoutFences.replace(/`[^`\n]*`/g, '')
  return /\[@[A-Za-z0-9_]/.test(withoutInline)
}

// Suggest the first .bib file from directory listings; callers pass entries
// ordered by proximity (document dir first, workspace root second).
export function pickBibCandidate(entries: Array<{ name?: string; path?: string }>): string | null {
  for (const entry of entries) {
    if (typeof entry.name === 'string' && /\.bib$/i.test(entry.name) && typeof entry.path === 'string') {
      return entry.path
    }
  }
  return null
}
