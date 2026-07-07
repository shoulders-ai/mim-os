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

describe('shell token contract — all AI callers use the shared aiApi helper', () => {
  const AI_CALLER_FILES = [
    'src/renderer/components/chat/ChatView.vue',
    'src/renderer/components/editor/InlineAI.vue',
    'src/renderer/services/ai/ghost.js',
    'src/renderer/services/ai/taskLabel.js',
    'src/renderer/services/ai/summary.js',
  ]

  for (const file of AI_CALLER_FILES) {
    it(`${file} imports from the shared aiApi helper`, () => {
      const text = source(file)
      // Files inside services/ai/ use relative ./aiApi; components use ../../services/ai/aiApi
      expect(text, `${file} must import from the aiApi helper`)
        .toMatch(/from\s+['"](?:\.\/|.*services\/ai\/)aiApi/)
    })

    it(`${file} does not use raw fetch() on /api/ai paths`, () => {
      const text = source(file)
      // Match patterns like: fetch(`${baseUrl}/api/ai  or  fetch(await aiApi  with raw fetch(
      // We allow aiFetch — that IS the helper. We forbid raw fetch() calls that hit /api/ai.
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Skip import lines
        if (line.trimStart().startsWith('import ')) continue
        // Skip the aiFetch definition itself (only in aiApi.ts, not in these files)
        // Look for raw `fetch(` that is NOT `aiFetch(`
        if (/\bfetch\s*\(/.test(line) && !/\baiFetch\s*\(/.test(line) && /api\/ai/.test(line)) {
          expect.fail(
            `${file}:${i + 1} uses raw fetch() on an /api/ai path — must use aiFetch from aiApi helper`,
          )
        }
      }
    })
  }
})
