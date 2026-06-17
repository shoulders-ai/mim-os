import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildValidationScript, type RenderHtmlFileToPdfOptions, type SlideCapture, type SlideMetrics, type SlidePage } from '@main/tools/render.js'
import type { DocumentPdfRenderOptions } from '@main/export/exportPdfTypes.js'

const RENDER_TIMEOUT_MS = 45_000
const CAPTURE_WIDTH = 1024

// Electron boundary for render.htmlToPdf: load the deck in a hidden window,
// wait for fonts and images, run the layout validation script, then print via
// Chromium's PDF engine. Page size mirrors the template's .slide geometry so
// one slide maps to exactly one page.
export async function renderHtmlFileToPdf(
  absolutePath: string,
  page: SlidePage,
  options?: RenderHtmlFileToPdfOptions,
): Promise<{ pdf: Buffer; metrics: SlideMetrics; captures?: SlideCapture[] }> {
  const win = new BrowserWindow({
    show: false,
    width: page.widthPx,
    height: page.heightPx,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  })
  try {
    return await withTimeout(renderInWindow(win, absolutePath, page, options), RENDER_TIMEOUT_MS)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

async function renderInWindow(
  win: BrowserWindow,
  absolutePath: string,
  page: SlidePage,
  options?: RenderHtmlFileToPdfOptions,
): Promise<{ pdf: Buffer; metrics: SlideMetrics; captures?: SlideCapture[] }> {
  await win.loadFile(absolutePath)
  await win.webContents.executeJavaScript(
    `Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      ...Array.from(document.images, img => img.decode().catch(() => {})),
    ]).then(() => true)`,
    true,
  )
  const metrics = await win.webContents.executeJavaScript(buildValidationScript(page), true) as SlideMetrics
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: { width: page.widthIn, height: page.heightIn },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: false,
  })

  let captures: SlideCapture[] | undefined
  if (options?.captureSlides && metrics.slideCount > 0) {
    captures = await captureSlides(win, metrics.slideCount, page)
  }

  return { pdf, metrics, captures }
}

// Capture one image per slide: inject a style that hides all other slides and
// zeros the body padding/gap so the target slide sits at the viewport origin,
// resize the window to 1280x720, capture, then restore.
async function captureSlides(
  win: BrowserWindow,
  slideCount: number,
  page: SlidePage,
): Promise<SlideCapture[]> {
  const captures: SlideCapture[] = []

  // Inject isolation style element
  await win.webContents.executeJavaScript(`
    (() => {
      const style = document.createElement('style')
      style.id = '__mim_capture_style'
      document.head.appendChild(style)
    })()
  `, true)

  win.setContentSize(page.widthPx, page.heightPx)

  for (let i = 0; i < slideCount; i++) {
    const slideNum = i + 1
    // Set CSS to hide all slides except the target and zero body padding/gap
    await win.webContents.executeJavaScript(`
      (() => {
        const style = document.getElementById('__mim_capture_style')
        style.textContent = \`
          body { padding: 0 !important; gap: 0 !important; margin: 0 !important; }
          section.slide { display: none !important; }
          section.slide:nth-of-type(${slideNum}) { display: block !important; margin: 0 !important; }
        \`
      })()
    `, true)

    // Small delay for layout to settle
    await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', true)

    const nativeImage = await win.webContents.capturePage()
    const resized = nativeImage.resize({ width: CAPTURE_WIDTH })
    const jpeg = resized.toJPEG(80)
    captures.push({ slide: slideNum, image: Buffer.from(jpeg) })
  }

  // Remove the injected style
  await win.webContents.executeJavaScript(`
    (() => {
      const style = document.getElementById('__mim_capture_style')
      if (style) style.remove()
    })()
  `, true)

  return captures
}

// Electron boundary for document export (export.pdf): load a self-contained
// HTML string in a hidden window, wait for fonts and images, and print with
// explicit page geometry. The HTML goes through a temp file (not a data URI)
// so its <base href> still resolves relative image paths and large documents
// avoid data-URL size limits. Shares the slide pipeline's readiness wait and
// timeout discipline — one printToPDF boundary, two callers.
export async function renderDocumentHtmlToPdf(
  html: string,
  options: DocumentPdfRenderOptions,
): Promise<Buffer> {
  const tempPath = join(tmpdir(), `mim-export-${randomUUID()}.html`)
  writeFileSync(tempPath, html, 'utf-8')
  const win = new BrowserWindow({
    show: false,
    width: Math.round(options.pageWidthIn * 96),
    height: Math.round(options.pageHeightIn * 96),
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  })
  try {
    return await withTimeout(renderDocumentInWindow(win, tempPath, options), RENDER_TIMEOUT_MS)
  } finally {
    if (!win.isDestroyed()) win.destroy()
    rmSync(tempPath, { force: true })
  }
}

async function renderDocumentInWindow(
  win: BrowserWindow,
  htmlPath: string,
  options: DocumentPdfRenderOptions,
): Promise<Buffer> {
  await win.loadFile(htmlPath)
  await win.webContents.executeJavaScript(
    `Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      ...Array.from(document.images, img => img.decode().catch(() => {})),
    ]).then(() => true)`,
    true,
  )
  const mmToIn = (mm: number): number => mm / 25.4
  return win.webContents.printToPDF({
    printBackground: true,
    pageSize: { width: options.pageWidthIn, height: options.pageHeightIn },
    margins: {
      top: mmToIn(options.marginsMm.top),
      bottom: mmToIn(options.marginsMm.bottom),
      left: mmToIn(options.marginsMm.left),
      right: mmToIn(options.marginsMm.right),
    },
    preferCSSPageSize: false,
    ...(options.pageNumberAlign !== 'none'
      ? {
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          // Chromium scales the footer ~0.8× and adds its own page padding, so
          // the number never sits flush to the paper edge. left/right just shift
          // the text within that band.
          footerTemplate:
            `<div style="width:100%;text-align:${options.pageNumberAlign};font-size:8px;font-family:Helvetica,Arial,sans-serif;color:#4a4a45;padding:0 12mm;"><span class="pageNumber"></span></div>`,
        }
      : {}),
  })
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`PDF render timed out after ${ms / 1000}s`)), ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
