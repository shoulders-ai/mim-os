// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import MimContextMenu from './MimContextMenu.vue'
import MimMenuItem from './MimMenuItem.vue'

const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function mountContextMenu(props: Record<string, unknown> = {}) {
  const close = vi.fn()
  const select = vi.fn()
  const app = createApp({
    render() {
      return h(
        MimContextMenu,
        {
          x: 24,
          y: 32,
          width: 160,
          height: 96,
          onClose: close,
          ...props,
        },
        {
          default: () => [
            h(MimMenuItem, { headless: false, onSelect: () => select('rename') }, () => 'Rename'),
            h(MimMenuItem, { headless: false, danger: true, onSelect: () => select('delete') }, () => 'Delete'),
          ],
        },
      )
    },
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root, close, select }
}

describe('MimContextMenu', () => {
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders a teleported menu at fixed coordinates', async () => {
    const mounted = mountContextMenu()
    await flushUi()

    expect(mounted.root.textContent).toBe('')
    const menu = document.body.querySelector<HTMLElement>('.mim-context-menu')
    expect(menu).not.toBeNull()
    expect(menu?.getAttribute('role')).toBe('menu')
    expect(menu?.style.left).toBe('24px')
    expect(menu?.style.top).toBe('32px')
    expect(menu?.style.minWidth).toBe('160px')
    mounted.app.unmount()
  })

  it('clamps near viewport edges', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 160 })
    const mounted = mountContextMenu({ x: 500, y: 500, width: 100, height: 80 })
    await flushUi()

    const menu = document.body.querySelector<HTMLElement>('.mim-context-menu')
    expect(menu?.style.left).toBe('132px')
    expect(menu?.style.top).toBe('72px')
    mounted.app.unmount()
  })

  it('emits close on overlay click and Escape', async () => {
    let mounted = mountContextMenu()
    await flushUi()
    document.body.querySelector('.mim-context-menu-overlay')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await flushUi()
    expect(mounted.close).toHaveBeenCalledOnce()
    mounted.app.unmount()
    document.body.innerHTML = ''

    mounted = mountContextMenu()
    await flushUi()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushUi()
    expect(mounted.close).toHaveBeenCalledOnce()
    mounted.app.unmount()
  })

  it('uses shared menu item rows without Headless UI context', async () => {
    const mounted = mountContextMenu()
    await flushUi()

    const deleteItem = [...document.body.querySelectorAll<HTMLButtonElement>('.mim-menu-item')]
      .find(item => item.textContent?.includes('Delete'))!
    expect(deleteItem.getAttribute('role')).toBe('menuitem')
    expect(deleteItem.className).toContain('text-rem')
    deleteItem.click()
    expect(mounted.select).toHaveBeenCalledWith('delete')
    mounted.app.unmount()
  })
})
