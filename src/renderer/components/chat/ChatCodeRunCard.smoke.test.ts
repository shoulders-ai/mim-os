// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import ChatCodeRunCard from './ChatCodeRunCard.vue'

vi.mock('@tabler/icons-vue', () => ({
  IconPhoto: { template: '<span class="icon-photo" />' },
  IconFileTypePdf: { template: '<span class="icon-pdf" />' },
  IconTable: { template: '<span class="icon-table" />' },
  IconCode: { template: '<span class="icon-code" />' },
  IconFile: { template: '<span class="icon-file" />' },
  IconFileText: { template: '<span class="icon-text" />' },
}))

async function flush() {
  await Promise.resolve()
  await nextTick()
}

describe('ChatCodeRunCard (smoke)', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp>

  afterEach(() => {
    app?.unmount()
    root?.remove()
  })

  it('renders a successful run with the command line, green dot, duration, and product chips', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    const onOpenFile = vi.fn()
    app = createApp(ChatCodeRunCard, {
      part: {
        type: 'tool-bash',
        state: 'output-available',
        input: { command: 'Rscript analysis/fit.R' },
        output: {
          exitCode: 0,
          timedOut: false,
          durationMs: 4200,
          stdout: 'Done.\n',
          stderr: '',
          products: [
            { path: '/ws/.mim/code-runs/abc/plot.png', bytes: 32000, kind: 'image' },
          ],
          runId: 'abc',
        },
      },
      onOpenFile,
    })
    app.mount(root)
    await flush()

    // argv line visible
    expect(root.textContent).toContain('Rscript analysis/fit.R')
    // duration visible
    expect(root.textContent).toContain('4.2s')
    // product chip visible
    expect(root.textContent).toContain('plot.png')
    expect(root.textContent).toContain('31.3 KB')

    // Green dot rendered (success)
    const greenDot = root.querySelector('[title="Success"]')
    expect(greenDot).toBeTruthy()

    // Click product chip emits open-file
    const productBtn = [...root.querySelectorAll('button')].find(b => b.textContent?.includes('plot.png'))
    productBtn?.click()
    expect(onOpenFile).toHaveBeenCalledWith('/ws/.mim/code-runs/abc/plot.png')
  })

  it('renders a running state with spinner', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(ChatCodeRunCard, {
      part: {
        type: 'tool-bash',
        state: 'input-available',
        input: { command: 'quarto render report.qmd' },
      },
    })
    app.mount(root)
    await flush()

    expect(root.textContent).toContain('quarto render report.qmd')
    // spinner present (uses the cm-tool-spinner class)
    expect(root.querySelector('.cm-tool-spinner')).toBeTruthy()
  })

  it('renders a failed run with red dot', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(ChatCodeRunCard, {
      part: {
        type: 'tool-bash',
        state: 'output-available',
        input: { command: 'Rscript broken.R' },
        output: {
          exitCode: 1,
          timedOut: false,
          durationMs: 800,
          stdout: '',
          stderr: 'Error in source: unexpected end',
          products: [],
          runId: 'def',
        },
      },
    })
    app.mount(root)
    await flush()

    expect(root.querySelector('[title="Failed"]')).toBeTruthy()
  })

  it('expands output on click', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(ChatCodeRunCard, {
      part: {
        type: 'tool-bash',
        state: 'output-available',
        input: { command: 'Rscript run.R' },
        output: {
          exitCode: 0,
          timedOut: false,
          durationMs: 1500,
          stdout: 'some output here',
          stderr: '',
          products: [],
          runId: 'ghi',
        },
      },
    })
    app.mount(root)
    await flush()

    // output collapsed by default
    expect(root.textContent).not.toContain('some output here')

    // click header to expand
    const headerBtn = root.querySelector('button')
    headerBtn?.click()
    await flush()
    expect(root.textContent).toContain('some output here')
  })
})
