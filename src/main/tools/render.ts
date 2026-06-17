import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { ToolRegistry } from '@main/tools/registry.js'

// PowerPoint's default slide geometry (16:9). The page size is derived from CSS
// pixels at 96dpi so the printed PDF page matches the template's .slide boxes
// exactly — 1280/96 keeps the float round-trip lossless, 13.333 would not.
export const SLIDE_PAGE = {
  widthPx: 1280,
  heightPx: 720,
  widthIn: 1280 / 96,
  heightIn: 720 / 96,
} as const

export type SlidePage = typeof SLIDE_PAGE

export interface SlideRenderIssue {
  slide: number | null
  type: string
  detail: string
}

export interface SlideMetrics {
  slideCount: number
  issues: SlideRenderIssue[]
  warnings: SlideRenderIssue[]
}

export interface SlideCapture {
  slide: number
  image: Buffer
}

export interface RenderReport {
  ok: boolean
  slide_count: number
  page_count: number
  issues: SlideRenderIssue[]
  warnings: SlideRenderIssue[]
}

export interface CaptureEntry {
  slide: number
  path: string
}

export interface RenderHtmlFileToPdfOptions {
  captureSlides?: boolean
}

export type RenderHtmlFileToPdf = (
  absolutePath: string,
  page: SlidePage,
  options?: RenderHtmlFileToPdfOptions,
) => Promise<{ pdf: Buffer; metrics: SlideMetrics; captures?: SlideCapture[] }>

export interface RenderToolOptions {
  // Electron boundary (hidden BrowserWindow + printToPDF). Absent in headless
  // runtimes, where the tool fails with a clear message instead of crashing.
  render?: RenderHtmlFileToPdf
}

export function registerRenderTools(tools: ToolRegistry, options: RenderToolOptions = {}): void {
  tools.register({
    name: 'render.htmlToPdf',
    description: 'Render a workspace HTML slide deck to PDF and report slide layout issues (overflow, page bleed). Optionally capture per-slide images for vision review.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to the HTML file' },
        output_path: { type: 'string', description: 'Workspace-relative PDF output path. Defaults to the HTML path with a .pdf extension.' },
        capture_slides: { type: 'boolean', description: 'When true, capture one JPEG image per slide into a captures/ directory next to the PDF.' },
      },
      required: ['path'],
    },
    execute: async (params) => {
      if (!options.render) throw new Error('PDF rendering is not available in this runtime')
      const relPath = requireString(params, 'path')
      if (!/\.html?$/i.test(relPath)) throw new Error(`Not an HTML file: ${relPath}`)
      const htmlPath = resolveWorkspacePath(tools, relPath)
      if (!existsSync(htmlPath)) throw new Error(`HTML file not found: ${relPath}`)

      const relOutput = typeof params.output_path === 'string' && params.output_path
        ? params.output_path
        : resolveOutputPath(relPath)
      const pdfPath = resolveWorkspacePath(tools, relOutput)
      const captureSlides = params.capture_slides === true

      const { pdf, metrics, captures } = await options.render(htmlPath, SLIDE_PAGE, { captureSlides })
      mkdirSync(dirname(pdfPath), { recursive: true })
      writeFileSync(pdfPath, pdf)

      const report = buildRenderReport(metrics, countPdfPages(pdf))

      const result: Record<string, unknown> = {
        ...report,
        path: toSlashPath(relPath),
        pdf_path: toSlashPath(relOutput),
      }

      if (captureSlides && captures && captures.length > 0) {
        const deckDir = dirname(htmlPath)
        const capturesDir = join(deckDir, 'captures')
        wipeCapturesDir(capturesDir)
        mkdirSync(capturesDir, { recursive: true })

        const workspace = tools.getWorkspacePath()!
        const captureEntries: CaptureEntry[] = []
        for (const cap of captures) {
          const filename = `slide-${String(cap.slide).padStart(2, '0')}.jpg`
          const absPath = join(capturesDir, filename)
          writeFileSync(absPath, cap.image)
          captureEntries.push({
            slide: cap.slide,
            path: toSlashPath(relative(workspace, absPath)),
          })
        }
        result.captures = captureEntries
      }

      return result
    },
  })
}

// Merge in-page layout metrics with the printed result into one agent-facing
// report. ok=true means the deck is ready to ship. Warnings are informational
// and never affect ok status.
export function buildRenderReport(metrics: SlideMetrics, pageCount: number): RenderReport {
  const issues: SlideRenderIssue[] = []
  if (metrics.slideCount === 0) {
    issues.push({
      slide: null,
      type: 'no-slides',
      detail: 'No <section class="slide"> elements found. Every slide must be a top-level section.slide.',
    })
  }
  if (pageCount > 0 && metrics.slideCount > 0 && pageCount !== metrics.slideCount) {
    issues.push({
      slide: null,
      type: 'page-count-mismatch',
      detail: `The deck has ${metrics.slideCount} slides but printed to ${pageCount} pages. Content is bleeding across page breaks; keep every slide inside its fixed box.`,
    })
  }
  issues.push(...metrics.issues)
  const warnings = metrics.warnings ?? []
  return { ok: issues.length === 0, slide_count: metrics.slideCount, page_count: pageCount, issues, warnings }
}

export function resolveOutputPath(htmlPath: string): string {
  return /\.html?$/i.test(htmlPath) ? htmlPath.replace(/\.html?$/i, '.pdf') : `${htmlPath}.pdf`
}

// Best-effort page count from Chromium's PDF output, whose page objects appear
// uncompressed in the object catalog. Returns 0 when nothing matches.
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1')
  const matches = text.match(/\/Type\s*\/Page(?![s\w])/g)
  return matches ? matches.length : 0
}

// Wipe the captures directory so stale images from a previous pass never survive.
export function wipeCapturesDir(capturesDir: string): void {
  if (existsSync(capturesDir)) {
    // Remove only .jpg files to be safe, then remove the dir if empty
    for (const entry of readdirSync(capturesDir)) {
      if (/\.jpg$/i.test(entry)) {
        rmSync(join(capturesDir, entry), { force: true })
      }
    }
  }
}

// In-page layout validation, executed in the render window before printing.
// Detects content taller/wider than its slide (scrollHeight reports clipped
// content even under overflow:hidden) and positioned elements escaping the
// slide box. Elements marked data-bleed opt out (intentional full-bleed decor).
//
// Returns { slideCount, issues, warnings }. Issues are blocking (affect ok);
// warnings (clipped-text, low-contrast) are informational only.
export function buildValidationScript(page: SlidePage): string {
  return `(() => {
    const EXPECTED = { width: ${page.widthPx}, height: ${page.heightPx} }
    const slides = Array.from(document.querySelectorAll('section.slide'))
    const issues = []
    const warnings = []

    function relativeLuminance(r, g, b) {
      var rs = r / 255, gs = g / 255, bs = b / 255
      rs = rs <= 0.03928 ? rs / 12.92 : Math.pow((rs + 0.055) / 1.055, 2.4)
      gs = gs <= 0.03928 ? gs / 12.92 : Math.pow((gs + 0.055) / 1.055, 2.4)
      bs = bs <= 0.03928 ? bs / 12.92 : Math.pow((bs + 0.055) / 1.055, 2.4)
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
    }

    function parseRgb(color) {
      var m = color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/)
      if (!m) return null
      return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])]
    }

    function isTransparent(color) {
      if (!color) return true
      if (color === 'transparent' || color === 'rgba(0, 0, 0, 0)') return true
      var m = color.match(/rgba\\(\\d+,\\s*\\d+,\\s*\\d+,\\s*([\\d.]+)\\)/)
      return m && parseFloat(m[1]) < 0.1
    }

    function getAncestorBg(el) {
      var node = el
      while (node && node !== document.documentElement) {
        var bg = getComputedStyle(node).backgroundColor
        if (!isTransparent(bg)) return bg
        node = node.parentElement
      }
      return 'rgb(255, 255, 255)'
    }

    function hasVisibleText(el) {
      for (var i = 0; i < el.childNodes.length; i++) {
        var child = el.childNodes[i]
        if (child.nodeType === 3 && child.textContent && child.textContent.trim().length > 0) return true
      }
      return false
    }

    slides.forEach(function(slide, index) {
      var n = index + 1
      var rect = slide.getBoundingClientRect()
      if (Math.abs(rect.width - EXPECTED.width) > 1 || Math.abs(rect.height - EXPECTED.height) > 1) {
        issues.push({ slide: n, type: 'wrong-size', detail: 'slide box is ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + 'px, expected ' + EXPECTED.width + 'x' + EXPECTED.height + 'px' })
      }
      if (slide.scrollHeight > slide.clientHeight + 1) {
        issues.push({ slide: n, type: 'overflow-y', detail: 'content is ' + (slide.scrollHeight - slide.clientHeight) + 'px taller than the slide' })
      }
      if (slide.scrollWidth > slide.clientWidth + 1) {
        issues.push({ slide: n, type: 'overflow-x', detail: 'content is ' + (slide.scrollWidth - slide.clientWidth) + 'px wider than the slide' })
      }
      var escapes = 0
      var clippedChecked = 0
      var contrastChecked = 0
      for (var ei = 0; ei < slide.querySelectorAll('*').length; ei++) {
        var el = slide.querySelectorAll('*')[ei]
        if (el.closest('[data-bleed]')) continue
        var r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (escapes < 3) {
          if (r.bottom > rect.bottom + 1 || r.right > rect.right + 1 || r.top < rect.top - 1 || r.left < rect.left - 1) {
            escapes++
            var cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(/\\s+/).join('.') : ''
            issues.push({ slide: n, type: 'escapes-slide', detail: '<' + el.tagName.toLowerCase() + cls + '> extends outside the slide box' })
          }
        }
        if (clippedChecked < 5 && el.scrollHeight > el.clientHeight + 2 && hasVisibleText(el)) {
          clippedChecked++
          var tag = el.tagName.toLowerCase()
          var cls2 = typeof el.className === 'string' && el.className ? '.' + el.className.split(/\\s+/).join('.') : ''
          warnings.push({ slide: n, type: 'clipped-text', detail: '<' + tag + cls2 + '> text is clipped (' + el.scrollHeight + 'px content in ' + el.clientHeight + 'px box)' })
        }
        if (contrastChecked < 5) {
          var style = getComputedStyle(el)
          var fg = style.color
          if (fg && hasVisibleText(el)) {
            var fgRgb = parseRgb(fg)
            var bgColor = getAncestorBg(el)
            var bgRgb = parseRgb(bgColor)
            if (fgRgb && bgRgb) {
              var l1 = relativeLuminance(fgRgb[0], fgRgb[1], fgRgb[2])
              var l2 = relativeLuminance(bgRgb[0], bgRgb[1], bgRgb[2])
              var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
              if (ratio < 2.5) {
                contrastChecked++
                var tag3 = el.tagName.toLowerCase()
                var cls3 = typeof el.className === 'string' && el.className ? '.' + el.className.split(/\\s+/).join('.') : ''
                warnings.push({ slide: n, type: 'low-contrast', detail: '<' + tag3 + cls3 + '> contrast ratio ' + ratio.toFixed(1) + ':1 (fg ' + fg + ' on ' + bgColor + ')' })
              }
            }
          }
        }
      }
    })
    return { slideCount: slides.length, issues: issues, warnings: warnings }
  })()`
}

function resolveWorkspacePath(tools: ToolRegistry, relativePath: string): string {
  const workspace = tools.getWorkspacePath()
  if (!workspace) throw new Error('No workspace open')
  const root = resolve(workspace)
  const resolved = resolve(root, relativePath)
  const rel = relative(root, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path traversal outside workspace is not allowed')
  }
  return resolved
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string`)
  return value
}

function toSlashPath(path: string): string {
  return path.split('\\').join('/')
}
