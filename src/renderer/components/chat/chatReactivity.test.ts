import { describe, expect, it } from 'vitest'
import { effect } from 'vue'
import { Chat } from '@ai-sdk/vue'

// Contract guard for the no-poll reactivity model in ChatView. @ai-sdk/vue's
// Chat holds messages/status in Vue refs, so reading chat.messages inside a
// reactive scope tracks and re-fires on change — that is the entire reason the
// old setInterval/tick hack could be deleted. These tests exercise the REAL SDK
// Chat (not a reimplementation), so a future @ai-sdk/vue upgrade that breaks the
// assumption — and would silently reintroduce the empty-until-send bug — fails
// here instead of in production. If this breaks, do NOT re-add polling; fix the
// engine integration (see docs/gotchas.md "@ai-sdk/vue Chat state is reactive").
function userMessage(id: string, text: string) {
  return { id, role: 'user', parts: [{ type: 'text', text }] } as never
}

describe('@ai-sdk/vue Chat reactivity contract', () => {
  it('reading chat.messages inside a reactive scope tracks changes', () => {
    const chat = new Chat({ id: 't-messages', messages: [userMessage('m1', 'hi')] })
    const lengths: number[] = []
    const stop = effect(() => { lengths.push(chat.messages.length) })

    // The hydration path (idle engine ← persisted history) goes through this setter.
    chat.messages = [...chat.messages, userMessage('m2', 'again')]

    stop()
    expect(lengths[0]).toBe(1)              // tracked the initial read
    expect(lengths.at(-1)).toBe(2)          // re-fired after the change — no poll needed
  })

  it('chat.status is reactive and starts ready', () => {
    const chat = new Chat({ id: 't-status', messages: [] })
    const seen: string[] = []
    const stop = effect(() => { seen.push(chat.status) })
    stop()
    expect(seen[0]).toBe('ready')
  })
})
