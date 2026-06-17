// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import FileCardArtifact from './FileCardArtifact.vue'

const docxEntry = {
  path: 'docs/proposal.docx',
  name: 'proposal.docx',
  type: 'file',
  size: 48000,
  modifiedAt: '2026-05-31T15:00:00.000Z',
  createdAt: '2026-05-20T08:00:00.000Z',
  lastChangedBy: 'Ben',
}

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountCard(path: string) {
  const appRoot = document.createElement('div')
  document.body.appendChild(appRoot)
  const app = createApp(FileCardArtifact, { path })
  app.mount(appRoot)
  return { app, root: appRoot }
}

describe('FileCardArtifact', () => {
  let mounted: ReturnType<typeof mountCard> | null = null
  let call: ReturnType<typeof vi.fn>
  let openNativeFile: ReturnType<typeof vi.fn>

  beforeEach(() => {
    call = vi.fn(async (name: string) => {
      if (name === 'fs.list') return { entries: [docxEntry] }
      throw new Error(`Unexpected kernel call ${name}`)
    })
    openNativeFile = vi.fn(async () => undefined)
    ;(window as { kernel?: unknown }).kernel = {
      call,
      openNativeFile,
      revealInFinder: vi.fn(),
    }
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
  })

  it('shows file metadata and a Word-specific open action for docx', async () => {
    mounted = mountCard('docs/proposal.docx')
    await flushUi()

    expect(call).toHaveBeenCalledWith('fs.list', { path: 'docs', include_last_changed_by: true })
    const text = mounted.root.textContent ?? ''
    expect(text).toContain('proposal.docx')
    expect(text).toContain('Word')
    expect(text).toContain('Ben')

    const openButton = Array.from(mounted.root.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Open in Microsoft Word'))!
    openButton.click()
    await flushUi()
    expect(openNativeFile).toHaveBeenCalledWith('docs/proposal.docx')
  })

  it('reports when the file is missing from the workspace listing', async () => {
    mounted = mountCard('docs/gone.docx')
    await flushUi()

    expect(mounted.root.textContent).toContain('File not found in workspace.')
  })
})
