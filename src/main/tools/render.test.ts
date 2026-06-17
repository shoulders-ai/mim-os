import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTraceLog } from '@main/trace/trace.js'
import { createToolRegistry } from '@main/tools/registry.js'
import {
  buildRenderReport,
  buildValidationScript,
  countPdfPages,
  registerRenderTools,
  resolveOutputPath,
  SLIDE_PAGE,
  wipeCapturesDir,
  type CaptureEntry,
  type RenderHtmlFileToPdfOptions,
  type SlideCapture,
  type SlideMetrics,
  type SlideRenderIssue,
} from './render.js'

const ctx = { actor: 'user' as const }

function fakeRender(
  metrics: SlideMetrics,
  pdf = Buffer.from('%PDF-fake'),
  captures?: SlideCapture[],
) {
  return vi.fn(async (_path: string, _page: unknown, options?: RenderHtmlFileToPdfOptions) => ({
    pdf,
    metrics,
    captures: options?.captureSlides ? captures : undefined,
  }))
}

const cleanMetrics: SlideMetrics = { slideCount: 3, issues: [], warnings: [] }

function pdfWithPages(count: number): Buffer {
  const objects = Array.from({ length: count }, (_, i) => `${i + 10} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj`)
  return Buffer.from(`%PDF-1.4\n<< /Type /Pages /Count ${count} >>\n${objects.join('\n')}`)
}

describe('render tools', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-render-tools-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    writeFileSync(join(dir, 'deck.html'), '<html><section class="slide"></section></html>')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('declares inputSchema and never parameters', () => {
    registerRenderTools(tools, { render: fakeRender(cleanMetrics) })
    const def = tools.get('render.htmlToPdf')
    expect(def).toBeDefined()
    expect(def!.inputSchema).toBeDefined()
    expect((def as unknown as Record<string, unknown>).parameters).toBeUndefined()
  })

  it('throws "No workspace open" when no workspace is set', async () => {
    const detached = createToolRegistry(createTraceLog())
    registerRenderTools(detached, { render: fakeRender(cleanMetrics) })
    await expect(detached.call('render.htmlToPdf', { path: 'deck.html' }, ctx)).rejects.toThrow('No workspace open')
  })

  it('rejects path traversal outside the workspace', async () => {
    registerRenderTools(tools, { render: fakeRender(cleanMetrics) })
    await expect(tools.call('render.htmlToPdf', { path: '../escape.html' }, ctx)).rejects.toThrow('outside workspace')
  })

  it('rejects non-HTML input files', async () => {
    registerRenderTools(tools, { render: fakeRender(cleanMetrics) })
    writeFileSync(join(dir, 'notes.md'), '# notes')
    await expect(tools.call('render.htmlToPdf', { path: 'notes.md' }, ctx)).rejects.toThrow('HTML')
  })

  it('reports a missing HTML file cleanly', async () => {
    registerRenderTools(tools, { render: fakeRender(cleanMetrics) })
    await expect(tools.call('render.htmlToPdf', { path: 'absent.html' }, ctx)).rejects.toThrow('not found')
  })

  it('throws when no render boundary is available (headless runtime)', async () => {
    registerRenderTools(tools, {})
    await expect(tools.call('render.htmlToPdf', { path: 'deck.html' }, ctx)).rejects.toThrow('not available')
  })

  it('renders next to the source by default and returns a clean report', async () => {
    const render = fakeRender(cleanMetrics, pdfWithPages(3))
    registerRenderTools(tools, { render })
    const result = await tools.call('render.htmlToPdf', { path: 'deck.html' }, ctx) as Record<string, unknown>

    expect(render).toHaveBeenCalledWith(join(dir, 'deck.html'), SLIDE_PAGE, { captureSlides: false })
    expect(result.ok).toBe(true)
    expect(result.pdf_path).toBe('deck.pdf')
    expect(result.slide_count).toBe(3)
    expect(result.page_count).toBe(3)
    expect(result.issues).toEqual([])
    expect(result.warnings).toEqual([])
    expect(readFileSync(join(dir, 'deck.pdf'), 'utf-8')).toContain('%PDF')
  })

  it('honors output_path and creates parent directories', async () => {
    registerRenderTools(tools, { render: fakeRender(cleanMetrics, pdfWithPages(3)) })
    const result = await tools.call(
      'render.htmlToPdf',
      { path: 'deck.html', output_path: 'exports/decks/deck.pdf' },
      ctx,
    ) as Record<string, unknown>

    expect(result.pdf_path).toBe('exports/decks/deck.pdf')
    expect(existsSync(join(dir, 'exports', 'decks', 'deck.pdf'))).toBe(true)
  })

  it('passes layout issues through and flags ok=false', async () => {
    const metrics: SlideMetrics = {
      slideCount: 2,
      issues: [{ slide: 2, type: 'overflow-y', detail: 'content is 86px taller than the slide' }],
      warnings: [],
    }
    registerRenderTools(tools, { render: fakeRender(metrics, pdfWithPages(2)) })
    const result = await tools.call('render.htmlToPdf', { path: 'deck.html' }, ctx) as Record<string, unknown>

    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(metrics.issues)
  })

  it('includes warnings in the result without affecting ok', async () => {
    const metrics: SlideMetrics = {
      slideCount: 2,
      issues: [],
      warnings: [{ slide: 1, type: 'clipped-text', detail: '<p> text is clipped (200px content in 100px box)' }],
    }
    registerRenderTools(tools, { render: fakeRender(metrics, pdfWithPages(2)) })
    const result = await tools.call('render.htmlToPdf', { path: 'deck.html' }, ctx) as Record<string, unknown>

    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual(metrics.warnings)
  })

  it('exposes capture_slides in the inputSchema', () => {
    registerRenderTools(tools, { render: fakeRender(cleanMetrics) })
    const def = tools.get('render.htmlToPdf')!
    const props = (def.inputSchema as Record<string, unknown>).properties as Record<string, unknown>
    expect(props.capture_slides).toEqual({ type: 'boolean', description: expect.any(String) })
  })
})

describe('capture_slides', () => {
  let dir: string
  let tools: ReturnType<typeof createToolRegistry>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-render-capture-'))
    tools = createToolRegistry(createTraceLog())
    tools.setWorkspacePath(dir)
    writeFileSync(join(dir, 'deck.html'), '<html><section class="slide"></section></html>')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('does not capture when capture_slides is false or absent', async () => {
    const render = fakeRender(cleanMetrics, pdfWithPages(3))
    registerRenderTools(tools, { render })
    const result = await tools.call('render.htmlToPdf', { path: 'deck.html' }, ctx) as Record<string, unknown>

    expect(result.captures).toBeUndefined()
    expect(render).toHaveBeenCalledWith(join(dir, 'deck.html'), SLIDE_PAGE, { captureSlides: false })
  })

  it('passes captureSlides option through to the boundary', async () => {
    const captures: SlideCapture[] = [
      { slide: 1, image: Buffer.from('jpg1') },
      { slide: 2, image: Buffer.from('jpg2') },
    ]
    const render = fakeRender(
      { slideCount: 2, issues: [], warnings: [] },
      pdfWithPages(2),
      captures,
    )
    registerRenderTools(tools, { render })
    await tools.call('render.htmlToPdf', { path: 'deck.html', capture_slides: true }, ctx)

    expect(render).toHaveBeenCalledWith(join(dir, 'deck.html'), SLIDE_PAGE, { captureSlides: true })
  })

  it('writes capture images to captures/ directory with zero-padded 1-based names', async () => {
    const captures: SlideCapture[] = [
      { slide: 1, image: Buffer.from('jpeg-data-1') },
      { slide: 2, image: Buffer.from('jpeg-data-2') },
      { slide: 3, image: Buffer.from('jpeg-data-3') },
    ]
    const render = fakeRender(
      { slideCount: 3, issues: [], warnings: [] },
      pdfWithPages(3),
      captures,
    )
    registerRenderTools(tools, { render })
    const result = await tools.call('render.htmlToPdf', { path: 'deck.html', capture_slides: true }, ctx) as Record<string, unknown>

    const capturesDir = join(dir, 'captures')
    expect(existsSync(capturesDir)).toBe(true)
    expect(readFileSync(join(capturesDir, 'slide-01.jpg'), 'utf-8')).toBe('jpeg-data-1')
    expect(readFileSync(join(capturesDir, 'slide-02.jpg'), 'utf-8')).toBe('jpeg-data-2')
    expect(readFileSync(join(capturesDir, 'slide-03.jpg'), 'utf-8')).toBe('jpeg-data-3')

    const entries = result.captures as CaptureEntry[]
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({ slide: 1, path: 'captures/slide-01.jpg' })
    expect(entries[1]).toEqual({ slide: 2, path: 'captures/slide-02.jpg' })
    expect(entries[2]).toEqual({ slide: 3, path: 'captures/slide-03.jpg' })
  })

  it('returns workspace-relative slash paths for captures in subdirectories', async () => {
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'deck.html'), '<html></html>')
    const captures: SlideCapture[] = [{ slide: 1, image: Buffer.from('img') }]
    const render = fakeRender(
      { slideCount: 1, issues: [], warnings: [] },
      pdfWithPages(1),
      captures,
    )
    registerRenderTools(tools, { render })
    const result = await tools.call('render.htmlToPdf', { path: 'sub/deck.html', capture_slides: true }, ctx) as Record<string, unknown>

    const entries = result.captures as CaptureEntry[]
    expect(entries[0].path).toBe('sub/captures/slide-01.jpg')
    expect(existsSync(join(dir, 'sub', 'captures', 'slide-01.jpg'))).toBe(true)
  })

  it('wipes stale captures before writing new ones', async () => {
    // Pre-create a stale capture
    const capturesDir = join(dir, 'captures')
    mkdirSync(capturesDir, { recursive: true })
    writeFileSync(join(capturesDir, 'slide-01.jpg'), 'stale')
    writeFileSync(join(capturesDir, 'slide-02.jpg'), 'stale')
    writeFileSync(join(capturesDir, 'slide-03.jpg'), 'stale')

    const captures: SlideCapture[] = [{ slide: 1, image: Buffer.from('fresh') }]
    const render = fakeRender(
      { slideCount: 1, issues: [], warnings: [] },
      pdfWithPages(1),
      captures,
    )
    registerRenderTools(tools, { render })
    await tools.call('render.htmlToPdf', { path: 'deck.html', capture_slides: true }, ctx)

    expect(readFileSync(join(capturesDir, 'slide-01.jpg'), 'utf-8')).toBe('fresh')
    expect(existsSync(join(capturesDir, 'slide-02.jpg'))).toBe(false)
    expect(existsSync(join(capturesDir, 'slide-03.jpg'))).toBe(false)
  })

  it('does not include captures in result when boundary returns no captures', async () => {
    const render = fakeRender(cleanMetrics, pdfWithPages(3), undefined)
    registerRenderTools(tools, { render })
    const result = await tools.call('render.htmlToPdf', { path: 'deck.html', capture_slides: true }, ctx) as Record<string, unknown>

    expect(result.captures).toBeUndefined()
  })

  it('does not include captures in result when boundary returns empty captures', async () => {
    const render = fakeRender(cleanMetrics, pdfWithPages(3), [])
    registerRenderTools(tools, { render })
    const result = await tools.call('render.htmlToPdf', { path: 'deck.html', capture_slides: true }, ctx) as Record<string, unknown>

    expect(result.captures).toBeUndefined()
  })
})

describe('buildRenderReport', () => {
  it('flags a deck with no slide sections', () => {
    const report = buildRenderReport({ slideCount: 0, issues: [], warnings: [] }, 1)
    expect(report.ok).toBe(false)
    expect(report.issues[0].type).toBe('no-slides')
  })

  it('flags a page-count mismatch (content bleeding onto extra pages)', () => {
    const report = buildRenderReport({ slideCount: 4, issues: [], warnings: [] }, 6)
    expect(report.ok).toBe(false)
    expect(report.issues[0].type).toBe('page-count-mismatch')
    expect(report.issues[0].detail).toContain('4 slides')
    expect(report.issues[0].detail).toContain('6 pages')
  })

  it('skips the page-count check when the count is unknown', () => {
    const report = buildRenderReport({ slideCount: 4, issues: [], warnings: [] }, 0)
    expect(report.ok).toBe(true)
  })

  it('threads warnings through without affecting ok', () => {
    const warnings: SlideRenderIssue[] = [
      { slide: 1, type: 'clipped-text', detail: '<p> text is clipped' },
      { slide: 2, type: 'low-contrast', detail: '<span> contrast ratio 1.8:1' },
    ]
    const report = buildRenderReport({ slideCount: 4, issues: [], warnings }, 4)
    expect(report.ok).toBe(true)
    expect(report.warnings).toEqual(warnings)
  })

  it('handles missing warnings field gracefully (backwards compat)', () => {
    const metrics = { slideCount: 3, issues: [] } as SlideMetrics
    const report = buildRenderReport(metrics, 3)
    expect(report.ok).toBe(true)
    expect(report.warnings).toEqual([])
  })

  it('ok is false with issues even when warnings exist', () => {
    const report = buildRenderReport({
      slideCount: 2,
      issues: [{ slide: 1, type: 'overflow-y', detail: 'too tall' }],
      warnings: [{ slide: 1, type: 'clipped-text', detail: 'clipped' }],
    }, 2)
    expect(report.ok).toBe(false)
    expect(report.issues).toHaveLength(1)
    expect(report.warnings).toHaveLength(1)
  })
})

describe('resolveOutputPath', () => {
  it('swaps .html and .htm for .pdf', () => {
    expect(resolveOutputPath('slides/deck.html')).toBe('slides/deck.pdf')
    expect(resolveOutputPath('a/b.htm')).toBe('a/b.pdf')
  })

  it('appends .pdf otherwise', () => {
    expect(resolveOutputPath('slides/deck')).toBe('slides/deck.pdf')
  })
})

describe('countPdfPages', () => {
  it('counts page objects in a Chromium-style PDF', () => {
    expect(countPdfPages(pdfWithPages(5))).toBe(5)
  })

  it('returns 0 when nothing matches', () => {
    expect(countPdfPages(Buffer.from('garbage'))).toBe(0)
  })
})

describe('buildValidationScript', () => {
  it('embeds the expected slide geometry', () => {
    const script = buildValidationScript(SLIDE_PAGE)
    expect(script).toContain('1280')
    expect(script).toContain('720')
    expect(script).toContain('section.slide')
    expect(script).toContain('data-bleed')
  })

  it('includes clipped-text detection', () => {
    const script = buildValidationScript(SLIDE_PAGE)
    expect(script).toContain('clipped-text')
    expect(script).toContain('scrollHeight')
    expect(script).toContain('hasVisibleText')
  })

  it('includes low-contrast detection with WCAG luminance', () => {
    const script = buildValidationScript(SLIDE_PAGE)
    expect(script).toContain('low-contrast')
    expect(script).toContain('relativeLuminance')
    expect(script).toContain('2.5')
  })

  it('returns warnings array separate from issues', () => {
    const script = buildValidationScript(SLIDE_PAGE)
    expect(script).toContain('warnings')
    // The return statement includes both
    expect(script).toContain('issues: issues')
    expect(script).toContain('warnings: warnings')
  })
})

describe('wipeCapturesDir', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mim-wipe-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('removes .jpg files from the directory', () => {
    const capturesDir = join(dir, 'captures')
    mkdirSync(capturesDir)
    writeFileSync(join(capturesDir, 'slide-01.jpg'), 'old')
    writeFileSync(join(capturesDir, 'slide-02.jpg'), 'old')

    wipeCapturesDir(capturesDir)

    expect(existsSync(join(capturesDir, 'slide-01.jpg'))).toBe(false)
    expect(existsSync(join(capturesDir, 'slide-02.jpg'))).toBe(false)
  })

  it('preserves non-jpg files', () => {
    const capturesDir = join(dir, 'captures')
    mkdirSync(capturesDir)
    writeFileSync(join(capturesDir, 'notes.txt'), 'keep')
    writeFileSync(join(capturesDir, 'slide-01.jpg'), 'remove')

    wipeCapturesDir(capturesDir)

    expect(existsSync(join(capturesDir, 'notes.txt'))).toBe(true)
    expect(existsSync(join(capturesDir, 'slide-01.jpg'))).toBe(false)
  })

  it('is a no-op when the directory does not exist', () => {
    expect(() => wipeCapturesDir(join(dir, 'nonexistent'))).not.toThrow()
  })
})
