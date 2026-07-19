import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createToolRegistry } from '@main/tools/registry.js'
import { createTraceLog } from '@main/trace/trace.js'
import { registerAiTools, resolveGenerationModel, loadRegistry, resolveKey, resolveRegistryPath, objectGenerationProviderOptions } from '@main/ai/ai.js'
import { reset as resetUserConfig } from '@main/userConfig.js'

describe('AI tools', () => {
  let tools: ReturnType<typeof createToolRegistry>
  const ctx = { actor: 'user' as const }

  beforeEach(() => {
    const trace = createTraceLog()
    tools = createToolRegistry(trace)
    registerAiTools(tools)
  })

  it('loads model registry', async () => {
    const result = await tools.call('ai.registry', {}, ctx) as { version: number; models: unknown[] }
    expect(result.version).toBeGreaterThan(0)
    expect(result.models.length).toBeGreaterThan(0)
  })

  it('resolves the model registry from app roots', () => {
    expect(resolveRegistryPath()).toMatch(/resources\/ai-models\.json$/)
  })

  it('checks key status', async () => {
    const result = await tools.call('ai.keyStatus', {}, ctx) as { statuses: Array<{ provider: string; configured: boolean }> }
    expect(result.statuses.length).toBeGreaterThan(0)
    expect(result.statuses[0]).toHaveProperty('provider')
    expect(result.statuses[0]).toHaveProperty('configured')
  })

  it('does not expose raw provider keys as a renderer tool', () => {
    expect(tools.get('ai.getKey')).toBeUndefined()
  })

  it('registers config.get returning user config without keys', async () => {
    const result = await tools.call('config.get', {}, ctx) as Record<string, unknown>
    expect(result).toHaveProperty('user')
    expect(result).toHaveProperty('defaults')
    expect(JSON.stringify(result)).not.toMatch(/sk-/)
  })
})

describe('model catalog usage contract', () => {
  function model(id: string) {
    const match = loadRegistry().models.find(candidate => candidate.id === id)
    expect(match, `missing model ${id}`).toBeDefined()
    return match!
  }

  it('keeps Claude Fable 5 standard and five-minute cache pricing current', () => {
    expect(model('claude-fable-5')).toMatchObject({
      contextWindow: 1_000_000,
      pricing: {
        inputPerMillion: 10,
        cacheReadInputPerMillion: 1,
        cacheWriteInputPerMillion: 12.5,
        outputPerMillion: 50,
      },
    })
  })

  it('uses provider-published context windows', () => {
    expect(model('claude-haiku-4-5-20251001').contextWindow).toBe(200_000)
    expect(model('gemini-3.1-pro-preview').contextWindow).toBe(1_048_576)
    expect(model('gemini-3.5-flash').contextWindow).toBe(1_048_576)
    expect(model('gemini-3.1-flash-lite').contextWindow).toBe(1_048_576)
    expect(model('gpt-5.5').contextWindow).toBe(1_050_000)
    expect(model('gpt-5.4').contextWindow).toBe(1_050_000)
  })

  it('records long-context price multipliers for models that have them', () => {
    expect(model('gemini-3.1-pro-preview').pricing).toMatchObject({
      longContextThresholdTokens: 200_000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
    })
    for (const id of ['gpt-5.5', 'gpt-5.4']) {
      expect(model(id).pricing).toMatchObject({
        longContextThresholdTokens: 272_000,
        longContextInputMultiplier: 2,
        longContextOutputMultiplier: 1.5,
      })
    }
  })
})

describe('resolveGenerationModel + config.yaml cascade', () => {
  let home: string
  const origHome = process.env.HOME
  const keyEnvs = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY']
  const savedKeys: Record<string, string | undefined> = {}

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-ai-home-'))
    process.env.HOME = home
    for (const k of keyEnvs) { savedKeys[k] = process.env[k]; delete process.env[k] }
    resetUserConfig()
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    process.env.HOME = origHome
    for (const k of keyEnvs) {
      if (savedKeys[k] === undefined) delete process.env[k]
      else process.env[k] = savedKeys[k]
    }
    resetUserConfig()
  })

  function writeConfig(text: string): void {
    mkdirSync(join(home, '.mim'), { recursive: true })
    writeFileSync(join(home, '.mim', 'config.yaml'), text)
    resetUserConfig()
  }

  it('prefers config.yaml defaults.models.chat over the registry default when its key resolves', () => {
    // Make a non-registry-default model the config choice; ensure both providers have keys.
    process.env.ANTHROPIC_API_KEY = 'sk-ant'
    process.env.OPENAI_API_KEY = 'sk-oai'
    writeConfig('defaults:\n  models:\n    chat: gpt-5.4\n')

    const registry = loadRegistry()
    const model = resolveGenerationModel(registry)
    expect(model.id).toBe('gpt-5.4')
  })

  it('falls back to registry defaults when config.yaml has no models default', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant'
    const registry = loadRegistry()
    const model = resolveGenerationModel(registry)
    // registry.defaults.chat[0] is claude-sonnet-5
    expect(model.id).toBe('claude-sonnet-5')
  })
})

describe('ai.setKey emits a key-change signal', () => {
  let home: string
  const origHome = process.env.HOME
  const saved = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-setkey-home-'))
    process.env.HOME = home
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    process.env.HOME = origHome
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = saved
  })

  it('writes the key and notifies listeners that keys changed', async () => {
    const emit = vi.fn()
    const tools = createToolRegistry(createTraceLog())
    registerAiTools(tools, emit)

    await tools.call('ai.setKey', { provider: 'anthropic', key: 'sk-new' }, { actor: 'user' })

    expect(emit).toHaveBeenCalledWith('ai:keys-changed')
    expect(resolveKey('anthropic').key).toBe('sk-new')
  })

  it('clears a saved key from the file and notifies listeners', async () => {
    const emit = vi.fn()
    const tools = createToolRegistry(createTraceLog())
    registerAiTools(tools, emit)

    await tools.call('ai.setKey', { provider: 'anthropic', key: 'sk-new' }, { actor: 'user' })
    expect(resolveKey('anthropic').key).toBe('sk-new')
    emit.mockClear()

    await tools.call('ai.clearKey', { provider: 'anthropic' }, { actor: 'user' })

    expect(emit).toHaveBeenCalledWith('ai:keys-changed')
    expect(resolveKey('anthropic').key).toBeNull()
  })

  it('setKey overrides an env-sourced key so Settings edits take effect', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-from-env'
    const tools = createToolRegistry(createTraceLog())
    registerAiTools(tools, vi.fn())

    await tools.call('ai.setKey', { provider: 'anthropic', key: 'sk-new' }, { actor: 'user' })

    expect(resolveKey('anthropic')).toEqual({ key: 'sk-new', source: 'file' })
  })

  it('keyStatus carries a masked tail for configured keys, never the full key', async () => {
    const tools = createToolRegistry(createTraceLog())
    registerAiTools(tools, vi.fn())

    await tools.call('ai.setKey', { provider: 'anthropic', key: 'sk-ant-api03-abcdefX4Q2' }, { actor: 'user' })
    const result = await tools.call('ai.keyStatus', {}, { actor: 'user' }) as {
      statuses: Array<{ provider: string; configured: boolean; masked: string | null }>
    }

    const anthropic = result.statuses.find(s => s.provider === 'anthropic')!
    expect(anthropic.masked).toBe('sk-ant…X4Q2')
    expect(JSON.stringify(result)).not.toContain('sk-ant-api03-abcdefX4Q2')
  })

  it('keyStatus masked is null when a provider is not configured', async () => {
    const tools = createToolRegistry(createTraceLog())
    registerAiTools(tools, vi.fn())

    const result = await tools.call('ai.keyStatus', {}, { actor: 'user' }) as {
      statuses: Array<{ provider: string; configured: boolean; masked: string | null }>
    }

    expect(result.statuses.find(s => s.provider === 'anthropic')!.masked).toBeNull()
  })

  it('clearKey falls back to the environment key when one is exported', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-from-env'
    const tools = createToolRegistry(createTraceLog())
    registerAiTools(tools, vi.fn())

    await tools.call('ai.setKey', { provider: 'anthropic', key: 'sk-new' }, { actor: 'user' })
    await tools.call('ai.clearKey', { provider: 'anthropic' }, { actor: 'user' })

    expect(resolveKey('anthropic')).toEqual({ key: 'sk-from-env', source: 'env' })
  })
})

describe('resolveKey ignores config.yaml', () => {
  let home: string
  const origHome = process.env.HOME
  const saved = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'mim-key-home-'))
    process.env.HOME = home
    delete process.env.ANTHROPIC_API_KEY
    resetUserConfig()
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    process.env.HOME = origHome
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = saved
    resetUserConfig()
  })

  it('prefers ~/.mim/keys.env over the launch environment', () => {
    // Settings must stay authoritative: a stale key exported in the user's
    // shell must not shadow a key saved (or rotated) from the app.
    process.env.ANTHROPIC_API_KEY = 'sk-from-env'
    mkdirSync(join(home, '.mim'), { recursive: true })
    writeFileSync(join(home, '.mim', 'keys.env'), 'ANTHROPIC_API_KEY=sk-from-file\n')
    const { key, source } = resolveKey('anthropic')
    expect(key).toBe('sk-from-file')
    expect(source).toBe('file')
  })

  it('falls back to the environment when the file has no entry', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-from-env'
    const { key, source } = resolveKey('anthropic')
    expect(key).toBe('sk-from-env')
    expect(source).toBe('env')
  })

  it('reads ~/.mim/keys.env when env var absent', () => {
    mkdirSync(join(home, '.mim'), { recursive: true })
    writeFileSync(join(home, '.mim', 'keys.env'), 'ANTHROPIC_API_KEY=sk-from-file\n')
    const { key, source } = resolveKey('anthropic')
    expect(key).toBe('sk-from-file')
    expect(source).toBe('file')
  })

  it('treats an empty file entry as absent and falls back to env', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-from-env'
    mkdirSync(join(home, '.mim'), { recursive: true })
    writeFileSync(join(home, '.mim', 'keys.env'), 'ANTHROPIC_API_KEY=\n')
    const { key, source } = resolveKey('anthropic')
    expect(key).toBe('sk-from-env')
    expect(source).toBe('env')
  })

  it('never reads a key placed in config.yaml', () => {
    mkdirSync(join(home, '.mim'), { recursive: true })
    writeFileSync(join(home, '.mim', 'config.yaml'), 'ANTHROPIC_API_KEY: sk-from-config\n')
    resetUserConfig()
    const { key } = resolveKey('anthropic')
    expect(key).toBeNull()
  })
})

describe('objectGenerationProviderOptions', () => {
  // Anthropic's native structured-output beta compiles the JSON schema into a
  // constrained-decoding grammar server-side; non-trivial schemas time out with
  // "Grammar compilation timed out." Object generation must use the json-tool
  // path instead, which is reliable and fast.
  it('forces the json-tool path for anthropic', () => {
    expect(objectGenerationProviderOptions('anthropic')).toEqual({
      anthropic: { structuredOutputMode: 'jsonTool' },
    })
  })

  it('leaves other providers on their defaults', () => {
    expect(objectGenerationProviderOptions('openai')).toBeUndefined()
    expect(objectGenerationProviderOptions('google')).toBeUndefined()
  })
})
