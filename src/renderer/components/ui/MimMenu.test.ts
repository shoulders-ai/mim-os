// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import MimMenu from './MimMenu.vue'
import MimMenuItem from './MimMenuItem.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

async function flushTransition() {
  await flushUi()
  await new Promise(resolve => setTimeout(resolve, 140))
  await flushUi()
}

function click(el: Element | null) {
  expect(el).toBeTruthy()
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function mountMenu(props: Record<string, unknown> = {}) {
  const select = vi.fn()
  const app = createApp({
    render() {
      return h(
        MimMenu,
        {
          ariaLabel: 'Actions',
          triggerClass: 'trigger-shell',
          itemsAttrs: { 'data-testid': 'menu-panel' },
          ...props,
        },
        {
          trigger: () => h('span', 'Open'),
          default: () => [
            h(MimMenuItem, { onSelect: () => select('one') }, () => 'One'),
            h(MimMenuItem, { disabled: true, onSelect: () => select('disabled') }, () => 'Disabled'),
            h(MimMenuItem, { danger: true, selected: true, onSelect: () => select('danger') }, () => 'Danger'),
          ],
        },
      )
    },
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root, select }
}

describe('MimMenu', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders an accessible trigger and teleported menu panel', async () => {
    const mounted = mountMenu()
    await flushUi()

    const trigger = mounted.root.querySelector('.mim-menu-trigger')
    expect(trigger?.getAttribute('aria-label')).toBe('Actions')
    expect(trigger?.textContent).toContain('Open')

    click(trigger)
    await flushUi()

    expect(document.body.querySelector('[data-testid="menu-panel"]')).not.toBeNull()
    expect(document.body.querySelectorAll('.mim-menu-item')).toHaveLength(3)
    mounted.app.unmount()
  })

  it('emits select for enabled items and ignores disabled items', async () => {
    const mounted = mountMenu()
    await flushUi()

    click(mounted.root.querySelector('.mim-menu-trigger'))
    await flushUi()
    click([...document.body.querySelectorAll('.mim-menu-item')]
      .find(item => item.textContent?.includes('Disabled')) ?? null)
    click([...document.body.querySelectorAll('.mim-menu-item')]
      .find(item => item.textContent?.includes('One')) ?? null)
    await flushUi()

    expect(mounted.select).toHaveBeenCalledTimes(1)
    expect(mounted.select).toHaveBeenCalledWith('one')
    mounted.app.unmount()
  })

  it('closes on Escape and stops menu keydowns from bubbling to document shortcuts', async () => {
    const mounted = mountMenu()
    await flushUi()
    click(mounted.root.querySelector('.mim-menu-trigger'))
    await flushUi()

    const docSpy = vi.fn()
    document.addEventListener('keydown', docSpy)
    const panel = document.body.querySelector('.mim-menu-items')
    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))
    expect(docSpy).not.toHaveBeenCalled()

    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushTransition()
    document.removeEventListener('keydown', docSpy)

    expect(document.body.querySelector('.mim-menu-items')).toBeNull()
    mounted.app.unmount()
  })

  it('applies selected danger row styling and disables the trigger', async () => {
    let mounted = mountMenu()
    await flushUi()
    click(mounted.root.querySelector('.mim-menu-trigger'))
    await flushUi()
    const danger = [...document.body.querySelectorAll('.mim-menu-item')]
      .find(item => item.textContent?.includes('Danger')) as HTMLElement | undefined
    expect(danger?.className).toContain('bg-rem/10')
    mounted.app.unmount()
    document.body.innerHTML = ''

    mounted = mountMenu({ disabled: true })
    await flushUi()
    const trigger = mounted.root.querySelector<HTMLButtonElement>('.mim-menu-trigger')
    expect(trigger?.disabled).toBe(true)
    click(trigger)
    await flushUi()
    expect(document.body.querySelector('.mim-menu-items')).toBeNull()
    mounted.app.unmount()
  })
})
