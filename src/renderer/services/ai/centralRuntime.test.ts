import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function source(path: string) {
  return readFileSync(join(root, path), 'utf-8')
}

describe('renderer AI integration boundary', () => {
  it('does not fetch raw provider keys or import provider SDKs in renderer AI surfaces', () => {
    const files = [
      'src/renderer/components/chat/ChatView.vue',
      'src/renderer/components/editor/InlineAI.vue',
      'src/renderer/services/ai/ghost.js',
    ]

    for (const file of files) {
      const text = source(file)
      expect(text, `${file} must not request provider keys`).not.toContain('ai.getKey')
      expect(text, `${file} must not import provider SDKs`).not.toMatch(/@ai-sdk\/(anthropic|openai|google)/)
      expect(text, `${file} must not run model calls directly`).not.toMatch(/\b(generateText|ToolLoopAgent|DirectChatTransport)\b/)
    }
  })

  it('routes chat through the central local AI endpoint', () => {
    const text = source('src/renderer/components/chat/ChatView.vue')

    expect(text).toContain('DefaultChatTransport')
    expect(text).toContain('/api/ai/chat')
    expect(text).not.toContain('createChatTransport')
  })

  it('does not hide chat transport failures behind successful finish handling', () => {
    const text = source('src/renderer/components/chat/ChatView.vue')

    expect(text).toContain('onFinish: async ({ isError, isAbort, finishReason })')
    expect(text).toContain('if (isError)')
    expect(text).toContain('await chat.sendMessage(sendPayload,')
    expect(text).toContain('[chat-ai]')
  })

  it('persists composer drafts when chat view leaves the screen', () => {
    const text = source('src/renderer/components/chat/ChatView.vue')

    expect(text).toContain('function saveActiveDraft()')
    expect(text).toContain('onDeactivated(() =>')
    expect(text).toContain('const draftId = props.draft ? NEW_CHAT_DRAFT_ID : session.value?.id')
    expect(text).toContain('sessionStore.setDraft(draftId, composerRef.value.draft ||')
  })

  it('routes inline rewrites through the central local AI endpoint', () => {
    const text = source('src/renderer/components/editor/InlineAI.vue')

    expect(text).toContain('DefaultChatTransport')
    expect(text).toContain('/api/ai/inline')
    expect(text).not.toContain('createInlineAITransport')
  })

  it('routes ghost suggestions through the central local AI endpoint', () => {
    const text = source('src/renderer/services/ai/ghost.js')

    expect(text).toContain('/api/ai/ghost')
    expect(text).not.toContain('createSdkModel')
    expect(text).not.toContain('generateText')
  })
})
