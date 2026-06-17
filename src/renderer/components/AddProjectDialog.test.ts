// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import AddProjectDialog from './AddProjectDialog.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountDialog(mode: 'new' | 'clone' = 'new') {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(AddProjectDialog, { mode })
  app.mount(root)
  return { app, root }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
    .find(candidate => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Missing button: ${text}`)
  return button
}

describe('AddProjectDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('keeps new-folder parent and folder-name text left aligned after parent selection', async () => {
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
        openFolderDialog: vi.fn(async () => '/Users/test/Projects'),
      },
    })
    const { app } = mountDialog('new')
    await flushUi()

    buttonByText('Browse').click()
    await flushUi()

    const parentLabel = document.body.querySelector<HTMLElement>('[title="/Users/test/Projects"]')
    const folderName = document.body.querySelector<HTMLInputElement>('input[placeholder="my-research-paper"]')

    expect(parentLabel?.className).toContain('text-left')
    expect(parentLabel?.className).toContain('[direction:ltr]')
    expect(parentLabel?.className).not.toContain('[direction:rtl]')
    expect(folderName?.className).toContain('text-left')
    expect(folderName?.className).toContain('[direction:ltr]')
    expect(folderName?.className).not.toContain('[direction:rtl]')

    app.unmount()
  })
})
