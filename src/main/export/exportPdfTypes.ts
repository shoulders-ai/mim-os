// Contract between the export tools (electron-free, testable) and the
// hidden-window printToPDF boundary in src/main/htmlPdf.ts.

export type PageNumberAlign = 'none' | 'left' | 'center' | 'right'

export interface DocumentPdfRenderOptions {
  pageWidthIn: number
  pageHeightIn: number
  marginsMm: { top: number; right: number; bottom: number; left: number }
  /** Where to render page numbers in the bottom margin; 'none' omits them. */
  pageNumberAlign: PageNumberAlign
}

export type RenderDocumentHtmlToPdf = (
  html: string,
  options: DocumentPdfRenderOptions,
) => Promise<Buffer>
