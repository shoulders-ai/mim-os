// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import InlineAI from './InlineAI.vue'

const aiMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@ai-sdk/vue', () => ({
  Chat: vi.fn().mockImplementation(() => ({
    status: 'ready',
    error: null,
    messages: [],
    sendMessage: aiMocks.sendMessage,
    stop: aiMocks.stop,
  })),
}))

vi.mock('ai', () => ({
  DefaultChatTransport: vi.fn().mockImplementation(input => input),
}))

async function flushUi() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

const registry = {
  defaults: {
    chat: ['claude-sonnet-4-6'],
    inline: ['claude-sonnet-4-6'],
  },
  models: [
    {
      id: 'claude-sonnet-4-6',
      provider: 'anthropic',
      providerLabel: 'Anthropic',
      displayName: 'Claude Sonnet 4.6',
      shortLabel: 'Sonnet 4.6',
      contextWindow: 200000,
      capabilities: { streaming: true, tools: true },
    },
  ],
}

function mountInlineAI(props: Record<string, unknown> = {}) {
  const app = createApp(InlineAI, {
    selection: {
      from: 0,
      to: 10,
      text: 'alpha beta',
      coords: { left: 120, right: 180, top: 100, bottom: 118 },
      contextBefore: '',
      contextAfter: '',
    },
    ...props,
  })
  app.use(createPinia())
  const root = document.createElement('div')
  document.body.appendChild(root)
  app.mount(root)
  return { app, root }
}

describe('InlineAI', () => {
  let mounted: ReturnType<typeof mountInlineAI> | null = null

  beforeEach(() => {
    aiMocks.sendMessage.mockClear()
    aiMocks.stop.mockClear()
    Object.defineProperty(window, 'kernel', {
      configurable: true,
      value: {
      call: vi.fn(async (name: string) => {
        if (name === 'ai.registry') return registry
        if (name === 'ai.keyStatus') return { statuses: [{ provider: 'anthropic', configured: true }] }
        if (name === 'settings.set') return {}
        return {}
      }),
      getPort: vi.fn(async () => 3030),
      getAiToken: vi.fn(async () => 'test-shell-token'),
      },
    })
  })

  afterEach(() => {
    mounted?.app.unmount()
    mounted?.root.remove()
    document.body.querySelectorAll('.mp-dropdown').forEach(el => el.remove())
    Object.defineProperty(window, 'kernel', { configurable: true, value: undefined })
    mounted = null
  })

  it('renders as an edit command surface instead of a mini chat bar', async () => {
    mounted = mountInlineAI()
    await flushUi()

    const text = mounted.root.textContent || ''
    expect(text).toContain('Selection · 2 words')
    expect(text).toContain('Sonnet 4.6')
    expect(text.match(/Sonnet 4\.6/g)).toHaveLength(1)
    expect(text).not.toContain('⌘K')
    expect(text).not.toContain('Send')
    expect(text).not.toContain('Follow up')

    const input = mounted.root.querySelector('textarea')
    expect(input?.getAttribute('placeholder')).toBe('Tell Mim how to change the selection')
  })

  it('renders as an integrated review command row instead of floating over changed text', async () => {
    mounted = mountInlineAI({ variant: 'review' })
    await flushUi()

    const surface = mounted.root.firstElementChild as HTMLElement | null
    expect(surface).toBeTruthy()
    expect(surface?.getAttribute('style')).toBeNull()
    expect(surface?.querySelector('textarea')?.getAttribute('placeholder')).toBe('Tell Mim how to change the selection')
  })

  it('submits review follow-ups without tearing down the active diff', async () => {
    const events: string[] = []
    mounted = mountInlineAI({
      variant: 'review',
      onDeactivateDiff: () => events.push('deactivate-diff'),
    })
    await flushUi()

    const textarea = mounted.root.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = 'make this more direct'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushUi()

    const form = mounted.root.querySelector('form') as HTMLFormElement
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushUi()

    expect(events).toEqual([])
    await vi.waitFor(() => expect(aiMocks.sendMessage).toHaveBeenCalled())
    expect(aiMocks.sendMessage).toHaveBeenCalledWith({ text: 'make this more direct' })
    expect(aiMocks.stop).not.toHaveBeenCalled()
  })
})
