import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject, generateText, jsonSchema, stepCountIs, tool, type ModelMessage } from 'ai'
import { chmodSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { buildProviderOptions, type ModelConfig } from '@main/ai/providerOptions.js'
import type { ToolRegistry } from '@main/tools/registry.js'
import { loadUserConfig, resolveModelDefault } from '@main/userConfig.js'
import { userHomeDir } from '@main/platform.js'

interface ModelRegistry {
  version: number
  providers: Record<string, { url: string; apiKeyEnv: string }>
  defaults: Record<string, string[]>
  models: ModelConfig[]
}

interface KeyStatus {
  provider: string
  configured: boolean
  source: string
}

let cachedRegistry: ModelRegistry | null = null

export function loadRegistry(): ModelRegistry {
  if (cachedRegistry) return cachedRegistry

  cachedRegistry = JSON.parse(readFileSync(resolveRegistryPath(), 'utf-8'))
  return cachedRegistry!
}

export function resolveRegistryPath(): string {
  const override = process.env.MIM_AI_MODELS_PATH
  if (override && existsSync(override)) return override

  const appRoots = Array.from(new Set([
    process.cwd(),
    resolve(import.meta.dirname, '../..'),
    resolve(import.meta.dirname, '../../..'),
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    typeof process.resourcesPath === 'string' ? resolve(process.resourcesPath, '..') : '',
  ].filter(Boolean)))

  const candidates = appRoots.flatMap(root => [
    join(root, 'resources', 'ai-models.json'),
    join(root, 'ai-models.json'),
  ])

  const found = candidates.find(candidate => existsSync(candidate))
  if (found) return found

  throw new Error(
    `ai-models.json not found. Checked: ${candidates.slice(0, 8).join(', ')}`,
  )
}

export function resolveKey(provider: string): { key: string | null; source: string } {
  const registry = loadRegistry()
  const providerConfig = registry.providers?.[provider]
  if (!providerConfig) return { key: null, source: 'missing' }

  const envVar = providerConfig.apiKeyEnv
  if (envVar && process.env[envVar]) {
    return { key: process.env[envVar]!, source: 'env' }
  }

  const dotenvPath = join(userHomeDir(), '.mim', 'keys.env')
  if (existsSync(dotenvPath)) {
    const content = readFileSync(dotenvPath, 'utf-8')
    for (const line of content.split(/\r\n|\n|\r/)) {
      const [k, ...rest] = line.split('=')
      if (k?.trim() === envVar && rest.length) {
        return { key: rest.join('=').trim().replace(/^["']|["']$/g, ''), source: 'file' }
      }
    }
  }

  return { key: null, source: 'missing' }
}

export function registerAiTools(tools: ToolRegistry, emit: (channel: string) => void = () => {}): void {
  tools.register({
    name: 'ai.registry',
    description: 'Get the model registry',
    execute: async () => loadRegistry()
  })

  tools.register({
    name: 'ai.keyStatus',
    description: 'Check which AI providers have keys configured',
    execute: async () => {
      const registry = loadRegistry()
      const statuses: KeyStatus[] = []
      for (const provider of Object.keys(registry.providers)) {
        const { key, source } = resolveKey(provider)
        statuses.push({ provider, configured: !!key, source })
      }
      return { statuses }
    }
  })

  tools.register({
    name: 'ai.setKey',
    description: 'Save an API key to ~/.mim/keys.env',
    execute: async (params) => {
      const provider = params.provider as string
      const key = params.key as string
      const registry = loadRegistry()
      const providerConfig = registry.providers?.[provider]
      if (!providerConfig) throw new Error(`Unknown provider: ${provider}`)

      const envVar = providerConfig.apiKeyEnv
      const dir = join(userHomeDir(), '.mim')
      const keysPath = join(dir, 'keys.env')

      mkdirSync(dir, { recursive: true })

      let content = ''
      if (existsSync(keysPath)) {
        content = readFileSync(keysPath, 'utf-8')
        const lines = content.split(/\r\n|\n|\r/)
        const filtered = lines.filter(l => !l.startsWith(`${envVar}=`))
        content = filtered.join('\n')
      }

      content = content.trimEnd() + `\n${envVar}=${key}\n`
      writeFileSync(keysPath, content, { mode: 0o600 })
      // writeFileSync's mode only applies on creation; fix pre-existing files.
      chmodSync(keysPath, 0o600)
      cachedRegistry = null
      // Tell every AI surface (chat, inline, settings, package webviews) to
      // re-check key status now — keys must take effect without an app restart.
      emit('ai:keys-changed')
      return { saved: provider }
    }
  })

  tools.register({
    name: 'ai.clearKey',
    description: 'Remove a provider API key from ~/.mim/keys.env',
    execute: async (params) => {
      const provider = params.provider as string
      const registry = loadRegistry()
      const providerConfig = registry.providers?.[provider]
      if (!providerConfig) throw new Error(`Unknown provider: ${provider}`)

      const envVar = providerConfig.apiKeyEnv
      const keysPath = join(userHomeDir(), '.mim', 'keys.env')
      // Only the file is app-managed; a key supplied via the launch environment
      // is outside our control and intentionally left untouched.
      if (existsSync(keysPath)) {
        const remaining = readFileSync(keysPath, 'utf-8')
          .split(/\r\n|\n|\r/)
          .filter(line => !line.startsWith(`${envVar}=`))
        writeFileSync(keysPath, remaining.join('\n'), { mode: 0o600 })
        chmodSync(keysPath, 0o600)
      }
      cachedRegistry = null
      emit('ai:keys-changed')
      return { cleared: provider }
    }
  })

  tools.register({
    name: 'config.get',
    description: 'Get the user-global config (~/.mim/config.yaml): identity and model defaults. Never returns API keys.',
    inputSchema: objectSchema({}, []),
    execute: async () => loadUserConfig()
  })

  tools.register({
    name: 'ai.generateObject',
    description: 'Generate a structured JSON object with a configured AI model. Intended for package backend jobs.',
    inputSchema: objectSchema({
      modelId: { type: 'string' },
      system: { type: 'string' },
      prompt: { type: 'string' },
      schema: { type: 'object' },
      maxOutputTokens: { type: 'number' },
      temperature: { type: 'number' },
    }, ['prompt', 'schema']),
    execute: async (params) => {
      const result = await generateObjectWithAi({
        modelId: optionalString(params, 'modelId'),
        system: optionalString(params, 'system'),
        prompt: requireString(params, 'prompt'),
        schema: requireSchema(params.schema),
        maxOutputTokens: optionalNumber(params, 'maxOutputTokens'),
        temperature: optionalNumber(params, 'temperature'),
      })

      return result
    },
  })
}

// Anthropic's native structured-output beta (`structured-outputs-2025-11-13`,
// enabled by @ai-sdk/anthropic whenever the model advertises support) compiles
// the JSON schema into a constrained-decoding grammar server-side. Non-trivial
// schemas — nested arrays of objects, the kind a deck plan or any real package
// job produces — routinely exceed the compiler's time budget and fail the whole
// call with `Grammar compilation timed out.` after ~140s. The `jsonTool` path
// sends the schema as a single forced tool call instead: no grammar, ~5s, still
// schema-validated by the SDK. This is the same approach other production
// systems use for structured output from Claude, so we make it the default.
export function objectGenerationProviderOptions(provider: string): Record<string, unknown> | undefined {
  if (provider === 'anthropic') {
    return { anthropic: { structuredOutputMode: 'jsonTool' } }
  }
  return undefined
}

export async function generateObjectWithAi(params: {
  modelId?: string
  system?: string
  prompt: string
  schema: Record<string, unknown>
  maxOutputTokens?: number
  temperature?: number
  signal?: AbortSignal
}): Promise<Record<string, unknown>> {
  const registry = loadRegistry()
  const modelConfig = resolveGenerationModel(registry, params.modelId)
  const { key } = resolveKey(modelConfig.provider)
  if (!key) throw new Error(`No API key configured for ${modelConfig.provider}`)
  const provider = registry.providers[modelConfig.provider]
  if (!provider) throw new Error(`Missing provider config for ${modelConfig.provider}`)

  const startedAt = Date.now()
  const schemaFields = Object.keys((params.schema as { properties?: Record<string, unknown> }).properties ?? {})
  console.info(
    `[ai.generateObject] start model=${modelConfig.id} provider=${modelConfig.provider}`
    + ` fields=[${schemaFields.join(',')}] promptChars=${params.prompt.length}`
    + ` maxOutputTokens=${params.maxOutputTokens ?? 'default'}`
  )

  try {
    const result = await generateObject({
      model: providerFactory(modelConfig.provider)({
        apiKey: key,
        baseURL: providerBaseUrl(modelConfig.provider, provider.url),
      })(modelConfig.model),
      schema: jsonSchema(requireSchema(params.schema)),
      system: params.system,
      prompt: params.prompt,
      maxOutputTokens: params.maxOutputTokens,
      temperature: params.temperature,
      providerOptions: objectGenerationProviderOptions(modelConfig.provider),
      abortSignal: params.signal,
    })

    console.info(
      `[ai.generateObject] ok model=${modelConfig.id} ms=${Date.now() - startedAt}`
      + ` usage=${JSON.stringify(result.usage ?? {})}`
    )

    return {
      object: result.object,
      usage: result.usage,
      modelId: modelConfig.id,
      provider: modelConfig.provider,
    }
  } catch (err) {
    console.error(
      `[ai.generateObject] failed model=${modelConfig.id} ms=${Date.now() - startedAt}:`
      + ` ${err instanceof Error ? err.message : String(err)}`
    )
    throw err
  }
}

export async function callAnthropicToolLoop({
  model = 'claude-sonnet-4-6',
  system,
  messages,
  tools,
  maxTokens = 4096,
  maxSteps = 1,
  signal,
}: {
  model?: string
  system?: string
  messages: Array<{ role: string; content: unknown }>
  tools?: Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
    execute(input: Record<string, unknown>): Promise<unknown> | unknown
  }>
  maxTokens?: number
  maxSteps?: number
  signal?: AbortSignal | null
}) {
  const { key } = resolveKey('anthropic')
  if (!key) throw new Error('No API key configured for anthropic')
  const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  let currentMessages = [...messages]
  let steps = 0
  let finalText = ''
  const toolMap = new Map((tools || []).map(item => [item.name, item]))
  const apiTools = tools?.map(item => ({
    name: item.name,
    description: item.description,
    input_schema: item.input_schema,
  }))

  if (currentMessages[0]) {
    const first = currentMessages[0] as { role: string; content: unknown }
    if (typeof first.content === 'string') {
      currentMessages[0] = {
        ...first,
        content: [{ type: 'text', text: first.content, cache_control: { type: 'ephemeral' } }],
      }
    } else if (Array.isArray(first.content)) {
      const content = [...first.content] as Array<Record<string, unknown>>
      const lastBlock = content[content.length - 1]
      if (lastBlock && !lastBlock.cache_control) lastBlock.cache_control = { type: 'ephemeral' }
      currentMessages[0] = { ...first, content }
    }
  }

  while (steps < maxSteps) {
    if (signal?.aborted) throw new Error('AI request aborted')
    steps++
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: currentMessages,
    }
    if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    if (apiTools?.length) body.tools = apiTools

    const requestSignal = createRequestSignal(signal, 120_000)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: requestSignal.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    }).finally(requestSignal.cleanup)

    if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`)
    const data = await res.json() as Record<string, any>
    if (data.usage) {
      totalUsage.input += data.usage.input_tokens || 0
      totalUsage.output += data.usage.output_tokens || 0
      totalUsage.cacheRead += data.usage.cache_read_input_tokens || 0
      totalUsage.cacheCreation += data.usage.cache_creation_input_tokens || 0
    }

    const content = Array.isArray(data.content) ? data.content : []
    const textBlocks = content.filter((block: Record<string, unknown>) => block.type === 'text')
    const toolUseBlocks = content.filter((block: Record<string, unknown>) => block.type === 'tool_use')
    if (textBlocks.length) finalText = textBlocks.map((block: Record<string, unknown>) => String(block.text || '')).join('')
    if (data.stop_reason !== 'tool_use' || toolUseBlocks.length === 0) {
      return { text: finalText, content, usage: totalUsage, steps }
    }

    currentMessages.push({ role: 'assistant', content })
    const toolResults = []
    for (const toolUse of toolUseBlocks) {
      const toolDef = toolMap.get(String(toolUse.name))
      if (!toolDef) {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: `Unknown tool: ${toolUse.name}` }) })
        continue
      }
      try {
        const result = await toolDef.execute((toolUse.input || {}) as Record<string, unknown>)
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) })
      } catch (err) {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify({ error: (err as Error).message }), is_error: true })
      }
    }
    currentMessages.push({ role: 'user', content: toolResults })
  }

  return { text: finalText, content: [], usage: totalUsage, steps }
}

// Provider-agnostic multi-step tool loop on the Vercel AI SDK. Runs the package
// tool shape ({name, description, input_schema, execute}) against Anthropic,
// OpenAI, or Google. Additive: callAnthropicToolLoop / callGeminiText are
// untouched. Unlike callAnthropicToolLoop it has NO built-in 120s request cap
// (timeoutMs defaults to 0 = no timeout) so long, large-context reviews finish.
export interface ModelToolLoopTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  execute(input: Record<string, unknown>): Promise<unknown> | unknown
}

export interface ModelToolLoopUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export interface ModelToolLoopResult {
  text: string
  content: Array<Record<string, unknown>>
  usage: ModelToolLoopUsage
  steps: number
  finishReason: string
  modelId: string
  provider: string
}

export async function callModelToolLoop(params: {
  modelId?: string
  model?: string
  provider?: string
  system?: string
  messages: Array<{ role: string; content: unknown }>
  tools?: ModelToolLoopTool[]
  maxTokens?: number
  maxSteps?: number
  timeoutMs?: number
  signal?: AbortSignal | null
  controlId?: string
}): Promise<ModelToolLoopResult> {
  const registry = loadRegistry()
  const requestedId = params.modelId || params.model
  const modelConfig = resolveGenerationModel(registry, requestedId)
  const provider = params.provider || modelConfig.provider
  const providerConfig = registry.providers[provider]
  if (!providerConfig) throw new Error(`Missing provider config for ${provider}`)
  const { key } = resolveKey(provider)
  if (!key) throw new Error(`No API key configured for ${provider}`)

  const sdkModel = providerFactory(provider)({
    apiKey: key,
    baseURL: providerBaseUrl(provider, providerConfig.url),
  })(modelConfig.model)

  const toolSet = buildModelToolSet(params.tools)
  const messages = toModelMessages(params.messages)
  const maxSteps = Math.max(1, params.maxSteps ?? 1)
  const { signal, cleanup } = makeLoopSignal(params.signal ?? null, params.timeoutMs ?? 0)

  try {
    const result = await generateText({
      model: sdkModel,
      ...(params.system ? { system: params.system } : {}),
      messages,
      ...(toolSet ? { tools: toolSet } : {}),
      stopWhen: stepCountIs(maxSteps),
      maxOutputTokens: params.maxTokens ?? 8192,
      providerOptions: buildProviderOptions({ ...modelConfig, provider }, params.controlId),
      abortSignal: signal,
    })

    return {
      text: result.text || '',
      content: reconstructAnthropicContent(result),
      // totalUsage sums every step; result.usage is only the last step (undercounts multi-step loops).
      usage: mapModelUsage((result as { totalUsage?: unknown }).totalUsage ?? result.usage),
      steps: Array.isArray(result.steps) ? result.steps.length : 1,
      finishReason: String(result.finishReason || 'stop'),
      modelId: modelConfig.id,
      provider,
    }
  } finally {
    cleanup()
  }
}

function sanitizeToolName(name: string): string {
  return String(name || '').replace(/[^A-Za-z0-9_-]/g, '_')
}

function buildModelToolSet(tools?: ModelToolLoopTool[]): Record<string, unknown> | undefined {
  if (!tools?.length) return undefined
  const set: Record<string, unknown> = {}
  for (const item of tools) {
    const key = sanitizeToolName(item.name)
    if (key in set) throw new Error(`Tool name collision after sanitization: "${item.name}" -> "${key}" is already registered`)
    set[key] = tool({
      description: item.description,
      inputSchema: jsonSchema(item.input_schema as Record<string, unknown>),
      // Mirror callAnthropicToolLoop: a throwing tool must not reject the whole
      // loop, it returns an error result so the model can recover (A11).
      execute: async (input: Record<string, unknown>) => {
        try {
          return await item.execute(input || {})
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    })
  }
  return set
}

function toModelMessages(messages: Array<{ role: string; content: unknown }>): ModelMessage[] {
  return messages.map(message => {
    const role = (message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user')
    if (typeof message.content === 'string') {
      return { role, content: message.content } as ModelMessage
    }
    const blocks = Array.isArray(message.content) ? message.content : []
    const parts = blocks.map(block => convertContentBlock(block)).filter(Boolean)
    return { role, content: parts } as ModelMessage
  })
}

function convertContentBlock(block: unknown): Record<string, unknown> | null {
  if (!block || typeof block !== 'object') return null
  const typed = block as Record<string, unknown>
  if (typed.type === 'text') return { type: 'text', text: String(typed.text || '') }
  if (typed.type === 'image') {
    // Anthropic-native base64 image block -> SDK image part (data URL).
    const source = typed.source as { type?: string; media_type?: string; data?: string } | undefined
    if (source?.data) {
      const mediaType = source.media_type || 'image/png'
      return { type: 'image', image: `data:${mediaType};base64,${source.data}`, mediaType }
    }
    if (typeof typed.image === 'string') return { type: 'image', image: typed.image }
  }
  return null
}

function reconstructAnthropicContent(result: { text?: string; toolCalls?: unknown }): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = []
  if (result.text) content.push({ type: 'text', text: result.text })
  const calls = Array.isArray(result.toolCalls) ? result.toolCalls : []
  for (const call of calls) {
    const typed = call as Record<string, unknown>
    content.push({
      type: 'tool_use',
      id: typed.toolCallId,
      name: typed.toolName,
      input: typed.input ?? typed.args,
    })
  }
  return content
}

function mapModelUsage(usage: Record<string, unknown> | undefined): ModelToolLoopUsage {
  const u = (usage || {}) as Record<string, number | undefined>
  const details = (u.inputTokenDetails || {}) as Record<string, number | undefined>
  return {
    input: u.inputTokens ?? u.promptTokens ?? 0,
    output: u.outputTokens ?? u.completionTokens ?? 0,
    cacheRead: u.cachedInputTokens ?? details.cacheReadTokens ?? 0,
    cacheCreation: u.cacheCreationInputTokens ?? details.cacheWriteTokens ?? 0,
  }
}

function makeLoopSignal(parent: AbortSignal | null, timeoutMs: number): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController()
  const abortFromParent = () => controller.abort(parent?.reason ?? new Error('AI tool loop aborted'))
  if (parent?.aborted) abortFromParent()
  else parent?.addEventListener('abort', abortFromParent, { once: true })

  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error('AI tool loop timed out')), timeoutMs)
    : null
  timer?.unref?.()

  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer)
      parent?.removeEventListener('abort', abortFromParent)
    },
  }
}

export async function callGeminiText({
  model = 'gemini-3.1-flash-lite-preview',
  system,
  messages,
  maxTokens = 4096,
  signal,
}: {
  model?: string
  system?: string
  messages: Array<{ role: string; content: string }>
  maxTokens?: number
  signal?: AbortSignal | null
}) {
  const { key } = resolveKey('google')
  if (!key) throw new Error('No API key configured for google')
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }))
  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens },
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }
  const requestSignal = createRequestSignal(signal, 120_000)
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    signal: requestSignal.signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  }).finally(requestSignal.cleanup)
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`)
  const data = await res.json() as Record<string, any>
  const candidate = data.candidates?.[0]
  return {
    text: candidate?.content?.parts?.map((part: Record<string, unknown>) => String(part.text || '')).join('') || '',
    usage: {
      input: data.usageMetadata?.promptTokenCount || 0,
      output: data.usageMetadata?.candidatesTokenCount || 0,
    },
    finishReason: candidate?.finishReason,
  }
}

export function resolveGenerationModel(registry: ModelRegistry, modelId?: string): ModelConfig {
  if (modelId) {
    const found = registry.models.find(model => model.id === modelId || model.model === modelId)
    if (!found) throw new Error(`Unknown AI model id: ${modelId}`)
    return found
  }

  // config.yaml chat default wins over the registry default when it exists and its key resolves.
  const configChat = resolveModelDefault('chat', {})
  if (configChat) {
    const found = registry.models.find(model => model.id === configChat || model.model === configChat)
    if (found && resolveKey(found.provider).key) return found
  }

  for (const id of registry.defaults?.chat ?? []) {
    const found = registry.models.find(model => model.id === id || model.model === id)
    if (found && resolveKey(found.provider).key) return found
  }

  const configured = registry.models.find(model => resolveKey(model.provider).key)
  if (configured) return configured
  throw new Error('No AI model available. Check your API keys in Settings.')
}

function createRequestSignal(parent: AbortSignal | null | undefined, timeoutMs: number): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('AI request timed out')), timeoutMs)
  const abortFromParent = () => controller.abort(parent?.reason ?? new Error('AI request aborted'))

  if (parent?.aborted) abortFromParent()
  else parent?.addEventListener('abort', abortFromParent, { once: true })

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout)
      parent?.removeEventListener('abort', abortFromParent)
    },
  }
}

function providerFactory(provider: string) {
  switch (provider) {
    case 'anthropic':
      return createAnthropic
    case 'openai':
      return createOpenAI
    case 'google':
      return createGoogleGenerativeAI
    default:
      throw new Error(`Unsupported AI provider: ${provider}`)
  }
}

function providerBaseUrl(provider: string, rawUrl: string): string {
  const url = rawUrl.replace(/\/+$/, '')
  if (provider === 'anthropic') return url.replace(/\/messages$/, '')
  if (provider === 'openai') return url.replace(/\/responses$/, '').replace(/\/chat\/completions$/, '')
  if (provider === 'google') return url.replace(/\/models$/, '')
  return url
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required parameter: ${key}`)
  return value
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  return typeof params[key] === 'string' && params[key].length > 0 ? params[key] : undefined
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  return typeof params[key] === 'number' && Number.isFinite(params[key]) ? params[key] : undefined
}

function requireSchema(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('schema must be a JSON schema object')
  }
  return value as Record<string, unknown>
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: 'object', properties, required }
}
