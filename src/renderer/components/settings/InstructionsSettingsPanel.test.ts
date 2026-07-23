// @vitest-environment happy-dom

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

  beforeEach(() => {
    root = document.createElement('div')
    document.body.appendChild(root)
    app = null
    call = vi.fn(async (tool: string, params?: Record<string, unknown>) => {
      if (tool === 'instruction.list') {
        return {
          instructions: [
            { origin: 'personal', label: 'You', editorPath: '.mim/origins/you/instructions.md', writable: true },
            { origin: 'team', label: 'Shoulders', editorPath: '.mim/team/instructions.md', writable: true },
            { origin: 'project', label: 'Alpha', editorPath: 'AGENTS.md', writable: true },
            { origin: 'mim', label: 'Mim', editorPath: '.mim/origins/mim/instructions.md', writable: false },
          ],
        }
      }
      if (tool === 'instruction.open') {
        const origin = params?.origin as string
        const paths: Record<string, string> = {
          personal: '.mim/origins/you/instructions.md',
          team: '.mim/team/instructions.md',
          project: 'AGENTS.md',
          mim: '.mim/origins/mim/instructions.md',
        }
        return { origin, editorPath: paths[origin] }
      }
      if (tool === 'editor.open') return { opened: params?.path }
      return {}
    })
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: { call, on: vi.fn(), off: vi.fn() },
    })
  })

  afterEach(() => {
    app?.unmount()
    root.remove()
    vi.restoreAllMocks()
  })

  function mount() {
    app = createApp(InstructionsSettingsPanel)
    app.mount(root)
  }

  it('shows composed origins as document links without an inline form', async () => {
    mount()
    await flushUi()

    expect(call).toHaveBeenCalledWith('instruction.list', {})
    expect(root.textContent).toContain('You')
    expect(root.textContent).toContain('Shoulders')
    expect(root.textContent).toContain('Alpha')
    expect(root.textContent).toContain('Mim')
    expect(root.querySelector('textarea')).toBeNull()
    expect(root.textContent).toContain('read only')
  })

  it('opens an instruction document in the normal editor', async () => {
    mount()
    await flushUi()

    root.querySelector<HTMLButtonElement>('[data-testid="instruction-open-team"]')?.click()
    await flushUi()

    expect(call).toHaveBeenCalledWith('instruction.open', { origin: 'team' })
    expect(call).toHaveBeenCalledWith('editor.open', { path: '.mim/team/instructions.md' })
  })
})
