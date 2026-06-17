// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import ModelPicker from './ModelPicker.vue'

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

const models = [
  {
    id: 'gpt-long',
    provider: 'openai',
    displayName: 'OpenAI GPT 5.1 Long Reasoning Label',
    contextWindow: 400000,
  },
  {
    id: 'claude-sonnet-long',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.5 Extended Thinking Preview',
    contextWindow: 200000,
  },
  {
    id: 'gemini-ultra-long',
    provider: 'google',
    displayName: 'Gemini 2.5 Pro Very Long Model Label',
    contextWindow: 1000000,
  },
]

function click(el: Element | null) {
  expect(el).toBeTruthy()
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function mountPicker(props = {}) {
  const app = createApp(ModelPicker, {
    modelId: 'claude-sonnet-long',
    models,
    ...props,
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root }
}

describe('ModelPicker', () => {
  let mounted: ReturnType<typeof mountPicker> | null = null

  beforeEach(() => {
    mounted = null
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    document.body.querySelectorAll('[data-testid="model-picker-menu"]').forEach(el => el.remove())
    mounted = null
  })

  it('renders ordered model options with ids and selected state', async () => {
    mounted = mountPicker()
    await flushUi()

    click(mounted.root.querySelector('[data-testid="model-picker-trigger"]'))
    await flushUi()

    const options = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"][data-testid^="model-picker-option-"]'))
    expect(options).toHaveLength(3)
    expect(options.map(el => el.getAttribute('data-testid'))).toEqual([
      'model-picker-option-claude-sonnet-long',
      'model-picker-option-gemini-ultra-long',
      'model-picker-option-gpt-long',
    ])
    expect(options.map(el => el.querySelector('[data-testid^="model-picker-option-label-"]')?.textContent?.trim())).toEqual([
      'Claude Sonnet 4.5 Extended Thinking Preview',
      'Gemini 2.5 Pro Very Long Model Label',
      'OpenAI GPT 5.1 Long Reasoning Label',
    ])
    expect(document.body.querySelector('[data-testid="model-picker-option-context-claude-sonnet-long"]')?.textContent).toBe('200k')
    expect(document.body.querySelector('[data-testid="model-picker-option-claude-sonnet-long"]')?.getAttribute('aria-selected')).toBe('true')
    expect(document.body.querySelector('[data-testid="model-picker-option-gpt-long"]')?.getAttribute('aria-selected')).toBe('false')
  })

  it('prefers shortLabel over displayName on trigger and options', async () => {
    const short = [
      { id: 'haiku', provider: 'anthropic', displayName: 'Claude Haiku 4.5', shortLabel: 'Haiku 4.5', contextWindow: 200000 },
      { id: 'flash', provider: 'google', displayName: 'Gemini 3.5 Flash', shortLabel: '3.5 Flash', contextWindow: 1000000 },
    ]
    mounted = mountPicker({ modelId: 'haiku', models: short })
    await flushUi()

    const trigger = mounted.root.querySelector('[data-testid="model-picker-trigger"]')
    expect(trigger?.textContent?.trim()).toContain('Haiku 4.5')
    expect(trigger?.textContent).not.toContain('Claude')

    click(trigger)
    await flushUi()
    const names = Array.from(document.body.querySelectorAll<HTMLElement>('[data-testid^="model-picker-option-label-"]')).map(el => el.textContent?.trim())
    expect(names).toEqual(['Haiku 4.5', '3.5 Flash'])
  })

  it('emits the selected model id', async () => {
    const update = vi.fn()
    mounted = mountPicker({ 'onUpdate:modelId': update })
    await flushUi()

    click(mounted.root.querySelector('[data-testid="model-picker-trigger"]'))
    await flushUi()
    click(document.body.querySelector('[data-testid="model-picker-option-gemini-ultra-long"]'))
    await flushUi()

    expect(update).toHaveBeenCalledWith('gemini-ultra-long')
  })
})
