// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import EditorTabStrip from './EditorTabStrip.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
}

function click(el: Element | null) {
  expect(el).toBeTruthy()
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

const tabs = [
  { id: 't1', kind: 'text', name: 'one.md', dirty: false },
  { id: 't2', kind: 'text', name: 'two.md', dirty: true },
  { id: 't3', kind: 'pdf', name: 'report.pdf', dirty: false },
  { id: 't4', kind: 'card', name: 'archive.zip', dirty: false },
  { id: 't5', kind: 'table', name: 'data.csv', dirty: false },
]

function mountStrip(handlers: Record<string, unknown> = {}, stripTabs = tabs) {
  const app = createApp(EditorTabStrip, { tabs: stripTabs, activeTab: 0, ...handlers })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root }
}

describe('EditorTabStrip', () => {
  let mounted: ReturnType<typeof mountStrip> | null = null

  beforeEach(() => { mounted = null })
  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    mounted = null
  })

  function addButton(root: HTMLElement) {
    return root.querySelector<HTMLButtonElement>('button[aria-label="New tab"]')
  }

  it('renders a button per tab', () => {
    mounted = mountStrip()
    const labels = Array.from(mounted.root.querySelectorAll('.etab')).map(b => b.textContent?.trim())
    expect(labels.some(l => l?.includes('one.md'))).toBe(true)
    expect(labels.some(l => l?.includes('two.md'))).toBe(true)
    expect(labels.some(l => l?.includes('report.pdf'))).toBe(true)
    expect(labels.some(l => l?.includes('archive.zip'))).toBe(true)
    expect(labels.some(l => l?.includes('data.csv'))).toBe(true)
  })

  it('renders a type icon for each tab kind', () => {
    mounted = mountStrip()

    expect(mounted.root.querySelector('[data-testid="tab-kind-text"]')).toBeTruthy()
    expect(mounted.root.querySelector('[data-testid="tab-kind-pdf"]')).toBeTruthy()
    expect(mounted.root.querySelector('[data-testid="tab-kind-card"]')).toBeTruthy()
    expect(mounted.root.querySelector('[data-testid="tab-kind-table"]')).toBeTruthy()
  })

  it('emits add-tab when the + button is clicked', async () => {
    const onAddTab = vi.fn()
    mounted = mountStrip({ onAddTab })
    click(addButton(mounted.root))
    await flushUi()
    expect(onAddTab).toHaveBeenCalled()
  })

  it('emits close-tab from a tab close affordance', async () => {
    const onCloseTab = vi.fn()
    mounted = mountStrip({ onCloseTab })
    click(mounted.root.querySelector('.etab-close'))
    await flushUi()
    expect(onCloseTab).toHaveBeenCalledWith(0)
  })

  it('shows the close affordance and emits close-tab for a single tab', async () => {
    const onCloseTab = vi.fn()
    mounted = mountStrip({ onCloseTab }, [{ id: 'solo', kind: 'text', name: 'solo.md', dirty: false }])

    click(mounted.root.querySelector('.etab-close'))
    await flushUi()

    expect(onCloseTab).toHaveBeenCalledWith(0)
  })

  it('only shows dirty dots for dirty editable tabs', () => {
    mounted = mountStrip({}, [
      { id: 'dirty-text', kind: 'text', name: 'dirty.md', dirty: true },
      { id: 'dirty-table', kind: 'table', name: 'dirty.csv', dirty: true },
      { id: 'dirty-pdf', kind: 'pdf', name: 'dirty.pdf', dirty: true },
      { id: 'dirty-card', kind: 'card', name: 'dirty.zip', dirty: true },
    ])

    expect(mounted.root.querySelectorAll('[data-testid="tab-dirty-dot"]')).toHaveLength(2)
  })
})
