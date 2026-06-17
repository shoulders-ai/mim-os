// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import PackageRunView from './PackageRunView.vue'
import type { PackageRunRecord } from '../../stores/runs.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

function packageRun(overrides: Partial<PackageRunRecord> = {}): PackageRunRecord {
  return {
    runId: 'run-1',
    packageId: 'docx-review',
    jobId: 'review',
    status: 'running',
    inputs: { path: 'docs/review-me.docx' },
    startedAt: '2026-01-01T00:00:00.000Z',
    result: {
      reportPath: 'reports/review.md',
      reviewedDocxPath: 'out/reviewed.docx',
      summary: 'Done',
    },
    events: [
      {
        type: 'job.started',
        packageId: 'docx-review',
        jobId: 'review',
        runId: 'run-1',
        ts: '2026-01-01T00:00:00.000Z',
        sequence: 1,
        data: { label: 'Review document' },
      },
      {
        type: 'job.progress',
        packageId: 'docx-review',
        jobId: 'review',
        runId: 'run-1',
        ts: '2026-01-01T00:00:10.000Z',
        sequence: 2,
        data: { label: 'Reading document', value: 0.5 },
      },
    ],
    ...overrides,
  }
}

describe('PackageRunView', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null
  let call: ReturnType<typeof vi.fn>
  let on: ReturnType<typeof vi.fn>
  let off: ReturnType<typeof vi.fn>

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    call = vi.fn(async (tool: string, params: Record<string, unknown>) => {
      if (tool === 'package.jobs.get') return { run: packageRun({ runId: params.runId as string }) }
      if (tool === 'package.jobs.cancel') return { ok: true }
      if (tool === 'editor.open') return { opened: params.path }
      if (tool === 'fs.openNative') return { opened: params.path }
      throw new Error(`Unexpected tool: ${tool}`)
    })
    on = vi.fn()
    off = vi.fn()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on, off },
    })
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders a readable run receipt with first-class result files', async () => {
    app = createApp({
      render: () => h(PackageRunView, {
        packageId: 'docx-review',
        runId: 'run-1',
        packages: [{
          manifest: { id: 'docx-review', name: 'Document Review', icon: 'D' },
          dir: '/packages/docx-review',
          source: 'global',
        }],
      }),
    })
    app.mount(root)
    await flushUi()

    expect(call).toHaveBeenCalledWith('package.jobs.get', { runId: 'run-1' })
    expect(on).toHaveBeenCalledWith('package:job:event', expect.any(Function))
    expect(root.querySelector('[data-testid="package-run-view"]')).toBeTruthy()
    expect(root.textContent).toContain('Review document')
    expect(root.textContent).toContain('Reading document 50%')
    expect(root.textContent).toContain('Result files')
    expect(root.textContent).toContain('Reviewed Word document')
    expect(root.textContent).toContain('Peer review report')
    expect(root.textContent).toContain('Progress')
    expect(root.textContent).toContain('Technical details')
    expect(root.textContent).toContain('Raw result')

    const openButtons = [...root.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => button.textContent?.includes('Open'))
    expect(openButtons).toHaveLength(2)

    openButtons[0].click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('fs.openNative', { path: 'out/reviewed.docx' })

    openButtons[1].click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('editor.open', { path: 'reports/review.md' })
  })

  it('renders persisted slide deck outputs when a completed run is reopened', async () => {
    call.mockImplementation(async (tool: string, params: Record<string, unknown>) => {
      if (tool === 'package.jobs.get') {
        return {
          run: packageRun({
            runId: params.runId as string,
            packageId: 'slides',
            jobId: 'generateDeck',
            status: 'completed',
            inputs: {
              brief: 'Quarterly deck',
              references: [{ role: 'source', path: 'reports/q2.md' }],
            },
            result: {
              status: 'complete',
              pdfPath: 'slides/quarterly/deck.pdf',
              htmlPath: 'slides/quarterly/deck.html',
              planPath: 'slides/quarterly/deck-plan.json',
              outputs: [
                {
                  kind: 'pdf',
                  label: 'Deck PDF',
                  path: 'slides/quarterly/deck.pdf',
                  description: 'Rendered slide deck PDF.',
                  action: 'Open PDF',
                  openWith: 'native',
                },
                {
                  kind: 'html',
                  label: 'Deck HTML',
                  path: 'slides/quarterly/deck.html',
                  description: 'Paginated deck source.',
                  action: 'Open in editor',
                  openWith: 'editor',
                },
              ],
            },
          }),
        }
      }
      if (tool === 'editor.open') return { opened: params.path }
      if (tool === 'fs.openNative') return { opened: params.path }
      throw new Error(`Unexpected tool: ${tool}`)
    })

    app = createApp({
      render: () => h(PackageRunView, {
        packageId: 'slides',
        runId: 'run-1',
        packages: [{
          manifest: { id: 'slides', name: 'Slides', icon: 'S' },
          dir: '/workspace/packages/slides',
          source: 'workspace',
        }],
      }),
    })
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Result files')
    expect(root.textContent).toContain('Deck PDF')
    expect(root.textContent).toContain('Deck HTML')
    expect(root.textContent).toContain('Deck plan')

    const openPdf = [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Open PDF'))
    const openHtml = [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Open in editor'))
    expect(openPdf).toBeTruthy()
    expect(openHtml).toBeTruthy()

    openPdf?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('fs.openNative', { path: 'slides/quarterly/deck.pdf' })

    openHtml?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('editor.open', { path: 'slides/quarterly/deck.html' })
  })

  it('promotes a plain outputPath result into an openable result file', async () => {
    call.mockImplementation(async (tool: string, params: Record<string, unknown>) => {
      if (tool === 'package.jobs.get') {
        return {
          run: packageRun({
            runId: params.runId as string,
            packageId: 'import-md',
            jobId: 'importMarkdown',
            status: 'completed',
            inputs: { path: 'docx-demo.docx', output_path: 'imports/docx-demo.md' },
            result: {
              sourcePath: 'docx-demo.docx',
              outputPath: 'imports/docx-demo.md',
              format: 'docx',
              fidelity: 'fallbacks',
              warnings: ['Footnotes or endnotes were detected; placement may be imperfect.'],
              stats: { characters: 28939 },
            },
          }),
        }
      }
      if (tool === 'editor.open') return { opened: params.path }
      throw new Error(`Unexpected tool: ${tool}`)
    })

    app = createApp({
      render: () => h(PackageRunView, {
        packageId: 'import-md',
        runId: 'run-1',
        packages: [{
          manifest: { id: 'import-md', name: 'Import to Markdown', icon: 'MD' },
          dir: '/home/test/.mim/packages/import-md/0.1.1',
          source: 'global',
        }],
      }),
    })
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('Result files')
    expect(root.textContent).toContain('Markdown file')
    expect(root.textContent).toContain('imports/docx-demo.md')
    expect(root.textContent).toContain('AI-ready Markdown output.')

    const openMarkdown = [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('Open in editor'))
    expect(openMarkdown).toBeTruthy()

    openMarkdown?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('editor.open', { path: 'imports/docx-demo.md' })
  })

  it('keeps cancellation available for running jobs', async () => {
    app = createApp({
      render: () => h(PackageRunView, {
        packageId: 'docx-review',
        runId: 'run-1',
        packages: [{
          manifest: { id: 'docx-review', name: 'Document Review', icon: 'D' },
          dir: '/packages/docx-review',
          source: 'global',
        }],
      }),
    })
    app.mount(root)
    await flushUi()

    root.querySelector<HTMLButtonElement>('button[title="Cancel run"]')?.click()
    await flushUi()
    expect(call).toHaveBeenCalledWith('package.jobs.cancel', { runId: 'run-1' })
  })

  it('updates elapsed time without a manual refresh', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'))

    app = createApp({
      render: () => h(PackageRunView, {
        packageId: 'docx-review',
        runId: 'run-1',
        packages: [{
          manifest: { id: 'docx-review', name: 'Document Review', icon: 'D' },
          dir: '/packages/docx-review',
          source: 'global',
        }],
      }),
    })
    app.mount(root)
    await flushUi()

    expect(root.textContent).toContain('running 5s')

    vi.advanceTimersByTime(3000)
    await flushUi()

    expect(root.textContent).toContain('running 8s')
  })
})
