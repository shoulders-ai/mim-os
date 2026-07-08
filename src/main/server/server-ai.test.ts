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
    generateSummary: vi.fn(),
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
    aiRuntimeMock.runtime.generateSummary.mockReset().mockResolvedValue({ summary: 'A summary of the conversation.' })
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
      headers: {
        'Content-Type': 'application/json',
        'x-mim-shell-token': server.shellToken,
      },
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
      agentId: undefined,
      abortSignal: expect.any(AbortSignal),
    })
  })

  it('forwards agentId from body to streamChatResponse', async () => {
    server = await createServer(makeTools(), makePackages())
    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mim-shell-token': server.shellToken,
      },
      body: JSON.stringify({
        id: 's1',
        messages,
        agentId: 'package:review-app/referee',
      }),
    })

    expect(response.status).toBe(200)
    expect(aiRuntimeMock.runtime.streamChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'package:review-app/referee',
      }),
    )
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
      headers: {
        'Content-Type': 'application/json',
        'x-mim-shell-token': server.shellToken,
      },
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
      headers: {
        'Content-Type': 'application/json',
        'x-mim-shell-token': server.shellToken,
      },
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
      headers: {
        'Content-Type': 'application/json',
        'x-mim-shell-token': server.shellToken,
      },
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
      headers: {
        'Content-Type': 'application/json',
        'x-mim-shell-token': server.shellToken,
      },
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

  it('routes summary requests through the central AI runtime', async () => {
    server = await createServer(makeTools(), makePackages())
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: 'Explain photosynthesis' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'Photosynthesis is...' }] },
    ]

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mim-shell-token': server.shellToken,
      },
      body: JSON.stringify({ messages }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ summary: 'A summary of the conversation.' })
    expect(aiRuntimeMock.runtime.generateSummary).toHaveBeenCalledWith({
      messages,
      modelId: undefined,
    })
  })
})

describe('shell token middleware', () => {
  let server: Awaited<ReturnType<typeof createServer>> | null

  beforeEach(() => {
    server = null
    aiRuntimeMock.createAiRuntime.mockReset().mockReturnValue(aiRuntimeMock.runtime)
    aiRuntimeMock.runtime.streamChatResponse.mockReset().mockResolvedValue(new Response('chat-ok'))
    aiRuntimeMock.runtime.streamInlineResponse.mockReset().mockResolvedValue(new Response('inline-ok'))
    aiRuntimeMock.runtime.generateGhostSuggestions.mockReset().mockResolvedValue({ suggestions: [' next'] })
    aiRuntimeMock.runtime.generateTaskLabel.mockReset().mockResolvedValue({ label: 'Label' })
    aiRuntimeMock.runtime.generateSummary.mockReset().mockResolvedValue({ summary: 'Summary' })
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

  const AI_ROUTES = [
    { path: '/api/ai/chat', mock: 'streamChatResponse' },
    { path: '/api/ai/inline', mock: 'streamInlineResponse' },
    { path: '/api/ai/ghost', mock: 'generateGhostSuggestions' },
    { path: '/api/ai/task-label', mock: 'generateTaskLabel' },
    { path: '/api/ai/summary', mock: 'generateSummary' },
  ] as const

  for (const { path, mock } of AI_ROUTES) {
    it(`rejects ${path} without the shell token header`, async () => {
      server = await createServer(makeTools(), makePackages())

      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'Missing or invalid shell token' })
      expect(aiRuntimeMock.runtime[mock]).not.toHaveBeenCalled()
    })

    it(`rejects ${path} with a wrong shell token`, async () => {
      server = await createServer(makeTools(), makePackages())

      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mim-shell-token': 'wrong-token-value',
        },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({ error: 'Missing or invalid shell token' })
      expect(aiRuntimeMock.runtime[mock]).not.toHaveBeenCalled()
    })
  }

  it('does not expose shell-token AI routes in serve mode', async () => {
    server = await createServer(makeTools(), makePackages(), { mode: 'serve' })

    for (const { path, mock } of AI_ROUTES) {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mim-shell-token': server.shellToken,
          'X-Forwarded-For': '203.0.113.20',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(404)
      expect(aiRuntimeMock.runtime[mock]).not.toHaveBeenCalled()
    }
  })

  it('does not allow AI route preflight in serve mode', async () => {
    server = await createServer(makeTools(), makePackages(), { mode: 'serve' })

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: `http://127.0.0.1:${server.port}`,
        'X-Forwarded-For': '203.0.113.21',
        'X-Forwarded-Proto': 'https',
      },
    })

    expect(response.status).toBe(404)
  })

  it('allows OPTIONS preflight on /api/ai/* without a shell token', async () => {
    server = await createServer(makeTools(), makePackages())

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/chat`, {
      method: 'OPTIONS',
    })

    expect(response.status).toBe(204)
  })

  it('exposes shellToken as a string on the server handle', async () => {
    server = await createServer(makeTools(), makePackages())
    expect(typeof server.shellToken).toBe('string')
    expect(server.shellToken.length).toBeGreaterThan(0)
  })

  it('includes x-mim-shell-token in CORS allowed headers', async () => {
    server = await createServer(makeTools(), makePackages())

    const response = await fetch(`http://127.0.0.1:${server.port}/api/ai/chat`, {
      method: 'OPTIONS',
      headers: { Origin: `http://127.0.0.1:${server.port}` },
    })

    expect(response.status).toBe(204)
    const allowHeaders = response.headers.get('access-control-allow-headers')
    expect(allowHeaders).toContain('x-mim-shell-token')
  })
})
