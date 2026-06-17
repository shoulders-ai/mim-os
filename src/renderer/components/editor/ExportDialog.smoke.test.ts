// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createPinia } from 'pinia'
import ExportDialog from './ExportDialog.vue'
import { useToastStore } from '../../stores/toasts.js'

const STYLES = {
  page_sizes: [{ id: 'a4', label: 'A4' }, { id: 'letter', label: 'US Letter' }],
  fonts: [{ id: 'satoshi', label: 'Satoshi (sans)' }, { id: 'lora', label: 'Lora (serif)' }],
  defaults: { page_size: 'a4', margin_cm: 2.5, font: 'satoshi', font_size_pt: 11 },
}

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('ExportDialog', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let pinia: ReturnType<typeof createPinia>
  let kernelCall: ReturnType<typeof vi.fn>
  let saveFileDialog: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    pinia = createPinia()
    kernelCall = vi.fn(async (tool: string) => {
      if (tool === 'export.styles') return STYLES
      if (tool === 'references.resolveBibliography') return { exists: false, path: 'references/references.bib', references: [] }
      if (tool === 'export.pdf') return { path: '/tmp/doc.pdf', format: 'pdf', pages: 2, bytes: 1000 }
      if (tool === 'export.docx') return { path: '/tmp/doc.docx', format: 'docx', bytes: 800 }
      throw new Error(`unexpected tool ${tool}`)
    })
    saveFileDialog = vi.fn(async () => '/tmp/doc.pdf')
    ;(window as unknown as { kernel: unknown }).kernel = {
      call: kernelCall,
      saveFileDialog,
      openFileDialog: vi.fn(async () => null),
      openNativeFile: vi.fn(async () => ({})),
      revealInFinder: vi.fn(async () => undefined),
    }
    // The test env's localStorage shim lacks Storage methods; install a real
    // in-memory one so option persistence code paths run.
    const data = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
        clear: () => data.clear(),
        key: () => null,
        get length() { return data.size },
      },
    })
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
  })

  function mount(props: Record<string, unknown> = {}) {
    app = createApp({
      setup: () => () => h(ExportDialog, {
        open: true,
        documentPath: 'docs/paper.md',
        documentName: 'paper.md',
        markdown: '# Paper\n\nBody.',
        ...props,
      }),
    })
    app.use(pinia)
    app.mount(root)
  }

  it('shows the essential controls and reveals the rest under Advanced', async () => {
    mount()
    await flushUi()
    expect(kernelCall).toHaveBeenCalledWith('export.styles')
    // Essentials are visible; advanced layout decisions stay folded by default.
    expect(document.body.textContent).toContain('Page size')
    expect(document.body.textContent).toContain('Body font')
    expect(document.body.textContent).toContain('Advanced')
    expect(document.body.textContent).not.toContain('Numbered headings')

    // Expanding Advanced reveals the layout controls.
    const advanced = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Advanced') as HTMLButtonElement
    expect(advanced).toBeTruthy()
    advanced.click()
    await flushUi()
    expect(document.body.textContent).toContain('Margins')
    expect(document.body.textContent).toContain('Numbered headings')
    expect(document.body.textContent).toContain('Page numbers')
  })

  it('renders format cards and runs an export — dialog closes, toast appears', async () => {
    mount()
    await flushUi()

    // Format cards are visible
    const formatGroup = document.querySelector('[role="radiogroup"][aria-label="Export format"]')
    expect(formatGroup?.textContent).toContain('PDF')
    expect(formatGroup?.textContent).toContain('Word')

    const runButton = document.querySelector('[data-testid="export-run"]') as HTMLButtonElement
    expect(runButton).toBeTruthy()
    runButton.click()
    await flushUi()

    expect(saveFileDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: 'docs/paper.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      allowAbsolutePath: true,
    }))
    const exportCall = kernelCall.mock.calls.find(call => call[0] === 'export.pdf')
    expect(exportCall).toBeTruthy()
    expect(exportCall![1]).toMatchObject({
      path: 'docs/paper.md',
      markdown: '# Paper\n\nBody.',
      output_path: '/tmp/doc.pdf',
      page_size: 'a4',
      margin_cm: 2.5,
      font: 'satoshi',
      justify: true,
      page_number_position: 'none',
    })

    // Success → closes dialog and pushes toast (not rendered in body)
    const toasts = useToastStore(pinia)
    expect(toasts.list.length).toBe(1)
    expect(toasts.list[0].kind).toBe('info')
    expect(toasts.list[0].message).toContain('doc.pdf')
    expect(toasts.list[0].message).toContain('2 page')
    expect(toasts.list[0].actionLabel).toBe('Open')
  })

  it('cancelling the save dialog leaves the dialog idle', async () => {
    saveFileDialog.mockResolvedValueOnce(null)
    mount()
    await flushUi()
    ;(document.querySelector('[data-testid="export-run"]') as HTMLButtonElement).click()
    await flushUi()
    expect(kernelCall.mock.calls.some(call => call[0] === 'export.pdf')).toBe(false)
    expect(document.body.textContent).toContain('Export PDF')
  })

  it('shows the bibliography section only when the document cites', async () => {
    mount({ markdown: 'No citations here.' })
    await flushUi()
    expect(document.body.textContent).not.toContain('Citations')
    app!.unmount()
    root.innerHTML = ''
    mount({ markdown: 'See [@smith2020].' })
    await flushUi()
    expect(document.body.textContent).toContain('Citations')
  })

  it('exports citations against the shared bibliography resolver', async () => {
    kernelCall.mockImplementation(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'export.styles') return STYLES
      if (tool === 'references.resolveBibliography') {
        expect(params).toMatchObject({
          path: 'docs/paper.md',
          markdown: 'Known [@smith2020]. Unknown [@missing].',
        })
        return { exists: true, path: 'references/references.bib', references: [] }
      }
      if (tool === 'export.pdf') return { path: '/tmp/doc.pdf', format: 'pdf', pages: 2, bytes: 1000, params }
      throw new Error(`unexpected tool ${tool}`)
    })
    mount({ markdown: 'Known [@smith2020]. Unknown [@missing].' })
    await flushUi()

    ;(document.querySelector('[data-testid="export-run"]') as HTMLButtonElement).click()
    await flushUi()

    const exportCall = kernelCall.mock.calls.find(call => call[0] === 'export.pdf')
    expect(exportCall?.[1]).toMatchObject({
      bibtex_path: 'references/references.bib',
      citation_style: 'apa',
    })
  })

  it('surfaces export errors inline', async () => {
    kernelCall.mockImplementation(async (tool: string) => {
      if (tool === 'export.styles') return STYLES
      if (tool === 'references.resolveBibliography') return { exists: false, path: 'references/references.bib', references: [] }
      throw new Error('render exploded')
    })
    mount()
    await flushUi()
    ;(document.querySelector('[data-testid="export-run"]') as HTMLButtonElement).click()
    await flushUi()
    expect(document.body.textContent).toContain('render exploded')
  })
})
