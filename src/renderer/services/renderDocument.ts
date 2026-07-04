/**
 * Pure functions for the Rmd/qmd render workflow.
 *
 * - Engine/argv decision matrix
 * - R string escaping for rmarkdown::render paths
 * - Product ranking (pdf > html > other)
 * - Missing PDF engine guidance (tinytex/LaTeX not found detection)
 */

// ── Types ──

export interface RenderProduct {
  path: string
  bytes: number
  kind: 'image' | 'pdf' | 'table' | 'html' | 'text' | 'other'
}

export interface EngineAvailability {
  quarto: boolean
  rscript: boolean
}

// ── R string escaping ──

/**
 * Escape a file path for embedding inside a single-quoted R string literal.
 * R's single-quoted strings only need backslash and single-quote escaped.
 */
export function escapeForRString(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Build the R expression for rmarkdown::render('<path>').
 */
export function rmarkdownRenderExpression(path: string): string {
  return `rmarkdown::render('${escapeForRString(path)}')`
}

// ── Engine / argv decision ──

/**
 * Returns the argv array for rendering a document, or null if no suitable
 * engine is available.
 *
 * Decision matrix:
 * - .qmd → quarto required → ['quarto', 'render', path]
 * - .rmd → quarto if detected → ['quarto', 'render', path]
 *          else rscript      → ['rscript', '-e', rmarkdownRenderExpression(path)]
 *          else              → null
 * - other extensions → null
 */
export function renderArgv(path: string, engines: EngineAvailability): string[] | null {
  const ext = extensionOf(path)

  if (ext === 'qmd') {
    if (!engines.quarto) return null
    return ['quarto', 'render', path]
  }

  if (ext === 'rmd') {
    if (engines.quarto) return ['quarto', 'render', path]
    if (engines.rscript) return ['rscript', '-e', rmarkdownRenderExpression(path)]
    return null
  }

  return null
}

// ── Product ranking ──

const KIND_RANK: Record<string, number> = {
  pdf: 0,
  html: 1,
  image: 2,
  table: 3,
  text: 4,
  other: 5,
}

/**
 * Pick the best product from a code.run result for the render workflow.
 * Ranks: pdf > html > image > table > text > other.
 * Returns null if the array is empty.
 */
export function pickBestProduct(products: RenderProduct[]): RenderProduct | null {
  if (products.length === 0) return null
  let best = products[0]
  let bestRank = KIND_RANK[best.kind] ?? 99
  for (let i = 1; i < products.length; i++) {
    const rank = KIND_RANK[products[i].kind] ?? 99
    if (rank < bestRank) {
      best = products[i]
      bestRank = rank
    }
  }
  return best
}

// ── Missing PDF engine guidance (R4.2) ──

const PDF_ENGINE_PATTERN = /tinytex|no\s+latex|xelatex.*not\s*found|pdflatex.*not\s*found|lualatex.*not\s*found/i

/**
 * Detect whether stderr from a render failure indicates a missing LaTeX/tinytex
 * installation. Returns the user-facing guidance string or null.
 */
export function missingPdfEngineGuidance(stderr: string): string | null {
  if (!stderr) return null
  if (PDF_ENGINE_PATTERN.test(stderr)) {
    return 'PDF engine missing — run `quarto install tinytex` or render to HTML'
  }
  return null
}

// ── Helpers ──

function extensionOf(path: string): string {
  const name = path.split(/[/\\]/).pop() || path
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}
