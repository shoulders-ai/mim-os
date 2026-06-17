// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, h } from 'vue'
import MimSelect from './MimSelect.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

function click(el: Element | null) {
  expect(el).toBeTruthy()
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

const options = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'plan', label: 'Plan' },
  { value: 'done', label: 'Done', disabled: true },
]

function mountSelect(props: Record<string, unknown> = {}) {
  const app = createApp(MimSelect, {
    modelValue: 'plan',
    options,
    ariaLabel: 'Status',
    ...props,
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root }
}

describe('MimSelect', () => {
  let mounted: ReturnType<typeof mountSelect> | null = null

  beforeEach(() => {
    mounted = null
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    document.body.querySelectorAll('.mim-select-options').forEach(el => el.remove())
    mounted = null
  })

  it('renders the trigger with the current option label and aria-label', async () => {
    mounted = mountSelect()
    await flushUi()

    const trigger = mounted.root.querySelector('.mim-select-trigger')
    expect(trigger?.textContent?.trim()).toBe('Plan')
    expect(trigger?.getAttribute('aria-label')).toBe('Status')
  })

  it('opens on click and renders every option with selected state', async () => {
    mounted = mountSelect()
    await flushUi()

    click(mounted.root.querySelector('.mim-select-trigger'))
    await flushUi()

    const opts = Array.from(document.body.querySelectorAll<HTMLElement>('.mim-select-option'))
    expect(opts.map(el => el.getAttribute('data-value'))).toEqual(['backlog', 'plan', 'done'])
    const selected = document.body.querySelector('.mim-select-option[data-value="plan"]')
    expect(selected?.getAttribute('aria-selected')).toBe('true')
  })

  it('emits update:modelValue with the chosen value', async () => {
    const update = vi.fn()
    mounted = mountSelect({ 'onUpdate:modelValue': update })
    await flushUi()

    click(mounted.root.querySelector('.mim-select-trigger'))
    await flushUi()
    click(document.body.querySelector('.mim-select-option[data-value="backlog"]'))
    await flushUi()

    expect(update).toHaveBeenCalledWith('backlog')
  })

  it('does not select a disabled option', async () => {
    const update = vi.fn()
    mounted = mountSelect({ 'onUpdate:modelValue': update })
    await flushUi()

    click(mounted.root.querySelector('.mim-select-trigger'))
    await flushUi()
    click(document.body.querySelector('.mim-select-option[data-value="done"]'))
    await flushUi()

    expect(update).not.toHaveBeenCalled()
  })

  it('disables the trigger when disabled', async () => {
    mounted = mountSelect({ disabled: true })
    await flushUi()

    const trigger = mounted.root.querySelector<HTMLButtonElement>('.mim-select-trigger')
    expect(trigger?.disabled).toBe(true)

    click(trigger)
    await flushUi()
    expect(document.body.querySelector('.mim-select-option')).toBeNull()
  })

  it('renders a custom trigger via slot', async () => {
    const app = createApp({
      render() {
        return h(
          MimSelect,
          { modelValue: 'plan', options, ariaLabel: 'Status' },
          { trigger: ({ label }: { label: string }) => h('span', { class: 'custom-trigger' }, `→ ${label}`) },
        )
      },
    })
    const root = document.createElement('div')
    document.body.appendChild(root)
    app.mount(root)
    await flushUi()

    expect(root.querySelector('.custom-trigger')?.textContent).toBe('→ Plan')
    app.unmount()
    root.remove()
  })

  it('passes trigger/menu attrs and option metadata through to Headless UI nodes', async () => {
    mounted = mountSelect({
      triggerAttrs: { 'data-testid': 'select-trigger' },
      optionsAttrs: { 'data-testid': 'select-menu' },
      options: [
        { value: 'backlog', label: 'Backlog', testId: 'option-backlog', title: 'Move to backlog' },
        { value: 'plan', label: 'Plan', testId: 'option-plan' },
      ],
    })
    await flushUi()

    expect(mounted.root.querySelector('[data-testid="select-trigger"]')).not.toBeNull()
    click(mounted.root.querySelector('[data-testid="select-trigger"]'))
    await flushUi()

    expect(document.body.querySelector('[data-testid="select-menu"]')).not.toBeNull()
    const option = document.body.querySelector('[data-testid="option-backlog"]')
    expect(option?.getAttribute('title')).toBe('Move to backlog')
  })

  it('exposes listbox aria state on the trigger and disabled option', async () => {
    mounted = mountSelect()
    await flushUi()
    const trigger = mounted.root.querySelector('.mim-select-trigger')
    expect(trigger?.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')

    click(trigger)
    await flushUi()
    expect(mounted.root.querySelector('.mim-select-trigger')?.getAttribute('aria-expanded')).toBe('true')
    expect(
      document.body.querySelector('.mim-select-option[data-value="done"]')?.getAttribute('aria-disabled'),
    ).toBe('true')
  })

  it('stops keydowns from escaping the options panel to the document', async () => {
    mounted = mountSelect()
    await flushUi()
    click(mounted.root.querySelector('.mim-select-trigger'))
    await flushUi()

    const docSpy = vi.fn()
    document.addEventListener('keydown', docSpy)
    const panel = document.body.querySelector('.mim-select-options')
    expect(panel).not.toBeNull()
    panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }))
    await flushUi()
    document.removeEventListener('keydown', docSpy)

    expect(docSpy).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    mounted = mountSelect()
    await flushUi()
    click(mounted.root.querySelector('.mim-select-trigger'))
    await flushUi()
    expect(document.body.querySelector('.mim-select-option')).not.toBeNull()

    document.body
      .querySelector('.mim-select-options')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushUi()
    expect(document.body.querySelector('.mim-select-option')).toBeNull()
  })
})
