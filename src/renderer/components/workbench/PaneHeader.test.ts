// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import PaneHeader from './PaneHeader.vue'
import { shortcutLabel } from '../../services/shortcutLabels.js'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

function button(title: string): HTMLButtonElement {
  const found = document.body.querySelector(`button[title="${title}"]`)
  if (!found) throw new Error(`Button not found: ${title}`)
  return found as HTMLButtonElement
}

describe('PaneHeader', () => {
  let root: HTMLElement
  let app: ReturnType<typeof createApp> | null = null

  afterEach(() => {
    app?.unmount()
    app = null
    root?.remove()
    vi.restoreAllMocks()
  })

  it('emits pane-local history actions and disables unavailable directions', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    const onBack = vi.fn()
    const onForward = vi.fn()

    app = createApp(PaneHeader, {
      pane: 'work',
      title: 'Files',
      subtitle: 'Work',
      canBack: true,
      canForward: false,
      onBack,
      onForward,
    })
    app.mount(root)
    await flushUi()

    const backTitle = `Back in Work history (${shortcutLabel(['Mod', '['])})`
    const forwardTitle = `Forward in Work history (${shortcutLabel(['Mod', ']'])})`
    button(backTitle).click()
    button(forwardTitle).click()

    expect(onBack).toHaveBeenCalledOnce()
    expect(onForward).not.toHaveBeenCalled()
    expect(button(forwardTitle).disabled).toBe(true)
  })

  it('emits Artifact visibility actions from one header', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    const onCollapse = vi.fn()
    const onExpand = vi.fn()

    app = createApp(PaneHeader, {
      pane: 'artifact',
      title: 'Artifact',
      canExpand: true,
      onCollapse,
      onExpand,
    })
    app.mount(root)
    await flushUi()

    button('Expand Artifact').click()
    button('Collapse Artifact').click()

    expect(onExpand).toHaveBeenCalledOnce()
    expect(onCollapse).toHaveBeenCalledOnce()
  })

  it('renders the bridged sidebar restore control before pane history', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    const onRestoreNavigator = vi.fn()

    app = createApp(PaneHeader, {
      pane: 'artifact',
      title: 'Editor',
      bridgeInset: 20,
      showNavigatorRestore: true,
      onRestoreNavigator,
    })
    app.mount(root)
    await flushUi()

    const header = root.querySelector<HTMLElement>('header')
    expect(header?.dataset.bridged).toBe('true')
    // The inset clears the macOS traffic lights so the expand-sidebar button
    // lands right after the zoom button on the shared chrome.
    expect(header?.style.paddingLeft).toBe('calc(0.5rem + 20px)')
    // The header keeps its own border-b in both bridged and standalone states
    // (the content below no longer carries a top border), so the surface
    // starts at the same y and the chrome band does not grow on bridge.
    expect(header?.className).toContain('border-b')
    expect(header?.className).not.toContain('border-b-0')

    button(`Expand sidebar (${shortcutLabel(['Mod', 'B'])})`).click()

    expect(onRestoreNavigator).toHaveBeenCalledOnce()
  })

  it('emits Work rename actions from the drag header title', async () => {
    root = document.createElement('div')
    document.body.appendChild(root)
    const onStartRename = vi.fn()
    const onUpdateRenameValue = vi.fn()
    const onCommitRename = vi.fn()

    app = createApp(PaneHeader, {
      pane: 'work',
      title: 'Draft chat',
      renameable: true,
      renaming: false,
      onStartRename,
      onUpdateRenameValue,
      onCommitRename,
    })
    app.mount(root)
    await flushUi()

    root.querySelector('h2')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(onStartRename).toHaveBeenCalledOnce()

    app.unmount()
    app = createApp(PaneHeader, {
      pane: 'work',
      title: 'Draft chat',
      renaming: true,
      renameValue: 'Draft chat',
      'onUpdate:renameValue': onUpdateRenameValue,
      onCommitRename,
    })
    app.mount(root)
    await flushUi()

    const input = root.querySelector('input') as HTMLInputElement
    input.value = 'Renamed chat'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(onUpdateRenameValue).toHaveBeenCalledWith('Renamed chat')
    expect(onCommitRename).toHaveBeenCalledOnce()
  })
})
