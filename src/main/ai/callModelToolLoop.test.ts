import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Mock the AI SDK boundary + provider factories so no network/key is needed.
// vi.hoisted lets the mock factories reference these (vi.mock is hoisted to top).
const { createAnthropic, createOpenAI, createGoogle, generateText } = vi.hoisted(() => ({
  createAnthropic: vi.fn((_opts: unknown) => (model: string) => ({ __p: 'anthropic', model })),
  createOpenAI: vi.fn((_opts: unknown) => (model: string) => ({ __p: 'openai', model })),
  createGoogle: vi.fn((_opts: unknown) => (model: string) => ({ __p: 'google', model })),
  generateText: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic }))
vi.mock('@ai-sdk/openai', () => ({ createOpenAI }))
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: createGoogle }))
vi.mock('ai', () => ({
  generateText,
  generateObject: vi.fn(),
  tool: (def: unknown) => ({ __tool: def }),
  jsonSchema: (schema: unknown) => ({ __jsonSchema: schema }),
  stepCountIs: (n: number) => ({ __stepCountIs: n }),
}))

import { callModelToolLoop } from '@main/ai/ai.js'

const OK = {
  text: 'hello',
  toolCalls: [],
  steps: [{}],
  finishReason: 'stop',
  usage: { inputTokens: 100, outputTokens: 40, cachedInputTokens: 10 },
}

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY'] as const
const savedEnv: Record<string, string | undefined> = {}

describe('callModelToolLoop', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; process.env[k] = 'test-key' }
    generateText.mockReset().mockResolvedValue(OK)
    createAnthropic.mockClear(); createOpenAI.mockClear(); createGoogle.mockClear()
  })
  afterEach(() => {
    for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]! }
  })

  // --- provider / model resolution ---
  it('A1 routes an Anthropic model id to createAnthropic', async () => {
    await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(createAnthropic).toHaveBeenCalledTimes(1)
    expect(createOpenAI).not.toHaveBeenCalled()
  })

  it('A2 routes an OpenAI model id to createOpenAI', async () => {
    await callModelToolLoop({ modelId: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] })
    expect(createOpenAI).toHaveBeenCalledTimes(1)
  })

  it('A3 routes a Google model id to createGoogleGenerativeAI', async () => {
    await callModelToolLoop({ modelId: 'gemini-3.1-pro-preview', messages: [{ role: 'user', content: 'hi' }] })
    expect(createGoogle).toHaveBeenCalledTimes(1)
  })

  it('A4 the deprecated `model` alias resolves like `modelId`', async () => {
    const res = await callModelToolLoop({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.modelId).toBe('claude-sonnet-4-6')
    expect(res.provider).toBe('anthropic')
  })

  it('A5 honors an explicit provider override', async () => {
    await callModelToolLoop({ modelId: 'claude-sonnet-4-6', provider: 'google', messages: [{ role: 'user', content: 'hi' }] })
    expect(createGoogle).toHaveBeenCalledTimes(1)
    expect(createAnthropic).not.toHaveBeenCalled()
  })

  it('A6 throws on an unknown model id and never calls the SDK', async () => {
    await expect(callModelToolLoop({ modelId: 'nope-9', messages: [] })).rejects.toThrow(/Unknown AI model id/)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('A7 throws when the provider key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const savedHome = process.env.HOME
    process.env.HOME = mkdtempSync(join(tmpdir(), 'mim-nokeys-')) // no keys.env here
    try {
      await expect(callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [] }))
        .rejects.toThrow(/No API key configured for anthropic/)
    } finally {
      process.env.HOME = savedHome
    }
  })

  // --- tool adaptation ---
  it('A8/A9 adapts package tools and sanitizes the name as the key', async () => {
    await callModelToolLoop({
      modelId: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'submit.review', description: 'd', input_schema: { type: 'object' }, execute: () => ({}) }],
    })
    const passed = generateText.mock.calls[0][0].tools
    expect(Object.keys(passed)).toEqual(['submit_review'])
    expect(passed.submit_review.__tool.inputSchema).toEqual({ __jsonSchema: { type: 'object' } })
  })

  it('A10 the adapted execute forwards input and returns the package value', async () => {
    const execute = vi.fn(async (input: Record<string, unknown>) => ({ echoed: input.x }))
    await callModelToolLoop({
      modelId: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't', description: 'd', input_schema: {}, execute }],
    })
    const adapted = generateText.mock.calls[0][0].tools.t.__tool
    const out = await adapted.execute({ x: 7 })
    expect(execute).toHaveBeenCalledWith({ x: 7 })
    expect(out).toEqual({ echoed: 7 })
  })

  it('A11 a throwing tool returns an {error} result instead of rejecting the loop', async () => {
    await callModelToolLoop({
      modelId: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't', description: 'd', input_schema: {}, execute: () => { throw new Error('boom') } }],
    })
    const adapted = generateText.mock.calls[0][0].tools.t.__tool
    await expect(adapted.execute({})).resolves.toEqual({ error: 'boom' })
  })

  it('A12 passes no tools when none are supplied', async () => {
    await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(generateText.mock.calls[0][0].tools).toBeUndefined()
  })

  // --- multi-step ---
  it('A13 maps maxSteps to stopWhen: stepCountIs(n) (default 1)', async () => {
    await callModelToolLoop({ modelId: 'claude-sonnet-4-6', maxSteps: 10, messages: [{ role: 'user', content: 'hi' }] })
    expect(generateText.mock.calls[0][0].stopWhen).toEqual({ __stepCountIs: 10 })
    await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(generateText.mock.calls[1][0].stopWhen).toEqual({ __stepCountIs: 1 })
  })

  it('A14 reports the number of steps and reconstructs content', async () => {
    generateText.mockResolvedValue({
      text: 'final', finishReason: 'stop', steps: [{}, {}, {}],
      toolCalls: [{ toolCallId: 'c1', toolName: 'submit_review', input: { a: 1 } }],
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    const res = await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.steps).toBe(3)
    expect(res.text).toBe('final')
    expect(res.content).toEqual([
      { type: 'text', text: 'final' },
      { type: 'tool_use', id: 'c1', name: 'submit_review', input: { a: 1 } },
    ])
  })

  // --- messages / vision ---
  it('A15 passes string content through unchanged', async () => {
    await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'plain' }] })
    expect(generateText.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'plain' }])
  })

  it('A16/A17 converts a base64 image block to an SDK image part, preserving order', async () => {
    await callModelToolLoop({
      modelId: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        { type: 'text', text: 'caption' },
      ] }],
    })
    expect(generateText.mock.calls[0][0].messages[0].content).toEqual([
      { type: 'image', image: 'data:image/png;base64,AAAA', mediaType: 'image/png' },
      { type: 'text', text: 'caption' },
    ])
  })

  it('A18 preserves the assistant role', async () => {
    await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [
      { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' },
    ] })
    const msgs = generateText.mock.calls[0][0].messages
    expect(msgs[1].role).toBe('assistant')
  })

  // --- usage ---
  it('A19 maps SDK usage to {input,output,cacheRead,cacheCreation}', async () => {
    generateText.mockResolvedValue({ ...OK, usage: { inputTokens: 100, outputTokens: 40, cachedInputTokens: 10, cacheCreationInputTokens: 5 } })
    const res = await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.usage).toEqual({ input: 100, output: 40, cacheRead: 10, cacheCreation: 5 })
  })

  it('A20 falls back to prompt/completion token names', async () => {
    generateText.mockResolvedValue({ ...OK, usage: { promptTokens: 7, completionTokens: 3 } })
    const res = await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.usage).toMatchObject({ input: 7, output: 3 })
  })

  it('A21 missing usage yields zeros, no throw', async () => {
    generateText.mockResolvedValue({ ...OK, usage: undefined })
    const res = await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(res.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })
  })

  // --- timeout (Decision 1) ---
  it('A22 default = NO timeout (a long call past 120s is not aborted)', async () => {
    vi.useFakeTimers()
    try {
      generateText.mockImplementation((args: { abortSignal: AbortSignal }) => new Promise(resolve => {
        args.abortSignal.addEventListener('abort', () => resolve({ ...OK, text: 'ABORTED' }))
        setTimeout(() => resolve(OK), 200_000)
      }))
      const p = callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
      await vi.advanceTimersByTimeAsync(150_000)
      await vi.advanceTimersByTimeAsync(60_000)
      const res = await p
      expect(res.text).toBe('hello')
    } finally {
      vi.useRealTimers()
    }
  })

  it('A23 timeoutMs aborts the loop with a timeout error', async () => {
    generateText.mockImplementation((args: { abortSignal: AbortSignal }) => new Promise((_, reject) => {
      args.abortSignal.addEventListener('abort', () => reject(args.abortSignal.reason))
    }))
    await expect(callModelToolLoop({ modelId: 'claude-sonnet-4-6', timeoutMs: 30, messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/timed out/)
  })

  it('A24 a pre-aborted parent signal rejects with the parent reason', async () => {
    generateText.mockImplementation((args: { abortSignal: AbortSignal }) => new Promise((_, reject) => {
      if (args.abortSignal.aborted) reject(args.abortSignal.reason)
      else args.abortSignal.addEventListener('abort', () => reject(args.abortSignal.reason))
    }))
    const parent = AbortSignal.abort(new Error('parent gone'))
    await expect(callModelToolLoop({ modelId: 'claude-sonnet-4-6', signal: parent, messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toThrow(/parent gone/)
  })

  // --- provider options ---
  it('A26 Anthropic gets ephemeral cacheControl provider options', async () => {
    await callModelToolLoop({ modelId: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
    const opts = generateText.mock.calls[0][0].providerOptions as { anthropic?: { cacheControl?: { type?: string } } }
    expect(opts?.anthropic?.cacheControl?.type).toBe('ephemeral')
  })

  it('passes system + maxOutputTokens through and returns provider/modelId/finishReason', async () => {
    const res = await callModelToolLoop({ modelId: 'claude-sonnet-4-6', system: 'SYS', maxTokens: 12345, messages: [{ role: 'user', content: 'hi' }] })
    const args = generateText.mock.calls[0][0]
    expect(args.system).toBe('SYS')
    expect(args.maxOutputTokens).toBe(12345)
    expect(res).toMatchObject({ provider: 'anthropic', modelId: 'claude-sonnet-4-6', finishReason: 'stop' })
  })
})
