import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from '@main/server/server.js'
import type { PackageLoader } from '@main/packages/packages.js'
import type { ToolDef, ToolRegistry } from '@main/tools/registry.js'

const aiRuntimeMock = vi.hoisted(() => ({
  createAiRuntime: vi.fn(),
  runtime: {
    streamChatResponse: vi.fn(),
    streamInlineResponse: vi.fn(),
    generateGhostSuggestions: vi.fn(),
    generateTaskLabel: vi.fn(),
  },
}))

vi.mock('@main/ai/aiRuntime.js', () => ({
  createAiRuntime: aiRuntimeMock.createAiRuntime,
}))

describe('server AI endpoints', () => {
  let server: Awaited<ReturnType<typeof createServer>> | null

  beforeEach(() => {
    server = null
    aiRuntimeMock.createAiRuntime.mockReset().mockReturnValue(aiRuntimeMock.runtime)
    aiRuntimeMock.runtime.streamChatResponse.mockReset().mockResolvedValue(new Response('chat-ok'))
    aiRuntimeMock.runtime.streamInlineResponse.mockReset().mockResolvedValue(new Response('inline-ok'))
    aiRuntimeMock.runtime.generateGhostSuggestions.mockReset().mockResolvedValue({ suggestions: [' next'] })
    aiRuntimeMock.runtime.generateTaskLabel.mockReset().mockResolvedValue({ label: 'Review manuscript comments' })
  })

  afterEach(() => {
    server?.close()
  })

  function makePackages(): PackageLoader {
    return {
      list: () => [],
      get: () => undefined,
      diagnostics: () => [],
      onChange: () => undefined,
      rescan: async () => undefined,
    }
  }

  function makeTools(): ToolRegistry {
    return {
      register: (_tool: ToolDef) => undefined,
      call: vi.fn(),
      list: () => [],
      get: () => undefined,
      getWorkspacePath: () => null,
      setWorkspacePath: () => undefined,
    }
  }

  it('routes chat requests through the central AI runtime', async () => {
    server = await createServer(makeTools(), makePackages())
    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 's1',
        messages,
        modelId: 'claude-sonnet-4',
        controlId: 'medium',
        skills: ['issue-work', 42, 'docx-review'],
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('chat-ok')
    expect(aiRuntimeMock.runtime.streamChatResponse).toHaveBeenCalledWith({
      id: 's1',
      messages,
      modelId: 'claude-sonnet-4',
      controlId: 'medium',
      skills: ['issue-work', 'docx-review'],
      abortSignal: expect.any(AbortSignal),
    })
  })

  it('does not abort an AI chat stream when the POST request body finishes', async () => {
    aiRuntimeMock.runtime.streamChatResponse.mockImplementation(async ({ abortSignal }) => {
      const stream = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(abortSignal.aborted ? 'aborted' : 'open'))
            controller.close()
          }, 20)
        },
      })
      return new Response(stream)
    })
    server = await createServer(makeTools(), makePackages())

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 's1',
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('open')
  })

  it('routes inline requests through the central AI runtime', async () => {
    server = await createServer(makeTools(), makePackages())
    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'rewrite' }] }]
    const selection = { text: 'old', contextBefore: 'before', contextAfter: 'after' }

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/inline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'inline-1',
        messages,
        modelId: 'gpt-5-mini',
        controlId: 'low',
        selection,
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('inline-ok')
    expect(aiRuntimeMock.runtime.streamInlineResponse).toHaveBeenCalledWith({
      id: 'inline-1',
      messages,
      modelId: 'gpt-5-mini',
      controlId: 'low',
      selection,
      abortSignal: expect.any(AbortSignal),
    })
  })

  it('routes ghost requests through the central AI runtime', async () => {
    server = await createServer(makeTools(), makePackages())

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/ghost`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        before: 'The intervention',
        after: ' worked.',
        fallback: [' fallback'],
        modelId: 'gemini-2.5-flash',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ suggestions: [' next'] })
    expect(aiRuntimeMock.runtime.generateGhostSuggestions).toHaveBeenCalledWith({
      before: 'The intervention',
      after: ' worked.',
      fallback: [' fallback'],
      modelId: 'gemini-2.5-flash',
    })
  })

  it('routes task label requests through the central AI runtime', async () => {
    server = await createServer(makeTools(), makePackages())

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/task-label`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userText: 'Please compare the supplier quotes before the finance meeting',
        contextLabels: ['quotes.xlsx', 123, 'finance agenda'],
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ label: 'Review manuscript comments' })
    expect(aiRuntimeMock.runtime.generateTaskLabel).toHaveBeenCalledWith({
      userText: 'Please compare the supplier quotes before the finance meeting',
      contextLabels: ['quotes.xlsx', 'finance agenda'],
      modelId: undefined,
    })
  })
})
