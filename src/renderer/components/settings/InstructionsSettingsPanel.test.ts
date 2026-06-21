// @vitest-environment happy-dom

// InstructionsSettingsPanel: workspace contract (AGENTS.md) editor with
// explicit save, restore-default, and template variable annotation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import InstructionsSettingsPanel from './InstructionsSettingsPanel.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

describe('InstructionsSettingsPanel', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null
  let call: ReturnType<typeof vi.fn>
  const AGENTS_CONTENT = '# Agent Instructions\n\nCustom workspace rules here.\n'

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    app = null

    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'fs.read') return { content: AGENTS_CONTENT }
      if (tool === 'fs.write') return { ok: true }
      if (tool === 'workspace.defaultAgentsMd') return { content: '# Default\n' }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn(), getWorkspace: vi.fn(async () => '/workspace') },
    })
  })

  afterEach(() => {
    app?.unmount()
    app = null
    root.remove()
    vi.restoreAllMocks()
  })

  function mount() {
    app = createApp(InstructionsSettingsPanel)
    app.mount(root)
  }

  it('loads and displays AGENTS.md content', async () => {
    mount()
    await flushUi()

    const textarea = root.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).toBeTruthy()
    expect(textarea!.value).toBe(AGENTS_CONTENT)
    expect(call).toHaveBeenCalledWith('fs.read', expect.objectContaining({ path: 'AGENTS.md', full: true }))
  })

  it('shows the description text', async () => {
    mount()
    await flushUi()

    expect(root.textContent).toContain('AGENTS.md')
  })

  it('shows Restore default button', async () => {
    mount()
    await flushUi()

    const button = root.querySelector('[data-testid="restore-default-btn"]')
    expect(button).toBeTruthy()
    expect(button!.textContent?.trim()).toContain('Restore default')
  })

  it('shows Save button when content has changed', async () => {
    mount()
    await flushUi()

    // No save button when content matches saved state.
    expect(root.querySelector('[data-testid="save-btn"]')).toBeNull()

    // Change textarea value.
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!
    textarea.value = '# Modified content\n'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    const saveBtn = root.querySelector('[data-testid="save-btn"]')
    expect(saveBtn).toBeTruthy()
    expect(saveBtn!.textContent?.trim()).toBe('Save')
  })

  it('hides Save button when content matches saved state', async () => {
    mount()
    await flushUi()

    expect(root.querySelector('[data-testid="save-btn"]')).toBeNull()
  })

  it('saves when Save button is clicked', async () => {
    mount()
    await flushUi()

    const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!
    const newContent = '# Updated instructions\n'
    textarea.value = newContent
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    const saveBtn = root.querySelector<HTMLButtonElement>('[data-testid="save-btn"]')!
    expect(saveBtn).toBeTruthy()
    saveBtn.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('fs.write', { path: 'AGENTS.md', content: newContent })
  })

  it('shows template variable annotation', async () => {
    mount()
    await flushUi()

    const annotation = root.querySelector('[data-testid="template-vars-annotation"]')
    expect(annotation).toBeTruthy()
    expect(annotation!.textContent).toContain('{{DATE_TODAY}}')
    expect(annotation!.textContent).toContain('{{TOOL_SET}}')
  })

  it('shows default content and Save button when AGENTS.md does not exist', async () => {
    call = vi.fn(async (tool: string) => {
      if (tool === 'fs.read') throw new Error('File not found')
      if (tool === 'fs.write') return { ok: true }
      if (tool === 'workspace.defaultAgentsMd') return { content: '# Default\n' }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })

    mount()
    await flushUi()

    const textarea = root.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).toBeTruthy()
    expect(textarea!.value).toBe('# Default\n')

    const saveBtn = root.querySelector('[data-testid="save-btn"]')
    expect(saveBtn).toBeTruthy()
  })
})
